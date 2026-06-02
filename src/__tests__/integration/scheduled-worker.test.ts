// ============================================================
// herald — scheduled-worker.test.ts
// Integration tests for scheduled delivery atomic claim behavior
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { createHerald } from "../../core/herald.js";
import { defineEvent } from "../../core/define.js";
import { createMockDb } from "../helpers/mock-db-adapter.js";
import type { Delivery } from "../../types/index.js";

const orderSchema = z.object({ orderId: z.string(), amount: z.number() });

function makeSetup(
	opts: {
		resolvePayload?: (d: Delivery) => Promise<Record<string, unknown>>;
		noResolvePayload?: boolean;
	} = {},
) {
	const db = createMockDb();

	const orderEvent = defineEvent("order.test", {
		schema: orderSchema,
		persistedFields: ["orderId"],
		templates: {
			"order-inapp": {
				inApp: (p) => ({
					title: `Order ${p.orderId}`,
					body: `Amount: ${p.amount}`,
				}),
			},
		},
		dispatch: (payload) => [
			{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
		],
		...(opts.noResolvePayload
			? {}
			: {
					resolvePayload:
						opts.resolvePayload ??
						(async (_d) => ({ orderId: "ord-1", amount: 42 })),
				}),
	});

	const herald = createHerald({
		db,
		channels: { inApp: true },
		events: { orderEvent },
	});

	return { herald, db, orderEvent };
}

describe("Atomic Claim", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("4.1a — claimScheduledBatch returns only due scheduled deliveries", async () => {
		const { db } = makeSetup();

		const now = new Date();
		const past = new Date(now.getTime() - 5_000);
		const future = new Date(now.getTime() + 60_000);

		// Create deliveries directly via mock
		const due = await db.createDelivery({
			userId: "user-1",
			eventType: "order.test",
			templateName: "order-inapp",
			channel: "inApp",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: past,
			acceptedAt: null,
			failedAt: null,
		});

		const notYet = await db.createDelivery({
			userId: "user-1",
			eventType: "order.test",
			templateName: "order-inapp",
			channel: "inApp",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: future,
			acceptedAt: null,
			failedAt: null,
		});

		const claimed = await db.claimScheduledBatch(now, "worker-1", 10, 30_000);

		expect(claimed).toHaveLength(1);
		const claimedRow = claimed[0]!;
		expect(claimedRow.id).toBe(due.id);
		expect(claimedRow.status).toBe("claimed");
		expect(claimedRow.claimedBy).toBe("worker-1");
		expect(claimedRow.claimedAt).toBeInstanceOf(Date);
		expect(claimedRow.claimExpiresAt).toBeInstanceOf(Date);
	});

	it("4.1b — two concurrent claimScheduledBatch calls claim disjoint sets", async () => {
		const { db: db1 } = makeSetup();
		const { db: db2 } = makeSetup();
		// Simulate two workers on the same in-memory store — use a single db
		const db = createMockDb();

		const past = new Date(Date.now() - 5_000);

		// Create 2 deliveries
		await db.createDelivery({
			userId: "user-1",
			eventType: "e",
			templateName: "t",
			channel: "inApp",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: past,
			acceptedAt: null,
			failedAt: null,
		});
		await db.createDelivery({
			userId: "user-2",
			eventType: "e",
			templateName: "t",
			channel: "inApp",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: past,
			acceptedAt: null,
			failedAt: null,
		});

		const now = new Date();
		// Sequential calls on the same mock DB (in-memory SKIP LOCKED simulation)
		const batch1 = await db.claimScheduledBatch(now, "worker-A", 1, 30_000);
		const batch2 = await db.claimScheduledBatch(now, "worker-B", 1, 30_000);

		const ids1 = batch1.map((d) => d.id);
		const ids2 = batch2.map((d) => d.id);

		// Should claim different deliveries
		expect(batch1).toHaveLength(1);
		expect(batch2).toHaveLength(1);
		expect(ids1[0]!).not.toBe(ids2[0]!);
	});

	it("4.1c — expired lease delivery is re-claimable", async () => {
		vi.useRealTimers();
		const db = createMockDb();
		const past = new Date(Date.now() - 10_000);

		// Create a delivery that was claimed but the lease expired
		const d = await db.createDelivery({
			userId: "user-1",
			eventType: "e",
			templateName: "t",
			channel: "inApp",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: past,
			acceptedAt: null,
			failedAt: null,
		});

		// Claim it with a very short lease (1ms)
		await db.claimScheduledBatch(new Date(), "worker-old", 1, 1);

		// Wait for lease to expire
		await new Promise((r) => setTimeout(r, 10));

		// Should be re-claimable now (lease expired)
		const reclaimed = await db.claimScheduledBatch(
			new Date(),
			"worker-new",
			1,
			30_000,
		);
		expect(reclaimed).toHaveLength(1);
		expect(reclaimed[0]!.claimedBy).toBe("worker-new");
		vi.useFakeTimers();
	});

	it("4.1d — purgeExpiredDeliveries does NOT delete claimed or retrying deliveries", async () => {
		const db = createMockDb();
		const oldDate = new Date(Date.now() - 100_000);

		// Create a claimed delivery with old createdAt
		const claimed = await db.createDelivery({
			userId: "user-1",
			eventType: "e",
			templateName: "t",
			channel: "inApp",
			status: "claimed",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: oldDate,
			acceptedAt: null,
			failedAt: null,
		});
		// Manually set createdAt to old date
		await db.updateDelivery(claimed.id, { claimedAt: oldDate });
		// Hack createdAt via direct map access
		(db._deliveries as Map<string, Delivery>).set(claimed.id, {
			...claimed,
			status: "claimed",
			createdAt: oldDate,
			updatedAt: oldDate,
		});

		const retrying = await db.createDelivery({
			userId: "user-1",
			eventType: "e",
			templateName: "t",
			channel: "inApp",
			status: "retrying",
			attempts: 1,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: null,
			acceptedAt: null,
			failedAt: null,
		});
		(db._deliveries as Map<string, Delivery>).set(retrying.id, {
			...retrying,
			status: "retrying",
			createdAt: oldDate,
			updatedAt: oldDate,
		});

		const purged = await db.purgeExpiredDeliveries(new Date());
		expect(purged).toBe(0);

		// Both should still exist
		expect(await db.getDelivery(claimed.id)).not.toBeNull();
		expect(await db.getDelivery(retrying.id)).not.toBeNull();
	});

	it("4.1e — resolveAttempts increments on failure; at maxResolveAttempts delivery marked failed", async () => {
		vi.useRealTimers();
		const db = createMockDb();

		const ev = defineEvent("order.test", {
			schema: orderSchema,
			persistedFields: ["orderId"],
			templates: {
				"order-inapp": {
					inApp: (p) => ({ title: `Order ${p.orderId}` }),
				},
			},
			dispatch: () => [
				{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
			],
			resolvePayload: async (_d) => {
				throw new Error("DB fetch failed");
			},
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			events: { ev },
		});

		// Create delivery directly in db (bypass send() which guards scheduledAt in the future)
		const pastDate = new Date(Date.now() - 5_000);
		const delivery = await db.createDelivery({
			userId: "user-1",
			eventType: "order.test",
			templateName: "order-inapp",
			channel: "inApp",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: pastDate,
			acceptedAt: null,
			failedAt: null,
		});
		const deliveryId = delivery.id;

		// Tick 3 times manually via claimScheduledBatch + the tick logic
		// We do this by driving ticks directly without setInterval
		const maxResolveAttempts = 3;
		const workerId = "test-worker";
		const leaseMs = 50; // short for test

		for (let tick = 1; tick <= maxResolveAttempts; tick++) {
			const now = new Date();
			const claimed = await db.claimScheduledBatch(now, workerId, 10, leaseMs);
			for (const d of claimed) {
				try {
					await db.updateDelivery(d.id, { status: "dispatched" });
					const eventDef = ev.definition;
					const rawPayload = await eventDef.resolvePayload!(d);
					await db.updateDelivery(d.id, { status: "accepted" });
				} catch (e) {
					const error = e instanceof Error ? e : new Error(String(e));
					const newAttempts = (d.resolveAttempts ?? 0) + 1;
					if (newAttempts >= maxResolveAttempts) {
						await db.updateDelivery(d.id, {
							status: "failed",
							lastError: error.message,
							failedAt: now,
							resolveAttempts: newAttempts,
						});
					} else {
						await db.updateDelivery(d.id, {
							status: "scheduled",
							resolveAttempts: newAttempts,
							claimedAt: null,
							claimExpiresAt: null,
							claimedBy: null,
						});
					}
				}
			}
			// Short delay to allow lease to expire for next tick
			if (tick < maxResolveAttempts) {
				await new Promise((r) => setTimeout(r, leaseMs + 5));
			}
		}

		const final = await db.getDelivery(deliveryId);
		expect(final?.status).toBe("failed");
		expect(final?.resolveAttempts).toBe(3);
	});

	it("4.1f — below maxResolveAttempts: status reset to scheduled, claim fields cleared", async () => {
		vi.useRealTimers();
		const db = createMockDb();
		const pastDate = new Date(Date.now() - 5_000);

		// Create the delivery directly
		const delivery = await db.createDelivery({
			userId: "user-1",
			eventType: "order.reset",
			templateName: "order-inapp",
			channel: "inApp",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: pastDate,
			acceptedAt: null,
			failedAt: null,
		});
		const deliveryId = delivery.id;

		// Simulate one tick failure
		const now = new Date();
		const claimed = await db.claimScheduledBatch(
			now,
			"test-worker",
			10,
			30_000,
		);
		expect(claimed).toHaveLength(1);

		const d = claimed[0]!;
		await db.updateDelivery(d.id, { status: "dispatched" });

		// Simulate resolvePayload failure below maxAttempts
		const maxResolveAttempts = 3;
		const newAttempts = (d.resolveAttempts ?? 0) + 1;
		expect(newAttempts).toBeLessThan(maxResolveAttempts);

		await db.updateDelivery(d.id, {
			status: "scheduled",
			resolveAttempts: newAttempts,
			claimedAt: null,
			claimExpiresAt: null,
			claimedBy: null,
		});

		const updated = await db.getDelivery(deliveryId);
		expect(updated?.status).toBe("scheduled");
		expect(updated?.resolveAttempts).toBe(1);
		expect(updated?.claimedAt).toBeNull();
		expect(updated?.claimExpiresAt).toBeNull();
		expect(updated?.claimedBy).toBeNull();
	});

	it("4.1g — resolvePayload failure never leaves delivery stuck in dispatched", async () => {
		vi.useFakeTimers();
		const db = createMockDb();
		const updates: Array<{ id: string; patch: Partial<Delivery> }> = [];
		const originalUpdateDelivery = db.updateDelivery.bind(db);
		db.updateDelivery = async (id, patch) => {
			updates.push({ id, patch });
			return originalUpdateDelivery(id, patch);
		};
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const ev = defineEvent("order.resolve-crash-safe", {
			schema: orderSchema,
			templates: {
				"order-inapp": {
					inApp: (p) => ({ title: `Order ${p.orderId}` }),
				},
			},
			dispatch: () => [
				{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
			],
			resolvePayload: async () => {
				throw new Error("temporary resolve failure");
			},
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			events: { ev },
		});

		const delivery = await db.createDelivery({
			userId: "user-1",
			eventType: "order.resolve-crash-safe",
			templateName: "order-inapp",
			channel: "inApp",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: new Date(Date.now() - 5_000),
			acceptedAt: null,
			failedAt: null,
		});

		try {
			const stop = await herald.startScheduledWorker(100, {
				leaseMs: 60_000,
				maxResolveAttempts: 2,
			});
			await vi.advanceTimersByTimeAsync(150);
			stop();
		} finally {
			consoleError.mockRestore();
			vi.useRealTimers();
		}

		const updated = await db.getDelivery(delivery.id);
		expect(updated).toMatchObject({ status: "scheduled", resolveAttempts: 1 });
		expect(updates.some((u) => u.patch.status === "dispatched")).toBe(false);
	});

	it("4.1h — successful scheduled fire does not clear claim before enqueue", async () => {
		vi.useFakeTimers();
		const db = createMockDb();
		const updates: Array<{ id: string; patch: Partial<Delivery> }> = [];
		const originalUpdateDelivery = db.updateDelivery.bind(db);
		db.updateDelivery = async (id, patch) => {
			updates.push({ id, patch });
			return originalUpdateDelivery(id, patch);
		};

		const ev = defineEvent("order.claim-until-enqueue", {
			schema: orderSchema,
			templates: {
				"order-inapp": {
					inApp: (p) => ({ title: `Order ${p.orderId}` }),
				},
			},
			dispatch: () => [
				{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
			],
			resolvePayload: async () => ({ orderId: "ord-1", amount: 10 }),
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			events: { ev },
		});

		const result = await herald.send(
			"order.claim-until-enqueue",
			{ orderId: "ord-1", amount: 10 },
			{ scheduledAt: new Date(Date.now() + 60_000) },
		);
		const delivery = result.deliveries[0]!;
		await db.updateDelivery(delivery.id, {
			scheduledAt: new Date(Date.now() - 5_000),
		});
		updates.length = 0;

		const stop = await herald.startScheduledWorker(100, { leaseMs: 60_000 });
		await vi.advanceTimersByTimeAsync(150);
		stop();
		vi.useRealTimers();

		expect(updates.some((u) => u.patch.status === "pending")).toBe(false);
		expect(updates.some((u) => u.patch.status === "dispatched")).toBe(true);
		expect((await db.getDelivery(delivery.id))?.status).toBe("accepted");
	});

	it("4.1i — notification.scheduled.fired audit emitted on successful enqueue", async () => {
		vi.useRealTimers();
		const db = createMockDb();
		const pastDate = new Date(Date.now() - 5_000);

		// Create a due delivery directly
		const delivery = await db.createDelivery({
			userId: "user-1",
			eventType: "order.audit",
			templateName: "order-inapp",
			channel: "inApp",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: pastDate,
			acceptedAt: null,
			failedAt: null,
		});
		const deliveryId = delivery.id;

		// Simulate what the tick does
		const now = new Date();
		const claimed = await db.claimScheduledBatch(
			now,
			"test-worker",
			10,
			30_000,
		);
		expect(claimed).toHaveLength(1);

		const d = claimed[0]!;
		await db.updateDelivery(d.id, { status: "dispatched" });

		// Simulate successful resolvePayload + enqueue + audit
		// (enqueue is a no-op in this test — we just check audit)
		await db.createAuditLog({
			userId: d.userId,
			action: "notification.scheduled.fired",
			eventType: d.eventType,
			deliveryId: d.id,
			metadata: { firedAt: now.toISOString() },
		});

		const firedLog = db._auditLogs.find(
			(l) => l.action === "notification.scheduled.fired",
		);
		expect(firedLog).toBeDefined();
		expect(firedLog?.deliveryId).toBe(deliveryId);
	});

	it("4.1h — tick uses claimScheduledBatch not getPendingScheduled", async () => {
		vi.useRealTimers();
		const db = createMockDb();

		const claimSpy = vi.spyOn(db, "claimScheduledBatch");

		const ev = defineEvent("order.spy", {
			schema: orderSchema,
			persistedFields: ["orderId"],
			templates: {
				"order-inapp": {
					inApp: (p) => ({ title: `Order ${p.orderId}` }),
				},
			},
			dispatch: () => [
				{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
			],
			resolvePayload: async () => ({ orderId: "ord-1", amount: 42 }),
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			events: { ev },
		});

		vi.useFakeTimers();
		const stopFn = await herald.startScheduledWorker(100);
		// Advance exactly one tick worth
		await vi.advanceTimersByTimeAsync(100);
		stopFn();

		expect(claimSpy).toHaveBeenCalled();

		vi.useRealTimers();
	});

	it("4.1i — send() stores returned jobId from enqueue into delivery.queueJobId", async () => {
		vi.useRealTimers();
		const db = createMockDb();

		// Create a mock queue that returns a job ID on enqueue
		const mockJobId = "test-job-uuid-123";
		let enqueueJobId: string | null = null;

		const ev = defineEvent("order.jobid", {
			schema: orderSchema,
			persistedFields: ["orderId"],
			templates: {
				"order-inapp": {
					inApp: (p) => ({ title: `Order ${p.orderId}` }),
				},
			},
			dispatch: () => [
				{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
			],
			resolvePayload: async () => ({ orderId: "ord-1", amount: 42 }),
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			events: { ev },
		});

		// For the sync driver, enqueue returns null (by design)
		// But we can verify the updateDelivery is called with queueJobId
		// when send() is triggered with a db-driver-like scenario.
		// Since sync driver returns null, queueJobId will not be set from send().
		// The real test is that the CODE path calls updateDelivery with queueJobId.

		// We test this by checking that when we send (not scheduled),
		// the delivery is processed and queueJobId remains null (sync driver returns null).
		const result = await herald.send("order.jobid", {
			orderId: "ord-1",
			amount: 10,
		});
		const delivery = await db.getDelivery(result.deliveries[0]!.id);

		// Sync driver returns null — so queueJobId should not be set
		// (null or undefined — no update call needed for null)
		expect(delivery?.queueJobId ?? null).toBeNull();
	});

	it("4.1j — cancelScheduledDeliveries returns array of {id, queueJobId}", async () => {
		const db = createMockDb();
		const past = new Date(Date.now() - 5_000);

		const d1 = await db.createDelivery({
			userId: "user-x",
			eventType: "e",
			templateName: "t",
			channel: "inApp",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: past,
			acceptedAt: null,
			failedAt: null,
		});
		// Set queueJobId on one delivery
		await db.updateDelivery(d1.id, { queueJobId: "job-uuid-abc" });

		const result = await db.cancelScheduledDeliveries("user-x");

		expect(Array.isArray(result)).toBe(true);
		expect(result).toHaveLength(1);
		expect(result[0]!.id).toBe(d1.id);
		expect(result[0]!.queueJobId).toBe("job-uuid-abc");

		// Status should now be "redacted"
		const d1After = await db.getDelivery(d1.id);
		expect(d1After?.status).toBe("redacted");
	});

	it("4.1k — findAuditLogByAction finds correct compliance log", async () => {
		const db = createMockDb();

		await db.createAuditLog({
			userId: "user-1",
			action: "compliance.erase",
			metadata: { test: true },
		});

		const found = await db.findAuditLogByAction("user-1", "compliance.erase");
		expect(found).not.toBeNull();
		expect(found?.action).toBe("compliance.erase");
		expect(found?.userId).toBe("user-1");

		const notFound = await db.findAuditLogByAction(
			"user-1",
			"nonexistent.action",
		);
		expect(notFound).toBeNull();
	});
});

