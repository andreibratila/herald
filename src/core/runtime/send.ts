import type {
	Channel,
	Delivery,
	DeliveryStatus,
	EventCompliancePolicy,
	EventRefMap,
	HeraldConfig,
	HeraldDatabaseAdapter,
	InferSchema,
	Recipient,
	ResolvedCompliancePolicy,
	SendOptions,
} from "../../types/index.js";
import type { QueueDriver } from "../../queue/index.js";
import type { LegalBasisRegistry } from "../../compliance/index.js";
import { ensureChannelSupported } from "./send/channel-phase.js";
import { resolveSendCompliance } from "./send/compliance-phase.js";
import {
	auditCreatedDelivery,
	createSendDelivery,
} from "./send/delivery-phase.js";
import { enqueueCreatedDelivery } from "./send/enqueue-phase.js";
import { assertScheduledAtNotPast } from "./send/guards.js";
import { prepareSend } from "./send/prepare.js";
import type {
	RuntimeChannels,
	RuntimeEventDef,
	RuntimeTemplateDef,
} from "./types.js";

export type EventPayloadMap<TEvents extends EventRefMap> = {
	[E in TEvents[keyof TEvents] as E["name"]]: InferSchema<
		E["definition"]["schema"]
	>;
};

export interface SendResult {
	deliveries: Delivery[];
	errors: Array<{ error: Error; recipient: Recipient }>;
	skipped: Array<{ recipient: Recipient; reason: string }>;
}

interface CreateSendFunctionConfig<TEvents extends EventRefMap> {
	start: () => Promise<void>;
	db: HeraldDatabaseAdapter;
	hooks?: HeraldConfig<TEvents>["hooks"];
	queue: QueueDriver;
	runtimeChannels: RuntimeChannels;
	eventMap: Map<string, RuntimeEventDef>;
	legalBasisRegistry: LegalBasisRegistry;
	reusableStatuses: readonly DeliveryStatus[];
	createDeliveryIdempotentWithRetry: (
		db: HeraldDatabaseAdapter,
		data: Omit<Delivery, "id" | "createdAt" | "updatedAt">,
		reusableStatuses: readonly DeliveryStatus[],
	) => Promise<{ delivery: Delivery; created: boolean }>;
	supportsChannel: (
		channel: Channel,
		runtimeChannels: RuntimeChannels,
	) => boolean;
	defaultCompliancePolicy: (eventName: string) => EventCompliancePolicy;
	assertComplianceDb: (
		db: HeraldDatabaseAdapter,
		policy: ResolvedCompliancePolicy,
	) => void;
	validateRecipientTemplateRenderers: (
		eventName: string,
		recipients: Recipient[],
		templates: Record<string, RuntimeTemplateDef>,
	) => void;
	safeHook: (fn: () => PromiseLike<void> | void) => Promise<void>;
}

export function createSendFunction<TEvents extends EventRefMap>({
	start,
	db,
	hooks,
	queue,
	runtimeChannels,
	eventMap,
	legalBasisRegistry,
	reusableStatuses,
	createDeliveryIdempotentWithRetry,
	supportsChannel,
	defaultCompliancePolicy,
	assertComplianceDb,
	validateRecipientTemplateRenderers,
	safeHook,
}: CreateSendFunctionConfig<TEvents>) {
	return async function send<
		TName extends keyof EventPayloadMap<TEvents> & string,
	>(
		eventName: TName,
		payload: EventPayloadMap<TEvents>[TName],
		options: SendOptions = {},
	): Promise<SendResult> {
		assertScheduledAtNotPast(options);

		const {
			validatedPayload,
			recipients,
			eventPolicy,
			bypassCompliance,
			isScheduled,
		} = await prepareSend({
			start,
			eventName,
			payload,
			options,
			eventMap,
			defaultCompliancePolicy,
			validateRecipientTemplateRenderers,
		});

		const result: SendResult = { deliveries: [], errors: [], skipped: [] };

		for (const recipient of recipients) {
			for (const channel of recipient.channels) {
				try {
					const channelSupport = await ensureChannelSupported({
						channel,
						recipient,
						eventName,
						runtimeChannels,
						hooks,
						supportsChannel,
						safeHook,
					});
					if (!channelSupport.ok) {
						result.skipped.push({
							recipient,
							reason: channelSupport.reason,
						});
						continue;
					}

					const compliance = await resolveSendCompliance({
						db,
						hooks,
						recipient,
						eventName,
						channel,
						eventPolicy,
						legalBasisRegistry,
						bypassCompliance,
						options,
						assertComplianceDb,
						safeHook,
					});
					if (!compliance.ok) {
						result.skipped.push({
							recipient,
							reason: compliance.reason,
						});
						continue;
					}
					const { decision, policy } = compliance;

					const { delivery, created } = await createSendDelivery({
						db,
						recipient,
						eventName,
						channel,
						options,
						isScheduled,
						bypassCompliance,
						policy,
						decision,
						reusableStatuses,
						createDeliveryIdempotentWithRetry,
					});

					result.deliveries.push(delivery);
					if (!created) continue;

					await auditCreatedDelivery({
						db,
						recipient,
						eventName,
						channel,
						options,
						isScheduled,
						bypassCompliance,
						delivery,
						policy,
						decision,
					});
					await enqueueCreatedDelivery({
						db,
						queue,
						delivery,
						isScheduled,
						scheduledAt: options.scheduledAt,
						validatedPayload,
					});
				} catch (err) {
					result.errors.push({
						error: err instanceof Error ? err : new Error(String(err)),
						recipient,
					});
				}
			}
		}

		return result;
	};
}
