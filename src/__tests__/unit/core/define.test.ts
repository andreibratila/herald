import { describe, it, expect } from "vitest";
import { defineEvent, validateRecipients } from "../../../core/define.js";
import { createHerald } from "../../../core/herald.js";
import { createMockDb } from "../../support/adapters/mock-db-adapter.js";
import { z } from "zod";

// ─── helpers ──────────────────────────────────────────────────

function makePassthroughSchema<T>() {
	return { parse: (x: unknown) => x as T };
}

function makeOrderEvent(name = "order.completed") {
	return defineEvent(name, {
		schema: makePassthroughSchema(),
		templates: {
			"order-user": {
				email: () => ({ subject: "s", html: "<p/>" }),
			},
		},
		dispatch: () => [],
	});
}

function makeHeraldWith(ev: ReturnType<typeof makeOrderEvent>) {
	return createHerald({
		db: createMockDb(),
		channels: { inApp: false },
		queue: { driver: "sync" },
		compliance: { retention: { autoPurge: false } },
		events: { ev },
	});
}

// ─── defineEvent — pure factory ───────────────────────────────

describe("defineEvent — pure factory", () => {
	it("returns { name, definition } with matching name", () => {
		const def = {
			schema: makePassthroughSchema(),
			templates: {},
			dispatch: () => [],
		};
		const ref = defineEvent("factory.a", def);
		expect(ref.name).toBe("factory.a");
		// defineEvent spreads the definition and adds persistedFields default — not same reference
		expect(ref.definition).toMatchObject({
			schema: def.schema,
			dispatch: def.dispatch,
			persistedFields: [],
		});
	});

	it("calling defineEvent twice with same name returns two separate EventRefs — no throw", () => {
		const def = {
			schema: makePassthroughSchema(),
			templates: {},
			dispatch: () => [],
		};
		let ref1: ReturnType<typeof defineEvent>;
		let ref2: ReturnType<typeof defineEvent>;
		expect(() => {
			ref1 = defineEvent("factory.dup", def);
			ref2 = defineEvent("factory.dup", def);
		}).not.toThrow();
		expect(ref1!.name).toBe("factory.dup");
		expect(ref2!.name).toBe("factory.dup");
	});

	it("does not throw for distinct event names", () => {
		expect(() => {
			defineEvent("factory.x", {
				schema: makePassthroughSchema(),
				templates: {},
				dispatch: () => [],
			});
			defineEvent("factory.y", {
				schema: makePassthroughSchema(),
				templates: {},
				dispatch: () => [],
			});
		}).not.toThrow();
	});

	it("same EventRef can be registered in multiple herald instances without conflict", () => {
		const ev = makeOrderEvent("factory.shared");
		// Both instances get the same ref — no global state
		expect(() => {
			makeHeraldWith(ev);
			makeHeraldWith(ev);
		}).not.toThrow();
	});
});

// ─── defineEvent — duplicate detection at createHerald ────────

describe("defineEvent — duplicate detection at createHerald construction", () => {
	it("throws with duplicate name when same EventRef registered twice in events map", () => {
		const ev = makeOrderEvent("dup.ctor.a");
		expect(() =>
			createHerald({
				db: createMockDb(),
				channels: { inApp: false },
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { ev, ev2: ev }, // same ref twice
			}),
		).toThrow("dup.ctor.a");
	});

	it("throws with name when two EventRefs with same name in events map", () => {
		const ev1 = defineEvent("dup.ctor.b", {
			schema: makePassthroughSchema(),
			templates: {},
			dispatch: () => [],
		});
		const ev2 = defineEvent("dup.ctor.b", {
			schema: makePassthroughSchema(),
			templates: {},
			dispatch: () => [],
		});
		expect(() =>
			createHerald({
				db: createMockDb(),
				channels: { inApp: false },
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { ev1, ev2 }, // two refs with same name
			}),
		).toThrow("dup.ctor.b");
	});

	it("does not throw for distinct event names in events map", () => {
		const ev1 = defineEvent("distinct.ctor.a", {
			schema: makePassthroughSchema(),
			templates: {},
			dispatch: () => [],
		});
		const ev2 = defineEvent("distinct.ctor.b", {
			schema: makePassthroughSchema(),
			templates: {},
			dispatch: () => [],
		});
		expect(() =>
			createHerald({
				db: createMockDb(),
				channels: { inApp: false },
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { ev1, ev2 },
			}),
		).not.toThrow();
	});

	it("throws when event compliance references an unknown legal basis", () => {
		const ev = defineEvent("compliance.unknown", {
			schema: makePassthroughSchema(),
			compliance: { purpose: "test.unknown", legalBasis: "missing_basis" },
			templates: {},
			dispatch: () => [],
		} as any);

		expect(() =>
			createHerald({
				db: createMockDb(),
				channels: { inApp: false },
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { ev },
			}),
		).toThrow(/Unknown legal basis "missing_basis"/);
	});

	it("extends built-in legal bases when custom legalBases are configured", () => {
		const ev = defineEvent("compliance.custom.extends", {
			schema: makePassthroughSchema(),
			compliance: { purpose: "test.contract", legalBasis: "contract" },
			templates: {},
			dispatch: () => [],
		} as any);

		expect(() =>
			createHerald({
				db: createMockDb(),
				channels: { inApp: false },
				queue: { driver: "sync" },
				compliance: {
					retention: { autoPurge: false },
					legalBases: {
						partner_agreement: {
							requiresConsentEvent: false,
							requiresSuppressionCheck: false,
							defaultDecision: "allow",
						},
					},
				},
				events: { ev },
			}),
		).not.toThrow();
	});

	it("can replace built-in legal bases explicitly", () => {
		const ev = defineEvent("compliance.custom.replace", {
			schema: makePassthroughSchema(),
			compliance: { purpose: "test.contract", legalBasis: "contract" },
			templates: {},
			dispatch: () => [],
		} as any);

		expect(() =>
			createHerald({
				db: createMockDb(),
				channels: { inApp: false },
				queue: { driver: "sync" },
				compliance: {
					retention: { autoPurge: false },
					replaceDefaultLegalBases: true,
					legalBases: {
						partner_agreement: {
							requiresConsentEvent: false,
							requiresSuppressionCheck: false,
							defaultDecision: "allow",
						},
					},
				},
				events: { ev },
			}),
		).toThrow(/Unknown legal basis "contract"/);
	});
});

// ─── validateRecipients contract ──────────────────────────────

describe("validateRecipients", () => {
	it("does not throw for a valid recipient with a registered template", () => {
		const ev = makeOrderEvent("vr.order");
		// Build templateMap from the event's inline templates
		const templateMap = new Map([
			["order-user", ev.definition.templates["order-user"]!],
		]);
		expect(() =>
			validateRecipients(
				"vr.order",
				[{ to: "user_1", channels: ["email"], template: "order-user" }],
				templateMap,
			),
		).not.toThrow();
	});

	it("throws for non-array dispatch return", () => {
		expect(() => validateRecipients("order.completed", null as any)).toThrow();
	});

	it("throws when recipient is missing 'to'", () => {
		const ev = makeOrderEvent("vr.missing-to");
		const templateMap = new Map([
			["order-user", ev.definition.templates["order-user"]!],
		]);
		expect(() =>
			validateRecipients(
				"vr.missing-to",
				[{ to: "", channels: ["email"], template: "order-user" }] as any,
				templateMap,
			),
		).toThrow();
	});

	it("throws when recipient is missing 'template'", () => {
		expect(() =>
			validateRecipients("order.completed", [
				{ to: "user_1", channels: ["email"], template: "" },
			] as any),
		).toThrow();
	});

	it("throws for invalid channel 'fax' and error contains 'fax'", () => {
		const ev = makeOrderEvent("vr.fax");
		const templateMap = new Map([
			["order-user", ev.definition.templates["order-user"]!],
		]);
		expect(() =>
			validateRecipients(
				"vr.fax",
				[{ to: "user_1", channels: ["fax"], template: "order-user" }] as any,
				templateMap,
			),
		).toThrow("fax");
	});

	it("accepts channel 'email'", () => {
		const ev = makeOrderEvent("vr.email");
		const templateMap = new Map([
			["order-user", ev.definition.templates["order-user"]!],
		]);
		expect(() =>
			validateRecipients(
				"vr.email",
				[{ to: "user_1", channels: ["email"], template: "order-user" }],
				templateMap,
			),
		).not.toThrow();
	});

	it("accepts channel 'inApp'", () => {
		const ev = makeOrderEvent("vr.inapp");
		const templateMap = new Map([
			["order-user", ev.definition.templates["order-user"]!],
		]);
		expect(() =>
			validateRecipients(
				"vr.inapp",
				[{ to: "user_1", channels: ["inApp"], template: "order-user" }],
				templateMap,
			),
		).not.toThrow();
	});

	it("accepts explicit channels array", () => {
		const ev = makeOrderEvent("vr.channels");
		const templateMap = new Map([
			["order-user", ev.definition.templates["order-user"]!],
		]);
		expect(() =>
			validateRecipients(
				"vr.channels",
				[
					{
						to: "user_1",
						channels: ["email", "inApp"],
						template: "order-user",
					},
				] as any,
				templateMap,
			),
		).not.toThrow();
	});

	it("throws when channels array is empty", () => {
		const ev = makeOrderEvent("vr.channels-empty");
		const templateMap = new Map([
			["order-user", ev.definition.templates["order-user"]!],
		]);
		expect(() =>
			validateRecipients(
				"vr.channels-empty",
				[{ to: "user_1", channels: [], template: "order-user" }] as any,
				templateMap,
			),
		).toThrow(/channels/);
	});

	it("throws for legacy singular channel property", () => {
		const ev = makeOrderEvent("vr.legacy-channel");
		const templateMap = new Map([
			["order-user", ev.definition.templates["order-user"]!],
		]);
		expect(() =>
			validateRecipients(
				"vr.legacy-channel",
				[{ to: "user_1", channel: "email", template: "order-user" }] as any,
				templateMap,
			),
		).toThrow(/channels/);
	});

	it("throws for unregistered template name and error contains template name", () => {
		const templateMap = new Map<string, any>(); // empty
		expect(() =>
			validateRecipients(
				"vr.ghost",
				[{ to: "user_1", channels: ["email"], template: "ghost-template" }],
				templateMap,
			),
		).toThrow("ghost-template");
	});

	it("empty array is valid (no-op)", () => {
		expect(() => validateRecipients("order.completed", [])).not.toThrow();
	});
});

// ─── zod schema integration ───────────────────────────────────

describe("defineEvent with zod schema", () => {
	it("registers event with a real zod schema without throwing", () => {
		expect(() =>
			defineEvent("zod.event.df", {
				schema: z.object({ userId: z.string(), orderId: z.string() }),
				templates: {
					"zod-tpl": {
						email: (p) => ({ subject: `Order ${p.orderId}`, html: "<p/>" }),
					},
				},
				dispatch: (p) => [
					{ to: p.userId, channels: ["email"], template: "zod-tpl" },
				],
			}),
		).not.toThrow();
	});
});
