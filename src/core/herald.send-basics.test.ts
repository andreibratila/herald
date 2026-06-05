import { describe, it, expect } from "vitest";
import { defineEvent } from "./define.js";
import { createHerald } from "./herald.js";
import { createMockDb } from "../__tests__/helpers/mock-db-adapter.js";
import { createMockMailAdapter } from "../__tests__/helpers/mock-mail-adapter.js";

import { makeHerald, makeOrderSetup } from "./runtime/test-utils.js";

// ─── dispatch() purity ────────────────────────────────────────

describe("dispatch() purity", () => {
	it("send() returns empty array when dispatch returns no recipients", async () => {
		const ev = defineEvent("empty.dispatch", {
			schema: { parse: (x: any) => x },
			templates: {},
			dispatch: () => [],
		});
		const { herald } = makeHerald({ events: { ev } });
		const result = await herald.send("empty.dispatch", {});
		expect(result.deliveries).toEqual([]);
		expect(result.errors).toEqual([]);
		expect(result.skipped).toEqual([]);
	});

	it("send() returns one delivery per recipient that is not skipped", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("multi.recipients", {
			schema: { parse: (x: any) => x },
			templates: {
				"mr-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email"], template: "mr-tpl" },
				{ to: "user_2", channels: ["email"], template: "mr-tpl" },
				{ to: "user_3", channels: ["email"], template: "mr-tpl" },
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

		const result = await herald.send("multi.recipients", {});
		expect(result.deliveries).toHaveLength(3);
		expect(db._deliveries.size).toBe(3);
	});
});

// ─── delivery externalId ──────────────────────────────────────

describe("delivery externalId", () => {
	it("stores externalId from mail provider response", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "ext.id" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
		mail.send.mockResolvedValueOnce({ id: "msg_from_provider_123" });

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

		const { deliveries } = await herald.send(eventName, {
			orderId: "o1",
			userId: "user_1",
		});
		const stored = db._deliveries.get(deliveries[0]!.id);
		expect(stored?.externalId).toBe("msg_from_provider_123");
	});
});
