import type {
	Delivery,
	HeraldConfig,
	HeraldDatabaseAdapter,
} from "../../types/index.js";
import { calculateBackoff, type DeliveryJob } from "../../queue/index.js";
import type {
	RuntimeChannels,
	RuntimeEventDef,
	RuntimeTemplateMap,
} from "./types.js";
import { resolveDeliveryPayload } from "./processor/payload.js";
import { runDeliverySideEffects } from "./processor/side-effects.js";
import {
	auditAcceptedDelivery,
	failDelivery,
	markAcceptedWithRetry,
	markDeliveryFailedAfterRetries,
	markDeliveryRetrying,
} from "./processor/status.js";
import {
	planDeliveryChannels,
	resolveDeliveryTemplate,
} from "./processor/templates.js";
import { sleep } from "./utils.js";

export interface RetryConfig {
	maxRetries: number;
	backoff: "exponential" | "linear" | "fixed";
	backoffDelay: number;
}

export interface CreateProcessorConfig {
	db: HeraldDatabaseAdapter;
	runtimeChannels: RuntimeChannels;
	defaultFrom: string;
	hooks?: HeraldConfig["hooks"];
	retry: RetryConfig;
	eventMap: Map<string, RuntimeEventDef>;
	templateMap: RuntimeTemplateMap;
	safeHook: (fn: () => PromiseLike<void> | void) => Promise<void>;
	isTerminalDelivery: (delivery: Delivery) => boolean;
}

/**
 * Creates the per-runtime delivery processor registered with the queue.
 *
 * The returned processDelivery() executes the actual side effects for one
 * delivery job: rendering, mail send / in-app creation, delivery status updates,
 * retry state, audit logs, and hooks.
 */
export function createProcessor({
	db,
	runtimeChannels,
	defaultFrom,
	hooks,
	retry,
	eventMap,
	templateMap,
	safeHook,
	isTerminalDelivery,
}: CreateProcessorConfig): (job: DeliveryJob) => Promise<void> {
	async function markFailed(
		delivery: Delivery,
		message: string,
		patch: Partial<Delivery> = {},
	): Promise<void> {
		await failDelivery({ db, delivery, message, hooks, safeHook, patch });
	}

	return async function processDelivery(job: DeliveryJob): Promise<void> {
		const { deliveryId } = job;

		const delivery = await db.getDelivery(deliveryId);
		if (!delivery) {
			// Best-effort audit log — never throw from here
			await db
				.createAuditLog({
					action: "notification.delivery_not_found",
					metadata: { deliveryId },
				})
				.catch(() => {});
			console.warn(`[herald] Delivery "${deliveryId}" not found — skipping.`);
			return;
		}

		// Terminal status guard — exit early, no side effects
		if (isTerminalDelivery(delivery)) return;

		const payloadResult = await resolveDeliveryPayload({
			db,
			delivery,
			initialPayload: job.payload,
			eventMap,
			hooks,
			safeHook,
		});
		if (!payloadResult.ok) {
			await markFailed(delivery, payloadResult.message);
			return;
		}
		const payload = payloadResult.payload;

		const templateResult = resolveDeliveryTemplate(delivery, templateMap);
		if (!templateResult.ok) {
			await markFailed(delivery, templateResult.message);
			return;
		}
		const template = templateResult.template;

		// Hoist channel flags above retry loop.
		// Computed once — these don't change between retries.
		const channelPlanResult = planDeliveryChannels(
			delivery,
			runtimeChannels,
			template,
		);
		if (!channelPlanResult.ok) {
			await markFailed(delivery, channelPlanResult.reason);
			return;
		}
		const channelPlan = channelPlanResult.plan;

		let attempt = delivery.attempts;
		const maxAttempt = delivery.attempts + retry.maxRetries + 1;
		let localExternalId: string | null = delivery.externalId ?? null;

		while (attempt < maxAttempt) {
			attempt++;

			await db.updateDelivery(deliveryId, {
				status: "dispatched",
				attempts: attempt,
			});

			try {
				// Refresh delivery to check sideEffectsCompletedAt.
				// Avoids re-sending email/inApp if we already did on a previous attempt
				const freshDelivery = await db.getDelivery(deliveryId);
				const alreadyCompletedSideEffects =
					!!freshDelivery?.sideEffectsCompletedAt;

				if (!alreadyCompletedSideEffects) {
					const sideEffects = await runDeliverySideEffects({
						db,
						delivery,
						payload,
						template,
						plan: channelPlan,
						runtimeChannels,
						defaultFrom,
						eventMap,
						externalId: localExternalId,
					});
					if (!sideEffects.ok) {
						await markFailed(delivery, sideEffects.message);
						return;
					}
					localExternalId = sideEffects.externalId;
				}

				const accepted = await markAcceptedWithRetry({
					db,
					delivery,
					backoffDelay: retry.backoffDelay,
				});
				if (!accepted) return; // NOT "failed" — side effects happened

				// ── Audit + hook ─────────────────────────────────────────
				await auditAcceptedDelivery(db, delivery);
				await safeHook(() => hooks?.onDelivered?.(delivery));
				return;
			} catch (err: unknown) {
				const error = err instanceof Error ? err : new Error(String(err));

				if (attempt <= retry.maxRetries) {
					await markDeliveryRetrying({
						db,
						delivery,
						error,
						attempt,
						hooks,
						safeHook,
					});
					await sleep(
						calculateBackoff(attempt, retry.backoff, retry.backoffDelay),
					);
					continue;
				}

				await markDeliveryFailedAfterRetries({
					db,
					delivery,
					error,
					hooks,
					safeHook,
				});
				throw error;
			}
		}
	};
}
