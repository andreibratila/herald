import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineEvent } from "../../../core/define.js";
import { createHerald } from "../../../core/herald.js";
import { createMockDb } from "../../support/adapters/mock-db-adapter.js";

// ─── processDelivery (in-app notifications) ─────────────────

describe("processDelivery — in-app notifications", () => {
	it("happy path inApp: notification created and status is 'accepted'", async () => {
		const db = createMockDb();

		const ev = defineEvent("inapp.event", {
			schema: { parse: (x: any) => x },
			templates: {
				"inapp-tpl": {
					inApp: () => ({ title: "Hello", body: "World" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["inApp"], template: "inapp-tpl" },
			],
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const result = await herald.send("inapp.event", {});

		expect(result.deliveries).toHaveLength(1);
		expect(db._notifications.size).toBe(1);
		const stored = db._deliveries.get(result.deliveries[0]!.id);
		expect(stored?.status).toBe("accepted");
	});

	it("derives in-app notification data from persisted payload paths", async () => {
		const db = createMockDb();

		const ev = defineEvent("inapp.persisted-data", {
			schema: z.object({
				order: z.object({ id: z.string(), total: z.number() }),
				email: z.string(),
			}),
			persistedFields: ["order.id", "order.total"],
			templates: {
				"inapp-tpl": {
					inApp: () => ({
						title: "Hello",
					}),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["inApp"], template: "inapp-tpl" },
			],
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("inapp.persisted-data", {
			order: { id: "ord_123", total: 49 },
			email: "user@example.com",
		});

		const notification = [...db._notifications.values()][0];
		expect(notification?.data).toEqual({
			order: { id: "ord_123", total: 49 },
		});
	});

	it("ignores template-produced data when persisting in-app notifications", async () => {
		const db = createMockDb();

		const ev = defineEvent("inapp.ignore-rendered-data", {
			schema: z.object({ orderId: z.string(), email: z.string() }),
			persistedFields: ["orderId"],
			templates: {
				"inapp-tpl": {
					inApp: ((payload: { email: string; orderId: string }) => ({
						title: "Hello",
						// Runtime should ignore template-owned structured data from JS/unsafe callers.
						data: {
							orderId: `${payload.email}:${payload.orderId}`,
						},
					})) as any,
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["inApp"], template: "inapp-tpl" },
			],
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("inapp.ignore-rendered-data", {
			orderId: "ord_123",
			email: "user@example.com",
		});

		const notification = [...db._notifications.values()][0];
		expect(notification?.data).toEqual({ orderId: "ord_123" });
	});
});
