import type {
	Delivery,
	EventCompliancePolicy,
	HeraldDatabaseAdapter,
	ResolvedCompliancePolicy,
} from "../../types/index.js";
import {
	evaluateCompliance,
	resolveCompliancePolicy,
	type LegalBasisRegistry,
} from "../../compliance/index.js";
import type { RuntimeEventDef } from "./types.js";

export function defaultCompliancePolicy(
	eventName: string,
): EventCompliancePolicy {
	return { purpose: eventName, legalBasis: "contract" };
}

export function assertComplianceDb(
	db: HeraldDatabaseAdapter,
	policy: ResolvedCompliancePolicy,
): asserts db is HeraldDatabaseAdapter &
	Required<
		Pick<HeraldDatabaseAdapter, "getConsentEvents" | "findSuppression">
	> {
	if (policy.requiresConsentEvent && !db.getConsentEvents) {
		throw new Error(
			"[herald] The configured database adapter does not implement compliance consent methods required by this event.",
		);
	}
	if (policy.requiresSuppressionCheck && !db.findSuppression) {
		throw new Error(
			"[herald] The configured database adapter does not implement compliance suppression methods required by this event.",
		);
	}
}

export async function assertCanSendNow(
	delivery: Delivery,
	db: HeraldDatabaseAdapter,
	eventMap: Map<string, RuntimeEventDef>,
	legalBasisRegistry: LegalBasisRegistry,
): Promise<boolean> {
	// Only applies to scheduled deliveries
	if (!delivery.scheduledAt) return true;

	const policy = resolveScheduledCompliancePolicy(
		delivery,
		eventMap,
		legalBasisRegistry,
	);
	const checkedAt = new Date();

	if (delivery.bypassComplianceCheck) {
		if (delivery.complianceDecision !== "bypassed") {
			await db.updateDelivery(delivery.id, {
				purpose: policy.purpose,
				legalBasisAtSend: policy.legalBasis,
				complianceRequired: policy.required,
				complianceRequiresConsentEvent: policy.requiresConsentEvent,
				complianceRequiresSuppressionCheck: policy.requiresSuppressionCheck,
				complianceRequiresEvidence: policy.requiresEvidence,
				complianceDefaultDecision: policy.defaultDecision,
				complianceDecision: "bypassed",
				complianceCheckedAt: checkedAt,
			});
			await db.createAuditLog({
				userId: delivery.userId,
				action: "compliance.bypassed",
				eventType: delivery.eventType,
				deliveryId: delivery.id,
				metadata: {
					decision: "bypassed",
					channel: delivery.channel,
					purpose: policy.purpose,
					legalBasis: policy.legalBasis,
					firedAt: checkedAt.toISOString(),
				},
			});
		}
		return true;
	}

	assertComplianceDb(db, policy);
	const decision = await evaluateCompliance(
		{
			subjectId: delivery.userId,
			addressHash: delivery.addressHash ?? undefined,
			channel: delivery.channel,
			purpose: policy.purpose,
			legalBasis: policy.legalBasis,
			required: policy.required,
			requiresConsentEvent: policy.requiresConsentEvent,
			requiresSuppressionCheck: policy.requiresSuppressionCheck,
			requiresEvidence: policy.requiresEvidence,
			complianceEvidenceId: delivery.complianceEvidenceId ?? undefined,
			now: checkedAt,
		},
		db,
		registryForResolvedCompliancePolicy(policy),
	);

	if (!decision.allowed) {
		await db.updateDelivery(delivery.id, {
			status: "skipped",
			purpose: decision.purpose,
			legalBasisAtSend: decision.legalBasis,
			complianceRequired: policy.required,
			complianceRequiresConsentEvent: policy.requiresConsentEvent,
			complianceRequiresSuppressionCheck: policy.requiresSuppressionCheck,
			complianceRequiresEvidence: policy.requiresEvidence,
			complianceDefaultDecision: policy.defaultDecision,
			consentEventId: decision.consentEventId ?? null,
			suppressionId: decision.suppressionId ?? null,
			complianceDecision: decision.decision,
			complianceCheckedAt: decision.checkedAt,
		});
		await db.createAuditLog({
			userId: delivery.userId,
			action: "compliance.denied",
			eventType: delivery.eventType,
			deliveryId: delivery.id,
			metadata: {
				decision: decision.decision,
				reason: decision.reason,
				channel: delivery.channel,
				purpose: decision.purpose,
				legalBasis: decision.legalBasis,
				consentEventId: decision.consentEventId ?? null,
				suppressionId: decision.suppressionId ?? null,
				complianceEvidenceId: decision.complianceEvidenceId ?? null,
				checkedAt: decision.checkedAt.toISOString(),
			},
		});
		return false;
	}

	await db.updateDelivery(delivery.id, {
		purpose: decision.purpose,
		legalBasisAtSend: decision.legalBasis,
		complianceRequired: policy.required,
		complianceRequiresConsentEvent: policy.requiresConsentEvent,
		complianceRequiresSuppressionCheck: policy.requiresSuppressionCheck,
		complianceRequiresEvidence: policy.requiresEvidence,
		complianceDefaultDecision: policy.defaultDecision,
		consentEventId: decision.consentEventId ?? null,
		suppressionId: decision.suppressionId ?? null,
		complianceEvidenceId: decision.complianceEvidenceId ?? null,
		complianceDecision: decision.decision,
		complianceCheckedAt: decision.checkedAt,
	});

	return true;
}

function registryForResolvedCompliancePolicy(
	policy: ResolvedCompliancePolicy,
): LegalBasisRegistry {
	return {
		[policy.legalBasis]: {
			requiresConsentEvent: policy.requiresConsentEvent,
			requiresSuppressionCheck: policy.requiresSuppressionCheck,
			requiresEvidence: policy.requiresEvidence,
			defaultDecision: policy.defaultDecision,
		},
	};
}

function resolveScheduledCompliancePolicy(
	delivery: Delivery,
	eventMap: Map<string, RuntimeEventDef>,
	legalBasisRegistry: LegalBasisRegistry,
): ResolvedCompliancePolicy {
	if (delivery.purpose && delivery.legalBasisAtSend) {
		const definition = legalBasisRegistry[delivery.legalBasisAtSend];
		return {
			purpose: delivery.purpose,
			legalBasis: delivery.legalBasisAtSend,
			required: delivery.complianceRequired ?? false,
			requiresConsentEvent:
				delivery.complianceRequiresConsentEvent ??
				definition?.requiresConsentEvent ??
				false,
			requiresSuppressionCheck:
				delivery.complianceRequiresSuppressionCheck ??
				definition?.requiresSuppressionCheck ??
				false,
			requiresEvidence:
				delivery.complianceRequiresEvidence ??
				definition?.requiresEvidence ??
				false,
			defaultDecision:
				delivery.complianceDefaultDecision ??
				definition?.defaultDecision ??
				"allow",
		};
	}

	const eventDef = eventMap.get(delivery.eventType);
	const eventPolicy =
		eventDef?.compliance ??
		({
			purpose: delivery.purpose ?? delivery.eventType,
			legalBasis: delivery.legalBasisAtSend ?? "contract",
		} satisfies EventCompliancePolicy);
	return resolveCompliancePolicy(
		eventPolicy,
		delivery.channel,
		legalBasisRegistry,
	);
}
