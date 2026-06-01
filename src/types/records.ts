import type { Channel } from "./channels.js";
import type {
	ComplianceDecisionStatus,
	ConsentEvent,
	LegalBasisDefinition,
	LegalBasisKey,
	Suppression,
} from "./compliance.js";

// ─── Delivery status ─────────────────────────────────────────

export type DeliveryStatus =
	| "pending"
	| "dispatched"
	| "accepted"
	| "failed"
	| "retrying"
	| "skipped" // no consent / capability disabled
	| "redacted" // compliance-erased
	| "scheduled" // awaiting scheduled dispatch time
	| "claimed"; // atomically locked by a worker between tick invocations

// ─── Notification (in-app record) ────────────────────────────

export interface Notification {
	id: string;
	userId: string;
	eventType: string;
	templateName: string;
	deliveryId?: string | null;
	title: string;
	body?: string | null;
	href?: string | null;
	/** Non-PII data only — filtered via safeFields */
	data?: Record<string, unknown> | null;
	readAt?: Date | null;
	createdAt: Date;
}

// ─── Delivery record ─────────────────────────────────────────

export interface Delivery {
	id: string;
	userId: string;
	eventType: string;
	templateName: string;
	channel: Channel;
	status: DeliveryStatus;
	attempts: number;
	lastError?: string | null;
	/** External message ID from mail provider */
	externalId?: string | null;
	/** Idempotency key to prevent duplicate sends */
	idempotencyKey?: string | null;
	scheduledAt?: Date | null;
	acceptedAt?: Date | null;
	failedAt?: Date | null;
	/** When a worker claimed this delivery row */
	claimedAt?: Date | null;
	/** Lease expiry — if past, re-claimable by another worker */
	claimExpiresAt?: Date | null;
	/** Worker ID string that holds the claim (e.g. hostname:pid) */
	claimedBy?: string | null;
	/** Count of resolvePayload failures */
	resolveAttempts?: number;
	/** Skip compliance checks at send/fire time for this delivery. */
	bypassComplianceCheck?: boolean | null;
	/** pg-boss job ID — for cancelJobs lookup */
	queueJobId?: string | null;
	/** App-supplied hashed address snapshot used for scheduled fire-time suppression checks. */
	addressHash?: string | null;
	/** Set after email+inApp accepted, before updateDelivery("accepted") — idempotency guard */
	sideEffectsCompletedAt?: Date | null;
	/**
	 * SHA-256 hex of `subject + "\0" + html` after rendering.
	 * Null for inApp-only or failed-pre-render deliveries.
	 * Written in the same updateDelivery call as externalId.
	 */
	renderedHash?: string | null;
	/** Compliance purpose snapshot used for audit reconstruction. */
	purpose?: string | null;
	/** Legal basis snapshot at send/fire time. */
	legalBasisAtSend?: LegalBasisKey | null;
	/** Consent event that authorized this delivery, when applicable. */
	consentEventId?: string | null;
	/** Suppression record that denied this delivery, when applicable. */
	suppressionId?: string | null;
	/** App-owned evidence reference that justified an evidence-required legal basis. */
	complianceEvidenceId?: string | null;
	/** Resolved compliance policy snapshot captured at send/schedule time. */
	complianceRequired?: boolean | null;
	complianceRequiresConsentEvent?: boolean | null;
	complianceRequiresSuppressionCheck?: boolean | null;
	complianceRequiresEvidence?: boolean | null;
	complianceDefaultDecision?: LegalBasisDefinition["defaultDecision"] | null;
	/** Compliance decision stored when a delivery row exists. */
	complianceDecision?: ComplianceDecisionStatus | null;
	/** When compliance was evaluated for this delivery. */
	complianceCheckedAt?: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

// ─── Audit and compliance export ─────────────────────────────

export interface AuditLog {
	id: string;
	userId?: string | null;
	/** e.g. "notification.accepted" | "notification.failed" | "compliance.erase" */
	action: string;
	eventType?: string | null;
	deliveryId?: string | null;
	/** Non-PII metadata only */
	metadata?: Record<string, unknown> | null;
	createdAt: Date;
}

export interface ComplianceExportData {
	userId: string;
	exportedAt: Date;
	notifications: Notification[];
	deliveries: Delivery[];
	consentEvents: ConsentEvent[];
	/** Address-hash scoped records only when the adapter can safely associate them with the subject. */
	suppressions: Suppression[];
	auditLogs: AuditLog[];
}
