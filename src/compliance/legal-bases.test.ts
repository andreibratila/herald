import { describe, expect, it } from "vitest";
import {
	legalBases,
	resolveCompliancePolicy,
	validateCompliancePolicy,
	validateLegalBasisDefinitions,
} from "./index.js";
import type {
	EventCompliancePolicy,
	LegalBasisDefinition,
} from "../types/index.js";

describe("legalBases.defaults", () => {
	it("includes the built-in legal basis presets", () => {
		expect(Object.keys(legalBases.defaults).sort()).toEqual([
			"consent",
			"contract",
			"legal_obligation",
			"legitimate_interest",
			"public_task",
			"soft_opt_in_contractual_relationship",
			"vital_interests",
		]);
	});

	it("marks consent as evidence-required by consent event and suppression", () => {
		expect(legalBases.defaults.consent).toMatchObject({
			requiresConsentEvent: true,
			requiresSuppressionCheck: true,
			defaultDecision: "deny_without_evidence",
			minimumRequirements: {
				consentEvent: true,
				suppressionCheck: true,
			},
		});
	});
});

describe("validateLegalBasisDefinitions", () => {
	it("accepts custom legal bases when every definition declares behavior", () => {
		const custom = {
			partner_agreement: {
				label: "Partner agreement",
				requiresConsentEvent: false,
				requiresSuppressionCheck: false,
				requiresEvidence: true,
				defaultDecision: "deny_without_evidence",
			},
		} satisfies Record<string, LegalBasisDefinition>;

		expect(() => validateLegalBasisDefinitions(custom)).not.toThrow();
	});

	it("rejects custom legal bases with missing behavior", () => {
		expect(() =>
			validateLegalBasisDefinitions({
				broken_basis: {
					requiresConsentEvent: false,
					defaultDecision: "allow",
				},
			} as unknown as Record<string, LegalBasisDefinition>),
		).toThrow(/broken_basis.*requiresSuppressionCheck/);
	});
});

describe("validateCompliancePolicy", () => {
	it("throws when an event references an unknown legal basis", () => {
		const policy: EventCompliancePolicy = {
			purpose: "marketing.newsletter",
			legalBasis: "missing_basis",
		};

		expect(() =>
			validateCompliancePolicy(
				"newsletter.weekly",
				policy,
				legalBases.defaults,
			),
		).toThrow(/Unknown legal basis "missing_basis"/);
	});

	it("throws when a channel override references an unknown legal basis", () => {
		const policy: EventCompliancePolicy = {
			purpose: "security.login_alert",
			legalBasis: "legitimate_interest",
			channels: {
				email: { legalBasis: "missing_email_basis" },
			},
		};

		expect(() =>
			validateCompliancePolicy("security.login", policy, legalBases.defaults),
		).toThrow(/Unknown legal basis "missing_email_basis"/);
	});

	it("rejects event refinements that relax non-relaxable consent requirements", () => {
		const policy: EventCompliancePolicy = {
			purpose: "marketing.newsletter",
			legalBasis: "consent",
			requiresSuppressionCheck: false,
		};

		expect(() =>
			validateCompliancePolicy(
				"newsletter.weekly",
				policy,
				legalBases.defaults,
			),
		).toThrow(/cannot relax.*suppression/i);
	});

	it("rejects channel refinements that relax non-relaxable consent requirements", () => {
		const policy: EventCompliancePolicy = {
			purpose: "marketing.newsletter",
			legalBasis: "consent",
			channels: {
				email: { requiresConsentEvent: false },
			},
		};

		expect(() =>
			validateCompliancePolicy(
				"newsletter.weekly",
				policy,
				legalBases.defaults,
			),
		).toThrow(/cannot relax.*consent/i);
	});

	it("allows explicit in-app suppression relaxation because address-hash suppression is not channel-applicable by default", () => {
		const policy: EventCompliancePolicy = {
			purpose: "marketing.in_app",
			legalBasis: "consent",
			channels: {
				inApp: { requiresSuppressionCheck: false },
			},
		};

		expect(() =>
			validateCompliancePolicy("in_app.marketing", policy, legalBases.defaults),
		).not.toThrow();
	});
});

describe("resolveCompliancePolicy", () => {
	it("resolves effective policy from basis, event refinement, and channel refinement", () => {
		const policy: EventCompliancePolicy = {
			purpose: "security.login_alert",
			legalBasis: "legitimate_interest",
			channels: {
				email: {
					legalBasis: "consent",
				},
			},
		};

		expect(
			resolveCompliancePolicy(policy, "email", legalBases.defaults),
		).toMatchObject({
			purpose: "security.login_alert",
			legalBasis: "consent",
			requiresConsentEvent: true,
			requiresSuppressionCheck: true,
			defaultDecision: "deny_without_evidence",
		});
	});

	it("does not require address-hash suppression for in-app consent by default", () => {
		const policy: EventCompliancePolicy = {
			purpose: "marketing.in_app",
			legalBasis: "consent",
		};

		expect(
			resolveCompliancePolicy(policy, "inApp", legalBases.defaults),
		).toMatchObject({
			legalBasis: "consent",
			requiresConsentEvent: true,
			requiresSuppressionCheck: false,
		});
		expect(
			resolveCompliancePolicy(policy, "email", legalBases.defaults),
		).toMatchObject({ requiresSuppressionCheck: true });
	});
});
