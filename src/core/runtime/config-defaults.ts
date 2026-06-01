import type { HeraldConfig, HeraldRetentionConfig } from "../../types/index.js";
import { legalBases, type LegalBasisRegistry } from "../../compliance/index.js";
import type { RetryConfig } from "./processor.js";

export const DEFAULT_RETENTION_CONFIG = {
	deliveryRetention: "90d",
	auditLogRetention: "2y",
	autoPurge: true,
} as const satisfies Required<HeraldRetentionConfig>;

export interface NormalizedComplianceDefaults
	extends Omit<
		NonNullable<HeraldConfig["compliance"]>,
		"legalBases" | "retention"
	> {
	legalBases: LegalBasisRegistry;
	retention: Required<HeraldRetentionConfig>;
}

export function resolveQueueConfig(
	queue: HeraldConfig["queue"] | undefined,
): NonNullable<HeraldConfig["queue"]> {
	return queue ?? { driver: "sync" as const };
}

export function resolveProcessorRetryConfig(
	queue: NonNullable<HeraldConfig["queue"]>,
): RetryConfig {
	if (queue.driver !== "sync") {
		return { maxRetries: 0, backoff: "exponential", backoffDelay: 1000 };
	}

	return {
		maxRetries: queue.retries ?? 0,
		backoff: queue.backoff ?? "exponential",
		backoffDelay: queue.backoffDelay ?? 1000,
	};
}

export function mergeComplianceDefaults(
	base: HeraldConfig["compliance"] | undefined,
	override?: HeraldConfig["compliance"] | undefined,
): NormalizedComplianceDefaults {
	const replaceDefaultLegalBases =
		override?.replaceDefaultLegalBases ?? base?.replaceDefaultLegalBases;

	const customLegalBases = {
		...(base?.legalBases ?? {}),
		...(override?.legalBases ?? {}),
	};

	const resolvedLegalBases = replaceDefaultLegalBases
		? customLegalBases
		: {
				...legalBases.defaults,
				...customLegalBases,
			};

	return {
		...base,
		...override,
		replaceDefaultLegalBases,
		legalBases: resolvedLegalBases,
		retention: {
			...DEFAULT_RETENTION_CONFIG,
			...(base?.retention ?? {}),
			...(override?.retention ?? {}),
		},
	};
}
