import type { Delivery } from "../../../types/index.js";
import type {
	RuntimeChannels,
	RuntimeTemplateDef,
	RuntimeTemplateMap,
} from "../types.js";

export type TemplateResolutionResult =
	| { ok: true; template: RuntimeTemplateDef }
	| { ok: false; message: string };

export function resolveDeliveryTemplate(
	delivery: Delivery,
	templateMap: RuntimeTemplateMap,
): TemplateResolutionResult {
	const template = templateMap
		.get(delivery.eventType)
		?.get(delivery.templateName);

	if (!template) {
		return {
			ok: false,
			message: `Template "${delivery.templateName}" not found for event "${delivery.eventType}". Register it in defineEvent("${delivery.eventType}", { templates: { "${delivery.templateName}": { ... } } }).`,
		};
	}

	return { ok: true, template };
}

export interface DeliveryChannelPlan {
	sendEmail: boolean;
	sendInApp: boolean;
}

export type DeliveryChannelPlanResult =
	| { ok: true; plan: DeliveryChannelPlan }
	| { ok: false; reason: "no_capable_channels" | "no_template_renderers" };

export function planDeliveryChannels(
	delivery: Delivery,
	runtimeChannels: RuntimeChannels,
	template: RuntimeTemplateDef,
): DeliveryChannelPlanResult {
	const sendEmail =
		delivery.channel === "email" && !!runtimeChannels.email && !!template.email;

	const sendInApp =
		delivery.channel === "inApp" &&
		runtimeChannels.inApp === true &&
		!!template.inApp;

	if (!sendEmail && !sendInApp) {
		const hasRenderers = !!template.email || !!template.inApp;
		return {
			ok: false,
			reason: hasRenderers ? "no_capable_channels" : "no_template_renderers",
		};
	}

	return { ok: true, plan: { sendEmail, sendInApp } };
}
