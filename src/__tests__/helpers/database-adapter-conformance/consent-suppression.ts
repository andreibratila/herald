import { describe, expect, it } from "vitest";
import type { DatabaseAdapterConformanceTarget } from "./context.js";
import { setupConformanceRuntime } from "./context.js";
import { at, consentEventInput, suppressionInput, USERS } from "./fixtures.js";
import { expectConsentEventOrderNewestFirst } from "./assertions.js";

export function runConsentSuppressionConformance<TContext>(
	target: DatabaseAdapterConformanceTarget<TContext>,
): void {
	describe(`consent/suppression conformance: ${target.name}`, () => {
		const runtime = setupConformanceRuntime(target);

		it("consent: append-only history and subject/channel/purpose filters", async () => {
			const db = runtime.getAdapter();

			const alphaTieOlderId = await db.createConsentEvent(
				consentEventInput({
					subjectId: USERS.alpha,
					channel: "email",
					purpose: "marketing",
					status: "withdrawn",
					createdAt: at(104),
				}),
			);
			const alphaTieNewerId = await db.createConsentEvent(
				consentEventInput({
					subjectId: USERS.alpha,
					channel: "email",
					purpose: "marketing",
					status: "granted",
					createdAt: at(104),
				}),
			);

			const alphaEmailMarketing = await db.createConsentEvent(
				consentEventInput({
					subjectId: USERS.alpha,
					channel: "email",
					purpose: "marketing",
					status: "granted",
					createdAt: at(100),
				}),
			);
			const alphaEmailSecurity = await db.createConsentEvent(
				consentEventInput({
					subjectId: USERS.alpha,
					channel: "email",
					purpose: "security",
					status: "withdrawn",
					createdAt: at(101),
				}),
			);
			const alphaInAppMarketing = await db.createConsentEvent(
				consentEventInput({
					subjectId: USERS.alpha,
					channel: "inApp",
					purpose: "marketing",
					status: "granted",
					createdAt: at(102),
				}),
			);
			await db.createConsentEvent(
				consentEventInput({
					subjectId: USERS.beta,
					channel: "email",
					purpose: "marketing",
					status: "granted",
					createdAt: at(103),
				}),
			);

			const allAlpha = await db.getConsentEvents({ subjectId: USERS.alpha });
			expect(allAlpha).toHaveLength(5);
			expect(allAlpha.map((event) => event.id)).toEqual([
				alphaTieNewerId.id,
				alphaTieOlderId.id,
				alphaInAppMarketing.id,
				alphaEmailSecurity.id,
				alphaEmailMarketing.id,
			]);
			expectConsentEventOrderNewestFirst(allAlpha);

			expect(
				await db.getConsentEvents({
					subjectId: USERS.alpha,
					channel: "email",
				}),
			).toMatchObject([
				{ id: alphaTieNewerId.id },
				{ id: alphaTieOlderId.id },
				{ id: alphaEmailSecurity.id },
				{ id: alphaEmailMarketing.id },
			]);
			expect(
				await db.getConsentEvents({
					subjectId: USERS.alpha,
					purpose: "marketing",
				}),
			).toMatchObject([
				{ id: alphaTieNewerId.id },
				{ id: alphaTieOlderId.id },
				{ id: alphaInAppMarketing.id },
				{ id: alphaEmailMarketing.id },
			]);
			expect(
				await db.getConsentEvents({
					subjectId: USERS.alpha,
					channel: "email",
					purpose: "security",
				}),
			).toMatchObject([{ id: alphaEmailSecurity.id }]);

			const before = await db.getConsentEvents({ subjectId: USERS.alpha });
			await db.getConsentEvents({
				subjectId: USERS.alpha,
				channel: "email",
				purpose: "security",
			});
			const after = await db.getConsentEvents({ subjectId: USERS.alpha });
			expect(after).toEqual(before);
		});

		it("suppression: purpose-specific precedence, global fallback, and channel/address isolation", async () => {
			const db = runtime.getAdapter();
			const addressHash = "hash:alpha@example.test";

			const globalOlder = await db.createSuppression(
				suppressionInput({
					addressHash,
					channel: "email",
					purpose: null,
					reason: "manual",
					createdAt: at(300),
				}),
			);
			await db.createSuppression(
				suppressionInput({
					addressHash,
					channel: "email",
					purpose: "marketing",
					reason: "unsubscribe",
					createdAt: at(310),
				}),
			);
			const purposeNewer = await db.createSuppression(
				suppressionInput({
					addressHash,
					channel: "email",
					purpose: "marketing",
					reason: "spam_complaint",
					source: "provider-webhook",
					createdAt: at(320),
				}),
			);
			expect(purposeNewer).toMatchObject({
				addressHash,
				channel: "email",
				purpose: "marketing",
				reason: "spam_complaint",
				source: "provider-webhook",
				createdAt: at(320),
			});
			await db.createSuppression(
				suppressionInput({
					addressHash,
					channel: "email",
					purpose: "security",
					reason: "legal",
					createdAt: at(330),
				}),
			);
			await db.createSuppression(
				suppressionInput({
					addressHash,
					channel: "inApp",
					purpose: "marketing",
					reason: "manual",
					createdAt: at(340),
				}),
			);
			await db.createSuppression(
				suppressionInput({
					addressHash: "hash:beta@example.test",
					channel: "email",
					purpose: "marketing",
					reason: "manual",
					createdAt: at(350),
				}),
			);

			expect(
				await db.findSuppression({
					addressHash,
					channel: "email",
					purpose: "marketing",
				}),
			).toMatchObject({
				id: purposeNewer.id,
				addressHash,
				channel: "email",
				purpose: "marketing",
				reason: "spam_complaint",
				source: "provider-webhook",
				createdAt: at(320),
			});

			expect(
				(
					await db.findSuppression({
						addressHash,
						channel: "email",
						purpose: "digest",
					})
				)?.id,
			).toBe(globalOlder.id);

			expect(
				(
					await db.findSuppression({
						addressHash,
						channel: "email",
					})
				)?.id,
			).toBe(globalOlder.id);

			const purposeTieA = await db.createSuppression(
				suppressionInput({
					addressHash,
					channel: "email",
					purpose: "marketing",
					reason: "manual",
					createdAt: at(320),
				}),
			);
			const purposeTieB = await db.createSuppression(
				suppressionInput({
					addressHash,
					channel: "email",
					purpose: "marketing",
					reason: "legal",
					createdAt: at(320),
				}),
			);
			const expectedPurposeTieId = [
				purposeNewer.id,
				purposeTieA.id,
				purposeTieB.id,
			].sort((a, b) => b.localeCompare(a))[0];
			expect(
				(
					await db.findSuppression({
						addressHash,
						channel: "email",
						purpose: "marketing",
					})
				)?.id,
			).toBe(expectedPurposeTieId);

			const globalTieA = await db.createSuppression(
				suppressionInput({
					addressHash,
					channel: "email",
					purpose: null,
					reason: "legal",
					createdAt: at(300),
				}),
			);
			const globalTieB = await db.createSuppression(
				suppressionInput({
					addressHash,
					channel: "email",
					purpose: null,
					reason: "spam_complaint",
					createdAt: at(300),
				}),
			);
			const expectedGlobalTieId = [
				globalOlder.id,
				globalTieA.id,
				globalTieB.id,
			].sort((a, b) => b.localeCompare(a))[0];
			expect(
				(
					await db.findSuppression({
						addressHash,
						channel: "email",
					})
				)?.id,
			).toBe(expectedGlobalTieId);

			expect(
				(
					await db.findSuppression({
						addressHash,
						channel: "inApp",
						purpose: "digest",
					})
				)?.id ?? null,
			).toBeNull();
		});
	});
}
