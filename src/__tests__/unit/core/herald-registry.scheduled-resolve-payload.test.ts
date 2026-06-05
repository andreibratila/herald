import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { defineEvent } from "../../../core/define.js";
import { createHerald } from "../../../core/herald.js";
import { createMockDb } from "../../support/adapters/mock-db-adapter.js";

describe("resolvePayload returns null → delivery fails with message", () => {
	it("resolvePayload returning null marks delivery failed with 'null or undefined' in lastError", async () => {
		const db = createMockDb();

		const ev = defineEvent("sched.null-resolve", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"null-resolve-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "null-resolve-tpl",
				},
			],
			resolvePayload: async () => null as any,
		});

		const herald = createHerald({
			db,
			channels: { inApp: false },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		// Create a scheduled delivery directly
		await db.createDelivery({
			userId: "u1",
			eventType: "sched.null-resolve",
			templateName: "null-resolve-tpl",
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

		// Use fake timers to tick the scheduled worker
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		try {
			const stop = await herald.startScheduledWorker(50, {
				maxResolveAttempts: 1,
			});
			await vi.advanceTimersByTimeAsync(50);
			stop();
		} finally {
			vi.useRealTimers();
		}

		const delivery = [...db._deliveries.values()][0]!;
		expect(delivery.status).toBe("failed");
		expect(delivery.lastError).toMatch(/null or undefined/);
	});

	it("resolvePayload returning object missing required Zod field → resolveAttempts incremented, no immediate failure below threshold", async () => {
		const db = createMockDb();

		// schema requires orderId: string, but resolvePayload returns {}
		const ev = defineEvent("sched.bad-payload", {
			schema: z.object({ userId: z.string(), orderId: z.string() }),
			templates: {
				"bad-payload-tpl": {
					email: (p: any) => ({ subject: `${p.orderId}`, html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "bad-payload-tpl",
				},
			],
			resolvePayload: async () => ({ userId: "u1" }) as any, // missing orderId
		});

		const herald = createHerald({
			db,
			channels: { inApp: false },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await db.createDelivery({
			userId: "u1",
			eventType: "sched.bad-payload",
			templateName: "bad-payload-tpl",
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

		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		try {
			// maxResolveAttempts=3 — one tick → resolveAttempts=1, not yet failed
			const stop = await herald.startScheduledWorker(50, {
				maxResolveAttempts: 3,
			});
			await vi.advanceTimersByTimeAsync(50);
			stop();
		} finally {
			vi.useRealTimers();
		}

		const delivery = [...db._deliveries.values()][0]!;
		// After 1 attempt with threshold 3 → still not failed, resolveAttempts incremented
		expect(delivery.resolveAttempts).toBe(1);
		expect(delivery.status).not.toBe("failed");
	});
});
