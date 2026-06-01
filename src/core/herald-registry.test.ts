// ============================================================
// herald — src/core/herald-registry.test.ts
// Tests for per-instance registry
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { defineEvent } from "./define.js";
import { createHerald } from "./herald.js";
import { createMockDb } from "../__tests__/helpers/mock-db-adapter.js";
import type { EventRef } from "../types/index.js";

// ─── Helpers ──────────────────────────────────────────────────

function makePassthroughSchema<T>() {
	return { parse: (x: unknown) => x as T };
}

const DEFAULT_TMPL_NAME = "order-tmpl";

function makeBaseEvent(name = "order.completed") {
	return defineEvent(name, {
		schema: z.object({ userId: z.string(), orderId: z.string() }),
		templates: {
			[DEFAULT_TMPL_NAME]: {
				email: (p: any) => ({ subject: `Order ${p.orderId}`, html: "<p/>" }),
			},
		},
		dispatch: (p) => [
			{ to: p.userId, channels: ["email"], template: DEFAULT_TMPL_NAME },
		],
	});
}

function makeHeraldWithInstance(
	ev: EventRef<string, any, any>,
	db = createMockDb(),
) {
	return createHerald({
		db,
		channels: { inApp: false },
		queue: { driver: "sync" },
		compliance: { retention: { autoPurge: false } },
		events: { ev },
	});
}

// ─── tests ───────────────────────────────────────────

describe("defineEvent — pure factory", () => {
	it("returns { name, definition } without throwing", () => {
		const def = {
			schema: makePassthroughSchema(),
			templates: {},
			dispatch: () => [],
		};
		const ref = defineEvent("pure.test.2a", def);
		expect(ref.name).toBe("pure.test.2a");
		// defineEvent spreads and adds persistedFields default — not same reference
		expect(ref.definition).toMatchObject({
			schema: def.schema,
			dispatch: def.dispatch,
			persistedFields: [],
		});
	});

	it("returns an EventRef object (has name and definition properties)", () => {
		const ev = defineEvent("has.props.2a", {
			schema: makePassthroughSchema(),
			templates: {},
			dispatch: () => [],
		});
		expect(ev).toHaveProperty("name", "has.props.2a");
		expect(ev).toHaveProperty("definition");
	});

	it("same EventRef can be passed to multiple createHerald instances (no conflict)", () => {
		const ev = defineEvent("shared.ref.2a", {
			schema: z.object({ userId: z.string(), orderId: z.string() }),
			templates: {
				"shared-ref-tmpl-2a": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "shared-ref-tmpl-2a",
				},
			],
		});
		// Two instances can share the same EventRef — no global conflict
		expect(() => {
			createHerald({
				db: createMockDb(),
				channels: { inApp: false },
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { ev },
			});
			createHerald({
				db: createMockDb(),
				channels: { inApp: false },
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { ev },
			});
		}).not.toThrow();
	});
});

describe("createHerald with events map", () => {
	it("resolves event by name from instance map when events map passed", async () => {
		const ev = makeBaseEvent("inst.event");
		const db = createMockDb();
		const herald = makeHeraldWithInstance(ev, db);

		// dispatch returns template "order-tmpl" — resolves via instance templateMap
		// No email capability, so delivery gets skipped in channel resolution
		await expect(
			herald.send("inst.event", { userId: "u1", orderId: "o1" }),
		).resolves.not.toThrow();
	});

	it("throws with duplicate event name in events map at construction time", () => {
		const ev = makeBaseEvent("dup.arr.event");
		expect(() => {
			createHerald({
				db: createMockDb(),
				channels: { inApp: false },
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { ev, ev2: ev }, // duplicate!
			});
		}).toThrow(/dup\.arr\.event|[Dd]uplicate/);
	});

	it("two createHerald instances using the same EventRef do NOT conflict", async () => {
		// defineEvent is a pure factory, so the same ref can be reused by separate instances.
		const ev = makeBaseEvent("shared.event.2a");
		const db1 = createMockDb();
		const herald1 = makeHeraldWithInstance(ev, db1);

		const db2 = createMockDb();
		const herald2 = makeHeraldWithInstance(ev, db2); // same ref, different instance

		// Both instances can use "shared.event.2a" via their own instance maps — no conflict
		await expect(
			herald1.send("shared.event.2a", { userId: "u1", orderId: "o1" }),
		).resolves.not.toThrow();
		await expect(
			herald2.send("shared.event.2a", { userId: "u2", orderId: "o2" }),
		).resolves.not.toThrow();
	});
});

// ─── tests (full isolation) ─────────────────────────

describe("per-instance isolation — no cross-contamination", () => {
	it("instance A with event 'x', instance B with event 'x' — no cross-contamination", async () => {
		// defineEvent is completely pure (no global write),
		// so creating two refs with same name is safe.
		// This test documents the DESIRED behavior.
		// It must pass after changes are applied.

		const evA = defineEvent("x.isolated.2b", {
			schema: z.object({ userId: z.string(), orderId: z.string() }),
			templates: {
				"x-iso-tmpl-a": {
					email: (p: any) => ({ subject: `A: ${p.orderId}`, html: "<p/>" }),
				},
			},
			dispatch: (p: any) => [
				{ to: p.userId, channels: ["email"], template: "x-iso-tmpl-a" },
			],
			resolvePayload: async () => ({ userId: "a", orderId: "a_order" }),
		});
		const dbA = createMockDb();
		const heraldA = createHerald({
			db: dbA,
			channels: { inApp: false },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { evA },
		});

		// Instance B uses a different event name
		const evB = defineEvent("x.isolated.2b.b", {
			schema: z.object({ userId: z.string(), orderId: z.string() }),
			templates: {
				"x-iso-tmpl-b": {
					email: (p: any) => ({ subject: `B: ${p.orderId}`, html: "<p/>" }),
				},
			},
			dispatch: (p: any) => [
				{ to: p.userId, channels: ["email"], template: "x-iso-tmpl-b" },
			],
		});
		const dbB = createMockDb();
		const heraldB = createHerald({
			db: dbB,
			channels: { inApp: false },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { evB },
		});

		// Both should be usable with no interference between their instance maps
		await expect(
			heraldA.send("x.isolated.2b", { userId: "ua", orderId: "oa" }),
		).resolves.not.toThrow();
		await expect(
			heraldB.send("x.isolated.2b.b", { userId: "ub", orderId: "ob" }),
		).resolves.not.toThrow();
	});

	it("createHerald with no events map throws", () => {
		expect(() => {
			createHerald({
				db: createMockDb(),
				channels: { inApp: false },
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				// no events map — testing JS runtime guard via cast
			} as any);
		}).toThrow(/events/);
	});

	it("rejects the old events array shape at runtime", () => {
		const ev = makeBaseEvent("old.array.shape");
		expect(() => {
			createHerald({
				db: createMockDb(),
				channels: { inApp: false },
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: [ev],
			} as any);
		}).toThrow(/events must be an object map/);
	});
});

// ─── Payload + Template Contract ────────────────────

describe("resolvePayload returns null → delivery fails with message", () => {
	it("resolvePayload returning null marks delivery failed with 'null or undefined' in lastError", async () => {
		const { z } = await import("zod");
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
		const { z } = await import("zod");
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

// ─── PR#3 Orphan template detection ──────────────────────────
// With the new API, `dispatch` return is narrowed to `keyof TTemplates` at compile time,
// so a template-name mismatch is a tsc error. At runtime (e.g. via `as any` escape hatches),
// validateRecipients() catches it during send(). warmup() cannot safely call dispatch()
// with a fake payload; send()-time detection is the correct guard.

describe("PR#3 — orphan template name detected at send() time", () => {
	it("send() throws when dispatch() returns a template name not in event.templates", async () => {
		// Use `as any` to bypass the TypeScript type check — mimics a broken runtime config
		const ev = defineEvent("orphan.dispatch", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"existing-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				// "missing-tpl" is NOT in the templates map — only possible via `as any`
				{
					to: p.userId,
					channels: ["email"],
					template: "missing-tpl" as any,
				},
			],
		});

		const herald = makeHeraldWithInstance(ev);

		// send() calls validateRecipients() which catches the orphaned template name
		await expect(
			herald.send("orphan.dispatch", { userId: "u1" }),
		).rejects.toThrow(
			/Template "missing-tpl" referenced in event "orphan.dispatch" is not registered/,
		);
	});

	it("send() throws when dispatch() returns a template owned by another event", async () => {
		const evA = defineEvent("orphan.cross-owner.a", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"event-a-tpl": {
					email: () => ({ subject: "a", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "event-b-tpl" as any,
				},
			],
		});
		const evB = defineEvent("orphan.cross-owner.b", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"event-b-tpl": {
					email: () => ({ subject: "b", html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "event-b-tpl" },
			],
		});
		const herald = createHerald({
			db: createMockDb(),
			channels: { inApp: false },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { evA, evB },
		});

		await expect(
			herald.send("orphan.cross-owner.a", { userId: "u1" }),
		).rejects.toThrow(
			/Template "event-b-tpl" referenced in event "orphan.cross-owner.a" is not registered/,
		);
	});

	it("warmup() does NOT throw on a valid event with templates", () => {
		const ev = makeBaseEvent("orphan.warmup.valid");
		const herald = makeHeraldWithInstance(ev);
		expect(() => herald.warmup()).not.toThrow();
	});

	it("warmup() emits a console.warn when an event has no templates", () => {
		const ev = defineEvent("orphan.warmup.no-tpl", {
			schema: z.object({ userId: z.string() }),
			templates: {},
			dispatch: () => [],
		});
		const herald = makeHeraldWithInstance(ev);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			herald.warmup();
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("has no templates"),
			);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("createHerald() allows different events to share a template name", () => {
		const evA = defineEvent("orphan.collision.a", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"shared-tpl": { email: () => ({ subject: "a", html: "<p/>" }) },
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "shared-tpl" },
			],
		});
		const evB = defineEvent("orphan.collision.b", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"shared-tpl": { email: () => ({ subject: "b", html: "<p/>" }) },
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "shared-tpl" },
			],
		});

		expect(() =>
			createHerald({
				db: createMockDb(),
				channels: { inApp: false },
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { evA, evB },
			}),
		).not.toThrow();
	});
});

describe("warmup() validates template-event linkage", () => {
	it("warmup() with valid registry resolves without error", () => {
		const ev = defineEvent("warmup.valid", {
			schema: { parse: (x: any) => x },
			templates: {
				"warmup-valid-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: () => [],
		});

		const herald = createHerald({
			db: createMockDb(),
			channels: { inApp: false },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		expect(() => herald.warmup()).not.toThrow();
	});

	it("warmup() with event having no templates in map does not throw (no orphan check needed)", () => {
		// Inline templates are always owned by their event — orphaned templates are impossible
		// via the new API. The shim path (config.templates) orphan detection is covered in
		// herald.test.ts and will be removed in PR#3 along with the shim.
		const ev = defineEvent("warmup.no-templates", {
			schema: { parse: (x: any) => x },
			templates: {},
			dispatch: () => [],
		});

		const herald = createHerald({
			db: createMockDb(),
			channels: { inApp: false },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		expect(() => herald.warmup()).not.toThrow();
	});
});
