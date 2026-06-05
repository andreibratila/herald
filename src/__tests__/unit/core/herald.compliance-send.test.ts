import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineEvent } from "../../../core/define.js";
import { createHerald } from "../../../core/herald.js";
import { createMockDb } from "../../support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../../support/adapters/mock-mail-adapter.js";

// ─── Compliance send pipeline (Slice 4) ──────────────────────

describe("explicit compliance policy requirement", () => {
	it("throws at construction when requireExplicitEventCompliance is enabled and an event omits compliance", () => {
		const ev = defineEvent("compliance.required.missing", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"compliance.required.missing.tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "compliance.required.missing.tpl",
				},
			],
		});

		expect(() =>
			createHerald({
				db: createMockDb(),
				channels: {
					email: {
						adapter: createMockMailAdapter(),
						defaultFrom: "x@test.com",
					},
				},
				queue: { driver: "sync" },
				compliance: {
					requireExplicitEventCompliance: true,
					retention: { autoPurge: false },
				},
				events: { ev },
			}),
		).toThrow(/missing required compliance policy/i);
	});
});

describe("compliance send pipeline", () => {
	it("contract events send without consent and create one delivery per concrete channel", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const ev = defineEvent("slice4.contract.multi", {
			schema: { parse: (x: any) => x },
			compliance: {
				purpose: "transactional.order_update",
				legalBasis: "contract",
			},
			templates: {
				"slice4-contract-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
					inApp: () => ({ title: "Order updated" }),
				},
			},
			dispatch: () => [
				{
					to: "user_1",
					channels: ["email", "inApp"],
					template: "slice4-contract-tpl",
				},
			],
		});
		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: true,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const result = await herald.send("slice4.contract.multi", {
			userId: "user_1",
		});

		expect(result.deliveries).toHaveLength(2);
		expect([...db._deliveries.values()].map((d) => d.channel).sort()).toEqual([
			"email",
			"inApp",
		]);
		expect(mail.send).toHaveBeenCalledOnce();
		expect(db._notifications.size).toBe(1);
	});

	it("consent-required marketing without consent is audit-only with no delivery", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const ev = defineEvent("slice4.marketing.missing", {
			schema: { parse: (x: any) => x },
			compliance: { purpose: "marketing.newsletter", legalBasis: "consent" },
			templates: {
				"slice4-marketing-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: () => [
				{
					to: "user_1",
					channels: ["email"],
					template: "slice4-marketing-tpl",
					addressHash: "hash:user_1@example.com",
				} as any,
			],
		});
		const herald = createHerald({
			db,
			channels: { email: { adapter: mail, defaultFrom: "noreply@test.com" } },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const result = await herald.send("slice4.marketing.missing", {});

		expect(result.skipped).toEqual([
			expect.objectContaining({ reason: "compliance_denied:missing_consent" }),
		]);
		expect(db._deliveries.size).toBe(0);
		expect(db._auditLogs).toContainEqual(
			expect.objectContaining({
				action: "compliance.denied",
				eventType: "slice4.marketing.missing",
				metadata: expect.objectContaining({
					decision: "denied",
					reason: "missing_consent",
					channel: "email",
					purpose: "marketing.newsletter",
					legalBasis: "consent",
				}),
			}),
		);
	});

	it("consent grant allows marketing send and stores legal snapshot on delivery", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const consent = await db.createConsentEvent({
			subjectId: "user_1",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "newsletter_form",
		});
		const ev = defineEvent("slice4.marketing.allowed", {
			schema: { parse: (x: any) => x },
			compliance: { purpose: "marketing.newsletter", legalBasis: "consent" },
			templates: {
				"slice4-marketing-allowed-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: () => [
				{
					to: "user_1",
					channels: ["email"],
					template: "slice4-marketing-allowed-tpl",
					addressHash: "hash:user_1@example.com",
				} as any,
			],
		});
		const herald = createHerald({
			db,
			channels: { email: { adapter: mail, defaultFrom: "noreply@test.com" } },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const result = await herald.send("slice4.marketing.allowed", {});

		expect(result.deliveries).toHaveLength(1);
		const delivery = result.deliveries[0]!;
		expect(delivery).toMatchObject({
			channel: "email",
			purpose: "marketing.newsletter",
			legalBasisAtSend: "consent",
			consentEventId: consent.id,
			complianceDecision: "allowed",
		});
	});

	it("in-app consent send does not require addressHash suppression by default", async () => {
		const db = createMockDb();
		await db.createConsentEvent({
			subjectId: "user_1",
			channel: "inApp",
			purpose: "marketing.in_app",
			status: "granted",
			legalBasis: "consent",
			source: "in_app_prompt",
		});
		const ev = defineEvent("slice4.marketing.inapp", {
			schema: { parse: (x: any) => x },
			compliance: { purpose: "marketing.in_app", legalBasis: "consent" },
			templates: {
				"slice4-marketing-inapp-tpl": {
					inApp: () => ({ title: "Promo" }),
				},
			},
			dispatch: () => [
				{
					to: "user_1",
					channels: ["inApp"],
					template: "slice4-marketing-inapp-tpl",
				},
			],
		});
		const herald = createHerald({
			db,
			channels: { inApp: true },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const result = await herald.send("slice4.marketing.inapp", {});

		expect(result.skipped).toHaveLength(0);
		expect(result.deliveries[0]).toMatchObject({
			channel: "inApp",
			purpose: "marketing.in_app",
			legalBasisAtSend: "consent",
			complianceRequiresSuppressionCheck: false,
		});
	});

	it("suppression denies marketing even when consent exists", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		await db.createConsentEvent({
			subjectId: "user_1",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "newsletter_form",
		});
		const suppression = await db.createSuppression({
			addressHash: "hash:user_1@example.com",
			channel: "email",
			purpose: "marketing.newsletter",
			reason: "unsubscribe",
			source: "unsubscribe_link",
		});
		const ev = defineEvent("slice4.marketing.suppressed", {
			schema: { parse: (x: any) => x },
			compliance: { purpose: "marketing.newsletter", legalBasis: "consent" },
			templates: {
				"slice4-marketing-suppressed-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: () => [
				{
					to: "user_1",
					channels: ["email"],
					template: "slice4-marketing-suppressed-tpl",
					addressHash: "hash:user_1@example.com",
				} as any,
			],
		});
		const herald = createHerald({
			db,
			channels: { email: { adapter: mail, defaultFrom: "noreply@test.com" } },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const result = await herald.send("slice4.marketing.suppressed", {});

		expect(result.skipped[0]?.reason).toBe("compliance_denied:suppressed");
		expect(db._deliveries.size).toBe(0);
		expect(db._auditLogs).toContainEqual(
			expect.objectContaining({
				action: "compliance.denied",
				metadata: expect.objectContaining({
					reason: "suppressed",
					suppressionId: suppression.id,
				}),
			}),
		);
	});

	it("idempotency is scoped to each concrete channel, not recipient channel array order", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		let reversed = false;
		const ev = defineEvent("slice4.idempotency.channels", {
			schema: { parse: (x: any) => x },
			compliance: {
				purpose: "transactional.multi_channel",
				legalBasis: "contract",
			},
			templates: {
				"slice4-idem-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
					inApp: () => ({ title: "Hello" }),
				},
			},
			dispatch: () => [
				{
					to: "user_1",
					channels: reversed ? ["inApp", "email"] : ["email", "inApp"],
					template: "slice4-idem-tpl",
				},
			],
		});
		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: true,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const first = await herald.send(
			"slice4.idempotency.channels",
			{},
			{ idempotencyKey: "evt" },
		);
		reversed = true;
		const second = await herald.send(
			"slice4.idempotency.channels",
			{},
			{ idempotencyKey: "evt" },
		);

		expect(first.deliveries).toHaveLength(2);
		expect(second.deliveries.map((d) => d.id).sort()).toEqual(
			first.deliveries.map((d) => d.id).sort(),
		);
		expect(db._deliveries.size).toBe(2);
		expect(
			[...db._deliveries.values()].map((d) => d.idempotencyKey).sort(),
		).toEqual([
			"evt:user_1:email:slice4-idem-tpl",
			"evt:user_1:inApp:slice4-idem-tpl",
		]);
	});
});
