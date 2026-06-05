import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/helpers/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/helpers/mock-mail-adapter.js";
import { makeOrderSetup } from "./test-utils.js";

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
