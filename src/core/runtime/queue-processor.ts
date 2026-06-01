import type { HeraldDatabaseAdapter, Delivery } from "../../types/index.js";
import type { DeliveryJob, QueueDriver } from "../../queue/index.js";

export interface RuntimeQueueProcessorConfig {
	queue: QueueDriver;
	db: HeraldDatabaseAdapter;
	processDelivery: (job: DeliveryJob) => Promise<void>;
	durableQueueMaxRetries: number;
	shouldReviveFailedDbDeliveryForRetry: (
		delivery: Delivery,
		maxRetries: number,
	) => boolean;
	isTerminalDelivery: (delivery: Delivery) => boolean;
	assertCanSendNow: (delivery: Delivery) => Promise<boolean>;
}

/**
 * Builds the processor registered with the configured queue.
 *
 * Non-durable queues can run the delivery processor directly. Durable queues
 * may execute delayed jobs much later, so they wrap processDelivery with a
 * fire-time delivery/compliance guard before side effects happen.
 */
export function createRuntimeQueueProcessor({
	queue,
	db,
	processDelivery,
	durableQueueMaxRetries,
	shouldReviveFailedDbDeliveryForRetry,
	isTerminalDelivery,
	assertCanSendNow,
}: RuntimeQueueProcessorConfig): (job: DeliveryJob) => Promise<void> {
	if (!queue.capabilities.durable) return processDelivery;

	return async function durableQueueProcessor(job: DeliveryJob): Promise<void> {
		const delivery = await db.getDelivery(job.deliveryId);
		if (!delivery) return;

		if (
			shouldReviveFailedDbDeliveryForRetry(delivery, durableQueueMaxRetries)
		) {
			await db.updateDelivery(job.deliveryId, {
				status: "retrying",
			});
		}

		const currentDelivery = (await db.getDelivery(job.deliveryId)) ?? delivery;
		if (isTerminalDelivery(currentDelivery)) return;

		const canSend = await assertCanSendNow(currentDelivery);
		if (!canSend) return;

		await processDelivery(job);
	};
}
