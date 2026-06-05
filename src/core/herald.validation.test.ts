import { describe, it, expect } from "vitest";
import { defineEvent } from "./define.js";
import { createHerald } from "./herald.js";
import { createMockDb } from "../__tests__/support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../__tests__/support/adapters/mock-mail-adapter.js";

describe("email channel defaultFrom validation at construction", () => {
	it("10.4a createHerald({ channels.email.defaultFrom: 'notanemail' }) throws mentioning 'defaultFrom'", () => {
		const ev = defineEvent("valid-for-from", {
			schema: { parse: (x: any) => x },
			templates: {},
			dispatch: () => [],
		});
		expect(() => {
			createHerald({
				db: createMockDb(),
				channels: {
					email: {
						adapter: createMockMailAdapter(),
						defaultFrom: "notanemail",
					},
					inApp: false,
				},
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { ev },
			});
		}).toThrow(/defaultFrom/);
	});

	it("10.4b createHerald({ channels.email.defaultFrom: '' }) throws mentioning 'defaultFrom'", () => {
		const ev = defineEvent("valid-for-empty-from", {
			schema: { parse: (x: any) => x },
			templates: {},
			dispatch: () => [],
		});
		expect(() => {
			createHerald({
				db: createMockDb(),
				channels: {
					email: { adapter: createMockMailAdapter(), defaultFrom: "" },
					inApp: false,
				},
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { ev },
			});
		}).toThrow(/defaultFrom/);
	});
});
