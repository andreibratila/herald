import { z } from "zod";
import { defineEvent } from "../define.js";
import { createHerald } from "../herald.js";
import { createMockDb } from "../../__tests__/helpers/mock-db-adapter.js";
import { createMockMailAdapter } from "../../__tests__/helpers/mock-mail-adapter.js";
import type { AnyEventRef } from "../../types/index.js";

export type MailAdapter = ReturnType<typeof createMockMailAdapter>;
export type MockDb = ReturnType<typeof createMockDb>;

export function makeHerald(
	overrides: {
		mail?: MailAdapter;
		db?: MockDb;
		inApp?: boolean;
		events?: Record<string, AnyEventRef>;
	} = {},
) {
	const db = overrides.db ?? createMockDb();
	const mail = overrides.mail ?? createMockMailAdapter();
	const herald = createHerald({
		db,
		channels: {
			email: { adapter: mail, defaultFrom: "noreply@test.com" },
			inApp: overrides.inApp ?? false,
		},
		queue: { driver: "sync" },
		compliance: { retention: { autoPurge: false } },
		events: overrides.events ?? {},
	});
	return { db, mail, herald };
}

// Returns a standard order event (unique per call via eventName/tplName).
// templates field must come BEFORE dispatch for TS to infer TTemplates correctly.
export function makeOrderSetup(
	opts: {
		eventName?: string;
		tplName?: string;
		legalBasis?: "contract" | "consent";
	} = {},
) {
	const eventName = opts.eventName ?? "order.completed";
	const tplName = opts.tplName ?? "order-user";
	const ev = defineEvent(eventName, {
		schema: z.object({ orderId: z.string(), userId: z.string() }),
		safeFields: ["orderId"],
		compliance:
			opts.legalBasis === "consent"
				? { purpose: `${eventName}.marketing`, legalBasis: "consent" }
				: { purpose: `${eventName}.transactional`, legalBasis: "contract" },
		templates: {
			[tplName]: {
				email: (p) => ({
					subject: `Order #${p.orderId}`,
					html: `<p>Your order ${p.orderId}</p>`,
				}),
			},
		},
		dispatch: (p) => [
			{
				to: p.userId,
				channels: ["email"],
				template: tplName,
				addressHash: `hash:${p.userId}`,
			},
		],
	});
	return { ev, eventName, tplName };
}
