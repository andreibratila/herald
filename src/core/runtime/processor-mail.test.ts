import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/support/adapters/mock-mail-adapter.js";
import { makeOrderSetup } from "../../__tests__/support/core/runtime.js";

// ─── Mail delivery behavior ─────────────────────────────────

describe("processDelivery — getUserEmail returns null", () => {
	it("delivery status is 'failed' when getUserEmail returns null", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "nullemail.test" });
		const db = createMockDb({ getUserEmail: async () => null });
		const mail = createMockMailAdapter();

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

		await herald.send(eventName, { orderId: "o1", userId: "user_1" });

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.status).toBe("failed");
		expect(delivery?.lastError).toContain("user_1");
	});
});

// ─── Retry logic ─────────────────────────────────────────────

describe("mail adapter — call shape", () => {
	it("mail.send is called with to set to the user's email address", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "mail.to" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
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

		await herald.send(eventName, { orderId: "o1", userId: "user_1" });

		expect(mail.send).toHaveBeenCalledWith(
			expect.objectContaining({ to: "user_1@test.com" }),
		);
	});

	it("mail.send uses defaultFrom when template does not override from", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "mail.from" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
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

		await herald.send(eventName, { orderId: "o1", userId: "user_1" });

		expect(mail.send).toHaveBeenCalledWith(
			expect.objectContaining({ from: "noreply@test.com" }),
		);
	});

	it("mail.send subject matches template rendering output", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("mail.subject", {
			schema: z.object({ orderId: z.string(), userId: z.string() }),
			templates: {
				"subject-tpl": {
					email: (p) => ({ subject: `Order #${p.orderId}`, html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "subject-tpl" },
			],
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

		await herald.send("mail.subject", { orderId: "ord_999", userId: "user_1" });

		expect(mail.send).toHaveBeenCalledWith(
			expect.objectContaining({ subject: "Order #ord_999" }),
		);
	});
});

describe("externalId sentinel is __no_provider_id__", () => {
	it("10.3 mail returns {} (no id) → delivery.externalId is '__no_provider_id__'", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "ext.no-id" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
		mail.send.mockResolvedValueOnce({}); // no id returned

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

		await herald.send(eventName, { orderId: "o1", userId: "user_1" });
		const delivery = [...db._deliveries.values()][0]!;
		expect(delivery.externalId).toBe("__no_provider_id__");
	});
});
