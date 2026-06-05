import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { createHerald } from "../../../core/herald.js";
import { defineEvent } from "../../../core/define.js";
import { createMockDb } from "../../support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../../support/adapters/mock-mail-adapter.js";

type BossWorkHandler = (
	jobs: Array<{
		data: { deliveryId: string; payload?: Record<string, unknown> };
	}>,
) => Promise<void>;

const pgBossMock = vi.hoisted(() => ({
	instances: [] as Array<{
		send: ReturnType<typeof vi.fn>;
		start: ReturnType<typeof vi.fn>;
		work: ReturnType<typeof vi.fn>;
		stop: ReturnType<typeof vi.fn>;
		handler?: BossWorkHandler;
	}>,
}));

vi.mock("pg-boss", () => ({
	PgBoss: class MockPgBoss {
		send = vi.fn().mockResolvedValue("job_1");
		start = vi.fn().mockResolvedValue(undefined);
		stop = vi.fn().mockResolvedValue(undefined);
		work = vi.fn(async (_queue, _options, handler: BossWorkHandler) => {
			this.handler = handler;
		});
		handler?: BossWorkHandler;

		constructor(_connectionString: string) {
			pgBossMock.instances.push(this);
		}
	},
}));

describe("db queue retry semantics", () => {
	beforeEach(() => {
		pgBossMock.instances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reprocesses a delivery on pg-boss retry after the first processor failure", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();
		mail.send
			.mockRejectedValueOnce(new Error("temporary provider outage"))
			.mockResolvedValueOnce({ id: "msg_retry_success" });

		const event = defineEvent("order.db-retry", {
			schema: z.object({ orderId: z.string(), userId: z.string() }),
			templates: {
				"order-email": {
					email: (p) => ({
						subject: `Order ${p.orderId}`,
						html: `<p>${p.orderId}</p>`,
					}),
				},
			},
			dispatch: (p) => [
				{
					to: p.userId,
					channels: ["email"],
					template: "order-email",
					addressHash: `hash:${p.userId}`,
				},
			],
		});

		const herald = createHerald({
			db,
			channels: { email: { adapter: mail, defaultFrom: "noreply@test.com" } },
			queue: {
				driver: "db",
				connectionString: "postgres://localhost/test",
				retries: 1,
				backoffDelay: 1,
			},
			compliance: { retention: { autoPurge: false } },
			events: { event },
		});

		const result = await herald.send("order.db-retry", {
			orderId: "ord-1",
			userId: "user-1",
		});
		const delivery = result.deliveries[0]!;
		const boss = pgBossMock.instances[0]!;
		expect(boss.handler).toBeDefined();

		await expect(
			boss.handler!([
				{
					data: {
						deliveryId: delivery.id,
						payload: { orderId: "ord-1", userId: "user-1" },
					},
				},
			]),
		).rejects.toThrow("temporary provider outage");
		expect((await db.getDelivery(delivery.id))?.status).toBe("failed");

		await boss.handler!([
			{
				data: {
					deliveryId: delivery.id,
					payload: { orderId: "ord-1", userId: "user-1" },
				},
			},
		]);

		const afterRetry = await db.getDelivery(delivery.id);
		expect(afterRetry?.status).toBe("accepted");
		expect(afterRetry?.attempts).toBe(2);
		expect(mail.send).toHaveBeenCalledTimes(2);
	});

	it("reprocesses dispatched deliveries when side effects were not recorded", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const event = defineEvent("order.dispatched-recover", {
			schema: z.object({ orderId: z.string(), userId: z.string() }),
			templates: {
				"order-email": {
					email: (p) => ({
						subject: `Order ${p.orderId}`,
						html: `<p>${p.orderId}</p>`,
					}),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "order-email" },
			],
		});

		const herald = createHerald({
			db,
			channels: { email: { adapter: mail, defaultFrom: "noreply@test.com" } },
			queue: { driver: "db", connectionString: "postgres://localhost/test" },
			compliance: { retention: { autoPurge: false } },
			events: { event },
		});

		await herald.start();
		const boss = pgBossMock.instances[0]!;
		const delivery = await db.createDelivery({
			userId: "user-1",
			eventType: "order.dispatched-recover",
			templateName: "order-email",
			channel: "email",
			status: "dispatched",
			attempts: 1,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: null,
			acceptedAt: null,
			failedAt: null,
			sideEffectsCompletedAt: null,
		});

		await boss.handler!([
			{
				data: {
					deliveryId: delivery.id,
					payload: { orderId: "ord-1", userId: "user-1" },
				},
			},
		]);

		expect(mail.send).toHaveBeenCalledOnce();
		expect(await db.getDelivery(delivery.id)).toMatchObject({ status: "accepted" });
	});

	it("tracks scheduled resolvePayload failures and leaves exhausted db retries terminal", async () => {
		const db = createMockDb();
		const resolvePayload = vi
			.fn()
			.mockRejectedValueOnce(new Error("temporary payload outage"))
			.mockRejectedValueOnce(new Error("still unavailable"));
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const event = defineEvent("order.db-scheduled-retry", {
			schema: z.object({ orderId: z.string() }),
			templates: {
				"order-inapp": {
					inApp: (p) => ({ title: `Order ${p.orderId}` }),
				},
			},
			dispatch: () => [
				{ to: "user-1", channels: ["inApp"], template: "order-inapp" },
			],
			resolvePayload,
		});

		const herald = createHerald({
			db,
			channels: { inApp: true },
			queue: {
				driver: "db",
				connectionString: "postgres://localhost/test",
				retries: 1,
			},
			compliance: { retention: { autoPurge: false } },
			events: { event },
		});

		const result = await herald.send(
			"order.db-scheduled-retry",
			{ orderId: "ord-1" },
			{ scheduledAt: new Date(Date.now() - 1_000) },
		);
		const delivery = result.deliveries[0]!;
		const boss = pgBossMock.instances[0]!;

		await expect(
			boss.handler!([{ data: { deliveryId: delivery.id } }]),
		).rejects.toThrow("temporary payload outage");
		expect(await db.getDelivery(delivery.id)).toMatchObject({
			status: "failed",
			attempts: 1,
		});

		await expect(
			boss.handler!([{ data: { deliveryId: delivery.id } }]),
		).rejects.toThrow("still unavailable");
		expect(await db.getDelivery(delivery.id)).toMatchObject({
			status: "failed",
			attempts: 2,
		});

		await boss.handler!([{ data: { deliveryId: delivery.id } }]);
		expect(await db.getDelivery(delivery.id)).toMatchObject({
			status: "failed",
			attempts: 2,
		});
		expect(resolvePayload).toHaveBeenCalledTimes(2);
		expect(consoleError).toHaveBeenCalledTimes(2);
	});
});
