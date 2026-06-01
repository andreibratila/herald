import type { Channel } from "./channels.js";
import type { EventCompliancePolicy } from "./compliance.js";
import type { Delivery } from "./records.js";
import type { HeraldSchema, InferSchema } from "./schema.js";

// ─── Recipient ───────────────────────────────────────────────

export interface Recipient {
	/** userId in your system */
	to: string;
	/** Concrete delivery channels. Use multiple entries instead of synthetic "both". */
	channels: Channel[];
	/** App-supplied hashed address used for suppression checks on external channels. */
	addressHash?: string;
	/** Must match a registered template name */
	template: string;
}

// ─── Event definition ────────────────────────────────────────

export interface EventDefinition<
	TSchema extends HeraldSchema<unknown>,
	TPayload = InferSchema<TSchema>,
	TTemplates extends Record<string, TemplateDefinition<TPayload>> = Record<
		string,
		TemplateDefinition<TPayload>
	>,
> {
	schema: TSchema;
	/**
	 * Fields from payload that are safe to persist in the DB.
	 * Everything else is kept in memory only — never written to DB.
	 * This is the PII-safe default. Example: ["orderId", "amount"]
	 */
	safeFields?: (keyof TPayload)[];
	/** Compliance policy for this event. Configured apps require this per event. */
	compliance?: EventCompliancePolicy;
	/**
	 * Templates owned by this event. Keys are template names referenced in dispatch().
	 */
	templates: TTemplates;
	/**
	 * Pure synchronous function — receives typed payload, returns recipient list.
	 * Do NOT do async work here. Resolve all data before calling generated `herald.events.*` methods.
	 */
	dispatch(payload: TPayload): Array<{
		to: string;
		channels: Channel[];
		addressHash?: string;
		template: keyof TTemplates & string;
	}>;
	/**
	 * Async function that reconstructs the full payload from a persisted Delivery record.
	 * Required when using scheduledAt — Herald calls this at fire time to retrieve the payload
	 * without storing PII in the DB or job queue long-term.
	 *
	 * @example
	 * resolvePayload: async (delivery) => fetchOrderById(delivery.id)
	 */
	resolvePayload?: (delivery: Delivery) => Promise<Record<string, unknown>>;
}

// ─── Template definition ─────────────────────────────────────

export interface EmailTemplate {
	subject: string;
	html: string;
	text?: string;
	/** Override defaultFrom for this specific template */
	from?: string;
}

export interface InAppTemplate {
	title: string;
	body?: string;
	/** Non-PII data attached to the notification (respects safeFields) */
	data?: Record<string, unknown>;
	/** URL to navigate to when the notification is clicked */
	href?: string;
}

export interface TemplateDefinition<TPayload> {
	email?: (payload: TPayload) => EmailTemplate;
	inApp?: (payload: TPayload) => InAppTemplate;
}

// ─── Per-instance registry refs ──────────────────────────────
// Pure factory return values — no global side effects

/**
 * Wildcard EventRef for constraint and default positions.
 * The second param uses `any` intentionally — TemplateDefinition is contravariant
 * (payload is a function parameter), so TemplateDefinition<unknown> would break
 * inference for concrete event maps.
 */
export type AnyEventRef = EventRef<string, HeraldSchema<any>, any>;

export type EventRefMap = Record<string, AnyEventRef>;

export interface EventRef<
	TName extends string,
	TSchema extends HeraldSchema<unknown>,
	TTemplates extends Record<
		string,
		TemplateDefinition<InferSchema<TSchema>>
	> = Record<string, TemplateDefinition<InferSchema<TSchema>>>,
> {
	name: TName;
	definition: EventDefinition<TSchema, InferSchema<TSchema>, TTemplates>;
}

// ─── Send options ────────────────────────────────────────────

export interface SendOptions {
	/**
	 * If provided, Herald won't dispatch the same event twice with the same key.
	 * Internally scoped per userId + concrete channel + template to allow fan-out without false deduplication.
	 */
	idempotencyKey?: string;
	/**
	 * Skip compliance checks for this specific send.
	 * Use only for system-critical notifications (password resets, security alerts).
	 */
	bypassComplianceCheck?: boolean;
	/**
	 * App-owned evidence reference for evidence-required legal bases.
	 * Herald stores the reference only; the evidence system remains application-owned.
	 */
	complianceEvidenceId?: string;
	/**
	 * Earliest UTC Date at which this delivery should be dispatched.
	 * When provided, the delivery is created with status "scheduled" and
	 * is not immediately enqueued (sync driver) or enqueued with startAfter (db driver).
	 * Requires the event to have a `resolvePayload` registered.
	 */
	scheduledAt?: Date;
}
