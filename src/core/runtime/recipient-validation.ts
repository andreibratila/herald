import type { Recipient } from "../../types/index.js";
import type { RuntimeTemplateDef } from "./types.js";

export function validateRecipientTemplateRenderers(
	eventName: string,
	recipients: Recipient[],
	templates: Record<string, RuntimeTemplateDef>,
): void {
	for (const recipient of recipients) {
		const template = templates[recipient.template];
		for (const channel of recipient.channels) {
			if (channel === "email" && !template?.email) {
				throw new Error(
					`[herald] Template "${recipient.template}" for event "${eventName}" has no renderer for channel "email".`,
				);
			}
			if (channel === "inApp" && !template?.inApp) {
				throw new Error(
					`[herald] Template "${recipient.template}" for event "${eventName}" has no renderer for channel "inApp".`,
				);
			}
		}
	}
}
