import { describe, it, expect, vi, type Mock } from "vitest";
import { z } from "zod";
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/support/adapters/mock-mail-adapter.js";
import type { Delivery } from "../../types/index.js";
import { type MailAdapter, type MockDb } from "../../__tests__/support/core/runtime.js";

// ─── Retry logic ─────────────────────────────────────────────

describe("retry logic — sync driver", () => {
	function makeRetrySetup(
		overrides: {
			retries?: number;
			mail?: MailAdapter;
			db?: MockDb;
			inApp?: boolean;
			onRetry?: Mock<(delivery: Delivery, attempt: number) => void>;
			onFailed?: Mock<(delivery: Delivery, error: Error) => void>;
			onDelivered?: Mock<(delivery: Delivery) => void>;
			eventName?: string;
		} = {},
	) {
		const eventName = overrides.eventName ?? "retry.order";
		const tplName = `${eventName}-tmpl`;
		const db = overrides.db ?? createMockDb();
		const mail = overrides.mail ?? createMockMailAdapter();
		const onRetry =
			overrides.onRetry ??
			vi.fn<(delivery: Delivery, attempt: number) => void>();
		const onFailed =
			overrides.onFailed ?? vi.fn<(delivery: Delivery, error: Error) => void>();
		const onDelivered =
			overrides.onDelivered ?? vi.fn<(delivery: Delivery) => void>();

		const ev = defineEvent(eventName, {
			schema: z.object({ orderId: z.string(), userId: z.string() }),
			persistedFields: ["orderId"],
			compliance: {
				purpose: `${eventName}.transactional`,
				legalBasis: "contract",
			},
			templates: {
				[tplName]: {
					email: (p: any) => ({
						subject: `Order #${p.orderId}`,
						html: `<p>${p.orderId}</p>`,
					}),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: tplName },
			],
		});

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: overrides.inApp ?? false,
			},
			queue: {
				driver: "sync",
				retries: overrides.retries ?? 0,
				backoffDelay: 1,
			},
			compliance: { retention: { autoPurge: false } },
			hooks: { onRetry, onFailed, onDelivered },
			events: { ev },
		});
		return {
			db,
			mail,
			herald,
			onRetry,
			onFailed,
			onDelivered,
			eventName,
			tplName,
		};
	}

	it("retries: 0 default — mail throws once → status 'failed', attempts 1, onRetry not called", async () => {
		const { herald, db, mail, onRetry, eventName } = makeRetrySetup({
			retries: 0,
			eventName: "retry.r0",
		});
		mail.send.mockRejectedValueOnce(new Error("SMTP timeout"));

		// errors go into result.errors[], send() no longer throws per-recipient errors
		const result = await herald.send(eventName, {
			orderId: "r1",
			userId: "user_1",
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]!.error.message).toBe("SMTP timeout");

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.status).toBe("failed");
		expect(delivery?.attempts).toBe(1);
		expect(onRetry).not.toHaveBeenCalled();
	});

	it("retries: 2 — mail throws twice then succeeds → status 'accepted', attempts 3, onRetry called twice", async () => {
		const { herald, db, mail, onRetry, onDelivered, eventName } =
			makeRetrySetup({ retries: 2, eventName: "retry.r2s" });
		mail.send
			.mockRejectedValueOnce(new Error("SMTP timeout"))
			.mockRejectedValueOnce(new Error("SMTP timeout"))
			.mockResolvedValueOnce({ id: "msg_ok" });

		await herald.send(eventName, { orderId: "r2", userId: "user_1" });

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.status).toBe("accepted");
		expect(delivery?.attempts).toBe(3);
		expect(onRetry).toHaveBeenCalledTimes(2);
		expect(onDelivered).toHaveBeenCalledOnce();
	});

	it("retries: 2 — mail always throws → status 'failed', attempts 3, onFailed called once", async () => {
		const { herald, db, mail, onRetry, onFailed, eventName } = makeRetrySetup({
			retries: 2,
			eventName: "retry.r2f",
		});
		mail.send.mockRejectedValue(new Error("SMTP dead"));

		// errors go into result.errors[], send() no longer throws per-recipient errors
		const result = await herald.send(eventName, {
			orderId: "r3",
			userId: "user_1",
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]!.error.message).toBe("SMTP dead");

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.status).toBe("failed");
		expect(delivery?.attempts).toBe(3);
		expect(onRetry).toHaveBeenCalledTimes(2);
		expect(onFailed).toHaveBeenCalledOnce();
	});

	it("onRetry receives correct attempt numbers (1, then 2) and not called on final failure", async () => {
		const db2 = createMockDb();
		const mail2 = createMockMailAdapter();
		mail2.send.mockRejectedValue(new Error("SMTP dead"));
		const onRetryFn = vi.fn<(delivery: Delivery, attempt: number) => void>();
		const ev2 = defineEvent("retry.correct-attempts", {
			schema: z.object({ orderId: z.string(), userId: z.string() }),
			templates: {
				rcatmpl: {
					email: (p: any) => ({ subject: `${p.orderId}`, html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "rcatmpl" },
			],
		});
		const h = createHerald({
			db: db2,
			channels: {
				email: { adapter: mail2, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync", retries: 2, backoffDelay: 1 },
			compliance: { retention: { autoPurge: false } },
			hooks: { onRetry: onRetryFn },
			events: { ev2 },
		});

		// errors go into result.errors[], send() no longer throws per-recipient errors
		const result = await h.send("retry.correct-attempts", {
			orderId: "r4",
			userId: "user_1",
		});
		expect(result.errors).toHaveLength(1);

		expect(onRetryFn).toHaveBeenCalledTimes(2);
		expect(onRetryFn).toHaveBeenNthCalledWith(1, expect.anything(), 1);
		expect(onRetryFn).toHaveBeenNthCalledWith(2, expect.anything(), 2);
	});

	it("email not re-accepted on retry — mail succeeds attempt 1, createNotification throws twice, mail called exactly once", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		mail.send.mockResolvedValue({ id: "sent_ok" });

		let createNotifCalls = 0;
		const origCreate = db.createNotification.bind(db);
		db.createNotification = async (data) => {
			createNotifCalls++;
			if (createNotifCalls <= 2) throw new Error("DB glitch");
			return origCreate(data);
		};

		const ev = defineEvent("retry.email-idem", {
			schema: { parse: (x: any) => x },
			templates: {
				"retry-both-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
					inApp: () => ({ title: "t" }),
				},
			},
			dispatch: () => [
				{
					to: "user_1",
					channels: ["email", "inApp"],
					template: "retry-both-tpl",
				},
			],
		});

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: true,
			},
			queue: { driver: "sync", retries: 3, backoffDelay: 1 },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("retry.email-idem", {});

		expect(mail.send).toHaveBeenCalledOnce();
	});

	it("in-app not duplicated on retry — createNotification succeeds once, updateDelivery('accepted') throws twice, exactly 1 notification stored", async () => {
		const db = createMockDb();

		let acceptedUpdateCalls = 0;
		const origUpdate = db.updateDelivery.bind(db);
		db.updateDelivery = async (id, patch) => {
			if (patch.status === "accepted") {
				acceptedUpdateCalls++;
				if (acceptedUpdateCalls <= 2) throw new Error("DB glitch on accepted");
			}
			return origUpdate(id, patch);
		};

		const ev = defineEvent("retry.inapp-idem", {
			schema: { parse: (x: any) => x },
			templates: {
				"retry-inapp-tpl": {
					inApp: () => ({ title: "Hello retry" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["inApp"], template: "retry-inapp-tpl" },
			],
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			queue: { driver: "sync", retries: 3, backoffDelay: 1 },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("retry.inapp-idem", {});

		const notifications = [...db._notifications.values()].filter(
			(n) => n.userId === "user_1",
		);
		expect(notifications).toHaveLength(1);
	});

	it("sentinel '__no_provider_id__' for null-id mail provider — mail returns {}, retry triggered, externalId stored as '__no_provider_id__', mail called once", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		// First attempt: mail returns {} (no id) — then something throws after
		mail.send.mockResolvedValueOnce({});

		let updateAcceptedCalls = 0;
		const origUpdate = db.updateDelivery.bind(db);
		db.updateDelivery = async (id, patch) => {
			if (patch.status === "accepted") {
				updateAcceptedCalls++;
				if (updateAcceptedCalls <= 1) throw new Error("DB glitch after send");
			}
			return origUpdate(id, patch);
		};

		const ev = defineEvent("retry.sentinel", {
			schema: { parse: (x: any) => x },
			templates: {
				"retry-sentinel-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email"], template: "retry-sentinel-tpl" },
			],
		});

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync", retries: 2, backoffDelay: 1 },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("retry.sentinel", {});

		expect(mail.send).toHaveBeenCalledOnce();
		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.externalId).toBe("__no_provider_id__");
	});

	it("non-retryable early exit — getUserEmail returns null with retries: 3 → status 'failed', attempts 1, onRetry never called", async () => {
		const db = createMockDb({ getUserEmail: async () => null });
		const mail = createMockMailAdapter();
		const onRetry = vi.fn();

		const ev = defineEvent("retry.noemail", {
			schema: { parse: (x: any) => x },
			templates: {
				"retry-noemail-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email"], template: "retry-noemail-tpl" },
			],
		});

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync", retries: 3, backoffDelay: 1 },
			compliance: { retention: { autoPurge: false } },
			hooks: { onRetry },
			events: { ev },
		});

		await herald.send("retry.noemail", {});

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.status).toBe("failed");
		expect(onRetry).not.toHaveBeenCalled();
	});

	it("createNotification receives deliveryId — stored notification has deliveryId === delivery.id", async () => {
		const ev = defineEvent("retry.deliveryid", {
			schema: { parse: (x: any) => x },
			templates: {
				"retry-did-tpl": {
					inApp: () => ({ title: "Hello deliveryId" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["inApp"], template: "retry-did-tpl" },
			],
		});

		const db = createMockDb();
		const herald = createHerald({
			db,
			channels: { inApp: true },
			queue: { driver: "sync", retries: 0, backoffDelay: 1 },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const { deliveries } = await herald.send("retry.deliveryid", {});
		const notification = [...db._notifications.values()][0];
		expect(notification?.deliveryId).toBe(deliveries[0]!.id);
	});
});
