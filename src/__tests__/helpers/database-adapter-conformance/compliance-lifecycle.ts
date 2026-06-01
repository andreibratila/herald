import { describe, expect, it } from "vitest";
import type { DatabaseAdapterConformanceTarget } from "./context.js";
import { setupConformanceRuntime } from "./context.js";
import {
	at,
	auditLogInput,
	consentEventInput,
	deliveryInput,
	notificationInput,
	suppressionInput,
	USERS,
} from "./fixtures.js";

export function runComplianceLifecycleConformance<TContext>(
	target: DatabaseAdapterConformanceTarget<TContext>,
): void {
	describe(`compliance lifecycle conformance: ${target.name}`, () => {
		const runtime = setupConformanceRuntime(target);

		it("compliance: eraseSubject redacts subject-linked notification/delivery fields and preserves evidence", async () => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();

			await db.createConsentEvent(
				consentEventInput({
					subjectId: USERS.alpha,
					channel: "email",
					purpose: "marketing",
					status: "granted",
				}),
			);
			await db.createAuditLog(
				auditLogInput({
					userId: USERS.alpha,
					action: "notification.accepted",
					eventType: "order.completed",
					deliveryId: "delivery-lifecycle",
				}),
			);
			const delivery = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					idempotencyKey: "order-123:user_alpha:email:email-primary",
					status: "accepted",
				}),
			);
			await db.createNotification(
				notificationInput({
					userId: USERS.alpha,
					deliveryId: delivery.id,
					title: "alpha title",
					body: "alpha body",
					href: "/orders/123",
					data: { pii: "keep out" },
				}),
			);

			await db.eraseSubject(USERS.alpha);

			const afterDelivery = await db.getDelivery(delivery.id);
			expect(afterDelivery).not.toBeNull();
			expect(afterDelivery?.userId).not.toBe(USERS.alpha);
			expect(afterDelivery?.idempotencyKey).not.toContain(USERS.alpha);

			const afterNotification = await db.getNotificationByDeliveryId(
				delivery.id,
			);
			expect(afterNotification).not.toBeNull();
			expect(afterNotification).toMatchObject({
				title: "[redacted]",
				body: "[redacted]",
				href: null,
				data: null,
			});

			const hashedSubjectId = await target.helpers?.hashSubjectId?.(
				context,
				USERS.alpha,
			);
			if (hashedSubjectId) {
				expect(
					await db.getConsentEvents({ subjectId: hashedSubjectId }),
				).toHaveLength(1);
				expect(
					await db.findAuditLogByAction(
						hashedSubjectId,
						"notification.accepted",
					),
				).not.toBeNull();
				expect(
					await db.findAuditLogByAction(hashedSubjectId, "compliance.erase"),
				).not.toBeNull();
			} else {
				const exportedAfter = await db.exportUser(USERS.alpha);
				expect(
					exportedAfter.consentEvents.length + exportedAfter.auditLogs.length,
				).toBeGreaterThan(0);
			}
		});

		it("compliance: exportUser before erasure includes expected user-owned datasets", async () => {
			const db = runtime.getAdapter();

			const delivery = await db.createDelivery(
				deliveryInput({ userId: USERS.alpha, status: "accepted" }),
			);
			const notification = await db.createNotification(
				notificationInput({ userId: USERS.alpha, deliveryId: delivery.id }),
			);
			const consent = await db.createConsentEvent(
				consentEventInput({ subjectId: USERS.alpha, purpose: "marketing" }),
			);
			const audit = await db.createAuditLog(
				auditLogInput({ userId: USERS.alpha, action: "notification.accepted" }),
			);
			await db.createDelivery(
				deliveryInput({ userId: USERS.beta, status: "accepted" }),
			);
			await db.createNotification(notificationInput({ userId: USERS.beta }));
			await db.createConsentEvent(consentEventInput({ subjectId: USERS.beta }));
			await db.createAuditLog(auditLogInput({ userId: USERS.beta }));
			await db.createSuppression(
				suppressionInput({
					addressHash: "hash:alpha@example.test",
					channel: "email",
					purpose: "marketing",
				}),
			);

			const exported = await db.exportUser(USERS.alpha);
			expect(exported.userId).toBe(USERS.alpha);
			expect(exported.notifications.map((item) => item.id)).toEqual([
				notification.id,
			]);
			expect(exported.deliveries.map((item) => item.id)).toEqual([delivery.id]);
			expect(exported.consentEvents.map((item) => item.id)).toEqual([
				consent.id,
			]);
			expect(exported.auditLogs.map((item) => item.id)).toEqual([audit.id]);
			// Suppressions are capability-scoped and may be empty for hash-scoped adapters.
			expect(Array.isArray(exported.suppressions)).toBe(true);
		});

		it("compliance: exportUser after erasure redacts queryable records or preserves evidence via hashed lookup", async () => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();

			await db.createConsentEvent(
				consentEventInput({ subjectId: USERS.alpha, purpose: "security" }),
			);
			await db.createAuditLog(
				auditLogInput({ userId: USERS.alpha, action: "compliance.check" }),
			);
			const delivery = await db.createDelivery(
				deliveryInput({ userId: USERS.alpha, status: "accepted" }),
			);
			await db.createNotification(
				notificationInput({ userId: USERS.alpha, deliveryId: delivery.id }),
			);

			await db.eraseSubject(USERS.alpha);

			const exportedAfter = await db.exportUser(USERS.alpha);
			const exposesRedactedRawExport =
				exportedAfter.notifications.length > 0 ||
				exportedAfter.deliveries.length > 0 ||
				exportedAfter.consentEvents.length > 0 ||
				exportedAfter.auditLogs.length > 0;

			if (exposesRedactedRawExport) {
				for (const notification of exportedAfter.notifications) {
					expect(notification.userId).not.toBe(USERS.alpha);
					expect(notification.title).toBe("[redacted]");
					expect(notification.body).toBe("[redacted]");
					expect(notification.data).toBeNull();
				}
				for (const delivery of exportedAfter.deliveries) {
					expect(delivery.userId).not.toBe(USERS.alpha);
					expect(delivery.idempotencyKey).not.toContain(USERS.alpha);
				}
			} else {
				expect(exportedAfter.notifications).toHaveLength(0);
				expect(exportedAfter.deliveries).toHaveLength(0);
				expect(exportedAfter.consentEvents).toHaveLength(0);
				expect(exportedAfter.auditLogs).toHaveLength(0);
			}

			const hashedSubjectId = await target.helpers?.hashSubjectId?.(
				context,
				USERS.alpha,
			);
			if (hashedSubjectId) {
				expect(
					await db.getConsentEvents({ subjectId: hashedSubjectId }),
				).toHaveLength(1);
				expect(await db.getAuditLogs(hashedSubjectId)).not.toHaveLength(0);
			} else {
				expect(exposesRedactedRawExport).toBe(true);
				expect(
					exportedAfter.consentEvents.length + exportedAfter.auditLogs.length,
				).toBeGreaterThan(0);
			}
		});

		it("compliance: purge removes strictly older records and returns exact counts", async () => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();
			const olderThan = at(1_000);

			const oldDelivery = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "accepted",
					idempotencyKey: "purge-old",
				}),
			);
			const boundaryDelivery = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "accepted",
					idempotencyKey: "purge-boundary",
				}),
			);
			const newDelivery = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "accepted",
					idempotencyKey: "purge-new",
				}),
			);
			await target.helpers?.setDeliveryTimestamps?.(context, oldDelivery.id, {
				createdAt: at(900),
				updatedAt: at(900),
			});
			await target.helpers?.setDeliveryTimestamps?.(
				context,
				boundaryDelivery.id,
				{
					createdAt: olderThan,
					updatedAt: olderThan,
				},
			);
			await target.helpers?.setDeliveryTimestamps?.(context, newDelivery.id, {
				createdAt: at(1_100),
				updatedAt: at(1_100),
			});

			const oldAudit = await db.createAuditLog(
				auditLogInput({ userId: USERS.alpha, action: "purge-old" }),
			);
			const boundaryAudit = await db.createAuditLog(
				auditLogInput({ userId: USERS.alpha, action: "purge-boundary" }),
			);
			const newAudit = await db.createAuditLog(
				auditLogInput({ userId: USERS.alpha, action: "purge-new" }),
			);
			await target.helpers?.setAuditLogCreatedAt?.(
				context,
				oldAudit.id,
				at(900),
			);
			await target.helpers?.setAuditLogCreatedAt?.(
				context,
				boundaryAudit.id,
				olderThan,
			);
			await target.helpers?.setAuditLogCreatedAt?.(
				context,
				newAudit.id,
				at(1_100),
			);

			expect(await db.purgeExpiredDeliveries(olderThan)).toBe(1);
			expect(await db.getDelivery(oldDelivery.id)).toBeNull();
			expect(await db.getDelivery(boundaryDelivery.id)).not.toBeNull();
			expect(await db.getDelivery(newDelivery.id)).not.toBeNull();

			expect(await db.purgeExpiredAuditLogs(olderThan)).toBe(1);
			expect(
				await db.findAuditLogByAction(USERS.alpha, "purge-old"),
			).toBeNull();
			expect(
				await db.findAuditLogByAction(USERS.alpha, "purge-boundary"),
			).not.toBeNull();
			expect(
				await db.findAuditLogByAction(USERS.alpha, "purge-new"),
			).not.toBeNull();
		});
	});
}
