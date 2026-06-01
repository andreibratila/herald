import { randomUUID } from "node:crypto";
import type {
	Delivery,
	HeraldConfig,
	HeraldDatabaseAdapter,
	StartScheduledWorkerOptions,
} from "../../types/index.js";
import type { QueueDriver } from "../../queue/index.js";
import type { RuntimeEventDef } from "./types.js";

export interface ScheduledWorkerStarterConfig {
	queue: QueueDriver;
	db: HeraldDatabaseAdapter;
	start: () => Promise<void>;
	eventMap: Map<string, RuntimeEventDef>;
	assertCanSendNow: (delivery: Delivery) => Promise<boolean>;
	hooks?: HeraldConfig["hooks"];
	safeHook: (fn: () => PromiseLike<void> | void) => Promise<void>;
}

/**
 * Creates the per-runtime scheduled worker starter for queues without native
 * delayed jobs. The returned startScheduledWorker() is singleton-scoped to one
 * Herald runtime instance and returns the same stop function on repeated calls.
 */
export function createScheduledWorkerStarter({
	queue,
	db,
	start,
	eventMap,
	assertCanSendNow,
	hooks,
	safeHook,
}: ScheduledWorkerStarterConfig) {
	let scheduledWorkerHandle: (() => void) | null = null;

	return async function startScheduledWorker(
		intervalMs: number,
		opts?: StartScheduledWorkerOptions,
	): Promise<() => void> {
		if (queue.capabilities.delayedJobs) {
			throw new Error(
				"[herald] startScheduledWorker is only available when the queue does not provide delayed jobs. " +
					"The configured queue handles scheduling internally.",
			);
		}

		// Singleton — don't create a second interval
		if (scheduledWorkerHandle) return scheduledWorkerHandle;

		// Ensure queue and retention lifecycle are ready before first tick can fire
		await start();

		const batchSize = opts?.batchSize ?? 50;
		const leaseMs = opts?.leaseMs ?? 30_000;
		const workerId = opts?.workerId ?? `herald:${randomUUID()}`;
		const maxResolveAttempts = opts?.maxResolveAttempts ?? 3;

		const tick = async () => {
			const now = new Date();
			let claimed: Delivery[];
			try {
				claimed = await db.claimScheduledBatch(
					now,
					workerId,
					batchSize,
					leaseMs,
				);
			} catch (e) {
				console.error("[herald] claimScheduledBatch failed", e);
				return;
			}

			for (const d of claimed) {
				let validatedPayload: Record<string, unknown>;
				try {
					// Fire-time policy gate — re-check compliance for scheduled deliveries
					const canSend = await assertCanSendNow(d);
					if (!canSend) continue;

					// Keep the row in "claimed" while resolving payload.
					// If the process crashes here, claim_expires_at lets another tick reclaim it.
					const eventDef = eventMap.get(d.eventType);
					if (!eventDef?.resolvePayload) {
						throw new Error(
							`[herald] Event "${d.eventType}" has no resolvePayload — cannot process scheduled delivery ${d.id}.`,
						);
					}

					const rawPayload = await eventDef.resolvePayload(d);
					if (rawPayload == null) {
						throw new Error(
							`[herald] resolvePayload for event "${d.eventType}" returned null or undefined.`,
						);
					}
					validatedPayload = eventDef.schema.parse(rawPayload) as Record<
						string,
						unknown
					>;
				} catch (e) {
					const error = e instanceof Error ? e : new Error(String(e));
					const newAttempts = (d.resolveAttempts ?? 0) + 1;

					if (newAttempts >= maxResolveAttempts) {
						await db.updateDelivery(d.id, {
							status: "failed",
							lastError: error.message,
							failedAt: now,
							resolveAttempts: newAttempts,
						});
						await safeHook(() => hooks?.onFailed?.(d, error));
					} else {
						await db.updateDelivery(d.id, {
							status: "scheduled",
							resolveAttempts: newAttempts,
							claimedAt: null,
							claimExpiresAt: null,
							claimedBy: null,
						});
					}
					const errMsg = e instanceof Error ? e.message : String(e);
					console.error(
						`[herald] scheduled delivery ${d.id} failed: ${errMsg}`,
					);
					continue;
				}

				try {
					// Keep the row "claimed" until enqueue/process succeeds. If the process
					// crashes before enqueue, claim_expires_at lets another tick reclaim it.
					await queue.enqueue({ deliveryId: d.id, payload: validatedPayload });
				} catch (e) {
					const errMsg = e instanceof Error ? e.message : String(e);
					console.error(
						`[herald] scheduled delivery ${d.id} enqueue/process failed: ${errMsg}`,
					);
					continue;
				}

				await db
					.createAuditLog({
						userId: d.userId,
						action: "notification.scheduled.fired",
						eventType: d.eventType,
						deliveryId: d.id,
						metadata: { firedAt: now.toISOString() },
					})
					.catch((e) =>
						console.warn(
							"[herald] scheduled fired audit log failed (non-fatal):",
							e,
						),
					);
			}
		};

		const handle = setInterval(() => {
			void tick();
		}, intervalMs);
		scheduledWorkerHandle = () => {
			clearInterval(handle);
			scheduledWorkerHandle = null;
		};
		return scheduledWorkerHandle;
	};
}
