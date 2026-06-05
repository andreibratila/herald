import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockDb } from "../helpers/mock-db-adapter.js";
import type { Delivery } from "../../types/index.js";

describe("Atomic Claim", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
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
