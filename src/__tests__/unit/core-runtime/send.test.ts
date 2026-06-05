import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineEvent } from "../../../core/define.js";
import { makeHerald, makeOrderSetup } from "../../support/core/runtime.js";

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
