import { describe, expect, it } from "vitest";
import type { DatabaseAdapterConformanceTarget } from "./context.js";
import { setupConformanceRuntime } from "./context.js";
import { at, deliveryInput, USERS } from "./fixtures.js";

export function runScheduledLifecycleConformance<TContext>(
	target: DatabaseAdapterConformanceTarget<TContext>,
): void {
	describe(`scheduled lifecycle conformance: ${target.name}`, () => {
		const runtime = setupConformanceRuntime(target);

		it("scheduled: claimScheduledBatch claims due scheduled + expired claimed only, sets lease fields, respects limit, deterministic order", async () => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();
			const before = at(1_000);

			const scheduledDueA = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "scheduled",
					scheduledAt: at(900),
					idempotencyKey: "sched-due-a",
				}),
			);
			const scheduledDueB = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "scheduled",
					scheduledAt: at(900),
					idempotencyKey: "sched-due-b",
				}),
			);
			const scheduledFuture = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "scheduled",
					scheduledAt: at(1_100),
					idempotencyKey: "sched-future",
				}),
			);
			const scheduledDueC = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "scheduled",
					scheduledAt: at(950),
					idempotencyKey: "sched-due-c-over-limit",
				}),
			);
			const claimedExpired = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "claimed",
					scheduledAt: at(800),
					claimedBy: "worker-old",
					claimedAt: new Date(Date.now() - 120_000),
					claimExpiresAt: new Date(Date.now() - 60_000),
					idempotencyKey: "claimed-expired",
				}),
			);
			const claimedActive = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "claimed",
					scheduledAt: at(700),
					claimedBy: "worker-old",
					claimedAt: new Date(Date.now() - 5_000),
					claimExpiresAt: new Date(Date.now() + 60_000),
					idempotencyKey: "claimed-active",
				}),
			);
			const preClaimUpdatedAt = new Map<string, number>([
				[scheduledDueA.id, scheduledDueA.updatedAt.getTime()],
				[scheduledDueB.id, scheduledDueB.updatedAt.getTime()],
				[claimedExpired.id, claimedExpired.updatedAt.getTime()],
			]);
			const terminal = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "failed",
					scheduledAt: at(700),
					idempotencyKey: "terminal-failed",
				}),
			);
			const retrying = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "retrying",
					scheduledAt: at(700),
					idempotencyKey: "retrying",
				}),
			);
			const pending = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "pending",
					scheduledAt: at(700),
					idempotencyKey: "pending",
				}),
			);

			await target.helpers?.setDeliveryTimestamps?.(context, scheduledDueA.id, {
				createdAt: at(10),
				updatedAt: at(10),
			});
			await target.helpers?.setDeliveryTimestamps?.(context, scheduledDueB.id, {
				createdAt: at(10),
				updatedAt: at(10),
			});

			const claimed = await db.claimScheduledBatch(
				before,
				"worker-new",
				3,
				60_000,
			);
			expect(claimed).toHaveLength(3);

			const expectedTieFirst = [scheduledDueA.id, scheduledDueB.id].sort(
				(a, b) => b.localeCompare(a),
			)[0];
			expect(claimed.map((d) => d.id)).toEqual([
				claimedExpired.id,
				expectedTieFirst!,
				scheduledDueA.id === expectedTieFirst
					? scheduledDueB.id
					: scheduledDueA.id,
			]);

			for (const row of claimed) {
				expect(row.status).toBe("claimed");
				expect(row.claimedBy).toBe("worker-new");
				expect(row.claimedAt).toBeInstanceOf(Date);
				expect(row.claimExpiresAt).toBeInstanceOf(Date);
				expect(row.updatedAt).toBeInstanceOf(Date);
				expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(
					preClaimUpdatedAt.get(row.id)!,
				);
				expect(row.updatedAt.getTime()).toBe(row.claimedAt!.getTime());
				expect(
					(row.claimExpiresAt!.getTime() - row.claimedAt!.getTime()) / 1000,
				).toBe(60);
			}

			expect((await db.getDelivery(scheduledDueC.id))?.status).toBe(
				"scheduled",
			);
			expect((await db.getDelivery(scheduledFuture.id))?.status).toBe(
				"scheduled",
			);
			expect((await db.getDelivery(claimedActive.id))?.claimedBy).toBe(
				"worker-old",
			);
			expect((await db.getDelivery(terminal.id))?.status).toBe("failed");
			expect((await db.getDelivery(retrying.id))?.status).toBe("retrying");
			expect((await db.getDelivery(pending.id))?.status).toBe("pending");
		});

		it("scheduled: cancelScheduledDeliveries redacts only scheduled/claimed for one user and returns queueJobIds", async () => {
			const db = runtime.getAdapter();

			const alphaScheduled = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "scheduled",
					scheduledAt: at(500),
					queueJobId: "job-alpha-1",
				}),
			);
			const alphaClaimed = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "claimed",
					scheduledAt: at(400),
					queueJobId: null,
					claimedAt: at(450),
					claimExpiresAt: at(550),
				}),
			);
			const alphaAccepted = await db.createDelivery(
				deliveryInput({
					userId: USERS.alpha,
					status: "accepted",
				}),
			);
			const betaScheduled = await db.createDelivery(
				deliveryInput({
					userId: USERS.beta,
					status: "scheduled",
					scheduledAt: at(450),
				}),
			);

			const cancelled = await db.cancelScheduledDeliveries(USERS.alpha);
			expect(cancelled).toHaveLength(2);
			expect(cancelled).toEqual(
				expect.arrayContaining([
					{ id: alphaScheduled.id, queueJobId: "job-alpha-1" },
					{ id: alphaClaimed.id, queueJobId: null },
				]),
			);

			expect((await db.getDelivery(alphaScheduled.id))?.status).toBe(
				"redacted",
			);
			expect((await db.getDelivery(alphaClaimed.id))?.status).toBe("redacted");
			expect((await db.getDelivery(alphaAccepted.id))?.status).toBe("accepted");
			expect((await db.getDelivery(betaScheduled.id))?.status).toBe(
				"scheduled",
			);
		});
	});
}
