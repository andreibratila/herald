import type { DeliveryJob, QueueDriver } from "../../queue/index.js";

export interface StartControllerConfig {
  queue: QueueDriver;
  createQueueProcessor: () => (job: DeliveryJob) => Promise<void>;
  autoPurgeCompliance: () => Promise<void>;
}

/**
 * Creates a per-runtime lazy start controller.
 *
 * The returned start() function is singleton-scoped to one Herald runtime
 * instance: concurrent callers share one promise, but separate createHerald()
 * calls get separate controllers and separate queue processors.
 */
export function createStartController({
  queue,
  createQueueProcessor,
  autoPurgeCompliance,
}: StartControllerConfig): { start: () => Promise<void> } {
  let startPromise: Promise<void> | null = null;

  function start(): Promise<void> {
    if (!startPromise) {
      startPromise = (async () => {
        await queue.start?.(createQueueProcessor());
        await autoPurgeCompliance();
      })();
    }

    return startPromise;
  }

  return { start };
}
