// ============================================================
// herald — src/core/herald.ts
// Main engine — internal runtime pipeline behind configured Herald instances
// ============================================================

import type { HeraldConfig, EventRefMap } from "../types/index.js";
import { createQueue } from "../queue/index.js";
import {
	assertCanSendNow,
	assertComplianceDb,
	defaultCompliancePolicy,
} from "./runtime/compliance-gate.js";
import { supportsChannel } from "./runtime/channel-support.js";
import { createComplianceLifecycle } from "./runtime/compliance-lifecycle.js";
import {
	assertValidEventMap,
	normalizeHeraldRuntimeConfig,
	type CreateHeraldRuntimeConfig,
} from "./runtime/config-normalization.js";
import { createDeliveryIdempotentWithRetry } from "./runtime/delivery-persistence.js";
import {
	isTerminalDelivery,
	REUSABLE_DELIVERY_STATUSES,
	shouldReviveFailedDbDeliveryForRetry,
} from "./runtime/delivery-state.js";
import { createInAppApi } from "./runtime/in-app-api.js";
import { createWarmup, createWorkerApi } from "./runtime/misc-api.js";
import { createProcessor } from "./runtime/processor.js";
import { createRuntimeQueueProcessor } from "./runtime/queue-processor.js";
import { validateRecipientTemplateRenderers } from "./runtime/recipient-validation.js";
import {
	createRuntimeEventMap,
	createRuntimeTemplateMap,
	validateEventRefs,
} from "./runtime/registry.js";
import { createSendFunction } from "./runtime/send.js";
import { createScheduledWorkerStarter } from "./runtime/scheduled-worker.js";
import { createStartController } from "./runtime/start-controller.js";
import { safeHook } from "./runtime/utils.js";
export type { RetryConfig } from "./runtime/processor.js";
export type { EventPayloadMap, SendResult } from "./runtime/send.js";
export type { RuntimeChannels } from "./runtime/types.js";

// ─── createHerald ────────────────────────────────────────────

export function createHerald<const TEvents extends EventRefMap>(
	config: HeraldConfig<TEvents>,
) {
	assertValidEventMap(config.events);
	return createHeraldRuntime(normalizeHeraldRuntimeConfig(config));
}

// ─── createHeraldRuntime ─────────────────────────────────────
export function createHeraldRuntime<const TEvents extends EventRefMap>({
	db,
	hooks,
	queue: queueConfig,
	processorRetry,
	channels: runtimeChannels,
	defaultFrom,
	events,
	compliance: complianceConfig,
}: CreateHeraldRuntimeConfig<TEvents>) {
	// Validate email sender config at construction.
	if (runtimeChannels.email && (!defaultFrom || !defaultFrom.includes("@"))) {
		throw new Error(
			"[herald] channels.email.defaultFrom is required and must be a valid email sender when email is enabled.",
		);
	}
	const eventRefs = Object.values(events ?? {});
	const legalBasisRegistry = complianceConfig.legalBases;

	validateEventRefs(
		eventRefs,
		legalBasisRegistry,
		complianceConfig.requireExplicitEventCompliance,
	);

	// Cast once at boundary — each EventRef has its own generic payload type
	// that TypeScript can't unify in a Map. The payload is validated before use.
	const eventMap = createRuntimeEventMap(eventRefs);

	// Build templateMap from event definitions (templates co-located with events).
	// Template names are scoped to their event; different events may reuse names
	// like "default" because deliveries resolve by eventType + templateName.
	const templateMap = createRuntimeTemplateMap(eventRefs);

	const retentionConfig = complianceConfig.retention;

	const queue = createQueue(queueConfig);

	const durableQueueMaxRetries =
		queueConfig.driver === "db" || queueConfig.driver === "adapter"
			? (queueConfig.retries ?? 3)
			: 0;

	const { compliance, autoPurgeCompliance } = createComplianceLifecycle({
		db,
		queue,
		retentionConfig,
	});

	const processDelivery = createProcessor({
		db,
		runtimeChannels,
		defaultFrom: defaultFrom ?? "",
		hooks,
		retry: processorRetry,
		eventMap,
		templateMap,
		safeHook,
		isTerminalDelivery,
	});

	// ── start ──────────────────────────────────────────────────
	// Singleton per runtime: concurrent callers share the same promise.

	const { start } = createStartController({
		queue,
		createQueueProcessor: () =>
			createRuntimeQueueProcessor({
				queue,
				db,
				processDelivery,
				durableQueueMaxRetries,
				shouldReviveFailedDbDeliveryForRetry,
				isTerminalDelivery,
				assertCanSendNow: (delivery) =>
					assertCanSendNow(delivery, db, eventMap, legalBasisRegistry),
			}),
		autoPurgeCompliance,
	});

	// ── send ───────────────────────────────────────────────────

	const send = createSendFunction<TEvents>({
		start,
		db,
		hooks,
		queue,
		runtimeChannels,
		eventMap,
		legalBasisRegistry,
		reusableStatuses: REUSABLE_DELIVERY_STATUSES,
		createDeliveryIdempotentWithRetry,
		supportsChannel,
		defaultCompliancePolicy,
		assertComplianceDb,
		validateRecipientTemplateRenderers,
		safeHook,
	});

	// ── In-app reads ───────────────────────────────────────────

	const {
		getNotifications,
		getUnreadNotifications,
		countUnread,
		markRead,
		markAllRead,
	} = createInAppApi(db);

	// ── Scheduled worker (sync driver only) ──────────────────

	const startScheduledWorker = createScheduledWorkerStarter({
		queue,
		db,
		start,
		eventMap,
		assertCanSendNow: (delivery) =>
			assertCanSendNow(delivery, db, eventMap, legalBasisRegistry),
		hooks,
		safeHook,
	});

	// ── Warmup + worker ────────────────────────────────────────

	const warmup = createWarmup(eventRefs);
	const createWorker = createWorkerApi({ start, queue });

	return {
		// Core
		send,
		start,
		// In-app
		getNotifications,
		getUnreadNotifications,
		countUnread,
		markRead,
		markAllRead,
		// Compliance lifecycle
		compliance,
		// Worker (for cron / separate process with db queue)
		createWorker,
		// Scheduled worker — for sync driver: poll + enqueue due deliveries
		startScheduledWorker,
		// Warmup — validate template-event linkage at startup
		warmup,
	};
}

export type Herald<TEvents extends EventRefMap = EventRefMap> = ReturnType<
	typeof createHerald<TEvents>
>;
