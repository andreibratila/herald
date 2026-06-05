import { describe, it, expect, vi } from "vitest";
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/support/adapters/mock-mail-adapter.js";
import { makeOrderSetup } from "../../__tests__/support/core/runtime.js";

// ─── PII-never-persists invariant ────────────────────────────

describe("PII-never-persists invariant", () => {
	it("delivery record does not contain PII fields outside persistedFields", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("order.pii", {
			schema: { parse: (x: any) => x },
			persistedFields: ["orderId", "amount"],
			templates: {
				"pii-tpl": {
					email: (p: any) => ({
						subject: `Order #${p.orderId}`,
						html: `<p>${p.orderId}</p>`,
					}),
				},
			},
			dispatch: (p: any) => [
				{ to: p.userId, channels: ["email"], template: "pii-tpl" },
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

		const payload = {
			orderId: "ord_123",
			amount: 99.9,
			userId: "user_1",
			creditCard: "4242424242424242",
		};

		await herald.send("order.pii", payload);

		const stored = JSON.stringify([...db._deliveries.values()]);
		expect(stored).not.toContain("4242424242424242");
		expect(stored).not.toContain("creditCard");
	});

	it("mail adapter receives full payload including PII fields", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("order.pii2", {
			schema: { parse: (x: any) => x },
			persistedFields: ["orderId"],
			templates: {
				"pii2-tpl": {
					email: (p: any) => ({
						subject: `Order #${p.orderId}`,
						html: `<p>CC: ${p.creditCard}</p>`,
					}),
				},
			},
			dispatch: (p: any) => [
				{ to: p.userId, channels: ["email"], template: "pii2-tpl" },
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

		const payload = {
			orderId: "ord_456",
			userId: "user_2",
			creditCard: "4111111111111111",
		};

		await herald.send("order.pii2", payload);

		expect(mail.send).toHaveBeenCalledWith(
			expect.objectContaining({
				html: expect.stringContaining("4111111111111111"),
			}),
		);
	});
});

// ─── Idempotency key scoping ──────────────────────────────────

describe("idempotency key scoping", () => {
	it("stored keys are scoped to key:userId:template for each recipient", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("idem.fan", {
			schema: { parse: (x: any) => x },
			templates: {
				"tpl-1": { email: () => ({ subject: "s", html: "<p/>" }) },
				"tpl-2": { email: () => ({ subject: "s", html: "<p/>" }) },
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email"], template: "tpl-1" },
				{ to: "user_2", channels: ["email"], template: "tpl-2" },
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

		await herald.send("idem.fan", {}, { idempotencyKey: "evt" });

		const keys = [...db._deliveries.values()].map((d) => d.idempotencyKey);
		// key includes channel → evt:userId:channel:template
		expect(keys).toContain("evt:user_1:email:tpl-1");
		expect(keys).toContain("evt:user_2:email:tpl-2");
	});

	it("second send with same key returns existing delivery without creating new one", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const { ev, eventName } = makeOrderSetup({ eventName: "idem.second" });

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

		const payload = { orderId: "ord_1", userId: "user_1" };
		const first = await herald.send(eventName, payload, {
			idempotencyKey: "k1",
		});
		const second = await herald.send(eventName, payload, {
			idempotencyKey: "k1",
		});

		expect(db._deliveries.size).toBe(1);
		expect(second.deliveries[0]!.id).toBe(first.deliveries[0]!.id);
	});

	it("uses the adapter atomic idempotent create path for idempotency keys", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const { ev, eventName } = makeOrderSetup({ eventName: "idem.atomic" });
		const createDeliveryIdempotent = vi.spyOn(db, "createDeliveryIdempotent");
		const getDeliveryByIdempotencyKey = vi.spyOn(
			db,
			"getDeliveryByIdempotencyKey",
		);

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

		await herald.send(
			eventName,
			{ orderId: "ord_1", userId: "user_1" },
			{ idempotencyKey: "k-atomic" },
		);

		expect(createDeliveryIdempotent).toHaveBeenCalledOnce();
		expect(getDeliveryByIdempotencyKey).not.toHaveBeenCalled();
	});

	it("retries serialization failures during idempotent create and returns existing delivery", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const { ev, eventName } = makeOrderSetup({ eventName: "idem.serialize" });
		const original = db.createDeliveryIdempotent.bind(db);
		const existing = await db.createDelivery({
			userId: "user_1",
			eventType: eventName,
			templateName: "order-user",
			channel: "email",
			status: "pending",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: "k-serialize:user_1:email:order-user",
			scheduledAt: null,
			acceptedAt: null,
			failedAt: null,
		});
		const serializationError = Object.assign(
			new Error("serialization failure"),
			{
				code: "40001",
			},
		);
		db.createDeliveryIdempotent = vi
			.fn()
			.mockRejectedValueOnce(serializationError)
			.mockImplementation(original);

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

		const result = await herald.send(
			eventName,
			{ orderId: "ord_1", userId: "user_1" },
			{ idempotencyKey: "k-serialize" },
		);

		expect(result.errors).toHaveLength(0);
		expect(result.deliveries[0]!.id).toBe(existing.id);
		expect(db._deliveries.size).toBe(1);
		expect(db.createDeliveryIdempotent).toHaveBeenCalledTimes(2);
	});

	it("same idempotency key with different user creates new delivery", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("idem.diff", {
			schema: { parse: (x: any) => x },
			templates: {
				"idem-tpl": { email: () => ({ subject: "s", html: "<p/>" }) },
			},
			dispatch: (p: any) => [
				{ to: p.userId, channels: ["email"], template: "idem-tpl" },
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

		await herald.send(
			"idem.diff",
			{ userId: "user_1" },
			{ idempotencyKey: "evt" },
		);
		await herald.send(
			"idem.diff",
			{ userId: "user_2" },
			{ idempotencyKey: "evt" },
		);

		expect(db._deliveries.size).toBe(2);
	});
});
