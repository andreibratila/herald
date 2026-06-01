import type {
	Delivery,
	EmailTemplate,
	EventCompliancePolicy,
	EventRefMap,
	HeraldMailAdapter,
	HeraldSchema,
	InAppTemplate,
	Recipient,
} from "../../types/index.js";

export interface RuntimeTemplateDef {
	email?: (payload: Record<string, unknown>) => EmailTemplate;
	inApp?: (payload: Record<string, unknown>) => InAppTemplate;
}

export interface RuntimeEventDef {
	schema: HeraldSchema<unknown>;
	persistedFields?: string[];
	compliance?: EventCompliancePolicy;
	templates: Record<string, RuntimeTemplateDef>;
	dispatch(payload: Record<string, unknown>): Recipient[];
	resolvePayload?: (delivery: Delivery) => Promise<Record<string, unknown>>;
}

export interface RuntimeChannels {
	email?: HeraldMailAdapter;
	inApp?: boolean;
}

export type RuntimeTemplateMap = Map<string, Map<string, RuntimeTemplateDef>>;

export type EventRefValue<TEvents extends EventRefMap = EventRefMap> =
	TEvents[keyof TEvents];
