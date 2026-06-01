// ============================================================
// herald — src/queue/index.ts
// Queue engine — sync driver + pg-boss driver
// ============================================================

import type {
	HeraldQueueAdapter,
	HeraldQueueCapabilities,
	QueueConfig,
} from "../types/index.js";

// ─── Job payload ─────────────────────────────────────────────

export interface DeliveryJob {
	deliveryId: string;
	/**
	 * Full event payload for template rendering.
	 * Flows through the queue job — never persisted in herald DB tables.
	 * For the db driver, temporarily stored in pg-boss's own table (auto-cleaned).
	 *
	 * For scheduled db-driver sends: undefined — payload is resolved at fire time
	 * via event.resolvePayload so PII is never persisted long-term.
	 */
	payload?: Record<string, unknown>;
	/**
	 * When set, pg-boss will delay job execution until this time (startAfter).
	 * Used by the db driver for scheduled sends; absent for immediate sends.
	 */
	scheduledAt?: Date;
}

// ─── Queue driver contract ───────────────────────────────────

export interface QueueDriver {
	capabilities: HeraldQueueCapabilities;
	enqueue(job: DeliveryJob): Promise<string | null>;
	/** Start processing — only needed for async/durable drivers */
	start?(processor: (job: DeliveryJob) => Promise<void>): Promise<void>;
	stop?(): Promise<void>;
	/**
	 * Cancel queued jobs by provider job IDs when supported.
	 * Used by compliance erasure to cancel pending scheduled deliveries.
	 */
	cancelJobs?(jobIds: string[]): Promise<void>;
}

// ─── Sync driver (default) ───────────────────────────────────
// Processes deliveries immediately in the same request.
// Simple, no infra — good for low-volume apps.

export function createSyncDriver(): QueueDriver {
	let processor: ((job: DeliveryJob) => Promise<void>) | null = null;

	return {
		capabilities: {
			durable: false,
			delayedJobs: false,
			cancellation: false,
			nativeRetries: false,
			concurrency: false,
		},
		async enqueue(job) {
			if (!processor) {
				throw new Error(
					"[herald] Sync queue has no processor registered. This is a bug — please report it.",
				);
			}
			// Execute immediately, in-band — no job ID concept in sync mode
			await processor(job);
			return null;
		},
		async start(proc) {
			processor = proc;
		},
		async cancelJobs(_jobIds) {
			// No-op: sync driver has no job queue to cancel
		},
	};
}

// ─── DB driver (pg-boss) ─────────────────────────────────────
// Processes deliveries async via PostgreSQL queue.
// No Redis needed — uses your existing Postgres.

const QUEUE_NAME = "herald:delivery";

/* v8 ignore start */
export function createDbDriver(
	config: {
		connectionString: string;
		concurrency?: number;
		retries?: number;
		backoff?: "exponential" | "linear" | "fixed";
		backoffDelay?: number;
	},
	/** Internal: injected pg-boss instance for unit tests (avoids real pg-boss dependency) */
	_bossOverride?: any,
): QueueDriver {
	let boss: any = _bossOverride ?? null;

	return {
		capabilities: {
			durable: true,
			delayedJobs: true,
			cancellation: true,
			nativeRetries: true,
			concurrency: true,
		},
		async enqueue(job) {
			if (!boss) {
				throw new Error(
					"[herald] pg-boss not initialized. Did you call herald.start()?",
				);
			}

			const isScheduled = !!job.scheduledAt;

			let jobId: string | null;
			if (isScheduled) {
				// Scheduled send: store only deliveryId, no payload — resolved at fire time
				const id = await boss.send(
					QUEUE_NAME,
					{ deliveryId: job.deliveryId },
					{
						retryLimit: config.retries ?? 3,
						retryDelay: config.backoffDelay ?? 1000,
						retryBackoff: config.backoff === "exponential",
						startAfter: job.scheduledAt,
					},
				);
				jobId = id ?? null;
			} else {
				// Immediate send: full payload travels through pg-boss (briefly, auto-cleaned)
				const id = await boss.send(
					QUEUE_NAME,
					{ deliveryId: job.deliveryId, payload: job.payload },
					{
						retryLimit: config.retries ?? 3,
						retryDelay: config.backoffDelay ?? 1000,
						retryBackoff: config.backoff === "exponential",
					},
				);
				jobId = id ?? null;
			}
			return jobId;
		},

		async start(processor) {
			if (_bossOverride) {
				// Test path: boss already injected, just register the worker
				boss = _bossOverride;
				await boss.start();
				await boss.work(
					QUEUE_NAME,
					{ localConcurrency: config.concurrency ?? 5 },
					async (jobs: { data: DeliveryJob }[]) => {
						await processBossJobs(jobs, processor);
					},
				);
				return;
			}

			const { PgBoss } = await import("pg-boss").catch(() => {
				throw new Error(
					'[herald] pg-boss is required for queue driver "db". Run: npm install pg-boss',
				);
			});

			boss = new PgBoss(config.connectionString);
			await boss.start();

			await boss.work(
				QUEUE_NAME,
				{ localConcurrency: config.concurrency ?? 5 },
				async (jobs: { data: DeliveryJob }[]) => {
					await processBossJobs(jobs, processor);
				},
			);
		},

		async stop() {
			if (boss) await boss.stop();
		},

		async cancelJobs(jobIds) {
			if (!boss) return;
			// pg-boss cancel by job ID — best-effort, individual failures silently swallowed
			await Promise.allSettled(jobIds.map((id: string) => boss.cancel(id)));
		},
	};
}
async function processBossJobs(
	jobs: { data: DeliveryJob }[],
	processor: (job: DeliveryJob) => Promise<void>,
): Promise<void> {
	await Promise.all(
		jobs.map(async (job) => {
			try {
				await processor(job.data);
			} catch (e) {
				console.error("[herald] job failed:", e);
				throw e;
			}
		}),
	);
}

/* v8 ignore end */

// ─── Queue factory ───────────────────────────────────────────

export function createQueue(
	config: QueueConfig = { driver: "sync" },
): QueueDriver {
	/* v8 ignore next 11 */
	if (config.driver === "db") {
		return createDbDriver({
			connectionString: config.connectionString,
			concurrency: config.concurrency,
			retries: config.retries,
			backoff: config.backoff,
			backoffDelay: config.backoffDelay,
		});
	}
	if (config.driver === "adapter") {
		return createAdapterDriver(config.adapter);
	}
	return createSyncDriver();
}

export function createAdapterDriver(adapter: HeraldQueueAdapter): QueueDriver {
	return {
		capabilities: adapter.capabilities,
		async enqueue(job) {
			const result = await adapter.enqueue(job);
			if (typeof result === "string") return result;
			if (result && typeof result === "object") return result.jobId ?? null;
			return null;
		},
		async start(processor) {
			await adapter.start?.(processor);
		},
		async stop() {
			await adapter.stop?.();
		},
		async cancelJobs(jobIds) {
			await adapter.cancelJobs?.(jobIds);
		},
	};
}

// ─── Backoff calculator ──────────────────────────────────────

export function calculateBackoff(
	attempt: number,
	strategy: "exponential" | "linear" | "fixed" = "exponential",
	baseDelay = 1000,
): number {
	switch (strategy) {
		case "exponential":
			return baseDelay * Math.pow(2, attempt - 1);
		case "linear":
			return baseDelay * attempt;
		case "fixed":
			return baseDelay;
	}
}
