import { describe, expect, it } from "vitest";
import { createHerald } from "../../../core/herald.js";
import { defineEvent } from "../../../core/define.js";
import { createMockDb } from "../../support/adapters/mock-db-adapter.js";
import { hashSubjectId } from "../../../compliance/index.js";

function makeHerald() {
	const db = createMockDb();
	const ev = defineEvent("compliance.lifecycle.event", {
		schema: { parse: (x: unknown) => x as Record<string, unknown> },
		compliance: { purpose: "transactional.lifecycle", legalBasis: "contract" },
		templates: {
			"lifecycle-inapp": {
				inApp: () => ({ title: "Lifecycle" }),
			},
		},
		dispatch: () => [
			{ to: "user_1", channels: ["inApp"], template: "lifecycle-inapp" },
		],
	});
	const herald = createHerald({
		db,
		channels: { inApp: true },
		compliance: { retention: { autoPurge: false } },
		events: { ev },
	});
	return { db, herald };
}

describe("herald.compliance public API", () => {
	it("exposes only the compliance namespace", () => {
		const { herald } = makeHerald();
		const legacyNamespace = ["g", "d", "p", "r"].join("");

		expect(herald.compliance).toBeDefined();
		expect(legacyNamespace in herald).toBe(false);
	});

	it("recordConsent appends consent evidence and writes compliance audit", async () => {
		const { db, herald } = makeHerald();

		const consent = await herald.compliance.recordConsent({
			subjectId: "user_1",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "newsletter_form",
			legalNoticeVersionId: "privacy_2026_05",
		});

		expect(db._consentEvents).toContainEqual(consent);
		expect(db._auditLogs).toContainEqual(
			expect.objectContaining({
				userId: "user_1",
				action: "compliance.consent.granted",
				metadata: expect.objectContaining({
					consentEventId: consent.id,
					channel: "email",
					purpose: "marketing.newsletter",
					legalBasis: "consent",
				}),
			}),
		);
	});

	it("suppress creates suppression evidence and writes compliance audit", async () => {
		const { db, herald } = makeHerald();

		const suppression = await herald.compliance.suppress({
			addressHash: "hash:user_1@example.com",
			channel: "email",
			purpose: "marketing.newsletter",
			reason: "unsubscribe",
			source: "unsubscribe_link",
		});

		expect(db._suppressions).toContainEqual(suppression);
		expect(db._auditLogs).toContainEqual(
			expect.objectContaining({
				userId: null,
				action: "compliance.suppressed",
				metadata: expect.objectContaining({
					suppressionId: suppression.id,
					addressHash: "hash:user_1@example.com",
					channel: "email",
					reason: "unsubscribe",
				}),
			}),
		);
	});

	it("exportSubject writes compliance.export audit", async () => {
		const { db, herald } = makeHerald();

		const exported = await herald.compliance.exportSubject("user_1");

		expect(exported.userId).toBe("user_1");
		expect(db._auditLogs).toContainEqual(
			expect.objectContaining({
				userId: "user_1",
				action: "compliance.export",
			}),
		);
	});

	it("eraseSubject preserves orchestration and writes compliance audit actions", async () => {
		const { db, herald } = makeHerald();
		await db.createDelivery({
			userId: "user_1",
			eventType: "compliance.lifecycle.event",
			templateName: "lifecycle-inapp",
			channel: "inApp",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: new Date(Date.now() + 60_000),
			acceptedAt: null,
			failedAt: null,
		});

		await herald.compliance.eraseSubject("user_1");
		await herald.compliance.eraseSubject("user_1");

		expect(
			db._auditLogs.filter(
				(log) => log.action === "compliance.scheduled_deliveries_cancelled",
			),
		).toHaveLength(1);
		expect(db._auditLogs).toContainEqual(
			expect.objectContaining({
				action: "compliance.erase",
				userId: expect.not.stringContaining("user_1"),
				metadata: expect.objectContaining({ userIdHash: expect.any(String) }),
			}),
		);
	});

	it("eraseSubject anonymizes existing audit logs and delivery idempotency keys", async () => {
		const { db, herald } = makeHerald();
		const userIdHash = await hashSubjectId("user_1");

		await db.createAuditLog({
			userId: "user_1",
			action: "notification.accepted",
			eventType: "compliance.lifecycle.event",
			metadata: { safe: true },
		});
		await herald.send(
			"compliance.lifecycle.event",
			{},
			{ idempotencyKey: "erase-idem" },
		);

		expect([...db._deliveries.values()][0]?.idempotencyKey).toContain("user_1");
		expect(db._auditLogs.some((log) => log.userId === "user_1")).toBe(true);

		await herald.compliance.eraseSubject("user_1");

		expect(db._auditLogs.some((log) => log.userId === "user_1")).toBe(false);
		expect(db._auditLogs).toContainEqual(
			expect.objectContaining({
				action: "notification.accepted",
				userId: userIdHash,
			}),
		);
		for (const delivery of db._deliveries.values()) {
			expect(delivery.idempotencyKey).not.toContain("user_1");
			expect(delivery.idempotencyKey).toContain(userIdHash);
		}
	});
});
