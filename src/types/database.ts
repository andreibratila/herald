import type { Except } from "type-fest";
import type { Channel } from "./channels.js";
import type {
	ConsentEvent,
	CreateConsentEventInput,
	CreateSuppressionInput,
	Suppression,
} from "./compliance.js";
import type {
	AuditLog,
	ComplianceExportData,
	Delivery,
	DeliveryStatus,
	Notification,
} from "./records.js";

// ─── DB Adapter contract ─────────────────────────────────────

export interface HeraldDatabaseAdapter {
	// Notifications (in-app)
	createNotification(
		data: Except<Notification, "id" | "createdAt">,
	): Promise<Notification>;
	getNotifications(
		userId: string,
		opts?: { limit?: number; offset?: number },
	): Promise<Notification[]>;
	getUnreadNotifications(userId: string): Promise<Notification[]>;
	countUnread(userId: string): Promise<number>;
	markRead(notificationId: string): Promise<void>;
	markAllRead(userId: string): Promise<void>;
	getNotificationByDeliveryId(deliveryId: string): Promise<Notification | null>;

	// Deliveries
	createDelivery(
		data: Except<Delivery, "id" | "createdAt" | "updatedAt">,
	): Promise<Delivery>;
	/**
	 * Atomically create a delivery unless a reusable delivery already exists for
	 * the same idempotency key. Implementations should use a serializable
	 * transaction or an equivalent DB-native lock/constraint.
	 */
	createDeliveryIdempotent(
		data: Except<Delivery, "id" | "createdAt" | "updatedAt">,
		reusableStatuses: readonly DeliveryStatus[],
	): Promise<{ delivery: Delivery; created: boolean }>;
	updateDelivery(id: string, data: Partial<Delivery>): Promise<Delivery>;
	getDelivery(id: string): Promise<Delivery | null>;
	getDeliveryByIdempotencyKey(key: string): Promise<Delivery | null>;
	getDeliveriesByUser(
		userId: string,
		opts?: { limit?: number; offset?: number },
	): Promise<Delivery[]>;

	// Compliance — append-only consent evidence and suppressions
	createConsentEvent(data: CreateConsentEventInput): Promise<ConsentEvent>;
	getConsentEvents(input: {
		subjectId: string;
		channel?: Channel;
		purpose?: string;
	}): Promise<ConsentEvent[]>;
	createSuppression(data: CreateSuppressionInput): Promise<Suppression>;
	findSuppression(input: {
		addressHash: string;
		channel: Channel;
		purpose?: string;
	}): Promise<Suppression | null>;

	// Compliance — Audit log
	createAuditLog(data: Except<AuditLog, "id" | "createdAt">): Promise<AuditLog>;
	getAuditLogs(userId: string, opts?: { limit?: number }): Promise<AuditLog[]>;

	// Compliance — Lifecycle
	/** Anonymize all subject data — replaces PII fields, preserves audit trail */
	eraseSubject(userId: string): Promise<void>;
	/** Export all stored data for a subject */
	exportUser(userId: string): Promise<ComplianceExportData>;
	/** Delete delivery records older than the given date */
	purgeExpiredDeliveries(olderThan: Date): Promise<number>;
	/** Delete audit log records older than the given date */
	purgeExpiredAuditLogs(olderThan: Date): Promise<number>;

	// Scheduled deliveries
	/**
	 * Atomically claim a batch of due scheduled deliveries.
	 * Uses FOR UPDATE SKIP LOCKED in PostgreSQL to prevent double-claiming.
	 * Also re-claims deliveries with expired leases (claimExpiresAt < now).
	 */
	claimScheduledBatch(
		before: Date,
		workerId: string,
		limit: number,
		leaseMs: number,
	): Promise<Delivery[]>;

	/**
	 * Cancel all scheduled/claimed deliveries for a user before compliance erasure.
	 * Sets status="redacted" and returns the affected delivery IDs and their queueJobIds.
	 */
	cancelScheduledDeliveries(
		userId: string,
	): Promise<Array<{ id: string; queueJobId: string | null }>>;

	/**
	 * Find an audit log entry by userId and action.
	 * Used as an idempotency guard for compliance erasure (userId is the userIdHash for that action).
	 */
	findAuditLogByAction(
		userId: string,
		action: string,
	): Promise<AuditLog | null>;

	// User resolution
	/**
	 * Resolve email address for a userId.
	 * Default implementations query your users table.
	 * Override via getUserEmail option in the adapter factory.
	 */
	getUserEmail(userId: string): Promise<string | null>;
}
