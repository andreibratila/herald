import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineEvent } from "./define.js";
import { createHerald } from "./herald.js";
import { createMockDb } from "../__tests__/helpers/mock-db-adapter.js";

function makePassthroughSchema<T>() {
	return { parse: (x: unknown) => x as T };
}

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
