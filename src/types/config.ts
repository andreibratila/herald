import type { Promisable } from "type-fest";
import type { HeraldChannelsConfig } from "./channels.js";
import type { HeraldComplianceConfig } from "./compliance.js";
import type { HeraldDatabaseAdapter } from "./database.js";
import type { EventRefMap } from "./events.js";
import type { QueueConfig } from "./queue.js";
import type { Delivery } from "./records.js";

// ─── Hooks ───────────────────────────────────────────────────

export interface HeraldHooks {
	onDelivered?: (delivery: Delivery) => Promisable<void>;
	onFailed?: (delivery: Delivery, error: Error) => Promisable<void>;
	onRetry?: (delivery: Delivery, attempt: number) => Promisable<void>;
	onSkipped?: (
		userId: string,
		eventType: string,
		reason: string,
	) => Promisable<void>;
}

// ─── Main config ─────────────────────────────────────────────

export interface HeraldConfig<TEvents extends EventRefMap = EventRefMap> {
	db: HeraldDatabaseAdapter;
	channels?: HeraldChannelsConfig;
	queue?: QueueConfig;
	compliance?: HeraldComplianceConfig;
	hooks?: HeraldHooks;
	/** Base URL of your app — used in email templates */
	appUrl?: string;
	/**
	 * Per-instance event registry — returned by defineEvent().
	 */
	events: TEvents;
}

// ─── Scheduled worker options ─────────────────────────────────

export interface StartScheduledWorkerOptions {
	/** How many deliveries to claim per tick. Default: 50 */
	batchSize?: number;
	/** How long to hold a claim lease in ms. Default: 30_000 (30s) */
	leaseMs?: number;
	/** Identifies this worker instance. Default: hostname:pid */
	workerId?: string;
	/** Max resolvePayload failures before delivery is marked "failed". Default: 3 */
	maxResolveAttempts?: number;
}
