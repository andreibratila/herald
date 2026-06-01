import type { Except, Simplify, SimplifyDeep } from "type-fest";
import { defineEvent as defineUnscopedEvent } from "./define.js";
import {
	createHeraldRuntime,
	type Herald,
	type RuntimeChannels,
	type SendResult,
} from "./herald.js";
import {
	mergeComplianceDefaults,
	resolveProcessorRetryConfig,
	resolveQueueConfig,
} from "./runtime/config-defaults.js";
import type {
	AnyEventRef,
	Delivery,
	EmailTemplate,
	EventCompliancePolicy,
	EventDefinition,
	EventRef,
	HeraldConfig,
	HeraldChannelsConfigInput,
	HeraldEmailChannelConfig,
	HeraldSchema,
	InAppTemplate,
	InferSchema,
	PayloadFieldPath,
	SendOptions,
	TemplateDefinition,
} from "../types/index.js";

const appIdKey = Symbol.for("herald.appId");

type AppId = symbol;

type BuiltInChannelId = "email" | "inApp";

type ChannelIds<TChannels extends HeraldChannelsConfigInput> = Extract<
	keyof TChannels,
	BuiltInChannelId
>;

type ConfiguredTemplateDefinition<
	TPayload,
	TChannelId extends string,
> = SimplifyDeep<
	([Extract<TChannelId, "email">] extends [never]
		? { email?: never }
		: { email?: (payload: TPayload) => EmailTemplate }) &
		([Extract<TChannelId, "inApp">] extends [never]
			? { inApp?: never }
			: { inApp?: (payload: TPayload) => InAppTemplate })
>;

type ConfiguredEventTemplates<
	TPayload,
	TChannels extends HeraldChannelsConfigInput,
> = Record<
	string,
	ConfiguredTemplateDefinition<TPayload, ChannelIds<TChannels>>
>;

type ConfiguredRecipient<
	TChannels extends HeraldChannelsConfigInput,
	TTemplates extends Record<string, unknown>,
> = {
	to: string;
	channels: readonly ChannelIds<TChannels>[];
	addressHash?: string;
	template: keyof TTemplates & string;
};

export interface ConfiguredEventDefinition<
	TSchema extends HeraldSchema<unknown>,
	TChannels extends HeraldChannelsConfigInput,
	TTemplates extends ConfiguredEventTemplates<InferSchema<TSchema>, TChannels>,
> {
	schema: TSchema;
	persistedFields?: readonly PayloadFieldPath<InferSchema<TSchema>>[];
	compliance: EventCompliancePolicy;
	templates: TTemplates;
	dispatch(
		payload: InferSchema<TSchema>,
	): Array<ConfiguredRecipient<TChannels, TTemplates>>;
	resolvePayload?: (delivery: Delivery) => Promise<Record<string, unknown>>;
}

export type ConfiguredEventRef<
	TName extends string = string,
	TSchema extends HeraldSchema<unknown> = HeraldSchema<unknown>,
	TChannels extends HeraldChannelsConfigInput = HeraldChannelsConfigInput,
	TTemplates extends ConfiguredEventTemplates<
		InferSchema<TSchema>,
		TChannels
	> = ConfiguredEventTemplates<InferSchema<TSchema>, TChannels>,
> = EventRef<
	TName,
	TSchema,
	TTemplates & Record<string, TemplateDefinition<InferSchema<TSchema>>>
> & {
	readonly [appIdKey]: AppId;
	readonly __channels: TChannels;
};

export type DefineEventForApp<TChannels extends HeraldChannelsConfigInput> = <
	const TName extends string,
	TSchema extends HeraldSchema<unknown>,
	const TTemplates extends ConfiguredEventTemplates<
		InferSchema<TSchema>,
		TChannels
	>,
>(
	name: TName,
	definition: ConfiguredEventDefinition<TSchema, TChannels, TTemplates>,
) => ConfiguredEventRef<TName, TSchema, TChannels, TTemplates>;

export interface ConfigureHeraldConfig<
	TChannels extends HeraldChannelsConfigInput,
> {
	channels: TChannels;
	compliance?: HeraldConfig["compliance"];
}

type EventMap = Record<string, AnyEventRef>;

type EventRefForApp<TChannels extends HeraldChannelsConfigInput> =
	AnyEventRef & {
		readonly [appIdKey]: AppId;
		readonly __channels: TChannels;
	};

type EventMapForApp<TChannels extends HeraldChannelsConfigInput> = Record<
	string,
	EventRefForApp<TChannels>
>;

type PayloadOfEventRef<TEventRef> =
	TEventRef extends EventRef<string, infer TSchema, infer _TTemplates>
		? InferSchema<TSchema>
		: never;

export type ConfiguredHerald<TEvents extends EventMap> = Simplify<
	Except<Herald<TEvents>, "send"> & {
		readonly events: {
			readonly [K in keyof TEvents]: (
				payload: PayloadOfEventRef<TEvents[K]>,
				options?: SendOptions,
			) => Promise<SendResult>;
		};
	}
>;

export interface HeraldApp<TChannels extends HeraldChannelsConfigInput> {
	readonly defineEvent: DefineEventForApp<TChannels>;
	create<const TEvents extends EventMapForApp<TChannels>>(
		config: Simplify<Except<HeraldConfig<TEvents>, "channels">>,
	): ConfiguredHerald<TEvents>;
}

export function configureHerald<
	const TChannels extends HeraldChannelsConfigInput,
>(config: ConfigureHeraldConfig<TChannels>): HeraldApp<TChannels> {
	validateChannelConfigs(config.channels);

	const appId = Symbol("herald.app");

	const defineEvent = ((name: string, definition: unknown) => {
		const ref = defineUnscopedEvent(
			name,
			definition as EventDefinition<
				HeraldSchema<unknown>,
				unknown,
				Record<string, TemplateDefinition<unknown>>
			>,
		);
		Object.defineProperty(ref, appIdKey, {
			value: appId,
			enumerable: false,
		});
		return ref;
	}) as DefineEventForApp<TChannels>;

	function create<const TEvents extends EventMapForApp<TChannels>>(
		createConfig: Except<HeraldConfig<TEvents>, "channels">,
	): ConfiguredHerald<TEvents> {
		const mergedCompliance = mergeComplianceDefaults(
			config.compliance,
			createConfig.compliance,
		);

		for (const eventRef of Object.values(createConfig.events)) {
			assertEventBelongsToApp(eventRef, appId);
		}

		const { channels: runtimeChannels, defaultFrom } = resolveRuntimeChannels(
			config.channels,
		);

		const queueConfig = resolveQueueConfig(createConfig.queue);
		const processorRetry = resolveProcessorRetryConfig(queueConfig);

		const runtime = createHeraldRuntime({
			db: createConfig.db,
			hooks: createConfig.hooks,
			queue: queueConfig,
			processorRetry,
			events: createConfig.events,
			channels: runtimeChannels,
			defaultFrom,
			compliance: mergedCompliance,
		});

		const eventMethods = Object.fromEntries(
			Object.entries(createConfig.events).map(([methodName, eventRef]) => [
				methodName,
				async (payload: unknown, options?: SendOptions) => {
					return runtime.send(eventRef.name, payload as never, options);
				},
			]),
		) as ConfiguredHerald<TEvents>["events"];

		const { send: _send, ...publicRuntime } = runtime;

		return {
			...publicRuntime,
			events: eventMethods,
		};
	}

	return {
		defineEvent,
		create,
	};
}

export function getEventAppId(ref: AnyEventRef): symbol | undefined {
	return (ref as { [appIdKey]?: symbol })[appIdKey];
}

function assertEventBelongsToApp(ref: AnyEventRef, appId: AppId): void {
	if (getEventAppId(ref) !== appId) {
		throw new Error(
			`[herald] Event "${ref.name}" was defined by a different Herald app. ` +
				`Define events with the same heraldApp.defineEvent used to create this instance.`,
		);
	}
}

function validateChannelConfigs(
	channels: HeraldChannelsConfigInput,
): asserts channels is HeraldChannelsConfigInput {
	const entries = Object.entries(channels);
	if (entries.length === 0) {
		throw new Error(
			"[herald] configureHerald({ channels }) requires at least one channel.",
		);
	}

	for (const [key] of entries) {
		if (key !== "email" && key !== "inApp") {
			throw new Error(
				`[herald] Unsupported channel key: "${key}". ` +
					`Only "email" and "inApp" are supported until custom channel delivery is implemented.`,
			);
		}
	}
}

function resolveRuntimeChannels(channels: HeraldChannelsConfigInput): {
	channels: RuntimeChannels;
	defaultFrom?: string;
} {
	const runtime: RuntimeChannels = {};
	let defaultFrom: string | undefined;

	if (channels.email) {
		const email = resolveEmailChannelConfig(channels.email);
		runtime.email = email.adapter;
		defaultFrom = email.defaultFrom;
	}

	if (channels.inApp) {
		runtime.inApp = true;
	}

	return { channels: runtime, defaultFrom };
}

function resolveEmailChannelConfig(
	channel: NonNullable<HeraldChannelsConfigInput["email"]>,
): HeraldEmailChannelConfig {
	const { adapter } = channel;
	const initialAdapter = typeof adapter === "function" ? adapter() : adapter;
	return {
		adapter: initialAdapter,
		defaultFrom: channel.defaultFrom,
	};
}
