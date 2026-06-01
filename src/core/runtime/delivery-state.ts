import type { Delivery, DeliveryStatus } from "../../types/index.js";

const TERMINAL_STATUSES = [
	"accepted",
	"skipped",
	"redacted",
	"failed",
] as const;

// "failed" and "skipped" are NOT reusable — allow re-creation.
export const REUSABLE_DELIVERY_STATUSES = [
	"pending",
	"scheduled",
	"claimed",
	"dispatched",
	"retrying",
	"accepted",
] as const satisfies readonly DeliveryStatus[];

export function isTerminalDelivery(delivery: Delivery): boolean {
	return (
		(TERMINAL_STATUSES as readonly string[]).includes(delivery.status) ||
		(delivery.status === "dispatched" && !!delivery.sideEffectsCompletedAt)
	);
}

export function shouldReviveFailedDbDeliveryForRetry(
	delivery: Delivery,
	maxRetries: number,
): boolean {
	return (
		delivery.status === "failed" &&
		delivery.attempts > 0 &&
		delivery.attempts <= maxRetries
	);
}
