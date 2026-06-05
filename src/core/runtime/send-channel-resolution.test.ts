import { describe, it, expect, vi } from "vitest";
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/support/adapters/mock-mail-adapter.js";

// ─── Channel resolution ───────────────────────────────────────

describe("channel resolution", () => {
	it("configured concrete channels create immediate deliveries", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("ch.configured", {
			schema: { parse: (x: any) => x },
			templates: {
				"ch-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
					inApp: () => ({ title: "t" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email", "inApp"], template: "ch-tpl" },
			],
		});

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "x@test.com" },
				inApp: true,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("ch.configured", {});

		expect(mail.send).toHaveBeenCalledOnce();
		expect([...db._deliveries.values()].map((d) => d.channel).sort()).toEqual([
			"email",
			"inApp",
		]);
	});

	it("no email capability with channel 'email' causes delivery to be skipped", async () => {
		const db = createMockDb();

		const ev = defineEvent("ch.noemail", {
			schema: { parse: (x: any) => x },
			templates: {
				"ch-ne-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email"], template: "ch-ne-tpl" },
			],
		});

		const herald = createHerald({
			db,
			channels: { inApp: false },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("ch.noemail", {});

		expect(db._deliveries.size).toBe(0);
	});

	it("email and inApp requested, inApp disabled → only email accepted", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("ch.emailonly", {
			schema: { parse: (x: any) => x },
			templates: {
				"ch-eo-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
					inApp: () => ({ title: "t" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email", "inApp"], template: "ch-eo-tpl" },
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

		await herald.send("ch.emailonly", {});

		expect(mail.send).toHaveBeenCalledOnce();
		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.channel).toBe("email");
		expect(db._notifications.size).toBe(0);
	});
});

// ─── channel resolution — onSkipped for unavailable channels ─

describe("channel resolution — unavailable channels", () => {
	it("onSkipped is called when requested channels are not configured", async () => {
		const db = createMockDb();
		const onSkipped = vi.fn();

		const ev = defineEvent("ch.alloff", {
			schema: { parse: (x: any) => x },
			templates: {
				"alloff-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
					inApp: () => ({ title: "t" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email", "inApp"], template: "alloff-tpl" },
			],
		});

		const herald = createHerald({
			db,
			channels: { inApp: false },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onSkipped },
			events: { ev },
		});

		await herald.send("ch.alloff", {});

		expect(db._deliveries.size).toBe(0);
		expect(onSkipped).toHaveBeenCalledTimes(2);
	});
});
