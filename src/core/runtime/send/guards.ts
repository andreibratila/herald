import type { SendOptions } from "../../../types/index.js";
import type { RuntimeEventDef } from "../types.js";

export function assertScheduledAtNotPast(options: SendOptions): void {
	// scheduledAt must be in the future (allow up to 5s clock skew).
	if (
		options.scheduledAt &&
		options.scheduledAt.getTime() < Date.now() - 5000
	) {
		throw new Error(
			`[herald] scheduledAt must be in the future. Received: ${options.scheduledAt.toISOString()}`,
		);
	}
}

export function assertScheduledEventCanResolvePayload(
	eventName: string,
	event: RuntimeEventDef,
	options: SendOptions,
): void {
	// Guard: scheduledAt requires resolvePayload on the event
	if (options?.scheduledAt) {
		if (!event.resolvePayload) {
			throw new Error(
				`Event "${eventName}" uses scheduledAt but has no resolvePayload defined. ` +
					`Add resolvePayload to defineEvent("${eventName}", { resolvePayload: async (d) => ... }).`,
			);
		}
	}
}
