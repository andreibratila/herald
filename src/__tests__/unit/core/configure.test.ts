import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createMockDb } from "../../support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../../support/adapters/mock-mail-adapter.js";
import { configureHerald, getEventAppId } from "../../../core/configure.js";

describe("configureHerald", () => {
	it("is pure and does not invoke lazy adapter factories until create()", () => {
		const mail = createMockMailAdapter();
		const adapterFactory = vi.fn(() => mail);

		const heraldApp = configureHerald({
			channels: {
				email: {
					adapter: adapterFactory,
					defaultFrom: "hello@example.com",
				},
				inApp: true,
			},
		});

		expect(adapterFactory).not.toHaveBeenCalled();

		const orderCompleted = heraldApp.defineEvent("order.completed", {
			schema: z.object({ userId: z.string() }),
			compliance: {
				purpose: "transactional.order_update",
				legalBasis: "contract",
			},
			templates: {
				customer: {
					email: () => ({ subject: "Order", html: "<p>Order</p>" }),
					inApp: () => ({ title: "Order" }),
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

		expect(getEventAppId(orderCompleted)).toBeTypeOf("symbol");
		expect(adapterFactory).not.toHaveBeenCalled();

		heraldApp.create({
			db: createMockDb(),
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { orderCompleted },
		});

		expect(adapterFactory).toHaveBeenCalledOnce();
	});

	it("rejects unsupported custom channel ids until custom delivery is implemented", () => {
		expect(() => {
			configureHerald({
				channels: { sms: true } as never,
			});
		}).toThrow(/Unsupported channel key: "sms"/);
	});

	it("rejects event refs defined by another app at create time", () => {
		const appA = configureHerald({ channels: { inApp: true } });
		const appB = configureHerald({ channels: { inApp: true } });
		const eventFromA = appA.defineEvent("wrong.app", {
			schema: z.object({ userId: z.string() }),
			compliance: { purpose: "transactional.test", legalBasis: "contract" },
			templates: {
				item: { inApp: () => ({ title: "Hello" }) },
			},
			dispatch: (payload) => [
				{ to: payload.userId, channels: ["inApp"], template: "item" },
			],
		});

		expect(() => {
			appB.create({
				db: createMockDb(),
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { eventFromA },
			});
		}).toThrow(/different Herald app/);
	});

	it("creates generated event methods from user map keys and dispatches by stable event name", async () => {
		const mail = createMockMailAdapter();
		const db = createMockDb();
		const app = configureHerald({
			channels: {
				email: {
					adapter: mail,
					defaultFrom: "hello@example.com",
				},
			},
		});
		const orderCompleted = app.defineEvent("order.completed.internal", {
			schema: z.object({ userId: z.string(), orderId: z.string() }),
			persistedFields: ["orderId"],
			compliance: { purpose: "transactional.order", legalBasis: "contract" },
			templates: {
				customer: {
					email: (payload) => ({
						subject: `Order ${payload.orderId}`,
						html: "<p>Order</p>",
					}),
				},
			},
			dispatch: (payload) => [
				{ to: payload.userId, channels: ["email"], template: "customer" },
			],
		});

		const herald = app.create({
			db,
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { sendWelcome: orderCompleted },
		});

		expect(herald.events).toHaveProperty("sendWelcome");
		expect(herald.events).not.toHaveProperty("order.completed.internal");

		await herald.events.sendWelcome({ userId: "u1", orderId: "o1" });

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.eventType).toBe("order.completed.internal");
		expect(mail.send).toHaveBeenCalledOnce();
	});

	it("does not expose public string-send on configured runtimes", () => {
		const app = configureHerald({ channels: { inApp: true } });
		const event = app.defineEvent("hidden.send", {
			schema: z.object({ userId: z.string() }),
			compliance: { purpose: "transactional.test", legalBasis: "contract" },
			templates: { item: { inApp: () => ({ title: "Hello" }) } },
			dispatch: (payload) => [
				{ to: payload.userId, channels: ["inApp"], template: "item" },
			],
		});

		const herald = app.create({
			db: createMockDb(),
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { event },
		});

		expect("send" in herald).toBe(false);
	});

	it("throws friendly errors for malformed configured dispatch recipients", async () => {
		const app = configureHerald({ channels: { inApp: true } });
		const event = app.defineEvent("legacy.recipient", {
			schema: z.object({ userId: z.string() }),
			compliance: { purpose: "transactional.test", legalBasis: "contract" },
			templates: { item: { inApp: () => ({ title: "Hello" }) } },
			dispatch: (payload) => [
				{ to: payload.userId, channel: "inApp", template: "item" } as never,
			],
		});
		const herald = app.create({
			db: createMockDb(),
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { event },
		});

		await expect(herald.events.event({ userId: "u1" })).rejects.toThrow(
			/no non-empty "channels" array/,
		);
	});

	it("throws early for configured events with missing renderers", async () => {
		const app = configureHerald({
			channels: {
				email: {
					adapter: createMockMailAdapter(),
					defaultFrom: "hello@example.com",
				},
			},
		});
		const event = app.defineEvent("missing.renderer", {
			schema: z.object({ userId: z.string() }),
			compliance: { purpose: "transactional.test", legalBasis: "contract" },
			templates: { item: {} },
			dispatch: (payload) => [
				{ to: payload.userId, channels: ["email"], template: "item" },
			],
		});
		const db = createMockDb();
		const herald = app.create({
			db,
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { event },
		});

		await expect(herald.events.event({ userId: "u1" })).rejects.toThrow(
			/no renderer for channel "email"/,
		);
		expect(db._deliveries.size).toBe(0);
	});

	it("keeps provider failures as persisted delivery failures", async () => {
		const mail = createMockMailAdapter();
		mail.send.mockRejectedValueOnce(new Error("SMTP down"));
		const app = configureHerald({
			channels: {
				email: {
					adapter: mail,
					defaultFrom: "hello@example.com",
				},
			},
		});
		const event = app.defineEvent("provider.failure", {
			schema: z.object({ userId: z.string() }),
			compliance: { purpose: "transactional.test", legalBasis: "contract" },
			templates: {
				item: { email: () => ({ subject: "Hello", html: "<p>Hello</p>" }) },
			},
			dispatch: (payload) => [
				{ to: payload.userId, channels: ["email"], template: "item" },
			],
		});
		const db = createMockDb();
		const herald = app.create({
			db,
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { event },
		});

		const result = await herald.events.event({ userId: "u1" });

		expect(result.errors[0]?.error.message).toBe("SMTP down");
		expect([...db._deliveries.values()][0]?.status).toBe("failed");
	});

	it("detects duplicate stable event names from different method keys", () => {
		const app = configureHerald({ channels: { inApp: true } });
		const first = app.defineEvent("dup.stable", {
			schema: z.object({ userId: z.string() }),
			compliance: { purpose: "transactional.test", legalBasis: "contract" },
			templates: { item: { inApp: () => ({ title: "First" }) } },
			dispatch: (payload) => [
				{ to: payload.userId, channels: ["inApp"], template: "item" },
			],
		});
		const second = app.defineEvent("dup.stable", {
			schema: z.object({ userId: z.string() }),
			compliance: { purpose: "transactional.test", legalBasis: "contract" },
			templates: { other: { inApp: () => ({ title: "Second" }) } },
			dispatch: (payload) => [
				{ to: payload.userId, channels: ["inApp"], template: "other" },
			],
		});

		expect(() => {
			app.create({
				db: createMockDb(),
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				events: { first, second },
			});
		}).toThrow(/Duplicate event name: "dup.stable"/);
	});
});
