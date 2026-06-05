import type {
	HeraldDatabaseAdapter,
	Notification,
	Delivery,
	AuditLog,
	ComplianceExportData,
	ConsentEvent,
	Suppression,
} from "../../../types/index.js";

export interface MockDb extends HeraldDatabaseAdapter {
	_notifications: Map<string, Notification>;
	_deliveries: Map<string, Delivery>;
	_auditLogs: AuditLog[];
	_consentEvents: ConsentEvent[];
	_suppressions: Suppression[];
	_userEmails: Map<string, string | null>;
	createConsentEvent: HeraldDatabaseAdapter["createConsentEvent"];
	getConsentEvents: HeraldDatabaseAdapter["getConsentEvents"];
	createSuppression: HeraldDatabaseAdapter["createSuppression"];
	findSuppression: HeraldDatabaseAdapter["findSuppression"];
	_reset: () => void;
}

export interface MockDbOptions {
	getUserEmail?: (userId: string) => Promise<string | null>;
}

export function createMockDb(opts: MockDbOptions = {}): MockDb {
	const _notifications = new Map<string, Notification>();
	const _deliveries = new Map<string, Delivery>();
	const _auditLogs: AuditLog[] = [];
	const _consentEvents: ConsentEvent[] = [];
	const _suppressions: Suppression[] = [];
	const _userEmails = new Map<string, string | null>();

	let idSeq = 0;
	const nextId = (prefix: string) => `${prefix}_${++idSeq}`;

	const db: MockDb = {
		_notifications,
		_deliveries,
		_auditLogs,
		_consentEvents,
		_suppressions,
		_userEmails,

		_reset() {
			_notifications.clear();
			_deliveries.clear();
			_auditLogs.length = 0;
			_consentEvents.length = 0;
			_suppressions.length = 0;
			_userEmails.clear();
			idSeq = 0;
		},

		// ── Notifications ──────────────────────────────────────────
		async createNotification(data) {
			const n: Notification = {
				...data,
				id: nextId("notif"),
				createdAt: new Date(),
			};
			_notifications.set(n.id, n);
			return n;
		},

		async getNotifications(userId, opts) {
			const all = [..._notifications.values()]
				.filter((n) => n.userId === userId)
				.sort(
					(a, b) =>
						b.createdAt.getTime() - a.createdAt.getTime() ||
						b.id.localeCompare(a.id),
				);
			const offset = opts?.offset ?? 0;
			const limit = opts?.limit ?? 20;
			return all.slice(offset, offset + limit);
		},

		async getUnreadNotifications(userId) {
			return [..._notifications.values()].filter(
				(n) => n.userId === userId && !n.readAt,
			);
		},

		async countUnread(userId) {
			return [..._notifications.values()].filter(
				(n) => n.userId === userId && !n.readAt,
			).length;
		},

		async markRead(notificationId) {
			const n = _notifications.get(notificationId);
			if (n) n.readAt = new Date();
		},

		async markAllRead(userId) {
			for (const n of _notifications.values()) {
				if (n.userId === userId) n.readAt = new Date();
			}
		},

		async getNotificationByDeliveryId(deliveryId) {
			for (const n of _notifications.values()) {
				if (n.deliveryId === deliveryId) return n;
			}
			return null;
		},

		// ── Deliveries ────────────────────────────────────────────
		async createDelivery(data) {
			const d: Delivery = {
				...data,
				id: nextId("del"),
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			_deliveries.set(d.id, d);
			return d;
		},

		async createDeliveryIdempotent(data, reusableStatuses) {
			if (data.idempotencyKey) {
				const existing = [..._deliveries.values()]
					.filter(
						(d) =>
							d.idempotencyKey === data.idempotencyKey &&
							reusableStatuses.includes(d.status),
					)
					.sort(
						(a, b) =>
							(b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0) ||
							b.createdAt.getTime() - a.createdAt.getTime() ||
							b.id.localeCompare(a.id),
					)[0];
				if (existing) return { delivery: existing, created: false };
			}
			return { delivery: await this.createDelivery(data), created: true };
		},

		async updateDelivery(id, patch) {
			const existing = _deliveries.get(id);
			if (!existing) throw new Error(`Delivery ${id} not found`);
			const updated: Delivery = {
				...existing,
				...patch,
				updatedAt: new Date(),
			};
			_deliveries.set(id, updated);
			return updated;
		},

		async getDelivery(id) {
			return _deliveries.get(id) ?? null;
		},

		async getDeliveryByIdempotencyKey(key) {
			const byLatestSnapshot = (a: Delivery, b: Delivery) =>
				(b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0) ||
				b.createdAt.getTime() - a.createdAt.getTime() ||
				b.id.localeCompare(a.id);
			const matches = [..._deliveries.values()]
				.filter((d) => d.idempotencyKey === key)
				.sort(byLatestSnapshot);
			return (
				matches.find((d) =>
					[
						"pending",
						"scheduled",
						"claimed",
						"dispatched",
						"retrying",
						"accepted",
					].includes(d.status),
				) ?? null
			);
		},

		async getDeliveriesByUser(userId, opts) {
			const all = [..._deliveries.values()]
				.filter((d) => d.userId === userId)
				.sort(
					(a, b) =>
						b.createdAt.getTime() - a.createdAt.getTime() ||
						b.id.localeCompare(a.id),
				);
			const offset = opts?.offset ?? 0;
			const limit = opts?.limit ?? 20;
			return all.slice(offset, offset + limit);
		},

		// ── Compliance evidence ───────────────────────────────────
		async createConsentEvent(data) {
			const id = nextId("consent_event");
			const event: ConsentEvent = {
				...data,
				id,
				createdAt: data.createdAt ?? new Date(),
			};
			_consentEvents.push(event);
			return event;
		},

		async getConsentEvents(input) {
			return _consentEvents
				.filter(
					(event) =>
						event.subjectId === input.subjectId &&
						(input.channel ? event.channel === input.channel : true) &&
						(input.purpose ? event.purpose === input.purpose : true),
				)
				.sort(
					(a, b) =>
						b.createdAt.getTime() - a.createdAt.getTime() ||
						b.id.localeCompare(a.id),
				);
		},

		async createSuppression(data) {
			const id = nextId("suppression");
			const suppression: Suppression = {
				...data,
				id,
				createdAt: data.createdAt ?? new Date(Date.now() + idSeq),
			};
			_suppressions.push(suppression);
			return suppression;
		},

		async findSuppression(input) {
			const byNewest = (a: Suppression, b: Suppression) =>
				b.createdAt.getTime() - a.createdAt.getTime() ||
				b.id.localeCompare(a.id);
			const matching = _suppressions.filter(
				(suppression) =>
					suppression.addressHash === input.addressHash &&
					suppression.channel === input.channel,
			);

			if (input.purpose) {
				const purposeSpecific = matching
					.filter((suppression) => suppression.purpose === input.purpose)
					.sort(byNewest)[0];
				if (purposeSpecific) return purposeSpecific;
			}

			return (
				matching
					.filter((suppression) => suppression.purpose == null)
					.sort(byNewest)[0] ?? null
			);
		},

		// ── Audit ─────────────────────────────────────────────────
		async createAuditLog(data) {
			const log: AuditLog = {
				...data,
				id: nextId("audit"),
				createdAt: new Date(),
			};
			_auditLogs.push(log);
			return log;
		},

		async getAuditLogs(userId, opts) {
			const filtered = _auditLogs
				.filter((l) => l.userId === userId)
				.sort(
					(a, b) =>
						b.createdAt.getTime() - a.createdAt.getTime() ||
						b.id.localeCompare(a.id),
				);
			return opts?.limit ? filtered.slice(0, opts.limit) : filtered;
		},

		// ── Compliance lifecycle ───────────────────────────────────
		async eraseSubject(userId) {
			const erasedId = `erased_${crypto.randomUUID()}`;
			const now = new Date();

			// Compute SHA-256 hash — mirrors what real adapters do inside their transaction
			const encoder = new TextEncoder();
			const data = encoder.encode(userId);
			const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
			const userIdHash = Array.from(new Uint8Array(hashBuffer))
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");

			for (const event of _consentEvents) {
				if (event.subjectId === userId) event.subjectId = userIdHash;
			}

			for (const n of _notifications.values()) {
				if (n.userId === userId) {
					n.userId = erasedId;
					n.title = "[redacted]";
					n.body = "[redacted]";
					n.href = null;
					n.data = null;
				}
			}
			for (const d of _deliveries.values()) {
				if (d.userId === userId) {
					d.userId = erasedId;
					if (d.idempotencyKey) {
						d.idempotencyKey = d.idempotencyKey.split(userId).join(userIdHash);
					}
				}
			}
			for (const log of _auditLogs) {
				if (log.userId === userId) log.userId = userIdHash;
			}
			// Audit log — written inside the "transaction" (mirrors real adapter step 6)
			_auditLogs.push({
				id: nextId("audit"),
				userId: userIdHash,
				action: "compliance.erase",
				metadata: { userIdHash, erasedAt: now.toISOString() },
				createdAt: now,
			});
		},

		async exportUser(userId): Promise<ComplianceExportData> {
			return {
				userId,
				exportedAt: new Date(),
				notifications: [..._notifications.values()].filter(
					(n) => n.userId === userId,
				),
				deliveries: [..._deliveries.values()].filter(
					(d) => d.userId === userId,
				),
				consentEvents: _consentEvents.filter(
					(event) => event.subjectId === userId,
				),
				// Suppressions are address-hash scoped, not subject-scoped.
				suppressions: [],
				auditLogs: _auditLogs.filter((l) => l.userId === userId),
			};
		},

		async purgeExpiredDeliveries(olderThan) {
			const PROTECTED_STATUSES = ["scheduled", "claimed", "retrying"] as const;
			let count = 0;
			for (const [id, d] of _deliveries.entries()) {
				if (
					d.createdAt < olderThan &&
					!PROTECTED_STATUSES.includes(d.status as any)
				) {
					_deliveries.delete(id);
					count++;
				}
			}
			return count;
		},

		async purgeExpiredAuditLogs(olderThan) {
			let count = 0;
			for (let i = _auditLogs.length - 1; i >= 0; i--) {
				if (_auditLogs[i]!.createdAt < olderThan) {
					_auditLogs.splice(i, 1);
					count++;
				}
			}
			return count;
		},

		async claimScheduledBatch(before, workerId, limit, leaseMs) {
			const now = new Date();
			const candidates = [..._deliveries.values()]
				.filter(
					(d) =>
						(d.status === "scheduled" &&
							d.scheduledAt != null &&
							d.scheduledAt <= before) ||
						(d.status === "claimed" &&
							d.claimExpiresAt != null &&
							d.claimExpiresAt < now),
				)
				.sort(
					(a, b) =>
						a.scheduledAt!.getTime() - b.scheduledAt!.getTime() ||
						b.id.localeCompare(a.id),
				)
				.slice(0, limit);

			const claimed: Delivery[] = [];
			for (const d of candidates) {
				const updated: Delivery = {
					...d,
					status: "claimed",
					claimedAt: now,
					claimExpiresAt: new Date(now.getTime() + leaseMs),
					claimedBy: workerId,
					updatedAt: now,
				};
				_deliveries.set(d.id, updated);
				claimed.push(updated);
			}
			return claimed;
		},

		async cancelScheduledDeliveries(userId) {
			const result: Array<{ id: string; queueJobId: string | null }> = [];
			for (const [id, d] of _deliveries.entries()) {
				if (
					d.userId === userId &&
					(d.status === "scheduled" || d.status === "claimed")
				) {
					const updated: Delivery = {
						...d,
						status: "redacted",
						updatedAt: new Date(),
					};
					_deliveries.set(id, updated);
					result.push({ id, queueJobId: d.queueJobId ?? null });
				}
			}
			return result;
		},

		async findAuditLogByAction(userId, action) {
			return (
				_auditLogs
					.filter((l) => l.userId === userId && l.action === action)
					.sort(
						(a, b) =>
							b.createdAt.getTime() - a.createdAt.getTime() ||
							b.id.localeCompare(a.id),
					)[0] ?? null
			);
		},

		// ── User resolution ───────────────────────────────────────
		async getUserEmail(userId) {
			if (opts.getUserEmail) return opts.getUserEmail(userId);
			if (_userEmails.has(userId)) return _userEmails.get(userId) ?? null;
			return `${userId}@test.com`;
		},
	};

	return db;
}
