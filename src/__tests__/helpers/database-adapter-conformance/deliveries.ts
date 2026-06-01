import { describe, expect, it } from "vitest";
import type { DeliveryStatus } from "../../../types/index.js";
import type { DatabaseAdapterConformanceTarget } from "./context.js";
import { setupConformanceRuntime } from "./context.js";
import { at, deliveryInput, USERS } from "./fixtures.js";
import { expectDeliveryOrderNewestFirst } from "./assertions.js";

const REUSABLE_STATUSES: DeliveryStatus[] = [
	"pending",
	"scheduled",
	"claimed",
	"dispatched",
	"retrying",
	"accepted",
];

export function runDeliveryConformance<TContext>(
	target: DatabaseAdapterConformanceTarget<TContext>,
): void {
	describe(`deliveries conformance: ${target.name}`, () => {
		const runtime = setupConformanceRuntime(target);

		const seedDeliveries = async (count: number, userId = USERS.alpha) => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();
			for (let i = 0; i < count; i++) {
				const created = await db.createDelivery(
					deliveryInput({ userId, idempotencyKey: `page-key-${i}` }),
				);
				await target.helpers?.setDeliveryTimestamps?.(context, created.id, {
					createdAt: at(i),
					updatedAt: at(i),
				});
			}
		};

		it("deliveries: create/update/get round-trip must preserve fields", async () => {
			const db = runtime.getAdapter();
			const created = await db.createDelivery(
				deliveryInput({ idempotencyKey: "roundtrip-key" }),
			);

			const updated = await db.updateDelivery(created.id, {
				status: "accepted",
				externalId: "ext_123",
			});
			expect(updated.status).toBe("accepted");
			expect(updated.externalId).toBe("ext_123");
			expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
				created.updatedAt.getTime(),
			);

			expect(await db.getDelivery(created.id)).toMatchObject({
				id: created.id,
				status: "accepted",
				externalId: "ext_123",
			});
		});

		it("deliveries: default pagination must use limit=20 offset=0", async () => {
			const db = runtime.getAdapter();
			await seedDeliveries(25);
			const otherUser = await db.createDelivery(
				deliveryInput({ userId: USERS.beta, idempotencyKey: "other-newest" }),
			);
			await target.helpers?.setDeliveryTimestamps?.(
				runtime.getContext(),
				otherUser.id,
				{ createdAt: at(1000), updatedAt: at(1000) },
			);

			const listed = await db.getDeliveriesByUser(USERS.alpha);
			expect(listed).toHaveLength(20);
			expect(listed.map((d) => d.idempotencyKey)).toEqual(
				Array.from({ length: 20 }, (_, index) => `page-key-${24 - index}`),
			);
			expect(listed.map((d) => d.idempotencyKey)).not.toContain("other-newest");
		});

		it("deliveries: explicit limit/offset must be honored", async () => {
			const db = runtime.getAdapter();
			await seedDeliveries(10);

			const listed = await db.getDeliveriesByUser(USERS.alpha, {
				limit: 3,
				offset: 4,
			});
			expect(listed).toHaveLength(3);
			expect(listed.map((d) => d.idempotencyKey)).toEqual([
				"page-key-5",
				"page-key-4",
				"page-key-3",
			]);
		});

		it("deliveries: must sort by createdAt desc then id desc", async () => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();
			const first = await db.createDelivery(
				deliveryInput({ idempotencyKey: "tie-a" }),
			);
			const second = await db.createDelivery(
				deliveryInput({ idempotencyKey: "tie-b" }),
			);
			await target.helpers?.setDeliveryTimestamps?.(context, first.id, {
				createdAt: at(500),
				updatedAt: at(500),
			});
			await target.helpers?.setDeliveryTimestamps?.(context, second.id, {
				createdAt: at(500),
				updatedAt: at(500),
			});

			const listed = await db.getDeliveriesByUser(USERS.alpha, {
				limit: 20,
				offset: 0,
			});
			expect(listed[0]?.id).toBe(second.id);
			expectDeliveryOrderNewestFirst(listed);
		});

		it("deliveries: createDeliveryIdempotent creates fresh when only terminal statuses exist", async () => {
			const db = runtime.getAdapter();
			const key = "idem-terminal-only";
			await db.createDelivery(
				deliveryInput({ idempotencyKey: key, status: "failed" }),
			);
			await db.createDelivery(
				deliveryInput({ idempotencyKey: key, status: "skipped" }),
			);
			await db.createDelivery(
				deliveryInput({ idempotencyKey: key, status: "redacted" }),
			);

			const result = await db.createDeliveryIdempotent(
				deliveryInput({ idempotencyKey: key, status: "pending" }),
				REUSABLE_STATUSES,
			);
			expect(result.created).toBe(true);
			expect(result.delivery.status).toBe("pending");
		});

		it("deliveries: createDeliveryIdempotent reuses all reusable statuses", async () => {
			const db = runtime.getAdapter();

			for (const status of REUSABLE_STATUSES) {
				const key = `idem-reusable-${status}`;
				const existing = await db.createDelivery(
					deliveryInput({ idempotencyKey: key, status }),
				);
				const result = await db.createDeliveryIdempotent(
					deliveryInput({ idempotencyKey: key, status: "pending" }),
					REUSABLE_STATUSES,
				);
				expect(result.created).toBe(false);
				expect(result.delivery.id).toBe(existing.id);
			}
		});

		it("deliveries: idempotent reuse selects by updatedAt then createdAt then id", async () => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();

			const assertSelectedByBothApis = async (
				key: string,
				expectedId: string,
			) => {
				const created = await db.createDeliveryIdempotent(
					deliveryInput({ idempotencyKey: key, status: "pending" }),
					REUSABLE_STATUSES,
				);
				expect(created.created).toBe(false);
				expect(created.delivery.id).toBe(expectedId);
				expect((await db.getDeliveryByIdempotencyKey(key))?.id).toBe(
					expectedId,
				);
			};

			const byUpdatedAtKey = "idem-reusable-updated-at";
			const olderUpdatedAt = await db.createDelivery(
				deliveryInput({ idempotencyKey: byUpdatedAtKey, status: "pending" }),
			);
			const newerUpdatedAt = await db.createDelivery(
				deliveryInput({ idempotencyKey: byUpdatedAtKey, status: "accepted" }),
			);
			await target.helpers?.setDeliveryTimestamps?.(
				context,
				olderUpdatedAt.id,
				{
					createdAt: at(600),
					updatedAt: at(610),
				},
			);
			await target.helpers?.setDeliveryTimestamps?.(
				context,
				newerUpdatedAt.id,
				{
					createdAt: at(605),
					updatedAt: at(620),
				},
			);
			await assertSelectedByBothApis(byUpdatedAtKey, newerUpdatedAt.id);

			const byCreatedAtKey = "idem-reusable-created-at";
			const olderCreatedAt = await db.createDelivery(
				deliveryInput({ idempotencyKey: byCreatedAtKey, status: "pending" }),
			);
			const newerCreatedAt = await db.createDelivery(
				deliveryInput({ idempotencyKey: byCreatedAtKey, status: "accepted" }),
			);
			await target.helpers?.setDeliveryTimestamps?.(
				context,
				olderCreatedAt.id,
				{
					createdAt: at(700),
					updatedAt: at(800),
				},
			);
			await target.helpers?.setDeliveryTimestamps?.(
				context,
				newerCreatedAt.id,
				{
					createdAt: at(710),
					updatedAt: at(800),
				},
			);
			await assertSelectedByBothApis(byCreatedAtKey, newerCreatedAt.id);

			const byIdKey = "idem-reusable-id";
			const olderId = await db.createDelivery(
				deliveryInput({ idempotencyKey: byIdKey, status: "pending" }),
			);
			const newerId = await db.createDelivery(
				deliveryInput({ idempotencyKey: byIdKey, status: "accepted" }),
			);
			await target.helpers?.setDeliveryTimestamps?.(context, olderId.id, {
				createdAt: at(900),
				updatedAt: at(900),
			});
			await target.helpers?.setDeliveryTimestamps?.(context, newerId.id, {
				createdAt: at(900),
				updatedAt: at(900),
			});
			await assertSelectedByBothApis(byIdKey, newerId.id);
		});

		it("deliveries: getDeliveryByIdempotencyKey uses reusable matrix and ignores terminals", async () => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();

			for (const status of REUSABLE_STATUSES) {
				const key = `idem-get-reusable-${status}`;
				const reusable = await db.createDelivery(
					deliveryInput({ idempotencyKey: key, status }),
				);
				expect((await db.getDeliveryByIdempotencyKey(key))?.id).toBe(
					reusable.id,
				);
			}

			for (const status of ["failed", "skipped", "redacted"] as const) {
				const key = `idem-get-terminal-${status}`;
				await db.createDelivery(deliveryInput({ idempotencyKey: key, status }));
				expect(await db.getDeliveryByIdempotencyKey(key)).toBeNull();
			}

			const mixedKey = "idem-get-mixed";
			const reusable = await db.createDelivery(
				deliveryInput({ idempotencyKey: mixedKey, status: "pending" }),
			);
			const terminal = await db.createDelivery(
				deliveryInput({ idempotencyKey: mixedKey, status: "failed" }),
			);
			await target.helpers?.setDeliveryTimestamps?.(context, reusable.id, {
				createdAt: at(700),
				updatedAt: at(710),
			});
			await target.helpers?.setDeliveryTimestamps?.(context, terminal.id, {
				createdAt: at(800),
				updatedAt: at(820),
			});
			expect((await db.getDeliveryByIdempotencyKey(mixedKey))?.id).toBe(
				reusable.id,
			);
			expect(await db.getDeliveryByIdempotencyKey("missing-key")).toBeNull();
		});
	});
}
