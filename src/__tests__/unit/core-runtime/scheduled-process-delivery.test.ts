import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { defineEvent } from "../../../core/define.js";
import { createHerald } from "../../../core/herald.js";
import { createMockDb } from "../../support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../../support/adapters/mock-mail-adapter.js";

// ─── processDelivery — scheduled job payload resolution ───────

describe("processDelivery — db-driver scheduled job (payload undefined)", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("3.10 calls event.resolvePayload(delivery) when job.payload is undefined and uses result for rendering", async () => {
		const db = createMockDb();
		const mail = createMockMailAdapter();

		const resolvePayload = vi
			.fn()
			.mockResolvedValue({ userId: "u1", orderId: "ord_resolved" });

		const ev = defineEvent("sched.process", {
			schema: z.object({ userId: z.string(), orderId: z.string().optional() }),
			templates: {
				"sched-proc-tpl": {
					email: (p: any) => ({
						subject: `Order ${p.orderId}`,
						html: `<p>${p.orderId}</p>`,
					}),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "sched-proc-tpl" },
			],
			resolvePayload,
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

		const delivery = await db.createDelivery({
			userId: "u1",
			eventType: "sched.process",
			templateName: "sched-proc-tpl",
			channel: "email",
			status: "scheduled",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: null,
			scheduledAt: new Date("2025-01-01"),
			acceptedAt: null,
			failedAt: null,
		});

		const stop = await herald.startScheduledWorker(50);
		await vi.advanceTimersByTimeAsync(50);
		stop();

		expect(resolvePayload).toHaveBeenCalledWith(
			expect.objectContaining({ id: delivery.id }),
		);
		expect(mail.send).toHaveBeenCalledWith(
			expect.objectContaining({ subject: "Order ord_resolved" }),
		);
	});
});
