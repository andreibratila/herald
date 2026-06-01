import type { Except, SetOptional } from "type-fest";
import type { Channel } from "./channels.js";

// ─── Compliance policy vocabulary ───────────────────────────

export type LegalBasisKey = string;

export type ComplianceDecisionStatus = "allowed" | "denied" | "bypassed";

export interface LegalBasisMinimumRequirements {
	/** If true, event/channel policies cannot set requiresConsentEvent=false. */
	consentEvent?: boolean;
	/** If true, event/channel policies cannot set requiresSuppressionCheck=false. */
	suppressionCheck?: boolean;
	/** If true, event/channel policies cannot set requiresEvidence=false. */
	evidence?: boolean;
}

export interface LegalBasisDefinition {
	label?: string;
	requiresConsentEvent: boolean;
	requiresSuppressionCheck: boolean;
	requiresEvidence?: boolean;
	defaultDecision: "allow" | "deny_without_evidence";
	/** Minimum non-relaxable requirements for event/channel refinements. */
	minimumRequirements?: LegalBasisMinimumRequirements;
}

export interface ChannelCompliancePolicy {
	legalBasis?: LegalBasisKey;
	required?: boolean;
	requiresConsentEvent?: boolean;
	requiresSuppressionCheck?: boolean;
	requiresEvidence?: boolean;
}

export interface EventCompliancePolicy {
	purpose: string;
	legalBasis: LegalBasisKey;
	required?: boolean;
	requiresConsentEvent?: boolean;
	requiresSuppressionCheck?: boolean;
	requiresEvidence?: boolean;
	channels?: Partial<Record<Channel, ChannelCompliancePolicy>>;
}

export interface ResolvedCompliancePolicy {
	purpose: string;
	legalBasis: LegalBasisKey;
	required: boolean;
	requiresConsentEvent: boolean;
	requiresSuppressionCheck: boolean;
	requiresEvidence: boolean;
	defaultDecision: LegalBasisDefinition["defaultDecision"];
}

export type ConsentStatus = "granted" | "withdrawn";

export interface ConsentEvent {
	id: string;
	subjectId: string;
	subjectType?: "user" | "contact";
	channel: Channel;
	purpose: string;
	status: ConsentStatus;
	legalBasis: LegalBasisKey;
	source: string;
	formId?: string | null;
	legalNoticeVersionId?: string | null;
	privacyPolicyVersion?: string | null;
	checkboxTextVersion?: string | null;
	ipHash?: string | null;
	userAgentHash?: string | null;
	metadata?: Record<string, unknown> | null;
	createdAt: Date;
}

export interface Suppression {
	id: string;
	addressHash: string;
	channel: Channel;
	purpose?: string | null;
	reason: "unsubscribe" | "spam_complaint" | "hard_bounce" | "manual" | "legal";
	source?: string | null;
	createdAt: Date;
}

export interface ComplianceDecision {
	allowed: boolean;
	decision: ComplianceDecisionStatus;
	reason?: string;
	consentEventId?: string;
	suppressionId?: string;
	/** App-owned evidence reference that justified an evidence-required legal basis. */
	complianceEvidenceId?: string;
	legalBasis: LegalBasisKey;
	purpose: string;
	channel: Channel;
	checkedAt: Date;
}

export interface ComplianceCheckInput {
	subjectId: string;
	addressHash?: string;
	channel: Channel;
	purpose: string;
	legalBasis: LegalBasisKey;
	required?: boolean;
	requiresConsentEvent?: boolean;
	requiresSuppressionCheck?: boolean;
	requiresEvidence?: boolean;
	/** App-owned evidence reference for legal bases that require evidence. */
	complianceEvidenceId?: string;
	now?: Date;
}

export type CreateConsentEventInput = SetOptional<
	Except<ConsentEvent, "id">,
	"createdAt"
>;

export type CreateSuppressionInput = SetOptional<
	Except<Suppression, "id">,
	"createdAt"
>;

export interface ComplianceDatabaseAdapter {
	createConsentEvent(data: CreateConsentEventInput): Promise<ConsentEvent>;
	getConsentEvents(input: {
		subjectId: string;
		channel?: Channel;
		purpose?: string;
	}): Promise<ConsentEvent[]>;
	createSuppression(data: CreateSuppressionInput): Promise<Suppression>;
	findSuppression(input: {
		addressHash: string;
		channel: Channel;
		purpose?: string;
	}): Promise<Suppression | null>;
}

export interface HeraldRetentionConfig {
	/**
	 * How long to keep delivery records before auto-purge.
	 * Default: "90d"
	 */
	deliveryRetention?: `${number}d` | `${number}y`;
	/**
	 * How long to keep audit logs.
	 * Default: "2y".
	 */
	auditLogRetention?: `${number}d` | `${number}y`;
	/**
	 * Auto-purge expired records on startup.
	 * Default: true
	 */
	autoPurge?: boolean;
}

export interface HeraldComplianceConfig {
	/**
	 * Custom legal-basis definitions. By default these extend/override Herald's built-ins.
	 * Set `replaceDefaultLegalBases: true` to opt into a closed registry.
	 */
	legalBases?: Record<LegalBasisKey, LegalBasisDefinition>;
	replaceDefaultLegalBases?: boolean;
	/** Require every event to declare an explicit compliance policy. */
	requireExplicitEventCompliance?: boolean;
	retention?: HeraldRetentionConfig;
}
