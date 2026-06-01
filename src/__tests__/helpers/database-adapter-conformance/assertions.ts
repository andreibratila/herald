import { expect } from "vitest";
import type {
	AuditLog,
	ConsentEvent,
	Delivery,
	Notification,
} from "../../../types/index.js";

function expectCreatedAtIdOrderNewestFirst<
	T extends { createdAt: Date; id: string },
>(items: T[]): void {
	for (let i = 1; i < items.length; i++) {
		const prev = items[i - 1]!;
		const curr = items[i]!;
		const timeDiff = prev.createdAt.getTime() - curr.createdAt.getTime();

		if (timeDiff === 0) {
			expect(prev.id.localeCompare(curr.id)).toBeGreaterThan(0);
		} else {
			expect(timeDiff).toBeGreaterThanOrEqual(0);
		}
	}
}

export function expectNotificationOrderNewestFirst(
	items: Notification[],
): void {
	expectCreatedAtIdOrderNewestFirst(items);
}

export function expectDeliveryOrderNewestFirst(items: Delivery[]): void {
	expectCreatedAtIdOrderNewestFirst(items);
}

export function expectConsentEventOrderNewestFirst(
	items: ConsentEvent[],
): void {
	expectCreatedAtIdOrderNewestFirst(items);
}

export function expectAuditLogOrderNewestFirst(items: AuditLog[]): void {
	expectCreatedAtIdOrderNewestFirst(items);
}
