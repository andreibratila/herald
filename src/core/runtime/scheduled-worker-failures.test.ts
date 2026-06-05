import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/helpers/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/helpers/mock-mail-adapter.js";

// ─── startScheduledWorker ─────────────────────────────────────

describe("startScheduledWorker", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not treat sync processor failures as resolvePayload failures", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		mail.send.mockRejectedValueOnce(new Error("SMTP down after resolve"));

		const ev = defineEvent("worker.processor-fails", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"worker-processor-fails-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "worker-processor-fails-tpl",
				},
			],
			resolvePayload: async () => ({ userId: "u1" }),
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

		const delivery = await db.createDelivery({
			userId: "u1",
			eventType: "worker.processor-fails",
			templateName: "worker-processor-fails-tpl",
			channel: "email",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: new Date(Date.now() - 1000),
			acceptedAt: null,
			failedAt: null,
		});

		const stop = await herald.startScheduledWorker(50);
		await vi.advanceTimersByTimeAsync(50);
		stop();

		expect(mail.send).toHaveBeenCalledOnce();
		const stored = db._deliveries.get(delivery.id);
		expect(stored).toMatchObject({
			status: "failed",
			lastError: "SMTP down after resolve",
		});
		expect(stored?.resolveAttempts ?? 0).toBe(0);
	});

	it("does not mutate delivery status when fired audit fails after enqueue", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const createAuditLog = db.createAuditLog.bind(db);
		db.createAuditLog = vi.fn(async (input) => {
			if (input.action === "notification.scheduled.fired") {
				throw new Error("audit failed after enqueue");
			}
			return createAuditLog(input);
		});

		const ev = defineEvent("worker.audit-fails", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"worker-audit-fails-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "worker-audit-fails-tpl",
				},
			],
			resolvePayload: async () => ({ userId: "u1" }),
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

		const delivery = await db.createDelivery({
			userId: "u1",
			eventType: "worker.audit-fails",
			templateName: "worker-audit-fails-tpl",
			channel: "email",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: new Date(Date.now() - 1000),
			acceptedAt: null,
			failedAt: null,
		});

		const stop = await herald.startScheduledWorker(50);
		await vi.advanceTimersByTimeAsync(50);
		stop();

		expect(mail.send).toHaveBeenCalledOnce();
		expect(db._deliveries.get(delivery.id)?.status).toBe("accepted");
		expect(db._deliveries.get(delivery.id)?.resolveAttempts ?? 0).toBe(0);
	});

	it("3.15 resolvePayload throws for delivery 1, delivery 2 still enqueued", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		let callCount = 0;
		const resolvePayload = vi.fn().mockImplementation(async () => {
			callCount++;
			if (callCount === 1) throw new Error("resolve failed for delivery 1");
			return { userId: "u2", orderId: "ord_2" };
		});

		const ev = defineEvent("worker.isolate", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"worker-iso-tpl": {
					email: (p: any) => ({ subject: `${p.orderId}`, html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "worker-iso-tpl" },
			],
			resolvePayload,
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

		const baseTime = Date.now() - 1000;

		await db.createDelivery({
			userId: "u1",
			eventType: "worker.isolate",
			templateName: "worker-iso-tpl",
			channel: "email",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: new Date(baseTime),
			acceptedAt: null,
			failedAt: null,
		});

		await db.createDelivery({
			userId: "u2",
			eventType: "worker.isolate",
			templateName: "worker-iso-tpl",
			channel: "email",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: new Date(baseTime + 1),
			acceptedAt: null,
			failedAt: null,
		});

		const stop = await herald.startScheduledWorker(50);
		await vi.advanceTimersByTimeAsync(50);
		stop();

		expect(mail.send).toHaveBeenCalledOnce();
	});

	it("does not enqueue when resolvePayload returns a schema-invalid payload", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("worker.invalid-payload", {
			schema: z.object({ userId: z.string(), amount: z.number() }),
			templates: {
				"worker-invalid-payload-tpl": {
					email: (p: any) => ({ subject: `${p.amount}`, html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "worker-invalid-payload-tpl",
				},
			],
			resolvePayload: async () => ({ userId: "u1", amount: "not-a-number" }),
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

		const delivery = await db.createDelivery({
			userId: "u1",
			eventType: "worker.invalid-payload",
			templateName: "worker-invalid-payload-tpl",
			channel: "email",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: new Date(Date.now() - 1000),
			acceptedAt: null,
			failedAt: null,
		});

		const stop = await herald.startScheduledWorker(50, {
			maxResolveAttempts: 2,
		});
		await vi.advanceTimersByTimeAsync(50);
		stop();

		expect(mail.send).not.toHaveBeenCalled();
		expect(db._deliveries.get(delivery.id)).toMatchObject({
			status: "scheduled",
			resolveAttempts: 1,
		});
	});
});
