import type {
	Delivery,
	DeliveryStatus,
	HeraldDatabaseAdapter,
} from "../../types/index.js";
import { sleep } from "./utils.js";

function isSerializationFailure(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const candidate = error as Error & { code?: string };
	return (
		candidate.code === "40001" ||
		candidate.code === "P2034" ||
		/serialization|write conflict|deadlock/i.test(error.message)
	);
}

export async function createDeliveryIdempotentWithRetry(
	db: HeraldDatabaseAdapter,
	data: Omit<Delivery, "id" | "createdAt" | "updatedAt">,
	reusableStatuses: readonly DeliveryStatus[],
): Promise<{ delivery: Delivery; created: boolean }> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			return await db.createDeliveryIdempotent(data, reusableStatuses);
		} catch (error) {
			lastError = error;
			if (!isSerializationFailure(error) || attempt === 2) break;
			await sleep(10 * (attempt + 1));
		}
	}
	throw lastError;
}
