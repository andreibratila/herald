import type {
	Delivery,
	HeraldConfig,
	HeraldDatabaseAdapter,
} from "../../../types/index.js";
import { calculateBackoff } from "../../../queue/index.js";
import { sleep } from "../utils.js";

export async function failDelivery({
	db,
	delivery,
	message,
	hooks,
	safeHook,
	patch = {},
}: {
	db: HeraldDatabaseAdapter;
	delivery: Delivery;
	message: string;
	hooks?: HeraldConfig["hooks"];
	safeHook: (fn: () => PromiseLike<void> | void) => Promise<void>;
	patch?: Partial<Delivery>;
}): Promise<void> {
	const error = new Error(message);
	await db.updateDelivery(delivery.id, {
		status: "failed",
		lastError: message,
		failedAt: new Date(),
		...patch,
	});
	await safeHook(() => hooks?.onFailed?.(delivery, error));
}

export async function markAcceptedWithRetry({
	db,
	delivery,
	backoffDelay,
}: {
	db: HeraldDatabaseAdapter;
	delivery: Delivery;
	backoffDelay: number;
}): Promise<boolean> {
	const acceptedLoopBase = Math.min(backoffDelay, 500);
	let markAcceptedError: unknown;
	for (let i = 0; i < 5; i++) {
		try {
			await db.updateDelivery(delivery.id, {
				status: "accepted",
				acceptedAt: new Date(),
			});
			markAcceptedError = undefined;
			break;
		} catch (e) {
			markAcceptedError = e;
			if (i < 4)
				await sleep(calculateBackoff(i + 1, "exponential", acceptedLoopBase));
		}
	}

	if (markAcceptedError === undefined) return true;

	await db.createAuditLog({
		userId: delivery.userId,
		action: "notification.accepted_unconfirmed",
		eventType: delivery.eventType,
		deliveryId: delivery.id,
		metadata: { acceptedAt: new Date().toISOString() },
	});
	return false;
}

export async function auditAcceptedDelivery(
	db: HeraldDatabaseAdapter,
	delivery: Delivery,
): Promise<void> {
	await db.createAuditLog({
		userId: delivery.userId,
		action: "notification.accepted",
		eventType: delivery.eventType,
		deliveryId: delivery.id,
		metadata: {
			channel: delivery.channel,
			template: delivery.templateName,
		},
	});
}

export async function markDeliveryRetrying({
	db,
	delivery,
	error,
	attempt,
	hooks,
	safeHook,
}: {
	db: HeraldDatabaseAdapter;
	delivery: Delivery;
	error: Error;
	attempt: number;
	hooks?: HeraldConfig["hooks"];
	safeHook: (fn: () => PromiseLike<void> | void) => Promise<void>;
}): Promise<void> {
	await db.updateDelivery(delivery.id, {
		status: "retrying",
		lastError: error.message,
		attempts: attempt,
	});
	await safeHook(() => hooks?.onRetry?.(delivery, attempt));
}

export async function markDeliveryFailedAfterRetries({
	db,
	delivery,
	error,
	hooks,
	safeHook,
}: {
	db: HeraldDatabaseAdapter;
	delivery: Delivery;
	error: Error;
	hooks?: HeraldConfig["hooks"];
	safeHook: (fn: () => PromiseLike<void> | void) => Promise<void>;
}): Promise<void> {
	await db.updateDelivery(delivery.id, {
		status: "failed",
		lastError: error.message,
		failedAt: new Date(),
	});

	await db.createAuditLog({
		userId: delivery.userId,
		action: "notification.failed",
		eventType: delivery.eventType,
		deliveryId: delivery.id,
		metadata: { error: error.message, channel: delivery.channel },
	});

	await safeHook(() => hooks?.onFailed?.(delivery, error));
}
