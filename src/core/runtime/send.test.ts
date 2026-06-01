import {
	describe,
	it,
	expect,
	vi,
	beforeEach,
	afterEach,
	type Mock,
} from "vitest";
import { z } from "zod";
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/helpers/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/helpers/mock-mail-adapter.js";
import type {
	Delivery,
	HeraldDatabaseAdapter,
} from "../../types/index.js";
import { makeHerald, makeOrderSetup } from "./test-utils.js";

// ─── send() — unknown event throws ────────────────────────────

describe("send() — unknown event throws", () => {
	it("throws with event name in message when event is not registered", async () => {
		// A herald with an unrelated event — "ghost.event" is not in the registry
		const ev = defineEvent("dummy.for.ghost", {
			schema: { parse: (x: any) => x },
			templates: {},
			dispatch: () => [],
		});
		const { herald } = makeHerald({ events: { ev } });
		await expect(herald.send("ghost.event", {})).rejects.toThrow("ghost.event");
	});
});


// ─── send() — payload validation ──────────────────────────────

describe("send() — payload validation", () => {
	it("propagates ZodError when payload fails schema validation", async () => {
		const ev = defineEvent("zod.test", {
			schema: z.object({ orderId: z.string(), userId: z.string() }),
			templates: {
				"order-user": {
					email: (p: any) => ({
						subject: `Order #${p.orderId}`,
						html: `<p>${p.orderId}</p>`,
					}),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "order-user" },
			],
		});
		const { herald } = makeHerald({ events: { ev } });
		await expect(
			herald.send("zod.test", { orderId: 123 as any, userId: "u1" }),
		).rejects.toThrow();
	});

	it("succeeds with valid payload matching schema", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "zod.valid" });
		const { herald } = makeHerald({ events: { ev } });
		await expect(
			herald.send(eventName, { orderId: "ord_1", userId: "user_1" }),
		).resolves.not.toThrow();
	});
});


// ─── PII-never-persists invariant ────────────────────────────

describe("PII-never-persists invariant", () => {
	it("delivery record does not contain PII fields outside safeFields", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("order.pii", {
			schema: { parse: (x: any) => x },
			safeFields: ["orderId", "amount"],
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
			safeFields: ["orderId"],
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


// ─── send() return type: { deliveries, errors, skipped } ──

describe("send() — returns { deliveries, errors, skipped }", () => {
	it("8.1 send() returns object with deliveries array (not a plain array)", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "ph8.return-shape" });
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

		const result = await herald.send(eventName, {
			orderId: "o1",
			userId: "user_1",
		});
		expect(result).toHaveProperty("deliveries");
		expect(result).toHaveProperty("errors");
		expect(result).toHaveProperty("skipped");
		expect(result.deliveries).toHaveLength(1);
		expect(result.errors).toHaveLength(0);
		expect(result.skipped).toHaveLength(0);
	});

	it("8.2 one recipient's createDelivery throws → errors has 1 entry, deliveries has rest", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		let createDeliveryCallCount = 0;
		const origCreate = db.createDelivery.bind(db);
		db.createDelivery = async (data) => {
			createDeliveryCallCount++;
			if (createDeliveryCallCount === 1)
				throw new Error("DB failure for recipient 1");
			return origCreate(data);
		};

		const ev = defineEvent("ph8.partial-failure", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"ph8-pf-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email"], template: "ph8-pf-tpl" },
				{ to: "user_2", channels: ["email"], template: "ph8-pf-tpl" },
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

		const result = await herald.send("ph8.partial-failure", {
			userId: "user_1",
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]!.error.message).toBe("DB failure for recipient 1");
		expect(result.errors[0]!.recipient.to).toBe("user_1");
		expect(result.deliveries).toHaveLength(1);
		expect(result.deliveries[0]!.userId).toBe("user_2");
	});

	it("8.3 skipped recipient (no consent) appears in skipped[] with reason", async () => {
		const { ev } = makeOrderSetup({
			eventName: "ph8.skipped-consent",
			legalBasis: "consent",
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();

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

		const result = await herald.send("ph8.skipped-consent", {
			orderId: "o1",
			userId: "user_1",
		});
		expect(result.skipped).toHaveLength(1);
		expect(result.skipped[0]!.reason).toContain("missing_consent");
		expect(result.deliveries).toHaveLength(0);
	});

	it("8.4 idempotency key includes channel — same key + different channel creates new delivery", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("ph8.idem-channel", {
			schema: z.object({ userId: z.string() }),
			templates: {
				"ph8-ic-email": { email: () => ({ subject: "s", html: "<p/>" }) },
				"ph8-ic-inapp": { inApp: () => ({ title: "t" }) },
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email"], template: "ph8-ic-email" },
				{ to: "user_1", channels: ["inApp"], template: "ph8-ic-inapp" },
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

		// First send — creates 2 deliveries (one email, one inApp)
		const first = await herald.send(
			"ph8.idem-channel",
			{ userId: "user_1" },
			{ idempotencyKey: "ch-test" },
		);
		expect(first.deliveries).toHaveLength(2);
		expect(db._deliveries.size).toBe(2);

		// Second send — same key, same channels → both idempotency-hit, no new deliveries
		const second = await herald.send(
			"ph8.idem-channel",
			{ userId: "user_1" },
			{ idempotencyKey: "ch-test" },
		);
		expect(db._deliveries.size).toBe(2);
		expect(second.deliveries).toHaveLength(2);
	});

	it("8.5 same key + 'failed' status = new delivery created (not short-circuited)", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "ph8.idem-failed" });
		const db = createMockDb();
		const mail = createMockMailAdapter();

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

		// First send — succeeds, creates delivery with status "accepted"
		const first = await herald.send(
			eventName,
			{ orderId: "o1", userId: "user_1" },
			{ idempotencyKey: "idem-fail-k" },
		);
		expect(first.deliveries).toHaveLength(1);

		// Manually set delivery status to "failed"
		await db.updateDelivery(first.deliveries[0]!.id, { status: "failed" });

		// Second send — same key, but delivery is "failed" → new delivery created
		const second = await herald.send(
			eventName,
			{ orderId: "o1", userId: "user_1" },
			{ idempotencyKey: "idem-fail-k" },
		);
		expect(second.deliveries).toHaveLength(1);
		expect(db._deliveries.size).toBe(2); // new delivery created

		// Third send — the newer reusable delivery is returned, not the older failed row.
		const third = await herald.send(
			eventName,
			{ orderId: "o1", userId: "user_1" },
			{ idempotencyKey: "idem-fail-k" },
		);
		expect(third.deliveries[0]!.id).toBe(second.deliveries[0]!.id);
		expect(db._deliveries.size).toBe(2);
	});

	it("8.6 same key + 'accepted' status = existing delivery returned in deliveries[]", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "ph8.idem-accepted" });
		const db = createMockDb();
		const mail = createMockMailAdapter();

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

		const first = await herald.send(
			eventName,
			{ orderId: "o1", userId: "user_1" },
			{ idempotencyKey: "idem-accepted-k" },
		);
		expect(first.deliveries).toHaveLength(1);
		// Check actual DB status — delivery was processed synchronously by sync driver
		const firstStored = await db.getDelivery(first.deliveries[0]!.id);
		expect(firstStored?.status).toBe("accepted");

		const second = await herald.send(
			eventName,
			{ orderId: "o1", userId: "user_1" },
			{ idempotencyKey: "idem-accepted-k" },
		);
		expect(db._deliveries.size).toBe(1); // no new delivery
		expect(second.deliveries[0]!.id).toBe(first.deliveries[0]!.id);
	});
});

