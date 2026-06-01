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
import type { Delivery, HeraldDatabaseAdapter } from "../../types/index.js";
import {
	makeHerald,
	makeOrderSetup,
	type MailAdapter,
	type MockDb,
} from "./test-utils.js";

// ─── processDelivery (sync queue) ────────────────────────────

describe("processDelivery — sync queue", () => {
	it("happy path email: delivery status is 'accepted' and mail.send called once", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "proc.happy" });
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

		expect(result.deliveries).toHaveLength(1);
		const stored = db._deliveries.get(result.deliveries[0]!.id);
		expect(stored?.status).toBe("accepted");
		expect(mail.send).toHaveBeenCalledOnce();
	});

	it("uses event-scoped renderers when different events share a template name", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const evA = defineEvent("template.scope.a", {
			schema: z.object({ userId: z.string() }),
			templates: {
				shared: { email: () => ({ subject: "A", html: "<p>A</p>" }) },
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "shared" },
			],
		});
		const evB = defineEvent("template.scope.b", {
			schema: z.object({ userId: z.string() }),
			templates: {
				shared: { email: () => ({ subject: "B", html: "<p>B</p>" }) },
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "shared" },
			],
		});

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { evA, evB },
		});

		await herald.send("template.scope.a", { userId: "user_1" });
		await herald.send("template.scope.b", { userId: "user_1" });

		expect(mail.send.mock.calls.map(([input]) => input.subject)).toEqual([
			"A",
			"B",
		]);
	});

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

	it("filters in-app notification data through safeFields before persisting", async () => {
		const db = createMockDb();

		const ev = defineEvent("inapp.safe-data", {
			schema: { parse: (x: any) => x },
			safeFields: ["orderId"],
			templates: {
				"inapp-tpl": {
					inApp: (payload) => ({
						title: "Hello",
						data: {
							orderId: payload.orderId,
							email: payload.email,
						},
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

		await herald.send("inapp.safe-data", {
			orderId: "ord_123",
			email: "user@example.com",
		});

		const notification = [...db._notifications.values()][0];
		expect(notification?.data).toEqual({ orderId: "ord_123" });
	});

	it("audit log contains 'notification.accepted' after successful delivery", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "proc.audit" });
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

		await herald.send(eventName, { orderId: "o2", userId: "user_1" });

		const sentLog = db._auditLogs.find(
			(l) => l.action === "notification.accepted",
		);
		expect(sentLog).toBeDefined();
	});

	it("mail send failure causes delivery status 'failed' and lastError set", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "proc.fail" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
		mail.send.mockRejectedValueOnce(new Error("SMTP timeout"));

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

		// errors go into result.errors[] — send() no longer throws per-recipient errors
		const result = await herald.send(eventName, {
			orderId: "o3",
			userId: "user_1",
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]!.error.message).toBe("SMTP timeout");

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.status).toBe("failed");
		expect(delivery?.lastError).toBe("SMTP timeout");
	});

	it("audit log contains 'notification.failed' after mail error", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "proc.faillog" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
		mail.send.mockRejectedValueOnce(new Error("SMTP timeout"));

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

		// errors go into result.errors[], no throw from send()
		const result = await herald.send(eventName, {
			orderId: "o4",
			userId: "user_1",
		});
		expect(result.errors).toHaveLength(1);

		const failLog = db._auditLogs.find(
			(l) => l.action === "notification.failed",
		);
		expect(failLog).toBeDefined();
	});

	it("mail.send returning { error } causes delivery status 'failed'", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "proc.mailerr" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
		mail.send.mockResolvedValueOnce({ error: "provider error" });

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

		// errors go into result.errors[], no throw from send()
		const result = await herald.send(eventName, {
			orderId: "o5",
			userId: "user_1",
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]!.error.message).toBe("provider error");

		const delivery = [...db._deliveries.values()][0];
		expect(delivery?.status).toBe("failed");
		expect(delivery?.lastError).toBe("provider error");
	});
});

// ─── getUserEmail returns null → delivery fails ───────────────

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
			safeFields: ["orderId"],
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

describe("processDelivery — delayed queue payload resolution", () => {
	it("schema-validates resolvePayload output before rendering", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		let processor: ((job: { deliveryId: string }) => Promise<void>) | undefined;

		const ev = defineEvent("processor.invalid-resolved-payload", {
			schema: z.object({ userId: z.string(), amount: z.number() }),
			templates: {
				"invalid-resolved-payload-tpl": {
					email: (p: any) => ({ subject: `${p.amount}`, html: "<p/>" }),
				},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "invalid-resolved-payload-tpl",
				},
			],
			resolvePayload: async () => ({ userId: "user_1", amount: "bad" }),
		});

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
			},
			queue: {
				driver: "adapter",
				adapter: {
					capabilities: {
						durable: true,
						delayedJobs: true,
						cancellation: false,
						nativeRetries: false,
					},
					async start(proc) {
						processor = proc;
					},
					async enqueue(job) {
						await processor?.({ deliveryId: job.deliveryId });
						return "job_1";
					},
				},
			},
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		const result = await herald.send(
			"processor.invalid-resolved-payload",
			{ userId: "user_1", amount: 1 },
			{ scheduledAt: new Date(Date.now() + 60_000) },
		);

		expect(mail.send).not.toHaveBeenCalled();
		expect(result.errors).toHaveLength(1);
		expect(db._deliveries.get(result.deliveries[0]!.id)).toMatchObject({
			status: "failed",
		});
	});
});

// ─── mail adapter called with correct fields ──────────────────

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

describe("processDelivery with unknown deliveryId creates audit log", () => {
	it("10.5 processDelivery with unknown deliveryId creates notification.delivery_not_found audit log", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const ev = defineEvent("notfound.event", {
			schema: { parse: (x: any) => x },
			templates: {
				"notfound-tpl": {
					email: () => ({ subject: "s", html: "<p/>" }),
				},
			},
			dispatch: () => [
				{ to: "user_1", channels: ["email"], template: "notfound-tpl" },
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

		// Intercept the queue to inject a job with a nonexistent deliveryId
		// We do this by sending normally but then deleting the delivery from DB before the job processes
		// Actually the sync queue processes inline, so we need a different approach:
		// Override createDelivery to record the id and delete it after creation but before queue fires

		const origCreate = db.createDelivery.bind(db);
		db.createDelivery = async (data) => {
			const delivery = await origCreate(data);
			// Delete it so getDelivery returns null when processDelivery runs
			db._deliveries.delete(delivery.id);
			return delivery;
		};

		await herald.send("notfound.event", {});

		const notFoundLog = db._auditLogs.find(
			(l) => l.action === "notification.delivery_not_found",
		);
		expect(notFoundLog).toBeDefined();
		expect(notFoundLog?.metadata?.deliveryId).toBeDefined();
	});
});
