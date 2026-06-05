import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/helpers/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/helpers/mock-mail-adapter.js";
import { makeOrderSetup } from "../../__tests__/support/core/runtime.js";

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
