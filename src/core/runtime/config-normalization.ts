import type { HeraldConfig, EventRefMap } from "../../types/index.js";
import type { LegalBasisRegistry } from "../../compliance/index.js";
import {
	mergeComplianceDefaults,
	resolveProcessorRetryConfig,
	resolveQueueConfig,
} from "./config-defaults.js";
import type { RetryConfig } from "./processor.js";
import type { RuntimeChannels } from "./types.js";

export interface NormalizedRuntimeComplianceConfig
	extends NonNullable<HeraldConfig["compliance"]> {
	legalBases: LegalBasisRegistry;
	retention: {
		deliveryRetention: `${number}d` | `${number}y`;
		auditLogRetention: `${number}d` | `${number}y`;
		autoPurge: boolean;
	};
}

export interface CreateHeraldRuntimeConfig<TEvents extends EventRefMap> {
	db: HeraldConfig<TEvents>["db"];
	hooks?: HeraldConfig<TEvents>["hooks"];
	queue: NonNullable<HeraldConfig<TEvents>["queue"]>;
	processorRetry: RetryConfig;
	channels: RuntimeChannels;
	defaultFrom?: string;
	compliance: NormalizedRuntimeComplianceConfig;
	events: TEvents;
}

function normalizeRuntimeChannels(channels: HeraldConfig["channels"]): {
	channels: RuntimeChannels;
	defaultFrom?: string;
} {
	return {
		channels: {
			email: channels?.email?.adapter,
			inApp: channels?.inApp,
		},
		defaultFrom: channels?.email?.defaultFrom,
	};
}

export function assertValidEventMap(
	events: unknown,
): asserts events is EventRefMap {
	if (!events || typeof events !== "object" || Array.isArray(events)) {
		throw new Error("[herald] events must be an object map of event refs.");
	}
}

export function normalizeHeraldRuntimeConfig<TEvents extends EventRefMap>(
	config: HeraldConfig<TEvents>,
): CreateHeraldRuntimeConfig<TEvents> {
	const queue = resolveQueueConfig(config.queue);
	const { channels, defaultFrom } = normalizeRuntimeChannels(config.channels);
	return {
		db: config.db,
		hooks: config.hooks,
		queue,
		processorRetry: resolveProcessorRetryConfig(queue),
		channels,
		defaultFrom,
		events: config.events,
		compliance: mergeComplianceDefaults(config.compliance),
	};
}
