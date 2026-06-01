// ============================================================
// herald — src/compliance/index.ts
// Legal-basis policy presets and validation helpers.
// ============================================================

import type {
	Channel,
	ChannelCompliancePolicy,
	ComplianceCheckInput,
	ComplianceDatabaseAdapter,
	ComplianceDecision,
	ConsentEvent,
	EventCompliancePolicy,
	LegalBasisDefinition,
	LegalBasisKey,
	ResolvedCompliancePolicy,
} from "../types/index.js";

export type LegalBasisRegistry = Record<LegalBasisKey, LegalBasisDefinition>;

export async function hashSubjectId(subjectId: string): Promise<string> {
	if (typeof globalThis.crypto !== "undefined") {
		const encoder = new TextEncoder();
		const data = encoder.encode(subjectId);
		const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
		return Array.from(new Uint8Array(hash))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}
	/* v8 ignore next 2 */
	const { createHash } = await import("node:crypto");
	return createHash("sha256").update(subjectId).digest("hex");
}

function defineLegalBases<const T extends LegalBasisRegistry>(bases: T): T {
	return bases;
}

export const legalBases = {
	defaults: defineLegalBases({
		consent: {
			label: "Consent",
			requiresConsentEvent: true,
			requiresSuppressionCheck: true,
			requiresEvidence: false,
			defaultDecision: "deny_without_evidence",
			minimumRequirements: {
				consentEvent: true,
				suppressionCheck: true,
			},
		},
		contract: {
			label: "Contract",
			requiresConsentEvent: false,
			requiresSuppressionCheck: false,
			requiresEvidence: false,
			defaultDecision: "allow",
		},
		legal_obligation: {
			label: "Legal obligation",
			requiresConsentEvent: false,
			requiresSuppressionCheck: false,
			requiresEvidence: false,
			defaultDecision: "allow",
		},
		legitimate_interest: {
			label: "Legitimate interest",
			requiresConsentEvent: false,
			requiresSuppressionCheck: true,
			requiresEvidence: true,
			defaultDecision: "deny_without_evidence",
			minimumRequirements: {
				suppressionCheck: true,
				evidence: true,
			},
		},
		soft_opt_in_contractual_relationship: {
			label: "Soft opt-in contractual relationship",
			requiresConsentEvent: false,
			requiresSuppressionCheck: true,
			requiresEvidence: true,
			defaultDecision: "deny_without_evidence",
			minimumRequirements: {
				suppressionCheck: true,
				evidence: true,
			},
		},
		vital_interests: {
			label: "Vital interests",
			requiresConsentEvent: false,
			requiresSuppressionCheck: false,
			requiresEvidence: true,
			defaultDecision: "deny_without_evidence",
			minimumRequirements: {
				evidence: true,
			},
		},
		public_task: {
			label: "Public task",
			requiresConsentEvent: false,
			requiresSuppressionCheck: false,
			requiresEvidence: true,
			defaultDecision: "deny_without_evidence",
			minimumRequirements: {
				evidence: true,
			},
		},
	}),
} as const;

export function validateLegalBasisDefinitions(
	registry: LegalBasisRegistry,
): void {
	for (const [key, definition] of Object.entries(registry)) {
		if (typeof definition.requiresConsentEvent !== "boolean") {
			throw new Error(
				`[herald] Legal basis "${key}" must define requiresConsentEvent as a boolean.`,
			);
		}
		if (typeof definition.requiresSuppressionCheck !== "boolean") {
			throw new Error(
				`[herald] Legal basis "${key}" must define requiresSuppressionCheck as a boolean.`,
			);
		}
		if (
			definition.requiresEvidence !== undefined &&
			typeof definition.requiresEvidence !== "boolean"
		) {
			throw new Error(
				`[herald] Legal basis "${key}" must define requiresEvidence as a boolean when provided.`,
			);
		}
		if (
			definition.defaultDecision !== "allow" &&
			definition.defaultDecision !== "deny_without_evidence"
		) {
			throw new Error(
				`[herald] Legal basis "${key}" must define defaultDecision as "allow" or "deny_without_evidence".`,
			);
		}
	}
}

export function validateCompliancePolicy(
	eventName: string,
	policy: EventCompliancePolicy,
	registry: LegalBasisRegistry = legalBases.defaults,
): void {
	validateLegalBasisDefinitions(registry);
	validatePolicyLegalBasis(eventName, policy.legalBasis, registry);
	assertDoesNotRelax(eventName, policy.legalBasis, policy, registry, "event");

	for (const [channel, channelPolicy] of Object.entries(
		policy.channels ?? {},
	) as Array<[Channel, ChannelCompliancePolicy]>) {
		const legalBasis = channelPolicy.legalBasis ?? policy.legalBasis;
		validatePolicyLegalBasis(eventName, legalBasis, registry, channel);
		assertDoesNotRelax(
			eventName,
			legalBasis,
			channelPolicy,
			registry,
			`channel "${channel}"`,
			channel,
		);
	}
}

export function resolveCompliancePolicy(
	policy: EventCompliancePolicy,
	channel: Channel,
	registry: LegalBasisRegistry = legalBases.defaults,
): ResolvedCompliancePolicy {
	validateCompliancePolicy("<anonymous>", policy, registry);

	const channelPolicy = policy.channels?.[channel];
	const legalBasis = channelPolicy?.legalBasis ?? policy.legalBasis;
	const definition = registry[legalBasis]!;

	const explicitSuppressionRequirement =
		channelPolicy?.requiresSuppressionCheck ?? policy.requiresSuppressionCheck;
	const requiresSuppressionCheck =
		explicitSuppressionRequirement ?? (channel === "inApp" ? false : undefined);

	return resolveComplianceRequirements(
		{
			purpose: policy.purpose,
			legalBasis,
			required: channelPolicy?.required ?? policy.required,
			requiresConsentEvent:
				channelPolicy?.requiresConsentEvent ?? policy.requiresConsentEvent,
			requiresSuppressionCheck,
			requiresEvidence:
				channelPolicy?.requiresEvidence ?? policy.requiresEvidence,
		},
		definition,
	);
}

export async function evaluateCompliance(
	input: ComplianceCheckInput,
	db: Pick<ComplianceDatabaseAdapter, "getConsentEvents" | "findSuppression">,
	registry: LegalBasisRegistry = legalBases.defaults,
): Promise<ComplianceDecision> {
	validateLegalBasisDefinitions(registry);
	const definition = registry[input.legalBasis];
	if (!definition) {
		throw new Error(
			`[herald] Unknown legal basis "${input.legalBasis}". Register it in configureHerald({ compliance: { legalBases } }) or heraldApp.create({ compliance: { legalBases } }).`,
		);
	}

	const checkedAt = input.now ?? new Date();
	const policy = resolveComplianceRequirements(input, definition);

	let consentEvent: ConsentEvent | undefined;
	if (policy.requiresConsentEvent) {
		const events = await db.getConsentEvents({
			subjectId: input.subjectId,
			channel: input.channel,
			purpose: input.purpose,
		});
		consentEvent = latestConsentEvent(events);
		if (!consentEvent) {
			return denied(input, checkedAt, "missing_consent");
		}
		if (consentEvent.status === "withdrawn") {
			return denied(input, checkedAt, "consent_withdrawn", {
				consentEventId: consentEvent.id,
			});
		}
	}

	if (policy.requiresSuppressionCheck) {
		if (!input.addressHash) {
			return denied(input, checkedAt, "missing_address_hash", {
				consentEventId: consentEvent?.id,
			});
		}
		const suppression = await db.findSuppression({
			addressHash: input.addressHash,
			channel: input.channel,
			purpose: input.purpose,
		});
		if (suppression) {
			return denied(input, checkedAt, "suppressed", {
				consentEventId: consentEvent?.id,
				suppressionId: suppression.id,
			});
		}
	}

	if (policy.requiresEvidence && !input.complianceEvidenceId) {
		return denied(input, checkedAt, "missing_evidence", {
			consentEventId: consentEvent?.id,
		});
	}

	return {
		allowed: true,
		decision: "allowed",
		consentEventId: consentEvent?.id,
		complianceEvidenceId: input.complianceEvidenceId,
		legalBasis: input.legalBasis,
		purpose: input.purpose,
		channel: input.channel,
		checkedAt,
	};
}

function resolveComplianceRequirements(
	input: {
		purpose: string;
		legalBasis: LegalBasisKey;
		required?: boolean;
		requiresConsentEvent?: boolean;
		requiresSuppressionCheck?: boolean;
		requiresEvidence?: boolean;
	},
	definition: LegalBasisDefinition,
): ResolvedCompliancePolicy {
	return {
		purpose: input.purpose,
		legalBasis: input.legalBasis,
		required: input.required ?? false,
		requiresConsentEvent:
			input.requiresConsentEvent ?? definition.requiresConsentEvent,
		requiresSuppressionCheck:
			input.requiresSuppressionCheck ?? definition.requiresSuppressionCheck,
		requiresEvidence:
			input.requiresEvidence ?? definition.requiresEvidence ?? false,
		defaultDecision: definition.defaultDecision,
	};
}

function latestConsentEvent(events: ConsentEvent[]): ConsentEvent | undefined {
	return [...events].sort(
		(a, b) =>
			b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
	)[0];
}

function denied(
	input: ComplianceCheckInput,
	checkedAt: Date,
	reason: string,
	ids: { consentEventId?: string; suppressionId?: string } = {},
): ComplianceDecision {
	return {
		allowed: false,
		decision: "denied",
		reason,
		...ids,
		legalBasis: input.legalBasis,
		purpose: input.purpose,
		channel: input.channel,
		checkedAt,
	};
}

function validatePolicyLegalBasis(
	eventName: string,
	legalBasis: string,
	registry: LegalBasisRegistry,
	channel?: string,
): void {
	if (!registry[legalBasis]) {
		const location = channel ? ` for channel "${channel}"` : "";
		throw new Error(
			`[herald] Unknown legal basis "${legalBasis}" referenced by event "${eventName}"${location}. Register it in configureHerald({ compliance: { legalBases } }) or heraldApp.create({ compliance: { legalBases } }).`,
		);
	}
}

function assertDoesNotRelax(
	eventName: string,
	legalBasis: string,
	refinement: ChannelCompliancePolicy | EventCompliancePolicy,
	registry: LegalBasisRegistry,
	location: string,
	channel?: Channel,
): void {
	const definition = registry[legalBasis]!;
	const minimum = definition.minimumRequirements ?? {};

	if (
		(minimum.consentEvent || definition.requiresConsentEvent) &&
		refinement.requiresConsentEvent === false
	) {
		throwRelaxationError(eventName, legalBasis, location, "consent event");
	}

	if (
		(minimum.suppressionCheck || definition.requiresSuppressionCheck) &&
		refinement.requiresSuppressionCheck === false &&
		channel !== "inApp"
	) {
		throwRelaxationError(eventName, legalBasis, location, "suppression check");
	}

	if (
		(minimum.evidence || definition.requiresEvidence) &&
		refinement.requiresEvidence === false
	) {
		throwRelaxationError(eventName, legalBasis, location, "evidence");
	}
}

function throwRelaxationError(
	eventName: string,
	legalBasis: string,
	location: string,
	requirement: string,
): never {
	throw new Error(
		`[herald] Invalid compliance policy for event "${eventName}": ${location} cannot relax ${requirement} required by legal basis "${legalBasis}". Define a different legal basis if this policy needs different behavior.`,
	);
}
