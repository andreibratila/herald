// ============================================================
// herald — src/adapters/db/kysely.ts unit tests
// Tests for the Kysely adapter mapping logic (no real DB needed)
// ============================================================

import { describe, it, expect } from "vitest";
import { createKyselyAdapter } from "../../../adapters/db/kysely.js";

// ─── Mock Kysely DB builder ───────────────────────────────────
// We build a chainable mock that captures the final `.set(...)` call
// and what `.where(...)` chains were built, without hitting a real DB.

function makeMockKysely(
	selectRows: Record<string, Array<Record<string, any>>> = {},
) {
	// Capture what updateTable().set(...).where().returningAll().executeTakeFirstOrThrow() receives
	const calls: {
		table: string;
		set: Record<string, any>;
		where: Array<[string, string, any]>;
	}[] = [];
	// Capture deleteFrom().where() chains
	const deleteCalls: { table: string; where: Array<[string, string, any]> }[] =
		[];
	// Capture selectFrom().selectAll().where() chains
	const selectCalls: {
		table: string;
		where: Array<[string, string, any]>;
		orderBy?: Array<[string, string]>;
	}[] = [];
	// Capture insertInto().values(...) payloads
	const insertCalls: { table: string; values: Record<string, any> }[] = [];

	function makeUpdateChain(table: string) {
		const wheres: Array<[string, string, any]> = [];
		let setData: Record<string, any> = {};

		const chain: any = {
			set(data: Record<string, any>) {
				setData = data;
				return chain;
			},
			where(col: string, op: string, val: any) {
				wheres.push([col, op, val]);
				return chain;
			},
			returningAll() {
				return chain;
			},
			async executeTakeFirstOrThrow() {
				calls.push({ table, set: setData, where: wheres });
				// Return a minimal fake delivery row
				return {
					id: "d1",
					user_id: "u1",
					event_type: "order.completed",
					template_name: "t",
					channel: "email",
					status: "scheduled",
					attempts: 0,
					last_error: null,
					external_id: null,
					idempotency_key: null,
					scheduled_at: setData.scheduled_at ?? null,
					accepted_at: null,
					failed_at: null,
					created_at: new Date(),
					updated_at: new Date(),
				};
			},
			async execute() {
				calls.push({ table, set: setData, where: wheres });
				return [];
			},
		};
		return chain;
	}

	function makeDeleteChain(table: string) {
		const wheres: Array<[string, string, any]> = [];
		const chain: any = {
			where(col: string, op: string, val: any) {
				wheres.push([col, op, val]);
				return chain;
			},
			async executeTakeFirst() {
				deleteCalls.push({ table, where: wheres });
				return { numDeletedRows: BigInt(0) };
			},
		};
		return chain;
	}

	function makeSelectChain(table: string) {
		const wheres: Array<[string, string, any]> = [];
		const orders: Array<[string, string]> = [];
		const chain: any = {
			selectAll() {
				return chain;
			},
			where(col: string, op: string, val: any) {
				wheres.push([col, op, val]);
				return chain;
			},
			orderBy(col: string, dir: string) {
				orders.push([col, dir]);
				return chain;
			},
			limit(_n: number) {
				return chain;
			},
			offset(_n: number) {
				return chain;
			},
			async execute() {
				selectCalls.push({ table, where: wheres, orderBy: orders });
				return selectRows[table] ?? [];
			},
			async executeTakeFirst() {
				selectCalls.push({ table, where: wheres, orderBy: orders });
				return selectRows[table]?.[0];
			},
		};
		return chain;
	}

	function makeInsertChain(table: string) {
		let valuesData: Record<string, any> = {};
		const chain: any = {
			values(data: Record<string, any>) {
				valuesData = data;
				return chain;
			},
			returningAll() {
				return chain;
			},
			async executeTakeFirstOrThrow() {
				insertCalls.push({ table, values: valuesData });
				return {
					...valuesData,
					created_at: valuesData.created_at ?? new Date(),
					updated_at: valuesData.updated_at ?? new Date(),
				};
			},
			async execute() {
				insertCalls.push({ table, values: valuesData });
				return [];
			},
		};
		return chain;
	}

	const db: any = {
		updateTable: (table: string) => makeUpdateChain(table),
		deleteFrom: (table: string) => makeDeleteChain(table),
		selectFrom: (table: string) => makeSelectChain(table),
		insertInto: (table: string) => makeInsertChain(table),
		transaction: () => ({ execute: async (fn: any) => fn(db) }),
	};

	return { db, calls, deleteCalls, selectCalls, insertCalls };
}

// ─── Task 2.5 RED: updateDelivery persists scheduledAt ────────

describe("Kysely adapter — updateDelivery", () => {
	it("maps scheduledAt to scheduled_at in the update payload", async () => {
		const { db, calls } = makeMockKysely();
		const adapter = createKyselyAdapter(db);
		const date = new Date("2030-06-01T12:00:00Z");

		await adapter.updateDelivery("d1", { scheduledAt: date });

		expect(calls).toHaveLength(1);
		expect(calls[0]!.set).toHaveProperty("scheduled_at", date);
	});

	it("does not include scheduled_at when scheduledAt is not provided", async () => {
		const { db, calls } = makeMockKysely();
		const adapter = createKyselyAdapter(db);

		await adapter.updateDelivery("d1", { status: "accepted" });

		expect(calls).toHaveLength(1);
		expect(calls[0]!.set).not.toHaveProperty("scheduled_at");
	});

	it("maps compliance snapshot fields to snake_case in the update payload", async () => {
		const { db, calls } = makeMockKysely();
		const adapter = createKyselyAdapter(db);
		const checkedAt = new Date("2030-06-01T12:00:00Z");

		await adapter.updateDelivery("d1", {
			addressHash: "hash:user@example.com",
			purpose: "marketing.newsletter",
			legalBasisAtSend: "consent",
			consentEventId: "consent_1",
			suppressionId: "suppression_1",
			complianceRequired: true,
			complianceRequiresConsentEvent: true,
			complianceRequiresSuppressionCheck: true,
			complianceRequiresEvidence: false,
			complianceDefaultDecision: "deny_without_evidence",
			complianceDecision: "denied",
			complianceCheckedAt: checkedAt,
		});

		expect(calls[0]!.set).toMatchObject({
			address_hash: "hash:user@example.com",
			purpose: "marketing.newsletter",
			legal_basis_at_send: "consent",
			consent_event_id: "consent_1",
			suppression_id: "suppression_1",
			compliance_required: true,
			compliance_requires_consent_event: true,
			compliance_requires_suppression_check: true,
			compliance_requires_evidence: false,
			compliance_default_decision: "deny_without_evidence",
			compliance_decision: "denied",
			compliance_checked_at: checkedAt,
		});
	});
});

describe("Kysely adapter — JSONB fields", () => {
	it("stores notification data as an object, not a JSON string", async () => {
		const { db, insertCalls } = makeMockKysely();
		const adapter = createKyselyAdapter(db);
		const data = { orderId: "ord_1", nested: { ok: true } };

		const notification = await adapter.createNotification({
			userId: "user_1",
			eventType: "order.completed",
			templateName: "order-inapp",
			deliveryId: "del_1",
			title: "Order complete",
			body: null,
			href: null,
			data,
			readAt: null,
		});

		expect(insertCalls[0]!.values.data).toEqual(data);
		expect(typeof insertCalls[0]!.values.data).toBe("object");
		expect(notification.data).toEqual(data);
	});

	it("throws when JSONB read values are pre-stringified instead of objects", async () => {
		const { db } = makeMockKysely({
			herald_notifications: [
				{
					id: "notif_1",
					user_id: "user_1",
					event_type: "order.completed",
					template_name: "order-inapp",
					delivery_id: "del_1",
					title: "Order complete",
					body: null,
					href: null,
					data: JSON.stringify({ orderId: "ord_1" }),
					read_at: null,
					created_at: new Date(),
				},
			],
		});
		const adapter = createKyselyAdapter(db);

		await expect(adapter.getNotifications("user_1")).rejects.toThrow(
			"not pre-stringified",
		);
	});

	it("stores consent metadata and audit metadata as objects, not JSON strings", async () => {
		const { db, insertCalls } = makeMockKysely();
		const adapter = createKyselyAdapter(db);
		const consentMetadata = { form: "newsletter", version: 2 };
		const auditMetadata = { reason: "manual", nested: { ok: true } };

		const consent = await adapter.createConsentEvent({
			subjectId: "user_1",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "newsletter_form",
			metadata: consentMetadata,
		});
		const audit = await adapter.createAuditLog({
			userId: "user_1",
			action: "compliance.test",
			metadata: auditMetadata,
		});

		expect(insertCalls[0]!.values.metadata).toEqual(consentMetadata);
		expect(insertCalls[1]!.values.metadata).toEqual(auditMetadata);
		expect(typeof insertCalls[0]!.values.metadata).toBe("object");
		expect(typeof insertCalls[1]!.values.metadata).toBe("object");
		expect(consent.metadata).toEqual(consentMetadata);
		expect(audit.metadata).toEqual(auditMetadata);
	});
});

// ─── Slice 7: compliance evidence methods ────────────────────

describe("Kysely adapter — compliance evidence", () => {
	it("createConsentEvent inserts into herald_consent_events", async () => {
		const { db, insertCalls } = makeMockKysely();
		const adapter = createKyselyAdapter(db);

		await adapter.createConsentEvent({
			subjectId: "user_1",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "newsletter_form",
			legalNoticeVersionId: "privacy_2026_05",
		});

		expect(insertCalls[0]).toMatchObject({
			table: "herald_consent_events",
			values: expect.objectContaining({
				subject_id: "user_1",
				channel: "email",
				purpose: "marketing.newsletter",
				status: "granted",
				legal_basis: "consent",
				source: "newsletter_form",
				legal_notice_version_id: "privacy_2026_05",
			}),
		});
	});

	it("createSuppression inserts into herald_suppressions", async () => {
		const { db, insertCalls } = makeMockKysely();
		const adapter = createKyselyAdapter(db);

		await adapter.createSuppression({
			addressHash: "hash:user@example.com",
			channel: "email",
			purpose: "marketing.newsletter",
			reason: "unsubscribe",
			source: "unsubscribe_link",
		});

		expect(insertCalls[0]).toMatchObject({
			table: "herald_suppressions",
			values: expect.objectContaining({
				address_hash: "hash:user@example.com",
				channel: "email",
				purpose: "marketing.newsletter",
				reason: "unsubscribe",
				source: "unsubscribe_link",
			}),
		});
	});

	it("eraseSubject hashes consent evidence subject IDs instead of using erased IDs", async () => {
		const { db, calls } = makeMockKysely();
		const adapter = createKyselyAdapter(db);

		await adapter.eraseSubject("user_1");

		const consentUpdate = calls.find(
			(call) => call.table === "herald_consent_events",
		);
		expect(consentUpdate?.where).toContainEqual(["subject_id", "=", "user_1"]);
		expect(consentUpdate?.set.subject_id).toMatch(/^[a-f0-9]{64}$/);
		expect(consentUpdate?.set.subject_id).not.toMatch(/^erased_/);
	});
});

// ─── Task 2.7 + 2.8 GREEN verification: getPendingScheduled + purgeExpiredDeliveries ─

describe("Kysely adapter — purge retention", () => {
	it("purgeExpiredAuditLogs deletes old audit rows by created_at", async () => {
		const { db, deleteCalls } = makeMockKysely();
		const adapter = createKyselyAdapter(db);
		const cutoff = new Date("2030-01-01T00:00:00Z");

		await adapter.purgeExpiredAuditLogs(cutoff);

		expect(deleteCalls).toHaveLength(1);
		expect(deleteCalls[0]).toMatchObject({
			table: "herald_audit_logs",
			where: [["created_at", "<", cutoff]],
		});
	});
});

describe("Kysely adapter — purgeExpiredDeliveries scheduled guard", () => {
	it("includes status 'not in' protected statuses in delete where clause", async () => {
		const { db, deleteCalls } = makeMockKysely();
		const adapter = createKyselyAdapter(db);
		const cutoff = new Date("2030-01-01T00:00:00Z");

		await adapter.purgeExpiredDeliveries(cutoff);

		expect(deleteCalls).toHaveLength(1);
		const call = deleteCalls[0]!;

		// Must have where("status", "not in", [...]) excluding scheduled, claimed, retrying
		const guard = call.where.find(
			([col, op, val]) =>
				col === "status" &&
				op === "not in" &&
				Array.isArray(val) &&
				(val as string[]).includes("scheduled") &&
				(val as string[]).includes("claimed") &&
				(val as string[]).includes("retrying"),
		);
		expect(guard).toBeDefined();
	});
});
