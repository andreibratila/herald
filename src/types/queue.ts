import type { Promisable } from "type-fest";

// ─── Queue config ────────────────────────────────────────────

export interface QueueConfigSync {
	driver: "sync";
	/**
	 * Max retry attempts for transient failures. Default: 0 (no retries).
	 *
	 * **Warning:** retries with the sync driver block the calling thread for up to
	 * `backoffDelay × 2^attempt` ms per attempt. Only use this in non-HTTP contexts
	 * (CLI tools, scripts, background workers). For HTTP handlers, use `driver: "db"` instead.
	 */
	retries?: number;
	/** Backoff strategy. Default: "exponential" */
	backoff?: "exponential" | "linear" | "fixed";
	/** Base delay in ms. Default: 1000 */
	backoffDelay?: number;
}

export interface QueueConfigDb {
	driver: "db";
	/** PostgreSQL connection string — required for pg-boss */
	connectionString: string;
	/** Max concurrent delivery processors. Default: 5 */
	concurrency?: number;
	/** Max retry attempts for transient failures. Default: 3 */
	retries?: number;
	/** Backoff strategy. Default: "exponential" */
	backoff?: "exponential" | "linear" | "fixed";
	/** Base delay in ms between retries. Default: 1000 */
	backoffDelay?: number;
}

export interface HeraldQueueJob {
	deliveryId: string;
	/** Full payload for immediate jobs. Scheduled durable queues should omit this and let resolvePayload rebuild it. */
	payload?: Record<string, unknown>;
	/** Earliest run time for queues with native delayed-job support. */
	scheduledAt?: Date;
}

export type HeraldQueueProcessor = (job: HeraldQueueJob) => Promise<void>;

export interface HeraldQueueCapabilities {
	/** True when jobs survive process restarts. */
	durable: boolean;
	/** True when enqueue({ scheduledAt }) is natively delayed by the queue. */
	delayedJobs: boolean;
	/** True when queued jobs can be cancelled by job id. */
	cancellation: boolean;
	/** True when the queue owns retry attempts/backoff after processor failure. */
	nativeRetries: boolean;
	/** True when the queue can process multiple jobs concurrently. */
	concurrency?: boolean;
}

export interface HeraldQueueAdapter {
	/** Human-readable adapter name used in diagnostics. */
	name?: string;
	capabilities: HeraldQueueCapabilities;
	enqueue(
		job: HeraldQueueJob,
	): Promisable<{ jobId?: string | null } | string | null | void>;
	start?(processor: HeraldQueueProcessor): Promisable<void>;
	stop?(): Promisable<void>;
	cancelJobs?(jobIds: string[]): Promisable<void>;
}

export interface QueueConfigAdapter {
	driver: "adapter";
	adapter: HeraldQueueAdapter;
	/** Max retry attempts when Herald needs to revive failed durable jobs. Default: 3. */
	retries?: number;
}

export type QueueConfig = QueueConfigSync | QueueConfigDb | QueueConfigAdapter;
