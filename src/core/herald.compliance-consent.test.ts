import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineEvent } from "./define.js";
import { createHerald } from "./herald.js";
import { createMockDb } from "../__tests__/helpers/mock-db-adapter.js";
import { createMockMailAdapter } from "../__tests__/helpers/mock-mail-adapter.js";
import type { HeraldDatabaseAdapter } from "../types/index.js";

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
			persistedFields: [],
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
