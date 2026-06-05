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
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/support/adapters/mock-mail-adapter.js";
import type {
	Delivery,
	HeraldDatabaseAdapter,
} from "../../types/index.js";
import { makeHerald, makeOrderSetup } from "../../__tests__/support/core/runtime.js";

describe("compliance purge", () => {
	it("purges expired deliveries and audit logs using their own retention windows", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const event = defineEvent("retention.event", {
			schema: { parse: (x: any) => x },
			templates: {
				"retention-tpl": { email: () => ({ subject: "s", html: "<p/>" }) },
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email"], template: "retention-tpl" },
			],
		});
		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: {
				retention: {
					autoPurge: false,
					deliveryRetention: "90d",
					auditLogRetention: "30d",
				},
			},
			events: { event },
		});

		const oldDelivery = await db.createDelivery({
			userId: "user_1",
			eventType: "retention.delivery",
			templateName: "tpl",
			channel: "email",
			status: "accepted",
			attempts: 1,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: null,
			acceptedAt: null,
			failedAt: null,
		});
		db._deliveries.set(oldDelivery.id, {
			...oldDelivery,
			createdAt: new Date(Date.now() - 91 * 86_400_000),
		});
		const oldAudit = await db.createAuditLog({
			userId: "user_1",
			action: "retention.old",
		});
		oldAudit.createdAt = new Date(Date.now() - 31 * 86_400_000);
		const freshAudit = await db.createAuditLog({
			userId: "user_1",
			action: "retention.fresh",
		});

		const result = await herald.compliance.purge();

		expect(result).toMatchObject({ deliveriesPurged: 1, auditLogsPurged: 1 });
		expect(await db.getDelivery(oldDelivery.id)).toBeNull();
		expect(db._auditLogs.some((l) => l.id === oldAudit.id)).toBe(false);
		expect(db._auditLogs.some((l) => l.id === freshAudit.id)).toBe(true);
		expect(db._auditLogs.at(-1)?.action).toBe("compliance.purge");
		expect(db._auditLogs.at(-1)?.metadata).toMatchObject({
			deliveriesPurged: 1,
			auditLogsPurged: 1,
		});
	});
});

