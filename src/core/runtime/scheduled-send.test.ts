import { describe, it, expect, vi, afterEach } from "vitest";
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
