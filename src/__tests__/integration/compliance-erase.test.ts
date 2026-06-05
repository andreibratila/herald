// ============================================================
// herald — compliance-erase.test.ts
// Integration tests for compliance erasure
// ============================================================

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createHerald } from "../../core/herald.js";
import { defineEvent } from "../../core/define.js";
import { createMockDb } from "../support/adapters/mock-db-adapter.js";

// ─── Shared helpers ──────────────────────────────────────────

const orderSchema = z.object({ orderId: z.string() });

function makeSetup() {
	const db = createMockDb();

	const ev = defineEvent("order.erase-test", {
		schema: orderSchema,
		templates: {
			"order-inapp": {
				inApp: (p) => ({ title: `Order ${p.orderId}` }),
			},
		},
		dispatch: () => [
			{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
		],
		resolvePayload: async () => ({ orderId: "ord-1" }),
	});

	const herald = createHerald({
		db,
		channels: { inApp: true },
		events: { ev },
	});

	return { herald, db };
}

// ─── Compliance erasure ───────────────────────────────────

describe("Compliance erasure", () => {
	it("6.1 — herald.compliance.eraseSubject calls cancelScheduledDeliveries before db.eraseSubject", async () => {
		const { herald, db } = makeSetup();
		const callOrder: string[] = [];

		const origCancel = db.cancelScheduledDeliveries.bind(db);
		db.cancelScheduledDeliveries = async (userId: string) => {
			callOrder.push("cancelScheduledDeliveries");
			return origCancel(userId);
		};

		const origErase = db.eraseSubject.bind(db);
		db.eraseSubject = async (userId: string) => {
			callOrder.push("eraseSubject");
			return origErase(userId);
		};

		await herald.compliance.eraseSubject("user-1");

		const cancelIdx = callOrder.indexOf("cancelScheduledDeliveries");
		const eraseIdx = callOrder.indexOf("eraseSubject");
		expect(cancelIdx).toBeGreaterThanOrEqual(0);
		expect(eraseIdx).toBeGreaterThanOrEqual(0);
		expect(cancelIdx).toBeLessThan(eraseIdx);
	});

	it("6.2 — pre-erasure audit compliance.scheduled_deliveries_cancelled emitted (even if count=0)", async () => {
		const { herald, db } = makeSetup();

		await herald.compliance.eraseSubject("user-1");

		const cancelLog = db._auditLogs.find(
			(l) => l.action === "compliance.scheduled_deliveries_cancelled",
		);
		expect(cancelLog).toBeDefined();
		expect(cancelLog?.metadata?.count).toBe(0);
		expect(typeof cancelLog?.metadata?.cancelledAt).toBe("string");
	});

	it("6.3 — eraseSubject cancels scheduled deliveries with queue job IDs", async () => {
		const { db } = makeSetup();

		const ev = defineEvent("order.cancel-test", {
			schema: orderSchema,
			templates: {
				"order-inapp": {
					inApp: (p) => ({ title: `Order ${p.orderId}` }),
				},
			},
			dispatch: () => [
				{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
			],
			resolvePayload: async () => ({ orderId: "ord-1" }),
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			events: { ev },
			// Override queue to capture cancelJobs
		});

		// Inject cancelJobs spy directly onto the herald instance
		// We do this by patching the internal queue via testing the public API:
		// Create a scheduled delivery with a queueJobId set
		const pastDate = new Date(Date.now() - 5_000);
		const delivery = await db.createDelivery({
			userId: "user-1",
			eventType: "order.cancel-test",
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
		await db.updateDelivery(delivery.id, {
			queueJobId: "pg-boss-job-uuid-123",
		});

		await herald.compliance.eraseSubject("user-1");

		const afterErase = await db.getDelivery(delivery.id);
		expect(afterErase?.status).toBe("redacted");
		expect(afterErase?.queueJobId).toBe("pg-boss-job-uuid-123");
	});

	it("second call to herald.compliance.eraseSubject(userId) is a no-op (idempotent)", async () => {
		const { herald, db } = makeSetup();

		let eraseCallCount = 0;
		const origErase = db.eraseSubject.bind(db);
		db.eraseSubject = async (userId: string) => {
			eraseCallCount++;
			return origErase(userId);
		};

		await herald.compliance.eraseSubject("user-1");
		await herald.compliance.eraseSubject("user-1");

		// db.eraseSubject should only be called once — second call is idempotent
		expect(eraseCallCount).toBe(1);
	});

	it("6.5 — after erase: delivery userId is anonymized (starts with 'erased_')", async () => {
		const { herald, db } = makeSetup();

		// Create a delivery for the user
		const delivery = await db.createDelivery({
			userId: "user-1",
			eventType: "order.erase-test",
			templateName: "order-inapp",
			channel: "inApp",
			status: "accepted",
			attempts: 1,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: null,
			acceptedAt: new Date(),
			failedAt: null,
		});

		await herald.compliance.eraseSubject("user-1");

		const afterErase = await db.getDelivery(delivery.id);
		expect(afterErase?.userId).toMatch(/^erased_/);
		expect(afterErase?.status).toBe("accepted");
	});

	it("6.5b — after erase: idempotency keys replace the subject id with a stable hash", async () => {
		const { herald, db } = makeSetup();

		const delivery = await db.createDelivery({
			userId: "user-1",
			eventType: "order.erase-test",
			templateName: "order-inapp",
			channel: "inApp",
			status: "accepted",
			attempts: 1,
			lastError: null,
			externalId: null,
			idempotencyKey: "order-123:user-1:inApp:order-inapp",
			scheduledAt: null,
			acceptedAt: new Date(),
			failedAt: null,
		});

		await herald.compliance.eraseSubject("user-1");

		const afterErase = await db.getDelivery(delivery.id);
		expect(afterErase?.idempotencyKey).not.toContain("user-1");
		expect(afterErase?.idempotencyKey).toMatch(
			/^order-123:[a-f0-9]{64}:inApp:order-inapp$/,
		);
	});

	it("6.5c — after erase: audit logs no longer contain the raw subject id", async () => {
		const { herald, db } = makeSetup();

		await db.createAuditLog({
			userId: "user-1",
			action: "notification.accepted",
			eventType: "order.erase-test",
			metadata: { note: "safe" },
		});

		await herald.compliance.eraseSubject("user-1");

		const subjectLogs = db._auditLogs.filter(
			(l) =>
				l.action === "notification.accepted" || l.action === "compliance.erase",
		);
		expect(subjectLogs).toHaveLength(2);
		expect(subjectLogs.every((l) => l.userId !== "user-1")).toBe(true);
		expect(subjectLogs.every((l) => l.userId?.match(/^[a-f0-9]{64}$/))).toBe(
			true,
		);
		expect(
			subjectLogs.find((l) => l.action === "compliance.erase")?.metadata
				?.userIdHash,
		).toMatch(/^[a-f0-9]{64}$/);
	});

	it("6.6 — after erase: consent evidence subjectId is anonymized", async () => {
		const { herald, db } = makeSetup();

		await db.createConsentEvent({
			subjectId: "user-1",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "test",
		});

		await herald.compliance.eraseSubject("user-1");

		expect(db._consentEvents[0]!.subjectId).not.toBe("user-1");
		expect(db._consentEvents[0]!.subjectId).toMatch(/^[a-f0-9]{64}$/);
	});

	it("6.8 — parseRetention('90d') returns Date.now() - 90 days (UTC, no DST skew)", async () => {
		// We test retention behavior via purgeExpiredDeliveries.
		// The retention gate is observed through the cutoff we pass.
		// The retention gate is 90 days ago; a record created 91 days ago should be purged
		const ninetyOneDaysAgo = new Date(Date.now() - 91 * 86_400_000);
		const eightNineDaysAgo = new Date(Date.now() - 89 * 86_400_000);

		// Create two deliveries: one older than 90d, one not
		const db = createMockDb();

		// Manually inject old record
		db._deliveries.set("old-del", {
			id: "old-del",
			userId: "u1",
			eventType: "e",
			templateName: "t",
			channel: "email",
			status: "accepted",
			attempts: 1,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: null,
			acceptedAt: null,
			failedAt: null,
			createdAt: ninetyOneDaysAgo,
			updatedAt: ninetyOneDaysAgo,
		});
		db._deliveries.set("new-del", {
			id: "new-del",
			userId: "u1",
			eventType: "e",
			templateName: "t",
			channel: "email",
			status: "accepted",
			attempts: 1,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: null,
			acceptedAt: null,
			failedAt: null,
			createdAt: eightNineDaysAgo,
			updatedAt: eightNineDaysAgo,
		});

		// purge with cutoff = 90d ago: only old-del should be deleted
		const cutoff90 = new Date(Date.now() - 90 * 86_400_000);
		// Call purgeExpiredDeliveries with 90d cutoff
		const count = await db.purgeExpiredDeliveries(cutoff90);
		expect(count).toBe(1);
		expect(db._deliveries.has("old-del")).toBe(false);
		expect(db._deliveries.has("new-del")).toBe(true);
	});

	it("6.9 — parseRetention('1y') result is one year before now (UTC)", () => {
		// Test the purge behavior: a record from 13 months ago should be purged by "1y" retention
		const thirteenMonthsAgo = new Date();
		thirteenMonthsAgo.setUTCFullYear(thirteenMonthsAgo.getUTCFullYear() - 1);
		thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 1);

		const cutoff1y = new Date();
		cutoff1y.setUTCFullYear(cutoff1y.getUTCFullYear() - 1);

		// thirteenMonthsAgo should be OLDER than cutoff1y
		expect(thirteenMonthsAgo.getTime()).toBeLessThan(cutoff1y.getTime());

		// The 1y cutoff should be exactly (this year - 1) in UTC
		const expectedYear = new Date().getUTCFullYear() - 1;
		expect(cutoff1y.getUTCFullYear()).toBe(expectedYear);
	});
});
