import { describe, expect, it } from "vitest";
import {
	mergeComplianceDefaults,
	resolveProcessorRetryConfig,
	resolveQueueConfig,
} from "./config-defaults.js";

describe("config defaults", () => {
	it("defaults omitted queue config to the sync driver", () => {
		expect(resolveQueueConfig(undefined)).toEqual({ driver: "sync" });
	});

	it("resolves processor retries only for the sync queue driver", () => {
		expect(
			resolveProcessorRetryConfig({
				driver: "sync",
				retries: 2,
				backoff: "linear",
				backoffDelay: 250,
			}),
		).toEqual({ maxRetries: 2, backoff: "linear", backoffDelay: 250 });

		expect(
			resolveProcessorRetryConfig({
				driver: "db",
				connectionString: "postgres://example",
				retries: 5,
				backoffDelay: 250,
			}),
		).toEqual({ maxRetries: 0, backoff: "exponential", backoffDelay: 1000 });
	});

	it("merges app and create compliance with create-time legal bases taking precedence", () => {
		const compliance = mergeComplianceDefaults(
			{
				legalBases: {
					partner_agreement: {
						requiresConsentEvent: false,
						requiresSuppressionCheck: false,
						defaultDecision: "allow",
					},
				},
			},
			{
				legalBases: {
					partner_agreement: {
						requiresConsentEvent: true,
						requiresSuppressionCheck: true,
						defaultDecision: "deny_without_evidence",
					},
				},
			},
		);

		expect(compliance.legalBases.contract).toBeDefined();
		expect(compliance.legalBases.partner_agreement).toEqual({
			requiresConsentEvent: true,
			requiresSuppressionCheck: true,
			defaultDecision: "deny_without_evidence",
		});
	});

	it("lets create-time replaceDefaultLegalBases override app-level replacement", () => {
		const restoredDefaults = mergeComplianceDefaults(
			{
				replaceDefaultLegalBases: true,
				legalBases: {
					partner_agreement: {
						requiresConsentEvent: false,
						requiresSuppressionCheck: false,
						defaultDecision: "allow",
					},
				},
			},
			{ replaceDefaultLegalBases: false },
		);

		expect(restoredDefaults.legalBases.contract).toBeDefined();
		expect(restoredDefaults.legalBases.partner_agreement).toBeDefined();

		const replacedDefaults = mergeComplianceDefaults(
			{
				legalBases: {
					partner_agreement: {
						requiresConsentEvent: false,
						requiresSuppressionCheck: false,
						defaultDecision: "allow",
					},
				},
			},
			{ replaceDefaultLegalBases: true },
		);

		expect(replacedDefaults.legalBases.contract).toBeUndefined();
		expect(replacedDefaults.legalBases.partner_agreement).toBeDefined();
	});

	it("merges retention defaults, app config, and create-time overrides", () => {
		const compliance = mergeComplianceDefaults(
			{
				retention: {
					deliveryRetention: "30d",
					autoPurge: false,
				},
			},
			{
				retention: {
					auditLogRetention: "1y",
					autoPurge: true,
				},
			},
		);

		expect(compliance.retention).toEqual({
			deliveryRetention: "30d",
			auditLogRetention: "1y",
			autoPurge: true,
		});
	});
});
