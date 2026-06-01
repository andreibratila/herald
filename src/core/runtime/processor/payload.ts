import type {
	Delivery,
	HeraldConfig,
	HeraldDatabaseAdapter,
} from "../../../types/index.js";
import type { RuntimeEventDef } from "../types.js";

export type PayloadResolutionResult =
	| { ok: true; payload: Record<string, unknown> }
	| { ok: false; message: string };

export async function resolveDeliveryPayload({
	db,
	delivery,
	initialPayload,
	eventMap,
	hooks,
	safeHook,
}: {
	db: HeraldDatabaseAdapter;
	delivery: Delivery;
	initialPayload?: Record<string, unknown>;
	eventMap: Map<string, RuntimeEventDef>;
	hooks?: HeraldConfig["hooks"];
	safeHook: (fn: () => PromiseLike<void> | void) => Promise<void>;
}): Promise<PayloadResolutionResult> {
	if (initialPayload) return { ok: true, payload: initialPayload };

	const eventDef = eventMap.get(delivery.eventType);
	if (!eventDef?.resolvePayload) {
		return {
			ok: false,
			message: `Event "${delivery.eventType}" has no resolvePayload — cannot process scheduled delivery.`,
		};
	}

	try {
		const rawPayload = await eventDef.resolvePayload(delivery);
		return {
			ok: true,
			payload: eventDef.schema.parse(rawPayload) as Record<string, unknown>,
		};
	} catch (err: unknown) {
		const error = err instanceof Error ? err : new Error(String(err));
		await db.updateDelivery(delivery.id, {
			status: "failed",
			lastError: error.message,
			attempts: delivery.attempts + 1,
			failedAt: new Date(),
		});
		await safeHook(() => hooks?.onFailed?.(delivery, error));
		throw error;
	}
}
