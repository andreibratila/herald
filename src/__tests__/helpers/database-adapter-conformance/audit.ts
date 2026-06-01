import { describe, expect, it } from "vitest";
import type { DatabaseAdapterConformanceTarget } from "./context.js";
import { setupConformanceRuntime } from "./context.js";
import { at, auditLogInput, USERS } from "./fixtures.js";
import { expectAuditLogOrderNewestFirst } from "./assertions.js";

export function runAuditConformance<TContext>(
	target: DatabaseAdapterConformanceTarget<TContext>,
): void {
	describe(`audit conformance: ${target.name}`, () => {
		const runtime = setupConformanceRuntime(target);

		it("audit: create/get list newest-first, limit, user isolation, and field persistence", async () => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();

			const alphaOlder = await db.createAuditLog(
				auditLogInput({
					userId: USERS.alpha,
					action: "notification.accepted",
					eventType: "order.completed",
					deliveryId: "del-1",
					metadata: { attempt: 1 },
				}),
			);
			const alphaNewer = await db.createAuditLog(
				auditLogInput({
					userId: USERS.alpha,
					action: "notification.failed",
					eventType: "order.failed",
					deliveryId: "del-2",
					metadata: { reason: "smtp" },
				}),
			);
			const alphaTie = await db.createAuditLog(
				auditLogInput({
					userId: USERS.alpha,
					action: "notification.accepted",
					eventType: "order.completed",
					deliveryId: "del-3",
					metadata: { attempt: 2 },
				}),
			);
			await db.createAuditLog(
				auditLogInput({
					userId: USERS.beta,
					action: "notification.accepted",
					eventType: "order.completed",
					deliveryId: "del-beta",
				}),
			);

			await target.helpers?.setAuditLogCreatedAt?.(
				context,
				alphaOlder.id,
				at(400),
			);
			await target.helpers?.setAuditLogCreatedAt?.(
				context,
				alphaNewer.id,
				at(410),
			);
			await target.helpers?.setAuditLogCreatedAt?.(
				context,
				alphaTie.id,
				at(410),
			);

			const allAlpha = await db.getAuditLogs(USERS.alpha);
			expect(allAlpha).toHaveLength(3);
			expect(allAlpha.map((log) => log.id)).toEqual([
				alphaTie.id,
				alphaNewer.id,
				alphaOlder.id,
			]);
			expectAuditLogOrderNewestFirst(allAlpha);

			expect(await db.getAuditLogs(USERS.alpha, { limit: 2 })).toHaveLength(2);
			expect(await db.getAuditLogs(USERS.beta)).toHaveLength(1);

			expect(allAlpha.find((log) => log.id === alphaOlder.id)).toMatchObject({
				userId: USERS.alpha,
				action: "notification.accepted",
				eventType: "order.completed",
				deliveryId: "del-1",
				metadata: { attempt: 1 },
			});
		});

		it("audit: findAuditLogByAction returns newest deterministic match and null when missing", async () => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();

			const older = await db.createAuditLog(
				auditLogInput({
					userId: USERS.alpha,
					action: "compliance.erase",
					eventType: "compliance",
					metadata: { seq: 1 },
				}),
			);
			const newer = await db.createAuditLog(
				auditLogInput({
					userId: USERS.alpha,
					action: "compliance.erase",
					eventType: "compliance",
					metadata: { seq: 2 },
				}),
			);
			await target.helpers?.setAuditLogCreatedAt?.(context, older.id, at(500));
			await target.helpers?.setAuditLogCreatedAt?.(context, newer.id, at(500));

			expect(
				(await db.findAuditLogByAction(USERS.alpha, "compliance.erase"))?.id,
			).toBe(newer.id);
			expect(
				await db.findAuditLogByAction(USERS.alpha, "missing-action"),
			).toBeNull();
			expect(
				await db.findAuditLogByAction("missing-user", "compliance.erase"),
			).toBeNull();
		});
	});
}
