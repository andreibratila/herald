import { describe, expect, it } from "vitest";
import { z } from "zod";
import { configureHerald } from "../index.js";
import { createMockDb } from "./support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "./support/adapters/mock-mail-adapter.js";

describe("README configured API fixture", () => {
	it("uses configured app channels, app-scoped defineEvent, and generated methods", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const heraldApp = configureHerald({
			channels: {
				email: {
					adapter: () => mail,
					defaultFrom: "hello@example.com",
				},
				inApp: true,
			},
		});
		const defineEvent = heraldApp.defineEvent;

		const orderCompleted = defineEvent("readme.order.completed", {
			schema: z.object({
				orderId: z.string(),
				amount: z.number(),
				userId: z.string(),
			}),
			persistedFields: ["orderId", "amount"],
			compliance: {
				purpose: "transactional.order_update",
				legalBasis: "contract",
			},
			templates: {
				customer: {
					email: (payload) => ({
						subject: `Order #${payload.orderId}`,
						html: `<p>${payload.amount}</p>`,
					}),
					inApp: (payload) => ({ title: `Order #${payload.orderId}` }),
				},
			},
			dispatch: (payload) => [
				{
					to: payload.userId,
					channels: ["email", "inApp"],
					template: "customer",
				},
			],
		});

		const herald = heraldApp.create({
			db,
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { orderCompleted },
		});

		await herald.events.orderCompleted({
			orderId: "ord_123",
			amount: 149.9,
			userId: "user_123",
		});

		expect([...db._deliveries.values()][0]?.eventType).toBe(
			"readme.order.completed",
		);
		expect(mail.send).toHaveBeenCalledOnce();
	});
});
