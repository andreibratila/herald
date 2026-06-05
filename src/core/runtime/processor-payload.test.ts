import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/support/adapters/mock-mail-adapter.js";

// ─── Delayed queue payload resolution ───────────────────────

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
