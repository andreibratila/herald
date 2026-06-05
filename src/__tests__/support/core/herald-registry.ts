import { z } from "zod";
import { defineEvent } from "../../../core/define.js";
import { createHerald } from "../../../core/herald.js";
import { createMockDb } from "../../helpers/mock-db-adapter.js";
import type { AnyEventRef } from "../../../types/index.js";

export const DEFAULT_TMPL_NAME = "order-tmpl";

export function makeBaseEvent(name = "order.completed") {
	return defineEvent(name, {
		schema: z.object({ userId: z.string(), orderId: z.string() }),
		templates: {
			[DEFAULT_TMPL_NAME]: {
				email: (p) => ({ subject: `Order ${p.orderId}`, html: "<p/>" }),
			},
		},
		dispatch: (p) => [
			{ to: p.userId, channels: ["email"], template: DEFAULT_TMPL_NAME },
		],
	});
}

export function makeHeraldWithInstance(ev: AnyEventRef, db = createMockDb()) {
	return createHerald({
		db,
		channels: { inApp: false },
		queue: { driver: "sync" },
		compliance: { retention: { autoPurge: false } },
		events: { ev },
	});
}
