// ============================================================
// integration tests — Safe Hooks + Retry Architecture
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { defineEvent } from "../../core/define.js";
import { createHerald } from "../../core/herald.js";
import { createMockDb } from "../helpers/mock-db-adapter.js";
import { createMockMailAdapter } from "../helpers/mock-mail-adapter.js";

// ─── helpers ──────────────────────────────────────────────────

function makeEmailSetup(eventName: string) {
	const tplName = `${eventName}-tpl`;
	const ev = defineEvent(eventName, {
		schema: z.object({ userId: z.string() }),
		templates: {
			[tplName]: {
				email: () => ({ subject: "s", html: "<p/>" }),
			},
		},
		dispatch: (p) => [{ to: p.userId, channels: ["email"], template: tplName }],
	});
	return { ev };
}

function makeInAppSetup(eventName: string) {
	const tplName = `${eventName}-tpl`;
	const ev = defineEvent(eventName, {
		schema: z.object({ userId: z.string() }),
		templates: {
			[tplName]: {
				inApp: () => ({ title: "hello" }),
			},
		},
		dispatch: (p) => [{ to: p.userId, channels: ["inApp"], template: tplName }],
	});
	return { ev };
}

// ─── 7.2 safeHook — onFailed throws, delivery still "failed" ──

describe("safeHook — onFailed throws, no unhandled rejection", () => {
	it("delivery is marked 'failed' even when onFailed hook throws", async () => {
		const { ev } = makeEmailSetup("ph7.onfailed-throws");
		const db = createMockDb();
		const mail = createMockMailAdapter();
		mail.send.mockRejectedValueOnce(new Error("SMTP down"));

		const onFailed = vi.fn().mockRejectedValueOnce(new Error("hook exploded"));

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "x@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onFailed },
			events: { ev },
		});

		// errors go into result.errors[] — send() no longer throws per-recipient errors
		// safeHook wraps onFailed so its error is swallowed, not propagated
		const result = await herald.send("ph7.onfailed-throws", { userId: "u1" });
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]!.error.message).toBe("SMTP down");

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.status).toBe("failed");
		expect(onFailed).toHaveBeenCalledOnce();
	});
});

describe("safeHook — onDelivered throws, delivery still 'accepted'", () => {
	it("delivery is marked 'accepted' even when onDelivered hook throws", async () => {
		const { ev } = makeEmailSetup("ph7.ondelivered-throws");
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const onDelivered = vi
			.fn()
			.mockRejectedValueOnce(new Error("hook exploded"));

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "x@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onDelivered },
			events: { ev },
		});

		// Should NOT throw — hook error is swallowed by safeHook
		await herald.send("ph7.ondelivered-throws", { userId: "u1" });

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.status).toBe("accepted");
		expect(onDelivered).toHaveBeenCalledOnce();
	});
});

// ─── 7.4 no_capable_channels ─────────────────────────────────
// To reach the no_capable_channels path in processDelivery, we bypass send()'s
// channel check by injecting a scheduled delivery directly into the DB, then
// trigger processDelivery via startScheduledWorker (fake timers for determinism).

function makeScheduledDelivery(
	db: ReturnType<typeof createMockDb>,
	overrides: {
		eventType: string;
		templateName: string;
		channel?: "email" | "inApp";
	},
) {
	return db.createDelivery({
		userId: "u1",
		eventType: overrides.eventType,
		templateName: overrides.templateName,
		channel: overrides.channel ?? "email",
		status: "scheduled",
		scheduledAt: new Date(Date.now() - 60_000),
		attempts: 0,
		lastError: null,
		externalId: null,
		idempotencyKey: null,
		acceptedAt: null,
		failedAt: null,
	});
}

async function runOneTick(
	herald: {
		startScheduledWorker: (
			ms: number,
			opts?: { maxResolveAttempts?: number },
		) => Promise<() => void>;
	},
	opts?: { maxResolveAttempts?: number },
): Promise<void> {
	vi.useFakeTimers();
	try {
		const stop = await herald.startScheduledWorker(100, opts);
		await vi.advanceTimersByTimeAsync(150);
		stop();
	} finally {
		vi.useRealTimers();
	}
}

describe("no_capable_channels — requested channel unavailable", () => {
	it("delivery is marked 'failed' with lastError 'no_capable_channels' when no configured channels match", async () => {
		const ev = defineEvent("ph7.no-cap-pd", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"ph7.no-cap-pd-tpl": {
					// Template HAS a renderer — so reason must be "no_capable_channels", not "no_template_renderers"
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "ph7.no-cap-pd-tpl" },
			],
			resolvePayload: async () => ({ userId: "u1" }),
		});
		const db = createMockDb();

		const herald = createHerald({
			db,
			channels: { inApp: false },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await makeScheduledDelivery(db, {
			eventType: "ph7.no-cap-pd",
			templateName: "ph7.no-cap-pd-tpl",
		});
		await runOneTick(herald);

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.status).toBe("failed");
		expect(delivery?.lastError).toBe("no_capable_channels");
	});

	it("onFailed hook is called with 'no_capable_channels' error", async () => {
		const ev = defineEvent("ph7.no-cap-hook-pd", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"ph7.no-cap-hook-pd-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "ph7.no-cap-hook-pd-tpl",
				},
			],
			resolvePayload: async () => ({ userId: "u1" }),
		});
		const db = createMockDb();
		const onFailed = vi.fn();

		const herald = createHerald({
			db,
			channels: { inApp: false },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onFailed },
			events: { ev },
		});

		await makeScheduledDelivery(db, {
			eventType: "ph7.no-cap-hook-pd",
			templateName: "ph7.no-cap-hook-pd-tpl",
		});
		await runOneTick(herald);

		expect(onFailed).toHaveBeenCalledOnce();
		expect(onFailed.mock.calls[0]![1].message).toBe("no_capable_channels");
	});
});

// ─── 7.4 persisted delivery failures ─────────────────────────

describe("persisted delivery failures — onFailed hook", () => {
	it("calls onFailed when a persisted delivery references an unknown template", async () => {
		const ev = defineEvent("ph7.missing-template-hook", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"ph7.missing-template-hook-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "ph7.missing-template-hook-tpl",
				},
			],
			resolvePayload: async () => ({ userId: "u1" }),
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const onFailed = vi.fn();

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "x@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onFailed },
			events: { ev },
		});

		await makeScheduledDelivery(db, {
			eventType: "ph7.missing-template-hook",
			templateName: "ph7.missing-template-hook-unknown",
		});
		await runOneTick(herald);

		const delivery = [...db._deliveries.values()][0]!;
		expect(delivery.status).toBe("failed");
		expect(delivery.lastError).toContain("Template");
		expect(onFailed).toHaveBeenCalledOnce();
		expect(onFailed.mock.calls[0]![1].message).toBe(delivery.lastError);
	});

	it("calls onFailed when a persisted scheduled delivery cannot resolve payload", async () => {
		const { ev } = makeEmailSetup("ph7.missing-resolver-hook");
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const onFailed = vi.fn();

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "x@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onFailed },
			events: { ev },
		});

		await makeScheduledDelivery(db, {
			eventType: "ph7.missing-resolver-hook",
			templateName: "ph7.missing-resolver-hook-tpl",
		});
		await runOneTick(herald, { maxResolveAttempts: 1 });

		const delivery = [...db._deliveries.values()][0]!;
		expect(delivery.status).toBe("failed");
		expect(delivery.lastError).toContain("has no resolvePayload");
		expect(onFailed).toHaveBeenCalledOnce();
		expect(onFailed.mock.calls[0]![1].message).toBe(delivery.lastError);
	});
});

describe("no_template_renderers — template has no renderers", () => {
	it("calls onFailed when a persisted delivery has a template with no renderers", async () => {
		const ev = defineEvent("ph7.no-renderers-hook", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"ph7.no-renderers-hook-tpl": {},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "ph7.no-renderers-hook-tpl",
				},
			],
			resolvePayload: async () => ({ userId: "u1" }),
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const onFailed = vi.fn();

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "x@test.com" },
				inApp: true,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onFailed },
			events: { ev },
		});

		await makeScheduledDelivery(db, {
			eventType: "ph7.no-renderers-hook",
			templateName: "ph7.no-renderers-hook-tpl",
		});
		await runOneTick(herald);

		const delivery = [...db._deliveries.values()][0]!;
		expect(delivery.status).toBe("failed");
		expect(delivery.lastError).toBe("no_template_renderers");
		expect(onFailed).toHaveBeenCalledOnce();
		expect(onFailed.mock.calls[0]![1].message).toBe("no_template_renderers");
	});

	it("delivery marked 'failed' with lastError 'no_template_renderers' when template has no renderers", async () => {
		const ev = defineEvent("ph7.no-renderers-pd", {
			schema: z.object({ userId: z.string() }),
			templates: {
				// Intentionally empty — no email, no inApp renderer
				"ph7.no-renderers-pd-tpl": {},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "ph7.no-renderers-pd-tpl",
				},
			],
			resolvePayload: async () => ({ userId: "u1" }),
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const herald = createHerald({
			db,
			// Configured channels ARE present — absence of renderers (not configured channels) must trigger the path
			channels: {
				email: { adapter: mail, defaultFrom: "x@test.com" },
				inApp: true,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await makeScheduledDelivery(db, {
			eventType: "ph7.no-renderers-pd",
			templateName: "ph7.no-renderers-pd-tpl",
		});
		await runOneTick(herald);

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.status).toBe("failed");
		expect(delivery?.lastError).toBe("no_template_renderers");
	});
});

// ─── 7.5 sideEffectsCompletedAt set before updateDelivery("accepted") ──

describe("sideEffectsCompletedAt — set before updateDelivery('accepted')", () => {
	it("sideEffectsCompletedAt is set on delivery before status becomes 'accepted'", async () => {
		const { ev } = makeEmailSetup("ph7.sideeffects");
		const db = createMockDb();
		const mail = createMockMailAdapter();

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

		await herald.send("ph7.sideeffects", { userId: "u1" });

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.status).toBe("accepted");
		expect(delivery?.sideEffectsCompletedAt).toBeInstanceOf(Date);
	});

	it("updateDelivery('accepted') is called AFTER sideEffectsCompletedAt is set", async () => {
		const { ev } = makeEmailSetup("ph7.order-check");
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const callOrder: string[] = [];
		const origUpdate = db.updateDelivery.bind(db);
		db.updateDelivery = async (id, patch) => {
			if (patch.sideEffectsCompletedAt) callOrder.push("sideEffectsCompletedAt");
			if (patch.status === "accepted") callOrder.push("status:accepted");
			return origUpdate(id, patch);
		};

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

		await herald.send("ph7.order-check", { userId: "u1" });

		const sideEffectsIdx = callOrder.indexOf("sideEffectsCompletedAt");
		const sentIdx = callOrder.indexOf("status:accepted");
		expect(sideEffectsIdx).toBeGreaterThanOrEqual(0);
		expect(sentIdx).toBeGreaterThan(sideEffectsIdx);
	});
});

// ─── 7.5 notification.accepted_unconfirmed ───────────────────────

describe("notification.accepted_unconfirmed — updateDelivery('accepted') always fails", () => {
	it("emits sent_unconfirmed audit and delivery stays 'dispatched' when all 5 updateDelivery('accepted') attempts fail", async () => {
		const { ev } = makeEmailSetup("ph7.unconfirmed");
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const origUpdate = db.updateDelivery.bind(db);
		db.updateDelivery = async (id, patch) => {
			if (patch.status === "accepted") throw new Error("DB write failed");
			return origUpdate(id, patch);
		};

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "x@test.com" },
				inApp: false,
			},
			// backoffDelay: 1 to speed up the 5-attempt updateDelivery("accepted") loop
			queue: { driver: "sync", retries: 0, backoffDelay: 1 },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		// Should NOT throw — sent_unconfirmed is a best-effort audit, not an error
		// errors go into result.errors[] for per-recipient failures
		await herald.send("ph7.unconfirmed", { userId: "u1" });

		const unconfirmed = db._auditLogs.find(
			(l) => l.action === "notification.accepted_unconfirmed",
		);
		expect(unconfirmed).toBeDefined();

		const delivery = [...db._deliveries.values()][0];
		// Delivery stays in "dispatched" with sideEffectsCompletedAt set (side effects happened — not "failed")
		expect(delivery?.status).toBe("dispatched");
		expect(delivery?.sideEffectsCompletedAt).toBeInstanceOf(Date);
		expect(mail.send).toHaveBeenCalledOnce();
	});
});

// ─── renderedHash ───────────────────────────────────

describe("renderedHash — email delivery computes and persists hash", () => {
	it("T34: db.updateDelivery is called with both externalId and renderedHash (64-char hex) in same call", async () => {
		const { ev } = makeEmailSetup("ph8.hash-email");
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const updateSpy = vi.spyOn(db, "updateDelivery");

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

		await herald.send("ph8.hash-email", { userId: "u1" });

		// Find the call that sets externalId
		const callWithExternalId = updateSpy.mock.calls.find(
			([, patch]) => patch.externalId !== undefined,
		);
		expect(callWithExternalId).toBeDefined();
		const patch = callWithExternalId![1];
		// Both must be in the same call
		expect(patch.externalId).toBeDefined();
		expect(patch.renderedHash).toBeDefined();
		expect(typeof patch.renderedHash).toBe("string");
		expect(patch.renderedHash).toHaveLength(64);
		expect(patch.renderedHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("T35: inApp-only delivery does NOT include renderedHash in any updateDelivery call", async () => {
		const { ev } = makeInAppSetup("ph8.hash-inapp");
		const db = createMockDb();

		const updateSpy = vi.spyOn(db, "updateDelivery");

		const herald = createHerald({
			db,
			channels: { inApp: true },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("ph8.hash-inapp", { userId: "u1" });

		// No updateDelivery call should contain renderedHash
		const callsWithHash = updateSpy.mock.calls.filter(
			([, patch]) =>
				patch.renderedHash !== undefined && patch.renderedHash !== null,
		);
		expect(callsWithHash).toHaveLength(0);
	});

	it("T36: when template.email throws, updateDelivery with renderedHash is never called", async () => {
		const eventName = "ph8.hash-throw";
		const tplName = `${eventName}-tpl`;
		const ev = defineEvent(eventName, {
			schema: z.object({ userId: z.string() }),
			templates: {
				[tplName]: {
					email: () => {
						throw new Error("render exploded");
					},
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: tplName },
			],
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const updateSpy = vi.spyOn(db, "updateDelivery");

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

		// render throws → delivery goes to failure path
		const result = await herald.send(eventName, { userId: "u1" });
		expect(result.errors).toHaveLength(1);

		// No call should have both renderedHash and externalId
		const callsWithHash = updateSpy.mock.calls.filter(
			([, patch]) =>
				patch.renderedHash !== undefined && patch.renderedHash !== null,
		);
		expect(callsWithHash).toHaveLength(0);
	});
});

// ─── 7.9 sync driver retry behavior ─────────────────────────
// The sync driver supports retries via the createProcessor while-loop.
// retries > 0 on sync driver is valid — no construction-time throw.

describe("sync + retries > 0 — supported on sync driver", () => {
	it("sync driver with retries > 0 does NOT throw at construction", () => {
		const ev = defineEvent("ph7.sync-retry-ok", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"srk-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "srk-tpl" },
			],
		});
		const db = createMockDb();

		expect(() =>
			createHerald({
				db,
				channels: { inApp: false },
				queue: { driver: "sync", retries: 2 },
				compliance: { retention: { autoPurge: false } },
				events: { ev },
			}),
		).not.toThrow();
	});
});
