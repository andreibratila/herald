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
});
