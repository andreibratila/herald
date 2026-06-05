import { describe, it, expect, vi } from "vitest";
import { createHerald } from "./herald.js";
import { createMockDb } from "../__tests__/support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../__tests__/support/adapters/mock-mail-adapter.js";

import { makeOrderSetup } from "../__tests__/support/core/runtime.js";

// ─── Hooks ────────────────────────────────────────────────────

describe("hooks", () => {
	it("onDelivered is called after successful delivery", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "hook.delivered" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const onDelivered = vi.fn();

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onDelivered },
			events: { ev },
		});

		await herald.send(eventName, { orderId: "o1", userId: "user_1" });

		expect(onDelivered).toHaveBeenCalledOnce();
	});

	it("onFailed is called after mail error", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "hook.failed" });
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const onFailed = vi.fn();
		mail.send.mockRejectedValueOnce(new Error("SMTP down"));

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onFailed },
			events: { ev },
		});

		// errors go into result.errors[], send() no longer throws per-recipient errors
		const result = await herald.send(eventName, {
			orderId: "o2",
			userId: "user_1",
		});
		expect(result.errors).toHaveLength(1);

		expect(onFailed).toHaveBeenCalledOnce();
		expect(onFailed).toHaveBeenCalledWith(expect.anything(), expect.any(Error));
	});

	it("onSkipped is called when consent check fails", async () => {
		const { ev, eventName } = makeOrderSetup({
			eventName: "mkt.hook",
			legalBasis: "consent",
		});
		const db = createMockDb();
		const mail = createMockMailAdapter();
		const onSkipped = vi.fn();

		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			hooks: { onSkipped },
			events: { ev },
		});

		await herald.send(eventName, { orderId: "o3", userId: "user_1" });

		expect(onSkipped).toHaveBeenCalledOnce();
		expect(onSkipped).toHaveBeenCalledWith(
			"user_1",
			eventName,
			expect.any(String),
		);
	});
});

// ─── Auto-start ───────────────────────────────────────────────

describe("auto-start", () => {
	it("send() triggers start() implicitly and processes deliveries in-band", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "autostart.a" });
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
	});

	it("calling send() twice does not re-run start() (idempotent)", async () => {
		const { ev, eventName } = makeOrderSetup({ eventName: "autostart.b" });
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
		await herald.send(eventName, { orderId: "o2", userId: "user_1" });

		expect(db._deliveries.size).toBe(2);
		const statuses = [...db._deliveries.values()].map((d) => d.status);
		expect(statuses.every((s) => s === "accepted")).toBe(true);
	});
});
