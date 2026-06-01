// ============================================================
// herald — src/core/define.ts
// defineEvent() — internal event-ref factory used by the configured API
// ============================================================

import type {
	HeraldSchema,
	EventDefinition,
	TemplateDefinition,
	EventRef,
	InferSchema,
	Recipient,
} from "../types/index.js";

// Re-export for convenience
export type { EventRef };

// No module-level registries. Registries are per runtime instance.

// ─── defineEvent — pure factory ──────────────────────────────

/**
 * Define a notification event and return an EventRef.
 *
 * Pure factory — no global side effects. The public documented path is
 * `configureHerald(...).defineEvent(...)`; that configured wrapper calls this
 * factory internally, brands the ref with its app scope, and later registers it
 * via `heraldApp.create({ events: { eventKey: ref } })`.
 *
 * The dispatch function is pure and synchronous — resolve all data
 * (e.g. admin user IDs) before calling generated `herald.events.*` methods,
 * not inside dispatch.
 */
export function defineEvent<
	const TName extends string,
	TSchema extends HeraldSchema<unknown>,
	TTemplates extends Record<
		string,
		TemplateDefinition<InferSchema<TSchema>>
	> = Record<string, TemplateDefinition<InferSchema<TSchema>>>,
>(
	name: TName,
	definition: EventDefinition<TSchema, InferSchema<TSchema>, TTemplates>,
): EventRef<TName, TSchema, TTemplates> {
	// Pure factory — no global write. Duplicate stable-name detection happens when a runtime instance is created.
	// Apply persistedFields default so downstream code receives a concrete array.
	return {
		name,
		definition: {
			...definition,
			persistedFields: definition.persistedFields ?? [],
		},
	};
}

// ─── Validation helpers (internal) ───────────────────────────

export function validateRecipients(
	eventName: string,
	recipients: Recipient[],
	templateMap?: Map<string, unknown>,
): void {
	if (!Array.isArray(recipients)) {
		throw new Error(
			`[herald] Event "${eventName}" dispatch must return an array of recipients.`,
		);
	}
	for (const r of recipients) {
		if (!r.to) {
			throw new Error(
				`[herald] Event "${eventName}" dispatch returned a recipient with no "to" field.`,
			);
		}
		if (!r.template) {
			throw new Error(
				`[herald] Event "${eventName}" dispatch returned a recipient with no "template" field.`,
			);
		}
		const channels = (r as { channels?: unknown; channel?: unknown }).channels;
		if (!Array.isArray(channels) || channels.length === 0) {
			throw new Error(
				`[herald] Event "${eventName}" dispatch returned a recipient with no non-empty "channels" array. Use channels: ["email"] instead of channel or "both".`,
			);
		}
		for (const channel of channels) {
			if (!["email", "inApp"].includes(channel)) {
				throw new Error(
					`[herald] Event "${eventName}" dispatch returned invalid channel "${String(channel)}". Must be one of: "email", "inApp".`,
				);
			}
		}
		// Check against instance template map when provided
		if (!templateMap) continue;
		const template = templateMap.get(r.template);
		if (!template) {
			throw new Error(
				`[herald] Template "${r.template}" referenced in event "${eventName}" is not registered. Add it to the templates map in defineEvent("${eventName}", { templates: { ... } }).`,
			);
		}
	}
}
