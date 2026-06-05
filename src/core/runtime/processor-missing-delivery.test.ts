import { describe, it, expect } from "vitest";
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/support/adapters/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/support/adapters/mock-mail-adapter.js";

// ─── Missing delivery handling ──────────────────────────────

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
