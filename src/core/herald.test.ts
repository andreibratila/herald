import {
	describe,
	it,
	expect,
	vi,
	beforeEach,
	afterEach,
	type Mock,
} from "vitest";
import { z } from "zod";
import { defineEvent } from "./define.js";
import { createHerald } from "./herald.js";
import { createMockDb } from "../__tests__/helpers/mock-db-adapter.js";
import { createMockMailAdapter } from "../__tests__/helpers/mock-mail-adapter.js";
import type {
	Delivery,
	EventRef,
	HeraldDatabaseAdapter,
} from "../types/index.js";

import { makeHerald, makeOrderSetup } from "./runtime/test-utils.js";

// ─── Compliance consent gating ───────────────────────────────

describe("compliance consent gating", () => {
	it("contract event with no consent record proceeds", async () => {
		const { ev } = makeOrderSetup({
			eventName: "tx.norecord",
			legalBasis: "contract",
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("tx.norecord", { orderId: "o1", userId: "user_1" });
		expect(db._deliveries.size).toBe(1);
	});

	it("throws before compliance evaluation when consent methods are missing", async () => {
		const { ev } = makeOrderSetup({
			eventName: "mkt.missing-consent-methods",
			legalBasis: "consent",
		});
		const db = createMockDb() as Partial<HeraldDatabaseAdapter>;
		delete db.getConsentEvents;
		const mail = createMockMailAdapter();
		const herald = createHerald({
			db: db as HeraldDatabaseAdapter,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const result = await herald.send("mkt.missing-consent-methods", {
			orderId: "o-missing",
			userId: "user_1",
		});

		expect(result.deliveries).toHaveLength(0);
		expect(result.errors[0]?.error.message).toMatch(
			/does not implement compliance consent methods/,
		);
	});

	it("marketing event with no consent record is skipped", async () => {
		const { ev } = makeOrderSetup({
			eventName: "mkt.skip",
			legalBasis: "consent",
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("mkt.skip", { orderId: "o2", userId: "user_1" });
		expect(db._deliveries.size).toBe(0);
	});

	it("marketing skip writes compliance.denied audit log with missing consent reason", async () => {
		const { ev } = makeOrderSetup({
			eventName: "mkt.audit",
			legalBasis: "consent",
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("mkt.audit", { orderId: "o3", userId: "user_1" });

		const skipped = db._auditLogs.find((l) => l.action === "compliance.denied");
		expect(skipped).toBeDefined();
		expect(skipped?.metadata?.reason).toBe("missing_consent");
	});

	it("marketing event with explicit consent granted proceeds", async () => {
		const { ev } = makeOrderSetup({
			eventName: "mkt.granted",
			legalBasis: "consent",
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});
		await db.createConsentEvent({
			subjectId: "user_1",
			channel: "email",
			purpose: "mkt.granted.marketing",
			status: "granted",
			legalBasis: "consent",
			source: "test",
		});

		await herald.send("mkt.granted", { orderId: "o4", userId: "user_1" });
		expect(db._deliveries.size).toBe(1);
	});

	it("contract event is allowed without consent evidence", async () => {
		const { ev } = makeOrderSetup({
			eventName: "tx.contract",
			legalBasis: "contract",
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("tx.contract", { orderId: "o5", userId: "user_1" });
		expect(db._deliveries.size).toBe(1);
	});

	it("evidence-required events require an app-owned evidence reference", async () => {
		const ev = defineEvent("mkt.legitimate_interest", {
			schema: z.object({ userId: z.string() }),
			safeFields: [],
			compliance: {
				purpose: "marketing.reactivation",
				legalBasis: "legitimate_interest",
			},
			templates: {
				reactivation: {
					email: () => ({ subject: "Come back", html: "<p>Hello</p>" }),
				},
			},
			dispatch: (payload) => [
				{
					to: payload.userId,
					channels: ["email"],
					template: "reactivation",
					addressHash: `hash:${payload.userId}`,
				},
			],
		});
		const { db, herald } = makeHerald({ events: { ev } });

		const denied = await herald.send("mkt.legitimate_interest", {
			userId: "user_1",
		});
		expect(denied.deliveries).toHaveLength(0);
		expect(denied.skipped[0]?.reason).toBe(
			"compliance_denied:missing_evidence",
		);

		const allowed = await herald.send(
			"mkt.legitimate_interest",
			{ userId: "user_1" },
			{ complianceEvidenceId: "li-assessment:2026-05" },
		);
		expect(allowed.deliveries).toHaveLength(1);
		expect(allowed.deliveries[0]?.complianceEvidenceId).toBe(
			"li-assessment:2026-05",
		);
		expect(db._deliveries.size).toBe(1);
	});

	it("bypassComplianceCheck: true on marketing event with no consent proceeds", async () => {
		const { ev } = makeOrderSetup({
			eventName: "mkt.bypass",
			legalBasis: "consent",
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send(
			"mkt.bypass",
			{ orderId: "o6", userId: "user_1" },
			{ bypassComplianceCheck: true },
		);
		expect(db._deliveries.size).toBe(1);
	});
});

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

// ─── Hooks ────────────────────────────────────────────────────

describe("hooks", () => {
	it("onDelivered is called after successful delivery", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "hook.delivered" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const onDelivered = vi.fn();

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onDelivered },
			events: { ev },
		});

		await herald.send(eventName, { orderId: "o1", userId: "user_1" });

		expect(onDelivered).toHaveBeenCalledOnce();
	});

	it("onFailed is called after mail error", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "hook.failed" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const onFailed = vi.fn();
		mail.send.mockRejectedValueOnce(new Error("SMTP down"));

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onFailed },
			events: { ev },
		});

		// errors go into result.errors[], send() no longer throws per-recipient errors
		const result = await herald.send(eventName, {
			orderId: "o2",
			userId: "user_1",
		});
		expect(result.errors).toHaveLength(1);

		expect(onFailed).toHaveBeenCalledOnce();
		expect(onFailed).toHaveBeenCalledWith(expect.anything(), expect.any(Error));
	});

	it("onSkipped is called when consent check fails", async () => {
		const { ev, eventName } = makeOrderSetup({
			eventName: "mkt.hook",
			legalBasis: "consent",
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const onSkipped = vi.fn();

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onSkipped },
			events: { ev },
		});

		await herald.send(eventName, { orderId: "o3", userId: "user_1" });

		expect(onSkipped).toHaveBeenCalledOnce();
		expect(onSkipped).toHaveBeenCalledWith(
			"user_1",
			eventName,
			expect.any(String),
		);
	});
});

// ─── Auto-start ───────────────────────────────────────────────

describe("auto-start", () => {
	it("send() triggers start() implicitly and processes deliveries in-band", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "autostart.a" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const result = await herald.send(eventName, {
			orderId: "o1",
			userId: "user_1",
		});

		expect(result.deliveries).toHaveLength(1);
		const stored = db._deliveries.get(result.deliveries[0]!.id);
		expect(stored?.status).toBe("accepted");
	});

	it("calling send() twice does not re-run start() (idempotent)", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "autostart.b" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send(eventName, { orderId: "o1", userId: "user_1" });
		await herald.send(eventName, { orderId: "o2", userId: "user_1" });

		expect(db._deliveries.size).toBe(2);
		const statuses = [...db._deliveries.values()].map((d) => d.status);
		expect(statuses.every((s) => s === "accepted")).toBe(true);
	});
});

// ─── dispatch() purity ────────────────────────────────────────

describe("dispatch() purity", () => {
	it("send() returns empty array when dispatch returns no recipients", async () => {
		const ev = defineEvent("empty.dispatch", {
			schema: { parse: (x: any) => x },
			templates: {},
			dispatch: () => [],
		});
		const { herald } = makeHerald({ events: { ev } });
		const result = await herald.send("empty.dispatch", {});
		expect(result.deliveries).toEqual([]);
		expect(result.errors).toEqual([]);
		expect(result.skipped).toEqual([]);
	});

	it("send() returns one delivery per recipient that is not skipped", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("multi.recipients", {
			schema: { parse: (x: any) => x },
			templates: {
				"mr-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email"], template: "mr-tpl" },
				{ to: "user_2", channels: ["email"], template: "mr-tpl" },
				{ to: "user_3", channels: ["email"], template: "mr-tpl" },
			],
		});

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "x@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const result = await herald.send("multi.recipients", {});
		expect(result.deliveries).toHaveLength(3);
		expect(db._deliveries.size).toBe(3);
	});
});

// ─── delivery externalId ──────────────────────────────────────

describe("delivery externalId", () => {
	it("stores externalId from mail provider response", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "ext.id" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
		mail.send.mockResolvedValueOnce({ id: "msg_from_provider_123" });

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const { deliveries } = await herald.send(eventName, {
			orderId: "o1",
			userId: "user_1",
		});
		const stored = db._deliveries.get(deliveries[0]!.id);
		expect(stored?.externalId).toBe("msg_from_provider_123");
	});
});

describe("email channel defaultFrom validation at construction", () => {
	it("10.4a createHerald({ channels.email.defaultFrom: 'notanemail' }) throws mentioning 'defaultFrom'", () => {
		const ev = defineEvent("valid-for-from", {
			schema: { parse: (x: any) => x },
			templates: {},
			dispatch: () => [],
		});
		expect(() => {
			createHerald({
				db: createMockDb(),
				channels: {
					email: {
						adapter: createMockMailAdapter(),
						defaultFrom: "notanemail",
					},
					inApp: false,
				},
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { ev },
			});
		}).toThrow(/defaultFrom/);
	});

	it("10.4b createHerald({ channels.email.defaultFrom: '' }) throws mentioning 'defaultFrom'", () => {
		const ev = defineEvent("valid-for-empty-from", {
			schema: { parse: (x: any) => x },
			templates: {},
			dispatch: () => [],
		});
		expect(() => {
			createHerald({
				db: createMockDb(),
				channels: {
					email: { adapter: createMockMailAdapter(), defaultFrom: "" },
					inApp: false,
				},
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { ev },
			});
		}).toThrow(/defaultFrom/);
	});
});

