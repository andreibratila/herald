import type { Delivery, HeraldDatabaseAdapter } from "../../../types/index.js";
import type { QueueDriver } from "../../../queue/index.js";

export async function enqueueCreatedDelivery({
	db,
	queue,
	delivery,
	isScheduled,
	scheduledAt,
	validatedPayload,
}: {
	db: HeraldDatabaseAdapter;
	queue: QueueDriver;
	delivery: Delivery;
	isScheduled: boolean;
	scheduledAt?: Date;
	validatedPayload: Record<string, unknown>;
}): Promise<void> {
	if (isScheduled) {
		if (queue.capabilities.delayedJobs) {
			// Delayed queue: fire at scheduledAt without storing payload in the queue.
			const jobId = await queue.enqueue({
				deliveryId: delivery.id,
				scheduledAt,
			});
			if (jobId) {
				await db.updateDelivery(delivery.id, { queueJobId: jobId });
			}
		}
		// Queues without delayed jobs: no enqueue — startScheduledWorker handles polling
		return;
	}

	// Immediate send: full payload travels through the queue job — never persisted to DB
	const jobId = await queue.enqueue({
		deliveryId: delivery.id,
		payload: validatedPayload,
	});
	if (jobId) {
		await db.updateDelivery(delivery.id, { queueJobId: jobId });
	}
}
