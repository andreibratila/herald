import { describe, expect, it } from "vitest";
import type { DatabaseAdapterConformanceTarget } from "./context.js";
import { setupConformanceRuntime } from "./context.js";
import { at, notificationInput, USERS } from "./fixtures.js";
import { expectNotificationOrderNewestFirst } from "./assertions.js";

export function runNotificationConformance<TContext>(
	target: DatabaseAdapterConformanceTarget<TContext>,
): void {
	describe(`notifications conformance: ${target.name}`, () => {
		const runtime = setupConformanceRuntime(target);

		const seedNotifications = async (count: number, userId = USERS.alpha) => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();
			for (let i = 0; i < count; i++) {
				const created = await db.createNotification(
					notificationInput({
						userId,
						title: `n-${i}`,
					}),
				);
				await target.helpers?.setNotificationCreatedAt?.(
					context,
					created.id,
					at(i),
				);
			}
		};

		it("notifications: default pagination must use limit=20 offset=0", async () => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();
			await seedNotifications(25);
			const otherUser = await db.createNotification(
				notificationInput({ userId: USERS.beta, title: "other-newest" }),
			);
			await target.helpers?.setNotificationCreatedAt?.(
				context,
				otherUser.id,
				at(1000),
			);

			const listed = await db.getNotifications(USERS.alpha);
			expect(listed).toHaveLength(20);
			expect(listed.map((n: { title: string }) => n.title)).toEqual(
				Array.from({ length: 20 }, (_, index) => `n-${24 - index}`),
			);
			expect(listed.map((n: { title: string }) => n.title)).not.toContain(
				"other-newest",
			);
		});

		it("notifications: explicit limit/offset must be honored", async () => {
			const db = runtime.getAdapter();
			await seedNotifications(10);

			const listed = await db.getNotifications(USERS.alpha, {
				limit: 3,
				offset: 4,
			});
			expect(listed).toHaveLength(3);
			expect(listed.map((n: { title: string }) => n.title)).toEqual([
				"n-5",
				"n-4",
				"n-3",
			]);
		});

		it("notifications: must sort by createdAt desc then id desc", async () => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();

			const first = await db.createNotification(
				notificationInput({ userId: USERS.alpha, title: "a" }),
			);
			const second = await db.createNotification(
				notificationInput({ userId: USERS.alpha, title: "b" }),
			);
			await target.helpers?.setNotificationCreatedAt?.(
				context,
				first.id,
				at(100),
			);
			await target.helpers?.setNotificationCreatedAt?.(
				context,
				second.id,
				at(100),
			);

			const listed = await db.getNotifications(USERS.alpha, {
				limit: 20,
				offset: 0,
			});
			expect(listed[0]?.id).toBe(second.id);
			expectNotificationOrderNewestFirst(listed);
		});

		it("notifications: unread transitions + markRead missing-id no-op + delivery lookup", async () => {
			const db = runtime.getAdapter();

			const n1 = await db.createNotification(
				notificationInput({
					userId: USERS.alpha,
					title: "unread-1",
					deliveryId: "delivery-alpha",
				}),
			);
			const n2 = await db.createNotification(
				notificationInput({ userId: USERS.alpha, title: "unread-2" }),
			);
			await db.createNotification(
				notificationInput({ userId: USERS.beta, title: "other-user" }),
			);

			expect(await db.countUnread(USERS.alpha)).toBe(2);
			const initialUnreadIds = (
				await db.getUnreadNotifications(USERS.alpha)
			).map((n: { id: string }) => n.id);
			expect(initialUnreadIds).toHaveLength(2);
			expect(initialUnreadIds).toEqual(expect.arrayContaining([n1.id, n2.id]));

			await expect(
				db.markRead("missing-notification"),
			).resolves.toBeUndefined();
			await db.markRead(n1.id);
			expect(await db.countUnread(USERS.alpha)).toBe(1);
			expect(
				(await db.getUnreadNotifications(USERS.alpha)).map(
					(n: { id: string }) => n.id,
				),
			).toEqual([n2.id]);

			await db.markAllRead(USERS.alpha);
			expect(await db.countUnread(USERS.alpha)).toBe(0);
			expect(await db.getUnreadNotifications(USERS.alpha)).toEqual([]);
			expect(await db.countUnread(USERS.beta)).toBe(1);

			expect(
				await db.getNotificationByDeliveryId("delivery-alpha"),
			).toMatchObject({
				id: n1.id,
			});
			expect(
				await db.getNotificationByDeliveryId("missing-delivery"),
			).toBeNull();
		});
	});
}
