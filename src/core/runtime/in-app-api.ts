import type { HeraldDatabaseAdapter, Notification } from "../../types/index.js";

export function createInAppApi(db: HeraldDatabaseAdapter) {
	async function getNotifications(
		userId: string,
		opts?: { limit?: number; offset?: number },
	): Promise<Notification[]> {
		return db.getNotifications(userId, opts);
	}

	async function getUnreadNotifications(
		userId: string,
	): Promise<Notification[]> {
		return db.getUnreadNotifications(userId);
	}

	async function countUnread(userId: string): Promise<number> {
		return db.countUnread(userId);
	}

	async function markRead(notificationId: string): Promise<void> {
		await db.markRead(notificationId);
	}

	async function markAllRead(userId: string): Promise<void> {
		await db.markAllRead(userId);
	}

	return {
		getNotifications,
		getUnreadNotifications,
		countUnread,
		markRead,
		markAllRead,
	};
}
