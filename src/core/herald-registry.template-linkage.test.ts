import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { defineEvent } from "./define.js";
import { createHerald } from "./herald.js";
import { createMockDb } from "../__tests__/support/adapters/mock-db-adapter.js";
import { makeBaseEvent, makeHeraldWithInstance } from "../__tests__/support/core/herald-registry.js";

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
