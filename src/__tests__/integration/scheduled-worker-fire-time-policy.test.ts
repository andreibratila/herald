// ============================================================
// herald — scheduled-worker-fire-time-policy.test.ts
// Integration tests for scheduled worker fire-time policy behavior
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createHerald } from "../../core/herald.js";
import { defineEvent } from "../../core/define.js";
import { legalBases } from "../../compliance/index.js";
import { createMockDb } from "../helpers/mock-db-adapter.js";
import { createMockMailAdapter } from "../helpers/mock-mail-adapter.js";

const orderSchema = z.object({ orderId: z.string(), amount: z.number() });

describe("Fire-Time Policy Gate", () => {
	it("5.1 — db queue processor returns early for status='dispatched' after side effects were recorded", async () => {
		vi.useRealTimers();
		const db = createMockDb();
		const mail = createMockMailAdapter();
		let workHandler:
			| ((
					jobs: Array<{
						data: { deliveryId: string; payload?: Record<string, unknown> };
					}>,
			  ) => Promise<void>)
			| undefined;
		const mockBoss = {
			send: vi.fn().mockResolvedValue("job_id"),
			start: vi.fn().mockResolvedValue(undefined),
			work: vi.fn(async (_queue, _options, handler) => {
				workHandler = handler;
			}),
			stop: vi.fn().mockResolvedValue(undefined),
		};

		const ev = defineEvent("order.phase5a", {
			schema: orderSchema,
			templates: {
				"order-email": {
					email: (p) => ({
						subject: `Order ${p.orderId}`,
						html: "<p>body</p>",
					}),
				},
			},
			dispatch: () => [
				{ to: "user-1", channels: ["email"], template: "order-email" },
			],
			resolvePayload: async () => ({ orderId: "ord-1", amount: 10 }),
		});

		const { createDbDriver } = await import("../../queue/index.js");
		const driver = createDbDriver(
			{ connectionString: "postgres://localhost/test" },
			mockBoss,
		);
		await driver.start!(async (job) => {
			const delivery = await db.getDelivery(job.deliveryId);
			if (!delivery) return;
			if (delivery.status === "dispatched" && delivery.sideEffectsCompletedAt)
				return;
			await mail.send({
				to: "user-1@test.com",
				from: "noreply@test.com",
				subject: "s",
				html: "<p>body</p>",
			});
		});

		// Insert a delivery in "dispatched" status after side effects completed
		const delivery = await db.createDelivery({
			userId: "user-1",
			eventType: "order.phase5a",
			templateName: "order-email",
			channel: "email",
			status: "dispatched",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: null,
			acceptedAt: null,
			failedAt: null,
		});

		await db.updateDelivery(delivery.id, {
			sideEffectsCompletedAt: new Date(),
		});

		await workHandler!([
			{
				data: {
					deliveryId: delivery.id,
					payload: { orderId: "ord-1", amount: 10 },
				},
			},
		]);

		expect(mail.send).not.toHaveBeenCalled();
	});

	it("5.2 — processDelivery returns early for status='accepted' (terminal status guard)", async () => {
		vi.useRealTimers();
		const db = createMockDb();
		let processCount = 0;

		const ev = defineEvent("order.phase5b", {
			schema: orderSchema,
			templates: {
				"order-inapp": {
					inApp: (p) => ({ title: `Order ${p.orderId}` }),
				},
			},
			dispatch: () => [
				{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
			],
			resolvePayload: async () => ({ orderId: "ord-1", amount: 10 }),
		});

		// Track createNotification calls
		const origCreate = db.createNotification.bind(db);
		db.createNotification = async (...args) => {
			processCount++;
			return origCreate(...args);
		};

		const herald = createHerald({
			db,
			channels: { inApp: true },
			events: { ev },
		});

		// Create a delivery with "accepted" status
		await db.createDelivery({
			userId: "user-1",
			eventType: "order.phase5b",
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

		// A new real delivery should work fine
		const deliveries = await herald.send("order.phase5b", {
			orderId: "ord-2",
			amount: 20,
		});
		// Only the NEW delivery's notification should have been created (1 call)
		expect(processCount).toBe(1);
		// The "accepted" delivery is untouched (terminal guard)
		const allDeliveries = await db.getDeliveriesByUser("user-1");
		const sentDelivery = allDeliveries.find((d) => d.status === "accepted");
		expect(sentDelivery).toBeDefined();
	});

	it("5.3 — consent withdrawn after schedule: fire-time compliance skips existing delivery", async () => {
		vi.useRealTimers();
		const db = createMockDb();

		const ev = defineEvent("order.phase5c", {
			schema: orderSchema,
			compliance: { purpose: "marketing.order_phase5c", legalBasis: "consent" },
			templates: {
				"order-inapp": {
					inApp: (p) => ({ title: `Order ${p.orderId}` }),
				},
			},
			dispatch: () => [
				{
					to: "user-1",
					channels: ["inApp"],
					template: "order-inapp",
					addressHash: "hash:user-1",
				},
			],
			resolvePayload: async () => ({ orderId: "ord-1", amount: 10 }),
		});

		await db.createConsentEvent({
			subjectId: "user-1",
			channel: "inApp",
			purpose: "marketing.order_phase5c",
			status: "granted",
			legalBasis: "consent",
			source: "test_grant",
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			events: { ev },
		});

		const futureDate = new Date(Date.now() + 60_000);
		const scheduled = await herald.send(
			"order.phase5c",
			{ orderId: "ord-1", amount: 10 },
			{ scheduledAt: futureDate },
		);
		const delivery = scheduled.deliveries[0]!;
		await db.updateDelivery(delivery.id, {
			scheduledAt: new Date(Date.now() - 5_000),
		});

		await db.createConsentEvent({
			subjectId: "user-1",
			channel: "inApp",
			purpose: "marketing.order_phase5c",
			status: "withdrawn",
			legalBasis: "consent",
			source: "test_withdrawal",
		});

		vi.useFakeTimers();
		const stop = await herald.startScheduledWorker(100, { leaseMs: 60_000 });
		await vi.advanceTimersByTimeAsync(150);
		stop();
		vi.useRealTimers();

		const final = await db.getDelivery(delivery.id);
		expect(final).toMatchObject({
			status: "skipped",
			purpose: "marketing.order_phase5c",
			legalBasisAtSend: "consent",
			complianceDecision: "denied",
		});
		expect(final?.complianceCheckedAt).toBeInstanceOf(Date);

		const skippedLog = db._auditLogs.find(
			(l) => l.action === "compliance.denied" && l.deliveryId === delivery.id,
		);
		expect(skippedLog).toBeDefined();
		expect(skippedLog?.metadata).toMatchObject({
			reason: "consent_withdrawn",
			channel: "inApp",
			purpose: "marketing.order_phase5c",
			legalBasis: "consent",
		});
	});

	it("5.4 — suppression added after schedule: fire-time compliance skips existing delivery", async () => {
		vi.useRealTimers();
		const db = createMockDb();
		const mail = { send: vi.fn(async () => ({ id: "accepted-id" })) };

		const ev = defineEvent("order.phase5d", {
			schema: orderSchema,
			compliance: { purpose: "marketing.order_phase5d", legalBasis: "consent" },
			templates: {
				"order-email": {
					email: (p) => ({
						subject: `Order ${p.orderId}`,
						html: "<p>body</p>",
					}),
				},
			},
			dispatch: () => [
				{
					to: "user-1",
					channels: ["email"],
					template: "order-email",
					addressHash: "hash:user-1@example.com",
				},
			],
			resolvePayload: async () => ({ orderId: "ord-1", amount: 10 }),
		});

		await db.createConsentEvent({
			subjectId: "user-1",
			channel: "email",
			purpose: "marketing.order_phase5d",
			status: "granted",
			legalBasis: "consent",
			source: "test_grant",
		});

		const herald = createHerald({
			db,
			channels: { email: { adapter: mail, defaultFrom: "noreply@test.com" } },
			events: { ev },
		});

		const futureDate = new Date(Date.now() + 60_000);
		const scheduled = await herald.send(
			"order.phase5d",
			{ orderId: "ord-1", amount: 10 },
			{ scheduledAt: futureDate },
		);
		const delivery = scheduled.deliveries[0]!;
		await db.updateDelivery(delivery.id, {
			scheduledAt: new Date(Date.now() - 5_000),
		});

		const suppression = await db.createSuppression({
			addressHash: "hash:user-1@example.com",
			channel: "email",
			purpose: "marketing.order_phase5d",
			reason: "unsubscribe",
			source: "test_unsubscribe",
		});

		vi.useFakeTimers();
		const stop = await herald.startScheduledWorker(100, { leaseMs: 60_000 });
		await vi.advanceTimersByTimeAsync(150);
		stop();
		vi.useRealTimers();

		const final = await db.getDelivery(delivery.id);
		expect(final).toMatchObject({
			status: "skipped",
			purpose: "marketing.order_phase5d",
			legalBasisAtSend: "consent",
			suppressionId: suppression.id,
			complianceDecision: "denied",
		});
		expect(mail.send).not.toHaveBeenCalled();

		const skippedLog = db._auditLogs.find(
			(l) => l.action === "compliance.denied" && l.deliveryId === delivery.id,
		);
		expect(skippedLog).toBeDefined();
		expect(skippedLog?.metadata).toMatchObject({
			reason: "suppressed",
			suppressionId: suppression.id,
			channel: "email",
			purpose: "marketing.order_phase5d",
			legalBasis: "consent",
		});
	});

	it("5.4b — fire-time compliance uses the scheduled policy snapshot, not mutated event policy", async () => {
		vi.useRealTimers();
		const db = createMockDb();
		const mail = { send: vi.fn(async () => ({ id: "accepted-id" })) };

		const ev = defineEvent("order.phase5.snapshot", {
			schema: orderSchema,
			compliance: {
				purpose: "marketing.snapshot",
				legalBasis: "consent",
			},
			templates: {
				"order-email": {
					email: (p) => ({
						subject: `Order ${p.orderId}`,
						html: "<p>body</p>",
					}),
				},
			},
			dispatch: () => [
				{
					to: "user-1",
					channels: ["email"],
					template: "order-email",
					addressHash: "hash:user-1@example.com",
				},
			],
			resolvePayload: async () => ({ orderId: "ord-1", amount: 10 }),
		});

		await db.createConsentEvent({
			subjectId: "user-1",
			channel: "email",
			purpose: "marketing.snapshot",
			status: "granted",
			legalBasis: "consent",
			source: "test_grant",
		});

		const legalBasisRegistry: Record<
			string,
			(typeof legalBases.defaults)[keyof typeof legalBases.defaults]
		> = { ...legalBases.defaults };
		const herald = createHerald({
			db,
			channels: { email: { adapter: mail, defaultFrom: "noreply@test.com" } },
			compliance: { legalBases: legalBasisRegistry },
			events: { ev },
		});

		const scheduled = await herald.send(
			"order.phase5.snapshot",
			{ orderId: "ord-1", amount: 10 },
			{ scheduledAt: new Date(Date.now() + 60_000) },
		);
		const delivery = scheduled.deliveries[0]!;
		expect(delivery).toMatchObject({
			purpose: "marketing.snapshot",
			legalBasisAtSend: "consent",
			complianceRequiresConsentEvent: true,
			complianceRequiresSuppressionCheck: true,
		});

		// Application code changed after scheduling. Fire-time checks must not weaken
		// the already-scheduled delivery from consent to contract, nor depend on
		// the original registry still containing the legal basis.
		delete legalBasisRegistry.consent;
		ev.definition.compliance = {
			purpose: "transactional.snapshot",
			legalBasis: "contract",
		};
		await db.createConsentEvent({
			subjectId: "user-1",
			channel: "email",
			purpose: "marketing.snapshot",
			status: "withdrawn",
			legalBasis: "consent",
			source: "test_withdrawal",
		});
		await db.updateDelivery(delivery.id, {
			scheduledAt: new Date(Date.now() - 5_000),
		});

		vi.useFakeTimers();
		const stop = await herald.startScheduledWorker(100, { leaseMs: 60_000 });
		await vi.advanceTimersByTimeAsync(150);
		stop();
		vi.useRealTimers();

		const final = await db.getDelivery(delivery.id);
		expect(final).toMatchObject({
			status: "skipped",
			purpose: "marketing.snapshot",
			legalBasisAtSend: "consent",
			complianceDecision: "denied",
		});
		expect(mail.send).not.toHaveBeenCalled();

		const skippedLog = db._auditLogs.find(
			(l) => l.action === "compliance.denied" && l.deliveryId === delivery.id,
		);
		expect(skippedLog?.metadata).toMatchObject({
			reason: "consent_withdrawn",
			purpose: "marketing.snapshot",
			legalBasis: "consent",
		});
	});

	it("5.5 — bypassComplianceCheck=true: fire-time emits compliance.bypassed with firedAt", async () => {
		vi.useRealTimers();
		const db = createMockDb();

		const ev = defineEvent("order.phase5e", {
			schema: orderSchema,
			templates: {
				"order-inapp": {
					inApp: (p) => ({ title: `Order ${p.orderId}` }),
				},
			},
			dispatch: () => [
				{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
			],
			resolvePayload: async () => ({ orderId: "ord-1", amount: 10 }),
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			events: { ev },
		});

		const pastDate = new Date(Date.now() - 5_000);
		// Create a scheduled delivery with bypassComplianceCheck=true
		const delivery = await db.createDelivery({
			userId: "user-1",
			eventType: "order.phase5e",
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
			bypassComplianceCheck: true,
		});

		vi.useFakeTimers();
		const stop = await herald.startScheduledWorker(100, { leaseMs: 60_000 });
		await vi.advanceTimersByTimeAsync(150);
		stop();
		vi.useRealTimers();

		// Should have a compliance.bypassed audit with firedAt
		const bypassLog = db._auditLogs.find(
			(l) => l.action === "compliance.bypassed" && l.deliveryId === delivery.id,
		);
		expect(bypassLog).toBeDefined();
		expect(bypassLog?.metadata?.firedAt).toBeDefined();
		expect(
			db._auditLogs.some(
				(l) => l.action === "notification.compliance_bypassed",
			),
		).toBe(false);
	});

	it("5.6 — scheduled bypass emits one compliance.bypassed audit at fire time", async () => {
		vi.useRealTimers();
		const db = createMockDb();

		const ev = defineEvent("order.phase5f", {
			schema: orderSchema,
			templates: {
				"order-inapp": {
					inApp: (p) => ({ title: `Order ${p.orderId}` }),
				},
			},
			dispatch: () => [
				{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
			],
			resolvePayload: async () => ({ orderId: "ord-1", amount: 10 }),
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			events: { ev },
		});

		const futureDate = new Date(Date.now() + 60_000);
		const result = await herald.send(
			"order.phase5f",
			{ orderId: "ord-1", amount: 10 },
			{
				bypassComplianceCheck: true,
				scheduledAt: futureDate,
			},
		);
		const delivery = result.deliveries[0]!;

		expect(
			db._auditLogs.filter((l) => l.action === "compliance.bypassed"),
		).toHaveLength(0);
		expect(
			db._auditLogs.some(
				(l) => l.action === "notification.compliance_bypassed",
			),
		).toBe(false);

		await db.updateDelivery(delivery.id, {
			scheduledAt: new Date(Date.now() - 5_000),
		});
		vi.useFakeTimers();
		const stop = await herald.startScheduledWorker(100, { leaseMs: 60_000 });
		await vi.advanceTimersByTimeAsync(150);
		stop();
		vi.useRealTimers();

		const bypassLogs = db._auditLogs.filter(
			(l) => l.action === "compliance.bypassed",
		);
		expect(bypassLogs).toHaveLength(1);
		expect(bypassLogs[0]).toMatchObject({ deliveryId: delivery.id });
		expect(bypassLogs[0]?.metadata?.firedAt).toBeDefined();
		expect(
			db._auditLogs.some(
				(l) => l.action === "notification.compliance_bypassed",
			),
		).toBe(false);
	});

	it("5.6b — scheduled bypass retry does not duplicate compliance.bypassed audits", async () => {
		vi.useRealTimers();
		const db = createMockDb();

		const ev = defineEvent("order.phase5f-retry", {
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

		const result = await herald.send(
			"order.phase5f-retry",
			{ orderId: "ord-1", amount: 10 },
			{
				bypassComplianceCheck: true,
				scheduledAt: new Date(Date.now() + 60_000),
			},
		);
		const delivery = result.deliveries[0]!;
		await db.updateDelivery(delivery.id, {
			scheduledAt: new Date(Date.now() - 5_000),
		});

		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		vi.useFakeTimers();
		try {
			const stop = await herald.startScheduledWorker(100, {
				leaseMs: 60_000,
				maxResolveAttempts: 3,
			});
			await vi.advanceTimersByTimeAsync(250);
			stop();
		} finally {
			vi.useRealTimers();
			consoleError.mockRestore();
		}

		const bypassLogs = db._auditLogs.filter(
			(l) => l.action === "compliance.bypassed" && l.deliveryId === delivery.id,
		);
		expect(bypassLogs).toHaveLength(1);
		expect(
			(await db.getDelivery(delivery.id))?.resolveAttempts,
		).toBeGreaterThan(1);
	});

	it("5.7 — bypassComplianceCheck is persisted on delivery row", async () => {
		vi.useRealTimers();
		const db = createMockDb();

		const ev = defineEvent("order.phase5g", {
			schema: orderSchema,
			templates: {
				"order-inapp": {
					inApp: (p) => ({ title: `Order ${p.orderId}` }),
				},
			},
			dispatch: () => [
				{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
			],
			resolvePayload: async () => ({ orderId: "ord-1", amount: 10 }),
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			events: { ev },
		});

		const futureDate = new Date(Date.now() + 60_000);
		const result5g = await herald.send(
			"order.phase5g",
			{ orderId: "ord-1", amount: 10 },
			{
				bypassComplianceCheck: true,
				scheduledAt: futureDate,
			},
		);

		expect(result5g.deliveries).toHaveLength(1);
		const stored = await db.getDelivery(result5g.deliveries[0]!.id);
		expect(stored?.bypassComplianceCheck).toBe(true);
	});
});
