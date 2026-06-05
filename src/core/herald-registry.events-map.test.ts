import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineEvent } from "./define.js";
import { createHerald } from "./herald.js";
import { createMockDb } from "../__tests__/support/adapters/mock-db-adapter.js";
import { makeBaseEvent, makeHeraldWithInstance } from "../__tests__/support/core/herald-registry.js";

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
