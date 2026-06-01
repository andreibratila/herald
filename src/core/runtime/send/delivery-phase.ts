import type {
	Channel,
	Delivery,
	DeliveryStatus,
	HeraldDatabaseAdapter,
	Recipient,
	ResolvedCompliancePolicy,
	SendOptions,
} from "../../../types/index.js";
import type { SendComplianceDecision } from "./compliance-phase.js";

export interface DeliveryPhaseResult {
	delivery: Delivery;
	created: boolean;
}

export async function createSendDelivery({
	db,
	recipient,
	eventName,
	channel,
	options,
	isScheduled,
	bypassCompliance,
	policy,
	decision,
	reusableStatuses,
	createDeliveryIdempotentWithRetry,
}: {
	db: HeraldDatabaseAdapter;
	recipient: Recipient;
	eventName: string;
	channel: Channel;
	options: SendOptions;
	isScheduled: boolean;
	bypassCompliance: boolean;
	policy: ResolvedCompliancePolicy;
	decision: SendComplianceDecision & { allowed: true };
	reusableStatuses: readonly DeliveryStatus[];
	createDeliveryIdempotentWithRetry: (
		db: HeraldDatabaseAdapter,
		data: Omit<Delivery, "id" | "createdAt" | "updatedAt">,
		reusableStatuses: readonly DeliveryStatus[],
	) => Promise<{ delivery: Delivery; created: boolean }>;
}): Promise<DeliveryPhaseResult> {
	// Idempotency key includes the concrete channel.
	const idempotencyKey = options.idempotencyKey
		? `${options.idempotencyKey}:${recipient.to}:${channel}:${recipient.template}`
		: undefined;

	return createDeliveryIdempotentWithRetry(
		db,
		{
			userId: recipient.to,
			eventType: eventName,
			templateName: recipient.template,
			channel,
			status: isScheduled ? "scheduled" : "pending",
			attempts: 0,
			lastError: null,
			externalId: null,
			idempotencyKey: idempotencyKey ?? null,
			scheduledAt: options.scheduledAt ?? null,
			acceptedAt: null,
			failedAt: null,
			bypassComplianceCheck: bypassCompliance,
			addressHash: recipient.addressHash ?? null,
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
			complianceDecision:
				isScheduled && bypassCompliance ? null : decision.decision,
			complianceCheckedAt:
				isScheduled && bypassCompliance ? null : decision.checkedAt,
		},
		reusableStatuses,
	);
}

export async function auditCreatedDelivery({
	db,
	recipient,
	eventName,
	channel,
	options,
	isScheduled,
	bypassCompliance,
	delivery,
	policy,
	decision,
}: {
	db: HeraldDatabaseAdapter;
	recipient: Recipient;
	eventName: string;
	channel: Channel;
	options: SendOptions;
	isScheduled: boolean;
	bypassCompliance: boolean;
	delivery: Delivery;
	policy: ResolvedCompliancePolicy;
	decision: SendComplianceDecision & { allowed: true };
}): Promise<void> {
	if (bypassCompliance && !isScheduled) {
		await db.createAuditLog({
			userId: recipient.to,
			action: "compliance.bypassed",
			eventType: eventName,
			metadata: {
				decision: "bypassed",
				channel,
				purpose: policy.purpose,
				legalBasis: policy.legalBasis,
			},
		});
	}

	if (isScheduled) {
		// Audit: scheduled delivery created
		await db.createAuditLog({
			userId: recipient.to,
			action: "notification.scheduled",
			eventType: eventName,
			deliveryId: delivery.id,
			metadata: {
				scheduledAt: options.scheduledAt!.toISOString(),
				channel,
				purpose: decision.purpose,
				legalBasis: decision.legalBasis,
			},
		});
	}
}
