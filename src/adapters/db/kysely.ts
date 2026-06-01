// ============================================================
// herald — src/adapters/db/kysely.ts
// Official Kysely adapter (PostgreSQL SQL dialect)
//
// Setup: npx herald generate --adapter kysely
// Then add the generated types to your Kysely Database interface.
// ============================================================

import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";
import type {
	HeraldDatabaseAdapter,
	Notification,
	Delivery,
	Channel,
	DeliveryStatus,
	AuditLog,
	ComplianceExportData,
	ConsentEvent,
	Suppression,
} from "../../types/index.js";

// ─── Required additions to your Kysely Database interface ────
//
// import type { HeraldDatabase } from "herald/adapters/kysely"
// interface Database extends HeraldDatabase {
//   // your other tables...
// }

export interface HeraldNotificationTable {
	id: string;
	user_id: string;
	event_type: string;
	template_name: string;
	delivery_id: string | null;
	title: string;
	body: string | null;
	href: string | null;
	data: unknown | null;
	read_at: Date | null;
	created_at: Date;
}

export interface HeraldDeliveryTable {
	id: string;
	user_id: string;
	event_type: string;
	template_name: string;
	channel: string;
	status: string;
	attempts: number;
	last_error: string | null;
	external_id: string | null;
	idempotency_key: string | null;
	scheduled_at: Date | null;
	accepted_at: Date | null;
	failed_at: Date | null;
	claimed_at: Date | null;
	claim_expires_at: Date | null;
	claimed_by: string | null;
	resolve_attempts: number;
	bypass_compliance_check: boolean | null;
	queue_job_id: string | null;
	side_effects_completed_at: Date | null;
	rendered_hash: string | null;
	address_hash: string | null;
	purpose: string | null;
	legal_basis_at_send: string | null;
	consent_event_id: string | null;
	suppression_id: string | null;
	compliance_evidence_id: string | null;
	compliance_required: boolean | null;
	compliance_requires_consent_event: boolean | null;
	compliance_requires_suppression_check: boolean | null;
	compliance_requires_evidence: boolean | null;
	compliance_default_decision: string | null;
	compliance_decision: string | null;
	compliance_checked_at: Date | null;
	created_at: Date;
	updated_at: Date;
}

export interface HeraldConsentEventTable {
	id: string;
	subject_id: string;
	subject_type: string | null;
	channel: string;
	purpose: string;
	status: string;
	legal_basis: string;
	source: string;
	form_id: string | null;
	legal_notice_version_id: string | null;
	privacy_policy_version: string | null;
	checkbox_text_version: string | null;
	ip_hash: string | null;
	user_agent_hash: string | null;
	metadata: unknown | null;
	created_at: Date;
}

export interface HeraldSuppressionTable {
	id: string;
	address_hash: string;
	channel: string;
	purpose: string | null;
	reason: string;
	source: string | null;
	created_at: Date;
}

export interface HeraldAuditLogTable {
	id: string;
	user_id: string | null;
	action: string;
	event_type: string | null;
	delivery_id: string | null;
	metadata: unknown | null;
	created_at: Date;
}

/** Add to your Kysely Database interface */
export interface HeraldDatabase {
	herald_notifications: HeraldNotificationTable;
	herald_deliveries: HeraldDeliveryTable;
	herald_consent_events: HeraldConsentEventTable;
	herald_suppressions: HeraldSuppressionTable;
	herald_audit_logs: HeraldAuditLogTable;
}

export interface KyselyAdapterOptions {
	/**
	 * Resolve the email address for a userId.
	 * Required when using email channel.
	 *
	 * @example
	 * getUserEmail: (userId) =>
	 *   db.selectFrom("users")
	 *     .select("email")
	 *     .where("id", "=", userId)
	 *     .executeTakeFirst()
	 *     .then(r => r?.email ?? null)
	 */
	getUserEmail?: (userId: string) => Promise<string | null>;
}

let generatedIdSequence = 0;

function generateId(): string {
	generatedIdSequence = (generatedIdSequence + 1) % Number.MAX_SAFE_INTEGER;
	return [
		Date.now().toString(36).padStart(10, "0"),
		generatedIdSequence.toString(36).padStart(8, "0"),
		crypto.randomUUID(),
	].join("_");
}

// Map camelCase Notification to snake_case DB row
function jsonObject(
	value: unknown,
	column: string,
): Record<string, unknown> | null {
	if (value == null) return null;
	if (typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	throw new Error(
		`[herald] Kysely adapter expected ${column} to be a JSON object or null. Check that the column is JSON/JSONB and values are not pre-stringified.`,
	);
}

function toNotification(row: HeraldNotificationTable): Notification {
	return {
		id: row.id,
		userId: row.user_id,
		eventType: row.event_type,
		templateName: row.template_name,
		deliveryId: row.delivery_id,
		title: row.title,
		body: row.body,
		href: row.href,
		data: jsonObject(row.data, "herald_notifications.data"),
		readAt: row.read_at,
		createdAt: row.created_at,
	};
}

function toDelivery(row: HeraldDeliveryTable): Delivery {
	return {
		id: row.id,
		userId: row.user_id,
		eventType: row.event_type,
		templateName: row.template_name,
		channel: row.channel as Channel,
		status: row.status as DeliveryStatus,
		attempts: row.attempts,
		lastError: row.last_error,
		externalId: row.external_id,
		idempotencyKey: row.idempotency_key,
		scheduledAt: row.scheduled_at,
		acceptedAt: row.accepted_at,
		failedAt: row.failed_at,
		claimedAt: row.claimed_at ?? null,
		claimExpiresAt: row.claim_expires_at ?? null,
		claimedBy: row.claimed_by ?? null,
		resolveAttempts: row.resolve_attempts ?? 0,
		bypassComplianceCheck: row.bypass_compliance_check ?? null,
		queueJobId: row.queue_job_id ?? null,
		sideEffectsCompletedAt: row.side_effects_completed_at ?? null,
		renderedHash: row.rendered_hash ?? null,
		addressHash: row.address_hash ?? null,
		purpose: row.purpose ?? null,
		legalBasisAtSend: row.legal_basis_at_send ?? null,
		consentEventId: row.consent_event_id ?? null,
		suppressionId: row.suppression_id ?? null,
		complianceEvidenceId: row.compliance_evidence_id ?? null,
		complianceRequired: row.compliance_required ?? null,
		complianceRequiresConsentEvent:
			row.compliance_requires_consent_event ?? null,
		complianceRequiresSuppressionCheck:
			row.compliance_requires_suppression_check ?? null,
		complianceRequiresEvidence: row.compliance_requires_evidence ?? null,
		complianceDefaultDecision:
			(row.compliance_default_decision as Delivery["complianceDefaultDecision"]) ??
			null,
		complianceDecision:
			(row.compliance_decision as Delivery["complianceDecision"]) ?? null,
		complianceCheckedAt: row.compliance_checked_at ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toDeliveryInsert(
	data: Omit<Delivery, "id" | "createdAt" | "updatedAt">,
	now: Date,
): Omit<HeraldDeliveryTable, "id"> & { id: string } {
	return {
		id: generateId(),
		user_id: data.userId,
		event_type: data.eventType,
		template_name: data.templateName,
		channel: data.channel,
		status: data.status,
		attempts: data.attempts,
		last_error: data.lastError ?? null,
		external_id: data.externalId ?? null,
		idempotency_key: data.idempotencyKey ?? null,
		scheduled_at: data.scheduledAt ?? null,
		accepted_at: data.acceptedAt ?? null,
		failed_at: data.failedAt ?? null,
		claimed_at: data.claimedAt ?? null,
		claim_expires_at: data.claimExpiresAt ?? null,
		claimed_by: data.claimedBy ?? null,
		resolve_attempts: data.resolveAttempts ?? 0,
		bypass_compliance_check: data.bypassComplianceCheck ?? false,
		queue_job_id: data.queueJobId ?? null,
		address_hash: data.addressHash ?? null,
		side_effects_completed_at: data.sideEffectsCompletedAt ?? null,
		rendered_hash: data.renderedHash ?? null,
		purpose: data.purpose ?? null,
		legal_basis_at_send: data.legalBasisAtSend ?? null,
		consent_event_id: data.consentEventId ?? null,
		suppression_id: data.suppressionId ?? null,
		compliance_evidence_id: data.complianceEvidenceId ?? null,
		compliance_required: data.complianceRequired ?? null,
		compliance_requires_consent_event:
			data.complianceRequiresConsentEvent ?? null,
		compliance_requires_suppression_check:
			data.complianceRequiresSuppressionCheck ?? null,
		compliance_requires_evidence: data.complianceRequiresEvidence ?? null,
		compliance_default_decision: data.complianceDefaultDecision ?? null,
		compliance_decision: data.complianceDecision ?? null,
		compliance_checked_at: data.complianceCheckedAt ?? null,
		created_at: now,
		updated_at: now,
	};
}

function toConsentEvent(row: HeraldConsentEventTable): ConsentEvent {
	return {
		id: row.id,
		subjectId: row.subject_id,
		subjectType: row.subject_type as ConsentEvent["subjectType"],
		channel: row.channel as ConsentEvent["channel"],
		purpose: row.purpose,
		status: row.status as ConsentEvent["status"],
		legalBasis: row.legal_basis,
		source: row.source,
		formId: row.form_id,
		legalNoticeVersionId: row.legal_notice_version_id,
		privacyPolicyVersion: row.privacy_policy_version,
		checkboxTextVersion: row.checkbox_text_version,
		ipHash: row.ip_hash,
		userAgentHash: row.user_agent_hash,
		metadata: jsonObject(row.metadata, "herald_consent_events.metadata"),
		createdAt: row.created_at,
	};
}

function toSuppression(row: HeraldSuppressionTable): Suppression {
	return {
		id: row.id,
		addressHash: row.address_hash,
		channel: row.channel as Suppression["channel"],
		purpose: row.purpose,
		reason: row.reason as Suppression["reason"],
		source: row.source,
		createdAt: row.created_at,
	};
}

function toAuditLog(row: HeraldAuditLogTable): AuditLog {
	return {
		id: row.id,
		userId: row.user_id,
		action: row.action,
		eventType: row.event_type,
		deliveryId: row.delivery_id,
		metadata: jsonObject(row.metadata, "herald_audit_logs.metadata"),
		createdAt: row.created_at,
	};
}

export function createKyselyAdapter(
	db: Kysely<any>,
	opts: KyselyAdapterOptions = {},
): HeraldDatabaseAdapter {
	return {
		// ── Notifications ─────────────────────────────────────────

		async createNotification(data) {
			const row = await db
				.insertInto("herald_notifications")
				.values({
					id: generateId(),
					user_id: data.userId,
					event_type: data.eventType,
					template_name: data.templateName,
					delivery_id: data.deliveryId ?? null,
					title: data.title,
					body: data.body ?? null,
					href: data.href ?? null,
					data: data.data ?? null,
					read_at: null,
					created_at: new Date(),
				})
				.returningAll()
				.executeTakeFirstOrThrow();
			return toNotification(row as HeraldNotificationTable);
		},

		async getNotifications(userId, options = {}) {
			const rows = await db
				.selectFrom("herald_notifications")
				.selectAll()
				.where("user_id", "=", userId)
				.orderBy("created_at", "desc")
				.orderBy("id", "desc")
				.limit(options.limit ?? 20)
				.offset(options.offset ?? 0)
				.execute();
			return rows.map((r: any) => toNotification(r as HeraldNotificationTable));
		},

		async getUnreadNotifications(userId) {
			const rows = await db
				.selectFrom("herald_notifications")
				.selectAll()
				.where("user_id", "=", userId)
				.where("read_at", "is", null)
				.orderBy("created_at", "desc")
				.orderBy("id", "desc")
				.execute();
			return rows.map((r: any) => toNotification(r as HeraldNotificationTable));
		},

		async countUnread(userId) {
			const result = await db
				.selectFrom("herald_notifications")
				.select((eb: any) => eb.fn.count("id").as("count"))
				.where("user_id", "=", userId)
				.where("read_at", "is", null)
				.executeTakeFirst();
			return Number((result as any)?.count ?? 0);
		},

		async markRead(notificationId) {
			await db
				.updateTable("herald_notifications")
				.set({ read_at: new Date() })
				.where("id", "=", notificationId)
				.execute();
		},

		async markAllRead(userId) {
			await db
				.updateTable("herald_notifications")
				.set({ read_at: new Date() })
				.where("user_id", "=", userId)
				.where("read_at", "is", null)
				.execute();
		},

		async getNotificationByDeliveryId(deliveryId) {
			const row = await db
				.selectFrom("herald_notifications")
				.selectAll()
				.where("delivery_id", "=", deliveryId)
				.executeTakeFirst();
			return row ? toNotification(row as HeraldNotificationTable) : null;
		},

		// ── Deliveries ────────────────────────────────────────────

		async createDelivery(data) {
			const now = new Date();
			const row = await db
				.insertInto("herald_deliveries")
				.values(toDeliveryInsert(data, now))
				.returningAll()
				.executeTakeFirstOrThrow();
			return toDelivery(row as HeraldDeliveryTable);
		},

		async createDeliveryIdempotent(data, reusableStatuses) {
			const createFresh = async (executor: Kysely<any>) => {
				const now = new Date();
				const row = await executor
					.insertInto("herald_deliveries")
					.values(toDeliveryInsert(data, now))
					.returningAll()
					.executeTakeFirstOrThrow();
				return {
					delivery: toDelivery(row as HeraldDeliveryTable),
					created: true,
				};
			};
			if (!data.idempotencyKey) return createFresh(db);
			return db
				.transaction()
				.setIsolationLevel("serializable")
				.execute(async (tx) => {
					const existing = await tx
						.selectFrom("herald_deliveries")
						.selectAll()
						.where("idempotency_key", "=", data.idempotencyKey)
						.where("status", "in", [...reusableStatuses])
						.orderBy("updated_at", "desc")
						.orderBy("created_at", "desc")
						.orderBy("id", "desc")
						.executeTakeFirst();
					if (existing) {
						return {
							delivery: toDelivery(existing as HeraldDeliveryTable),
							created: false,
						};
					}
					return createFresh(tx as unknown as Kysely<any>);
				});
		},

		async updateDelivery(id, data) {
			const mapped: Record<string, any> = { updated_at: new Date() };
			if (data.status !== undefined) mapped.status = data.status;
			if (data.attempts !== undefined) mapped.attempts = data.attempts;
			if (data.lastError !== undefined) mapped.last_error = data.lastError;
			if (data.externalId !== undefined) mapped.external_id = data.externalId;
			if (data.acceptedAt !== undefined) mapped.accepted_at = data.acceptedAt;
			if (data.failedAt !== undefined) mapped.failed_at = data.failedAt;
			if (data.scheduledAt !== undefined)
				mapped.scheduled_at = data.scheduledAt;
			if (data.renderedHash !== undefined)
				mapped.rendered_hash = data.renderedHash;
			if (data.sideEffectsCompletedAt !== undefined)
				mapped.side_effects_completed_at = data.sideEffectsCompletedAt;
			if (data.queueJobId !== undefined) mapped.queue_job_id = data.queueJobId;
			if (data.resolveAttempts !== undefined)
				mapped.resolve_attempts = data.resolveAttempts;
			if (data.claimedAt !== undefined) mapped.claimed_at = data.claimedAt;
			if (data.claimExpiresAt !== undefined)
				mapped.claim_expires_at = data.claimExpiresAt;
			if (data.claimedBy !== undefined) mapped.claimed_by = data.claimedBy;
			if (data.addressHash !== undefined)
				mapped.address_hash = data.addressHash;
			if (data.purpose !== undefined) mapped.purpose = data.purpose;
			if (data.legalBasisAtSend !== undefined)
				mapped.legal_basis_at_send = data.legalBasisAtSend;
			if (data.consentEventId !== undefined)
				mapped.consent_event_id = data.consentEventId;
			if (data.suppressionId !== undefined)
				mapped.suppression_id = data.suppressionId;
			if (data.complianceEvidenceId !== undefined)
				mapped.compliance_evidence_id = data.complianceEvidenceId;
			if (data.complianceRequired !== undefined)
				mapped.compliance_required = data.complianceRequired;
			if (data.complianceRequiresConsentEvent !== undefined)
				mapped.compliance_requires_consent_event =
					data.complianceRequiresConsentEvent;
			if (data.complianceRequiresSuppressionCheck !== undefined)
				mapped.compliance_requires_suppression_check =
					data.complianceRequiresSuppressionCheck;
			if (data.complianceRequiresEvidence !== undefined)
				mapped.compliance_requires_evidence = data.complianceRequiresEvidence;
			if (data.complianceDefaultDecision !== undefined)
				mapped.compliance_default_decision = data.complianceDefaultDecision;
			if (data.complianceDecision !== undefined)
				mapped.compliance_decision = data.complianceDecision;
			if (data.complianceCheckedAt !== undefined)
				mapped.compliance_checked_at = data.complianceCheckedAt;

			const row = await db
				.updateTable("herald_deliveries")
				.set(mapped)
				.where("id", "=", id)
				.returningAll()
				.executeTakeFirstOrThrow();
			return toDelivery(row as HeraldDeliveryTable);
		},

		async getDelivery(id) {
			const row = await db
				.selectFrom("herald_deliveries")
				.selectAll()
				.where("id", "=", id)
				.executeTakeFirst();
			return row ? toDelivery(row as HeraldDeliveryTable) : null;
		},

		async getDeliveryByIdempotencyKey(key) {
			const reusable = await db
				.selectFrom("herald_deliveries")
				.selectAll()
				.where("idempotency_key", "=", key)
				.where("status", "in", [
					"pending",
					"scheduled",
					"claimed",
					"dispatched",
					"retrying",
					"accepted",
				])
				.orderBy("updated_at", "desc")
				.orderBy("created_at", "desc")
				.orderBy("id", "desc")
				.executeTakeFirst();
			return reusable ? toDelivery(reusable as HeraldDeliveryTable) : null;
		},

		async getDeliveriesByUser(userId, options = {}) {
			const rows = await db
				.selectFrom("herald_deliveries")
				.selectAll()
				.where("user_id", "=", userId)
				.orderBy("created_at", "desc")
				.orderBy("id", "desc")
				.limit(options.limit ?? 20)
				.offset(options.offset ?? 0)
				.execute();
			return rows.map((r) => toDelivery(r as HeraldDeliveryTable));
		},

		// ── Compliance evidence ───────────────────────────────────

		async createConsentEvent(data) {
			const now = data.createdAt ?? new Date();
			const row = await db
				.insertInto("herald_consent_events")
				.values({
					id: generateId(),
					subject_id: data.subjectId,
					subject_type: data.subjectType ?? null,
					channel: data.channel,
					purpose: data.purpose,
					status: data.status,
					legal_basis: data.legalBasis,
					source: data.source,
					form_id: data.formId ?? null,
					legal_notice_version_id: data.legalNoticeVersionId ?? null,
					privacy_policy_version: data.privacyPolicyVersion ?? null,
					checkbox_text_version: data.checkboxTextVersion ?? null,
					ip_hash: data.ipHash ?? null,
					user_agent_hash: data.userAgentHash ?? null,
					metadata: data.metadata ?? null,
					created_at: now,
				})
				.returningAll()
				.executeTakeFirstOrThrow();
			return toConsentEvent(row as HeraldConsentEventTable);
		},

		async getConsentEvents(input) {
			let query = db
				.selectFrom("herald_consent_events")
				.selectAll()
				.where("subject_id", "=", input.subjectId);
			if (input.channel) query = query.where("channel", "=", input.channel);
			if (input.purpose) query = query.where("purpose", "=", input.purpose);
			const rows = await query
				.orderBy("created_at", "desc")
				.orderBy("id", "desc")
				.execute();
			return rows.map((r: any) => toConsentEvent(r as HeraldConsentEventTable));
		},

		async createSuppression(data) {
			const now = data.createdAt ?? new Date();
			const row = await db
				.insertInto("herald_suppressions")
				.values({
					id: generateId(),
					address_hash: data.addressHash,
					channel: data.channel,
					purpose: data.purpose ?? null,
					reason: data.reason,
					source: data.source ?? null,
					created_at: now,
				})
				.returningAll()
				.executeTakeFirstOrThrow();
			return toSuppression(row as HeraldSuppressionTable);
		},

		async findSuppression(input) {
			if (input.purpose != null) {
				const specific = await db
					.selectFrom("herald_suppressions")
					.selectAll()
					.where("address_hash", "=", input.addressHash)
					.where("channel", "=", input.channel)
					.where("purpose", "=", input.purpose)
					.orderBy("created_at", "desc")
					.orderBy("id", "desc")
					.executeTakeFirst();
				if (specific) return toSuppression(specific as HeraldSuppressionTable);
			}
			const global = await db
				.selectFrom("herald_suppressions")
				.selectAll()
				.where("address_hash", "=", input.addressHash)
				.where("channel", "=", input.channel)
				.where("purpose", "is", null)
				.orderBy("created_at", "desc")
				.orderBy("id", "desc")
				.executeTakeFirst();
			return global ? toSuppression(global as HeraldSuppressionTable) : null;
		},

		// ── Audit log ─────────────────────────────────────────────

		async createAuditLog(data) {
			const row = await db
				.insertInto("herald_audit_logs")
				.values({
					id: generateId(),
					user_id: data.userId ?? null,
					action: data.action,
					event_type: data.eventType ?? null,
					delivery_id: data.deliveryId ?? null,
					metadata: data.metadata ?? null,
					created_at: new Date(),
				})
				.returningAll()
				.executeTakeFirstOrThrow();
			return toAuditLog(row as HeraldAuditLogTable);
		},

		async getAuditLogs(userId, options = {}) {
			const rows = await db
				.selectFrom("herald_audit_logs")
				.selectAll()
				.where("user_id", "=", userId)
				.orderBy("created_at", "desc")
				.orderBy("id", "desc")
				.limit(options.limit ?? 50)
				.execute();
			return rows.map((r: any) => toAuditLog(r as HeraldAuditLogTable));
		},

		// ── Compliance lifecycle ─────────────────────────────────

		async eraseSubject(userId) {
			const erasedId = `erased_${crypto.randomUUID()}`;
			const now = new Date();

			// Compute SHA-256 hash of userId for audit log (no PII stored)
			let userIdHash: string;
			if (typeof globalThis.crypto !== "undefined") {
				const encoder = new TextEncoder();
				const data = encoder.encode(userId);
				const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
				userIdHash = Array.from(new Uint8Array(hash))
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("");
			} else {
				/* v8 ignore next 2 */
				const { createHash } = await import("crypto");
				userIdHash = createHash("sha256").update(userId).digest("hex");
			}

			await db.transaction().execute(async (trx: Transaction<any>) => {
				// Anonymize deliveries and scrub userId from scoped idempotency keys.
				await trx
					.updateTable("herald_deliveries")
					.set({
						user_id: erasedId,
						idempotency_key: sql`CASE WHEN idempotency_key IS NULL THEN NULL ELSE replace(idempotency_key, ${userId}, ${userIdHash}) END`,
					})
					.where("user_id", "=", userId)
					.execute();

				// Anonymize notifications
				await trx
					.updateTable("herald_notifications")
					.set({
						user_id: erasedId,
						title: "[redacted]",
						body: "[redacted]",
						data: null,
						href: null,
					})
					.where("user_id", "=", userId)
					.execute();

				// Anonymize append-only consent evidence with a stable hash for audit cross-reference.
				await trx
					.updateTable("herald_consent_events")
					.set({ subject_id: userIdHash })
					.where("subject_id", "=", userId)
					.execute();

				// Anonymize existing audit logs with the same stable hash.
				await trx
					.updateTable("herald_audit_logs")
					.set({ user_id: userIdHash })
					.where("user_id", "=", userId)
					.execute();

				// Audit log inside transaction — rolls back on any failure
				await trx
					.insertInto("herald_audit_logs")
					.values({
						id: generateId(),
						user_id: userIdHash,
						action: "compliance.erase",
						event_type: null,
						delivery_id: null,
						metadata: {
							userIdHash,
							erasedAt: now.toISOString(),
						},
						created_at: now,
					})
					.execute();
			});
		},

		async exportUser(userId) {
			const [notifications, deliveries, consentEvents, auditLogs] =
				await Promise.all([
					db
						.selectFrom("herald_notifications")
						.selectAll()
						.where("user_id", "=", userId)
						.orderBy("created_at", "desc")
						.execute()
						.then((r: any[]) => r.map((x) => toNotification(x))),
					db
						.selectFrom("herald_deliveries")
						.selectAll()
						.where("user_id", "=", userId)
						.orderBy("created_at", "desc")
						.execute()
						.then((r: any[]) => r.map((x) => toDelivery(x))),
					db
						.selectFrom("herald_consent_events")
						.selectAll()
						.where("subject_id", "=", userId)
						.orderBy("created_at", "desc")
						.execute()
						.then((r: any[]) => r.map((x) => toConsentEvent(x))),
					db
						.selectFrom("herald_audit_logs")
						.selectAll()
						.where("user_id", "=", userId)
						.orderBy("created_at", "desc")
						.execute()
						.then((r: any[]) => r.map((x) => toAuditLog(x))),
				]);

			return {
				userId,
				exportedAt: new Date(),
				notifications,
				deliveries,
				consentEvents,
				// Suppressions are address-hash scoped, not subject-scoped.
				suppressions: [],
				auditLogs,
			} as ComplianceExportData;
		},

		async claimScheduledBatch(before, workerId, limit, leaseMs) {
			// Atomic claim via raw SQL: lock the ordered candidate rowset first,
			// then assign ordinals separately because PostgreSQL does not allow
			// FOR UPDATE in the same SELECT as window functions.
			const rows = await sql`
        WITH locked_candidates AS (
          SELECT id, scheduled_at
          FROM herald_deliveries
          WHERE
            (status = 'scheduled' AND scheduled_at <= ${before})
            OR (status = 'claimed' AND claim_expires_at < NOW())
          ORDER BY scheduled_at ASC, id DESC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        ), candidates AS (
          SELECT
            id,
            row_number() OVER (ORDER BY scheduled_at ASC, id DESC) AS claim_order
          FROM locked_candidates
        ), updated AS (
          UPDATE herald_deliveries
          SET
            status = 'claimed',
            claimed_at = NOW(),
            claim_expires_at = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
            claimed_by = ${workerId},
            updated_at = NOW()
          WHERE id IN (SELECT id FROM candidates)
          RETURNING *
        )
        SELECT updated.*
        FROM updated
        JOIN candidates ON candidates.id = updated.id
        ORDER BY candidates.claim_order ASC
      `.execute(db);
			return (rows.rows as any[]).map(toDelivery);
		},

		async cancelScheduledDeliveries(userId) {
			const rows = await sql`
        UPDATE herald_deliveries
        SET status = 'redacted', updated_at = NOW()
        WHERE user_id = ${userId}
          AND status IN ('scheduled', 'claimed')
        RETURNING id, queue_job_id
      `.execute(db);
			return (rows.rows as any[]).map((r: any) => ({
				id: r.id as string,
				queueJobId: (r.queue_job_id ?? null) as string | null,
			}));
		},

		async findAuditLogByAction(userId, action) {
			const row = await db
				.selectFrom("herald_audit_logs")
				.selectAll()
				.where("user_id", "=", userId)
				.where("action", "=", action)
				.orderBy("created_at", "desc")
				.orderBy("id", "desc")
				.limit(1)
				.executeTakeFirst();
			return row ? toAuditLog(row as any) : null;
		},

		async purgeExpiredDeliveries(olderThan) {
			const result = await db
				.deleteFrom("herald_deliveries")
				.where("created_at", "<", olderThan)
				.where("status", "not in", ["scheduled", "claimed", "retrying"])
				.executeTakeFirst();
			return Number(result.numDeletedRows ?? 0);
		},

		async purgeExpiredAuditLogs(olderThan) {
			const result = await db
				.deleteFrom("herald_audit_logs")
				.where("created_at", "<", olderThan)
				.executeTakeFirst();
			return Number(result.numDeletedRows ?? 0);
		},

		// ── User resolution ───────────────────────────────────────

		async getUserEmail(userId) {
			if (opts.getUserEmail) return opts.getUserEmail(userId);
			throw new Error(
				"[herald] Kysely adapter: getUserEmail not configured. " +
					"Pass it as the second argument to createKyselyAdapter().\n" +
					"Example: createKyselyAdapter(db, {\n" +
					'  getUserEmail: (id) => db.selectFrom("users")\n' +
					'    .select("email").where("id", "=", id)\n' +
					"    .executeTakeFirst().then(r => r?.email ?? null)\n" +
					"})",
			);
		},
	};
}
