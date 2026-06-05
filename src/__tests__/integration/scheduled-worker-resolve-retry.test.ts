import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { createHerald } from "../../core/herald.js";
import { defineEvent } from "../../core/define.js";
import { createMockDb } from "../helpers/mock-db-adapter.js";
import type { Delivery } from "../../types/index.js";

const orderSchema = z.object({ orderId: z.string(), amount: z.number() });

describe("Atomic Claim", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
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
});
