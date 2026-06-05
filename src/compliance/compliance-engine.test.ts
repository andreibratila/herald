import { describe, expect, it } from "vitest";
import { createMockDb } from "../__tests__/support/adapters/mock-db-adapter.js";
import { evaluateCompliance, legalBases } from "./index.js";

const baseInput = {
	subjectId: "user_123",
	channel: "email" as const,
	purpose: "marketing.newsletter",
	legalBasis: "consent",
};

describe("compliance engine", () => {
	it("appends consent grants and withdrawals without mutating earlier events", async () => {
		const db = createMockDb();

		const grant = await db.createConsentEvent({
			subjectId: "user_123",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "newsletter_form",
		});
		const withdrawal = await db.createConsentEvent({
			subjectId: "user_123",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "withdrawn",
			legalBasis: "consent",
			source: "unsubscribe_link",
		});

		expect(grant.id).not.toBe(withdrawal.id);
		expect(db._consentEvents).toHaveLength(2);
		expect(db._consentEvents[0]).toMatchObject({ status: "granted" });
		expect(db._consentEvents[1]).toMatchObject({ status: "withdrawn" });
	});

	it("allows a consent-required check when latest same-scope event is granted", async () => {
		const db = createMockDb();
		const consent = await db.createConsentEvent({
			subjectId: "user_123",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "newsletter_form",
		});

		await expect(
			evaluateCompliance(
				{ ...baseInput, addressHash: "hash:user_123@example.com" },
				db,
				legalBases.defaults,
			),
		).resolves.toMatchObject({
			allowed: true,
			decision: "allowed",
			consentEventId: consent.id,
			legalBasis: "consent",
			purpose: "marketing.newsletter",
			channel: "email",
		});
	});

	it("denies when the latest same-scope consent event is withdrawn", async () => {
		const db = createMockDb();
		await db.createConsentEvent({
			subjectId: "user_123",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "newsletter_form",
		});
		const withdrawal = await db.createConsentEvent({
			subjectId: "user_123",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "withdrawn",
			legalBasis: "consent",
			source: "unsubscribe_link",
		});

		await expect(
			evaluateCompliance(baseInput, db, legalBases.defaults),
		).resolves.toMatchObject({
			allowed: false,
			decision: "denied",
			reason: "consent_withdrawn",
			consentEventId: withdrawal.id,
		});
	});

	it("uses a deterministic id tie-breaker when consent timestamps match", async () => {
		const db = createMockDb();
		const sameCreatedAt = new Date("2030-01-01T00:00:00.000Z");
		await db.createConsentEvent({
			subjectId: "user_123",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "newsletter_form",
			createdAt: sameCreatedAt,
		});
		const withdrawal = await db.createConsentEvent({
			subjectId: "user_123",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "withdrawn",
			legalBasis: "consent",
			source: "unsubscribe_link",
			createdAt: sameCreatedAt,
		});

		await expect(
			evaluateCompliance(baseInput, db, legalBases.defaults),
		).resolves.toMatchObject({
			allowed: false,
			reason: "consent_withdrawn",
			consentEventId: withdrawal.id,
		});
	});

	it("does not let email consent authorize another channel", async () => {
		const db = createMockDb();
		await db.createConsentEvent({
			subjectId: "user_123",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "newsletter_form",
		});

		await expect(
			evaluateCompliance(
				{
					...baseInput,
					channel: "inApp",
					requiresSuppressionCheck: false,
				},
				db,
				legalBases.defaults,
			),
		).resolves.toMatchObject({
			allowed: false,
			decision: "denied",
			reason: "missing_consent",
			channel: "inApp",
		});
	});

	it("denies by app-supplied addressHash suppression when suppression checks are required", async () => {
		const db = createMockDb();
		await db.createConsentEvent({
			subjectId: "user_123",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "newsletter_form",
		});
		const suppression = await db.createSuppression({
			addressHash: "hash:user_123@example.com",
			channel: "email",
			purpose: "marketing.newsletter",
			reason: "unsubscribe",
			source: "unsubscribe_link",
		});

		await expect(
			evaluateCompliance(
				{ ...baseInput, addressHash: "hash:user_123@example.com" },
				db,
				legalBases.defaults,
			),
		).resolves.toMatchObject({
			allowed: false,
			decision: "denied",
			reason: "suppressed",
			suppressionId: suppression.id,
		});
	});

	it("allows non-consent legal bases without consent events", async () => {
		const db = createMockDb();

		await expect(
			evaluateCompliance(
				{
					subjectId: "user_123",
					channel: "inApp",
					purpose: "transactional.order_update",
					legalBasis: "contract",
				},
				db,
				legalBases.defaults,
			),
		).resolves.toMatchObject({
			allowed: true,
			decision: "allowed",
			legalBasis: "contract",
		});
	});

	it("allows in-app consent checks without an addressHash when suppression is not required", async () => {
		const db = createMockDb();
		const consent = await db.createConsentEvent({
			subjectId: "user_123",
			channel: "inApp",
			purpose: "marketing.in_app",
			status: "granted",
			legalBasis: "consent",
			source: "in_app_prompt",
		});

		await expect(
			evaluateCompliance(
				{
					subjectId: "user_123",
					channel: "inApp",
					purpose: "marketing.in_app",
					legalBasis: "consent",
					requiresConsentEvent: true,
					requiresSuppressionCheck: false,
				},
				db,
				legalBases.defaults,
			),
		).resolves.toMatchObject({
			allowed: true,
			decision: "allowed",
			consentEventId: consent.id,
		});
	});

	it("denies evidence-required legal bases without an app-owned evidence reference", async () => {
		const db = createMockDb();

		await expect(
			evaluateCompliance(
				{
					subjectId: "user_123",
					addressHash: "hash:user_123@example.com",
					channel: "email",
					purpose: "marketing.reactivation",
					legalBasis: "legitimate_interest",
				},
				db,
				legalBases.defaults,
			),
		).resolves.toMatchObject({
			allowed: false,
			decision: "denied",
			reason: "missing_evidence",
			legalBasis: "legitimate_interest",
		});
	});

	it("allows evidence-required legal bases with an app-owned evidence reference", async () => {
		const db = createMockDb();

		await expect(
			evaluateCompliance(
				{
					subjectId: "user_123",
					addressHash: "hash:user_123@example.com",
					channel: "email",
					purpose: "marketing.reactivation",
					legalBasis: "legitimate_interest",
					complianceEvidenceId: "li-assessment:2026-05",
				},
				db,
				legalBases.defaults,
			),
		).resolves.toMatchObject({
			allowed: true,
			decision: "allowed",
			legalBasis: "legitimate_interest",
			complianceEvidenceId: "li-assessment:2026-05",
		});
	});
});
