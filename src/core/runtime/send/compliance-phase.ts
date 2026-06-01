import type {
	Channel,
	ComplianceDecisionStatus,
	EventCompliancePolicy,
	HeraldConfig,
	HeraldDatabaseAdapter,
	Recipient,
	ResolvedCompliancePolicy,
	SendOptions,
} from "../../../types/index.js";
import {
	evaluateCompliance,
	resolveCompliancePolicy,
	type LegalBasisRegistry,
} from "../../../compliance/index.js";

export interface SendComplianceDecision {
	allowed: boolean;
	decision: ComplianceDecisionStatus;
	reason?: string;
	consentEventId?: string;
	suppressionId?: string;
	complianceEvidenceId?: string;
	legalBasis: string;
	purpose: string;
	channel: Channel;
	checkedAt: Date;
}

export type CompliancePhaseResult =
	| {
			ok: true;
			policy: ResolvedCompliancePolicy;
			decision: SendComplianceDecision & { allowed: true };
	  }
	| {
			ok: false;
			policy: ResolvedCompliancePolicy;
			decision: SendComplianceDecision & { allowed: false };
			reason: `compliance_denied:${string}`;
	  };

export async function resolveSendCompliance({
	db,
	hooks,
	recipient,
	eventName,
	channel,
	eventPolicy,
	legalBasisRegistry,
	bypassCompliance,
	options,
	assertComplianceDb,
	safeHook,
}: {
	db: HeraldDatabaseAdapter;
	hooks?: HeraldConfig["hooks"];
	recipient: Recipient;
	eventName: string;
	channel: Channel;
	eventPolicy: EventCompliancePolicy;
	legalBasisRegistry: LegalBasisRegistry;
	bypassCompliance: boolean;
	options: SendOptions;
	assertComplianceDb: (
		db: HeraldDatabaseAdapter,
		policy: ResolvedCompliancePolicy,
	) => void;
	safeHook: (fn: () => PromiseLike<void> | void) => Promise<void>;
}): Promise<CompliancePhaseResult> {
	const policy = resolveCompliancePolicy(
		eventPolicy,
		channel,
		legalBasisRegistry,
	);
	const checkedAt = new Date();
	const decision: SendComplianceDecision = bypassCompliance
		? {
				allowed: true,
				decision: "bypassed",
				legalBasis: policy.legalBasis,
				purpose: policy.purpose,
				channel,
				checkedAt,
			}
		: (assertComplianceDb(db, policy),
			await evaluateCompliance(
				{
					subjectId: recipient.to,
					addressHash: recipient.addressHash,
					channel,
					purpose: policy.purpose,
					legalBasis: policy.legalBasis,
					required: policy.required,
					requiresConsentEvent: policy.requiresConsentEvent,
					requiresSuppressionCheck: policy.requiresSuppressionCheck,
					requiresEvidence: policy.requiresEvidence,
					complianceEvidenceId: options.complianceEvidenceId,
					now: checkedAt,
				},
				db,
				legalBasisRegistry,
			));

	if (decision.allowed) {
		return {
			ok: true,
			policy,
			decision: decision as SendComplianceDecision & { allowed: true },
		};
	}

	await safeHook(() =>
		hooks?.onSkipped?.(
			recipient.to,
			eventName,
			`Compliance denied: ${decision.reason ?? "unknown"}`,
		),
	);
	await db.createAuditLog({
		userId: recipient.to,
		action: "compliance.denied",
		eventType: eventName,
		metadata: {
			decision: decision.decision,
			reason: decision.reason,
			channel,
			purpose: decision.purpose,
			legalBasis: decision.legalBasis,
			consentEventId: decision.consentEventId ?? null,
			suppressionId: decision.suppressionId ?? null,
			complianceEvidenceId: decision.complianceEvidenceId ?? null,
			checkedAt: decision.checkedAt.toISOString(),
		},
	});

	return {
		ok: false,
		policy,
		decision: decision as SendComplianceDecision & { allowed: false },
		reason: `compliance_denied:${decision.reason ?? "unknown"}`,
	};
}
