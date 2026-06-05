import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { createHerald } from "../../core/herald.js";
import { defineEvent } from "../../core/define.js";
import { createMockDb } from "../support/adapters/mock-db-adapter.js";
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
});
