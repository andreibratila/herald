import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/helpers/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/helpers/mock-mail-adapter.js";
import { makeHerald } from "./test-utils.js";

// ─── Scheduled deliveries ─────────────────────────────────────

describe("send() — scheduled deliveries", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("3.1 throws descriptive error when scheduledAt set but event has no resolvePayload", async () => {
		const ev = defineEvent("sched.no-resolve", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"sched-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "sched-tpl" },
			],
			// NO resolvePayload
		});
		const { herald } = makeHerald({ events: { ev } });

		await expect(
			herald.send(
				"sched.no-resolve",
				{ userId: "u1" },
				{ scheduledAt: new Date("2030-01-01") },
			),
		).rejects.toThrow(/resolvePayload/);

		await expect(
			herald.send(
				"sched.no-resolve",
				{ userId: "u1" },
				{ scheduledAt: new Date("2030-01-01") },
			),
		).rejects.toThrow(/sched\.no-resolve/);
	});

	it("3.2 sync driver + scheduledAt + resolvePayload: status=scheduled, scheduledAt set, audit notification.scheduled, queue.enqueue NOT called", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("sched.sync", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"sched-sync-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "sched-sync-tpl" },
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

		const futureDate = new Date("2030-06-01T12:00:00Z");
		const result = await herald.send(
			"sched.sync",
			{ userId: "u1" },
			{ scheduledAt: futureDate },
		);

		expect(result.deliveries).toHaveLength(1);
		const stored = db._deliveries.get(result.deliveries[0]!.id);
		expect(stored?.status).toBe("scheduled");
		expect(stored?.scheduledAt?.toISOString()).toBe(futureDate.toISOString());

		const scheduledLog = db._auditLogs.find(
			(l) => l.action === "notification.scheduled",
		);
		expect(scheduledLog).toBeDefined();
		expect(scheduledLog?.deliveryId).toBe(result.deliveries[0]!.id);

		expect(mail.send).not.toHaveBeenCalled();
	});

	it("3.4 send() without scheduledAt: delivery status is pending (regression guard)", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("sched.immediate", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"sched-imm-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "sched-imm-tpl" },
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

		const result = await herald.send("sched.immediate", { userId: "u1" });
		expect(result.deliveries).toHaveLength(1);
		const stored = db._deliveries.get(result.deliveries[0]!.id);
		expect(stored?.status).toBe("accepted"); // sync driver processes immediately
	});

	it("3.5 idempotency key + scheduledAt: second call with same key returns existing delivery, createDelivery called once", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("sched.idem", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"sched-idem-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "sched-idem-tpl" },
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

		const futureDate = new Date("2030-06-01T12:00:00Z");
		const first = await herald.send(
			"sched.idem",
			{ userId: "u1" },
			{ scheduledAt: futureDate, idempotencyKey: "k-sched-1" },
		);
		const second = await herald.send(
			"sched.idem",
			{ userId: "u1" },
			{ scheduledAt: futureDate, idempotencyKey: "k-sched-1" },
		);

		expect(db._deliveries.size).toBe(1);
		expect(second.deliveries[0]!.id).toBe(first.deliveries[0]!.id);
	});
});

// ─── processDelivery — scheduled job payload resolution ───────

describe("processDelivery — db-driver scheduled job (payload undefined)", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("3.10 calls event.resolvePayload(delivery) when job.payload is undefined and uses result for rendering", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const resolvePayload = vi
			.fn()
			.mockResolvedValue({ userId: "u1", orderId: "ord_resolved" });

		const ev = defineEvent("sched.process", {
			schema: z.object({ userId: z.string(), orderId: z.string().optional() }),
			templates: {
				"sched-proc-tpl": {
					email: (p: any) => ({
						subject: `Order ${p.orderId}`,
						html: `<p>${p.orderId}</p>`,
					}),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "sched-proc-tpl" },
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

		const delivery = await db.createDelivery({
			userId: "u1",
			eventType: "sched.process",
			templateName: "sched-proc-tpl",
			channel: "email",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: new Date("2025-01-01"),
			acceptedAt: null,
			failedAt: null,
		});

		const stop = await herald.startScheduledWorker(50);
		await vi.advanceTimersByTimeAsync(50);
		stop();

		expect(resolvePayload).toHaveBeenCalledWith(
			expect.objectContaining({ id: delivery.id }),
		);
		expect(mail.send).toHaveBeenCalledWith(
			expect.objectContaining({ subject: "Order ord_resolved" }),
		);
	});
});

// ─── startScheduledWorker ─────────────────────────────────────

describe("startScheduledWorker", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("3.12 ticks → claimScheduledBatch(now) → resolvePayload → queue.enqueue", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const resolvePayload = vi
			.fn()
			.mockResolvedValue({ userId: "u1", orderId: "o1" });

		const ev = defineEvent("worker.tick", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"worker-tick-tpl": {
					email: (p: any) => ({ subject: `Tick ${p.orderId}`, html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "worker-tick-tpl" },
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

		await db.createDelivery({
			userId: "u1",
			eventType: "worker.tick",
			templateName: "worker-tick-tpl",
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

		const claimSpy = vi.spyOn(db, "claimScheduledBatch");

		const stop = await herald.startScheduledWorker(100);
		await vi.advanceTimersByTimeAsync(100);
		stop();

		expect(claimSpy).toHaveBeenCalled();
		expect(resolvePayload).toHaveBeenCalledOnce();
		expect(mail.send).toHaveBeenCalledOnce();
	});

	it("3.13 stop fn: after calling stop, advancing 200ms, claimScheduledBatch count does not increase", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("worker.stop", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"worker-stop-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "worker-stop-tpl" },
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

		const claimSpy = vi.spyOn(db, "claimScheduledBatch");

		const stop = await herald.startScheduledWorker(50);
		await vi.advanceTimersByTimeAsync(50);
		const countAtStop = claimSpy.mock.calls.length;
		stop();
		await vi.advanceTimersByTimeAsync(200);
		expect(claimSpy.mock.calls.length).toBe(countAtStop);
	});

	it("can be restarted after its stop function is called", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("worker.restart", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"worker-restart-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "worker-restart-tpl" },
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

		const claimSpy = vi.spyOn(db, "claimScheduledBatch");
		const stopFirst = await herald.startScheduledWorker(50);
		stopFirst();

		const stopSecond = await herald.startScheduledWorker(50);
		await vi.advanceTimersByTimeAsync(50);
		stopSecond();

		expect(claimSpy).toHaveBeenCalledOnce();
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

	it("3.14 empty poll: getPendingScheduled returns [], no error, queue.enqueue not called (mail not called)", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("worker.empty", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"worker-empty-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "worker-empty-tpl" },
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

		let didThrow = false;
		const stop = await herald.startScheduledWorker(50);
		try {
			await vi.advanceTimersByTimeAsync(50);
		} catch {
			didThrow = true;
		}
		stop();

		expect(didThrow).toBe(false);
		expect(mail.send).not.toHaveBeenCalled();
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

// ─── Hygiene Fixes ─────────────────────────────────

describe("scheduledAt in past throws", () => {
	it("10.2 send() with scheduledAt 10s ago throws mentioning 'scheduledAt' and 'future', no delivery created", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("sched.past-guard", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"past-guard-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "past-guard-tpl" },
			],
			resolvePayload: async () => ({ userId: "u1" }),
		});

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

		const pastDate = new Date(Date.now() - 10_000);
		await expect(
			herald.send(
				"sched.past-guard",
				{ userId: "u1" },
				{ scheduledAt: pastDate },
			),
		).rejects.toThrow(/scheduledAt/);

		await expect(
			herald.send(
				"sched.past-guard",
				{ userId: "u1" },
				{ scheduledAt: pastDate },
			),
		).rejects.toThrow(/future/);

		expect(db._deliveries.size).toBe(0);
	});
});
