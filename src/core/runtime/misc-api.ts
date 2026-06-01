import type { QueueDriver } from "../../queue/index.js";
import type { EventRefValue } from "./types.js";

export function createWarmup(eventRefs: EventRefValue[]) {
	return function warmup(): void {
		for (const eventRef of eventRefs) {
			const tplKeys = Object.keys(eventRef.definition.templates);
			if (tplKeys.length === 0) {
				console.warn(
					`[herald] Event "${eventRef.name}" has no templates defined — send() will always fail for this event.`,
				);
			}
		}
	};
}

export function createWorkerApi({
	start,
	queue,
}: {
	start: () => Promise<void>;
	queue: QueueDriver;
}) {
	return function createWorker() {
		return {
			async start() {
				await start();
			},
			async stop() {
				await queue.stop?.();
			},
		};
	};
}
