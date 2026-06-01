import type {
	EventCompliancePolicy,
	Recipient,
	SendOptions,
} from "../../../types/index.js";
import { validateRecipients } from "../../define.js";
import type { RuntimeEventDef, RuntimeTemplateDef } from "../types.js";
import { assertScheduledEventCanResolvePayload } from "./guards.js";

export interface PreparedSend {
	event: RuntimeEventDef;
	validatedPayload: Record<string, unknown>;
	recipients: Recipient[];
	eventPolicy: EventCompliancePolicy;
	bypassCompliance: boolean;
	isScheduled: boolean;
}

export async function prepareSend({
	start,
	eventName,
	payload,
	options,
	eventMap,
	defaultCompliancePolicy,
	validateRecipientTemplateRenderers,
}: {
	start: () => Promise<void>;
	eventName: string;
	payload: unknown;
	options: SendOptions;
	eventMap: Map<string, RuntimeEventDef>;
	defaultCompliancePolicy: (eventName: string) => EventCompliancePolicy;
	validateRecipientTemplateRenderers: (
		eventName: string,
		recipients: Recipient[],
		templates: Record<string, RuntimeTemplateDef>,
	) => void;
}): Promise<PreparedSend> {
	await start();

	const event = eventMap.get(eventName);
	if (!event) {
		throw new Error(
			`[herald] Event "${eventName}" is not registered in this Herald instance. Did you pass it to heraldApp.create({ events: { ... } })?`,
		);
	}

	assertScheduledEventCanResolvePayload(eventName, event, options);

	const validatedPayload = event.schema.parse(payload) as Record<
		string,
		unknown
	>;
	const recipients = event.dispatch(validatedPayload);
	validateRecipients(
		eventName,
		recipients,
		new Map(Object.entries(event.templates)),
	);
	validateRecipientTemplateRenderers(eventName, recipients, event.templates);

	return {
		event,
		validatedPayload,
		recipients,
		eventPolicy: event.compliance ?? defaultCompliancePolicy(eventName),
		bypassCompliance: options.bypassComplianceCheck ?? false,
		isScheduled: !!options.scheduledAt,
	};
}
