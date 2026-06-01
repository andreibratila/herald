// ============================================================
// herald — src/adapters/db/prisma.ts
// Official Prisma adapter
//
// Setup: npx herald generate --adapter prisma
// Then add the generated models to your schema.prisma and run:
//   npx prisma migrate dev
// ============================================================

import type {
	HeraldDatabaseAdapter,
	Notification,
	Delivery,
	Channel,
	DeliveryStatus,
	AuditLog,
	ComplianceExportData,
	ConsentEvent,
	Suppression,
} from "../../types/index.js";

// Loose Prisma client type — user passes their own generated instance
type AnyPrismaClient = {
	heraldNotification: any;
	heraldDelivery: any;
	heraldConsentEvent: any;
	heraldSuppression: any;
	heraldAuditLog: any;
	user?: any;
	$transaction: (arg: any, options?: any) => Promise<any>;
	$queryRaw?: (query: any, ...values: any[]) => Promise<any[]>;
	$executeRaw?: (query: any, ...values: any[]) => Promise<number>;
};

export interface PrismaAdapterOptions {
	/**
	 * Resolve the email address for a userId.
	 * Default: queries prisma.user.findUnique({ where: { id } }).email
	 * Override if your user model has a different structure.
	 *
	 * @example
	 * getUserEmail: (userId) =>
	 *   prisma.account.findFirst({ where: { userId }, select: { email: true } })
	 *     .then(r => r?.email ?? null)
	 */
	getUserEmail?: (userId: string) => Promise<string | null>;
}

let generatedIdSequence = 0;

function generateId(): string {
	generatedIdSequence = (generatedIdSequence + 1) % Number.MAX_SAFE_INTEGER;
	return [
		Date.now().toString(36).padStart(10, "0"),
		generatedIdSequence.toString(36).padStart(8, "0"),
		crypto.randomUUID(),
	].join("_");
}

function toNotificationCreateData(
	data: Omit<Notification, "id" | "createdAt">,
) {
	return {
		id: generateId(),
		userId: data.userId,
		eventType: data.eventType,
		templateName: data.templateName,
		deliveryId: data.deliveryId ?? null,
		title: data.title,
		body: data.body ?? null,
		href: data.href ?? null,
		data: data.data ?? null,
		readAt: data.readAt ?? null,
		createdAt: new Date(),
	};
}

function toDeliveryCreateData(
	data: Omit<Delivery, "id" | "createdAt" | "updatedAt">,
) {
	return {
		id: generateId(),
		...data,
		attempts: data.attempts ?? 0,
		resolveAttempts: data.resolveAttempts ?? 0,
		bypassComplianceCheck: data.bypassComplianceCheck ?? false,
		queueJobId: data.queueJobId ?? null,
		addressHash: data.addressHash ?? null,
		sideEffectsCompletedAt: data.sideEffectsCompletedAt ?? null,
		renderedHash: data.renderedHash ?? null,
		purpose: data.purpose ?? null,
		legalBasisAtSend: data.legalBasisAtSend ?? null,
		consentEventId: data.consentEventId ?? null,
		suppressionId: data.suppressionId ?? null,
		complianceEvidenceId: data.complianceEvidenceId ?? null,
		complianceRequired: data.complianceRequired ?? null,
		complianceRequiresConsentEvent: data.complianceRequiresConsentEvent ?? null,
		complianceRequiresSuppressionCheck:
			data.complianceRequiresSuppressionCheck ?? null,
		complianceRequiresEvidence: data.complianceRequiresEvidence ?? null,
		complianceDefaultDecision: data.complianceDefaultDecision ?? null,
		complianceDecision: data.complianceDecision ?? null,
		complianceCheckedAt: data.complianceCheckedAt ?? null,
	};
}

// Map raw snake_case DB rows (from $queryRaw) to camelCase Delivery objects
function rowToDelivery(row: any): Delivery {
	return {
		id: row.id,
		userId: row.user_id,
		eventType: row.event_type,
		templateName: row.template_name,
		channel: row.channel as Channel,
		status: row.status as DeliveryStatus,
		attempts: row.attempts ?? 0,
		lastError: row.last_error ?? null,
		externalId: row.external_id ?? null,
		idempotencyKey: row.idempotency_key ?? null,
		scheduledAt: row.scheduled_at ?? null,
		acceptedAt: row.accepted_at ?? null,
		failedAt: row.failed_at ?? null,
		claimedAt: row.claimed_at ?? null,
		claimExpiresAt: row.claim_expires_at ?? null,
		claimedBy: row.claimed_by ?? null,
		resolveAttempts: row.resolve_attempts ?? 0,
		bypassComplianceCheck: row.bypass_compliance_check ?? null,
		queueJobId: row.queue_job_id ?? null,
		addressHash: row.address_hash ?? null,
		sideEffectsCompletedAt: row.side_effects_completed_at ?? null,
		renderedHash: row.rendered_hash ?? null,
		purpose: row.purpose ?? null,
		legalBasisAtSend: row.legal_basis_at_send ?? null,
		consentEventId: row.consent_event_id ?? null,
		suppressionId: row.suppression_id ?? null,
		complianceEvidenceId: row.compliance_evidence_id ?? null,
		complianceRequired: row.compliance_required ?? null,
		complianceRequiresConsentEvent:
			row.compliance_requires_consent_event ?? null,
		complianceRequiresSuppressionCheck:
			row.compliance_requires_suppression_check ?? null,
		complianceRequiresEvidence: row.compliance_requires_evidence ?? null,
		complianceDefaultDecision: row.compliance_default_decision ?? null,
		complianceDecision: row.compliance_decision ?? null,
		complianceCheckedAt: row.compliance_checked_at ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function createPrismaAdapter(
	prisma: AnyPrismaClient,
	opts: PrismaAdapterOptions = {},
): HeraldDatabaseAdapter {
	return {
		// ── Notifications ─────────────────────────────────────────

		async createNotification(data) {
			return prisma.heraldNotification.create({
				data: toNotificationCreateData(data),
			}) as Promise<Notification>;
		},

		async getNotifications(userId, opts = {}) {
			return prisma.heraldNotification.findMany({
				where: { userId },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take: opts.limit ?? 20,
				skip: opts.offset ?? 0,
			}) as Promise<Notification[]>;
		},

		async getUnreadNotifications(userId) {
			return prisma.heraldNotification.findMany({
				where: { userId, readAt: null },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			}) as Promise<Notification[]>;
		},

		async countUnread(userId) {
			return prisma.heraldNotification.count({
				where: { userId, readAt: null },
			});
		},

		async markRead(notificationId) {
			try {
				await prisma.heraldNotification.update({
					where: { id: notificationId },
					data: { readAt: new Date() },
				});
			} catch (error: any) {
				if (error?.code === "P2025") return;
				throw error;
			}
		},

		async markAllRead(userId) {
			await prisma.heraldNotification.updateMany({
				where: { userId, readAt: null },
				data: { readAt: new Date() },
			});
		},

		async getNotificationByDeliveryId(deliveryId) {
			return prisma.heraldNotification.findFirst({
				where: { deliveryId },
			}) as Promise<Notification | null>;
		},

		// ── Deliveries ────────────────────────────────────────────

		async createDelivery(data) {
			return prisma.heraldDelivery.create({
				data: toDeliveryCreateData(data),
			}) as Promise<Delivery>;
		},

		async createDeliveryIdempotent(data, reusableStatuses) {
			if (!data.idempotencyKey) {
				return {
					delivery: (await prisma.heraldDelivery.create({
						data: toDeliveryCreateData(data),
					})) as Delivery,
					created: true,
				};
			}
			return prisma.$transaction(
				async (tx: AnyPrismaClient) => {
					const existing = await tx.heraldDelivery.findFirst({
						where: {
							idempotencyKey: data.idempotencyKey,
							status: { in: [...reusableStatuses] },
						},
						orderBy: [
							{ updatedAt: "desc" },
							{ createdAt: "desc" },
							{ id: "desc" },
						],
					});
					if (existing)
						return { delivery: existing as Delivery, created: false };
					const delivery = (await tx.heraldDelivery.create({
						data: toDeliveryCreateData(data),
					})) as Delivery;
					return { delivery, created: true };
				},
				{ isolationLevel: "Serializable" },
			);
		},

		async updateDelivery(id, data) {
			return prisma.heraldDelivery.update({
				where: { id },
				data,
			}) as Promise<Delivery>;
		},

		async getDelivery(id) {
			return prisma.heraldDelivery.findUnique({
				where: { id },
			}) as Promise<Delivery | null>;
		},

		async getDeliveryByIdempotencyKey(key) {
			const reusable = await prisma.heraldDelivery.findFirst({
				where: {
					idempotencyKey: key,
					status: {
						in: [
							"pending",
							"scheduled",
							"claimed",
							"dispatched",
							"retrying",
							"accepted",
						],
					},
				},
				orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
			});
			if (reusable) return reusable as Delivery;
			return null;
		},

		async getDeliveriesByUser(userId, opts = {}) {
			return prisma.heraldDelivery.findMany({
				where: { userId },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take: opts.limit ?? 20,
				skip: opts.offset ?? 0,
			}) as Promise<Delivery[]>;
		},

		// ── Compliance evidence ───────────────────────────────────

		async createConsentEvent(data) {
			return prisma.heraldConsentEvent.create({
				data: {
					id: generateId(),
					...data,
					subjectType: data.subjectType ?? null,
					formId: data.formId ?? null,
					legalNoticeVersionId: data.legalNoticeVersionId ?? null,
					privacyPolicyVersion: data.privacyPolicyVersion ?? null,
					checkboxTextVersion: data.checkboxTextVersion ?? null,
					ipHash: data.ipHash ?? null,
					userAgentHash: data.userAgentHash ?? null,
					metadata: data.metadata ?? null,
					createdAt: data.createdAt ?? new Date(),
				},
			}) as Promise<ConsentEvent>;
		},

		async getConsentEvents(input) {
			return prisma.heraldConsentEvent.findMany({
				where: {
					subjectId: input.subjectId,
					...(input.channel ? { channel: input.channel } : {}),
					...(input.purpose ? { purpose: input.purpose } : {}),
				},
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			}) as Promise<ConsentEvent[]>;
		},

		async createSuppression(data) {
			return prisma.heraldSuppression.create({
				data: {
					id: generateId(),
					...data,
					purpose: data.purpose ?? null,
					source: data.source ?? null,
					createdAt: data.createdAt ?? new Date(),
				},
			}) as Promise<Suppression>;
		},

		async findSuppression(input) {
			if (input.purpose != null) {
				const specific = await prisma.heraldSuppression.findFirst({
					where: {
						addressHash: input.addressHash,
						channel: input.channel,
						purpose: input.purpose,
					},
					orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				});
				if (specific) return specific as Suppression;
			}
			return prisma.heraldSuppression.findFirst({
				where: {
					addressHash: input.addressHash,
					channel: input.channel,
					purpose: null,
				},
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			}) as Promise<Suppression | null>;
		},

		// ── Audit log ─────────────────────────────────────────────

		async createAuditLog(data) {
			return prisma.heraldAuditLog.create({
				data: {
					id: generateId(),
					...data,
				},
			}) as Promise<AuditLog>;
		},

		async getAuditLogs(userId, opts = {}) {
			return prisma.heraldAuditLog.findMany({
				where: { userId },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take: opts.limit ?? 50,
			}) as Promise<AuditLog[]>;
		},

		// ── Compliance lifecycle ─────────────────────────────────

		async eraseSubject(userId) {
			if (!prisma.$executeRaw) {
				throw new Error(
					"[herald] eraseSubject requires $executeRaw on your Prisma client.",
				);
			}
			const erasedId = `erased_${crypto.randomUUID()}`;
			const now = new Date();

			// Compute SHA-256 hash of userId for audit log (no PII stored)
			let userIdHash: string;
			if (typeof globalThis.crypto !== "undefined") {
				const encoder = new TextEncoder();
				const data = encoder.encode(userId);
				const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
				userIdHash = Array.from(new Uint8Array(hash))
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("");
			} else {
				/* v8 ignore next 2 */
				const { createHash } = await import("crypto");
				userIdHash = createHash("sha256").update(userId).digest("hex");
			}

			// Atomic transaction (array form — all ops are independent)
			await prisma.$transaction([
				// Anonymize deliveries and scrub userId from scoped idempotency keys.
				prisma.$executeRaw`
					UPDATE herald_deliveries
					SET
						user_id = ${erasedId},
						idempotency_key = CASE
							WHEN idempotency_key IS NULL THEN NULL
							ELSE replace(idempotency_key, ${userId}, ${userIdHash})
						END
					WHERE user_id = ${userId}
				`,
				// Anonymize notifications
				prisma.heraldNotification.updateMany({
					where: { userId },
					data: {
						userId: erasedId,
						title: "[redacted]",
						body: "[redacted]",
						data: null,
						href: null,
					},
				}),
				// Anonymize append-only consent evidence with a stable hash for audit cross-reference.
				prisma.heraldConsentEvent.updateMany({
					where: { subjectId: userId },
					data: { subjectId: userIdHash },
				}),
				// Anonymize existing audit logs with the same stable hash.
				prisma.heraldAuditLog.updateMany({
					where: { userId },
					data: { userId: userIdHash },
				}),
				// Audit log inside transaction — rolls back on any failure
				prisma.heraldAuditLog.create({
					data: {
						id: generateId(),
						userId: userIdHash,
						action: "compliance.erase",
						metadata: { userIdHash, erasedAt: now.toISOString() },
						createdAt: now,
					},
				}),
			]);
		},

		async exportUser(userId) {
			const [notifications, deliveries, consentEvents, auditLogs] =
				await Promise.all([
					prisma.heraldNotification.findMany({
						where: { userId },
						orderBy: [{ createdAt: "desc" }, { id: "desc" }],
					}),
					prisma.heraldDelivery.findMany({
						where: { userId },
						orderBy: [{ createdAt: "desc" }, { id: "desc" }],
					}),
					prisma.heraldConsentEvent.findMany({
						where: { subjectId: userId },
						orderBy: [{ createdAt: "desc" }, { id: "desc" }],
					}),
					prisma.heraldAuditLog.findMany({
						where: { userId },
						orderBy: [{ createdAt: "desc" }, { id: "desc" }],
					}),
				]);

			return {
				userId,
				exportedAt: new Date(),
				notifications,
				deliveries,
				consentEvents,
				// Suppressions are address-hash scoped, not subject-scoped.
				suppressions: [],
				auditLogs,
			} as ComplianceExportData;
		},

		async claimScheduledBatch(before, workerId, limit, leaseMs) {
			if (!prisma.$queryRaw) {
				throw new Error(
					"[herald] claimScheduledBatch requires $queryRaw on your Prisma client. " +
						"Ensure you are using a standard Prisma client instance.",
				);
			}
			// Atomic claim via CTE + FOR UPDATE SKIP LOCKED
			// Parameters passed as tagged template literal for Prisma's $queryRaw
			const rows = await prisma.$queryRaw`
        WITH locked_candidates AS (
          SELECT id, scheduled_at
          FROM herald_deliveries
          WHERE
            (status = 'scheduled' AND scheduled_at <= ${before})
            OR (status = 'claimed' AND claim_expires_at < NOW())
          ORDER BY scheduled_at ASC, id DESC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        ), candidates AS (
          SELECT
            id,
            row_number() OVER (ORDER BY scheduled_at ASC, id DESC) AS claim_order
          FROM locked_candidates
        ), updated AS (
          UPDATE herald_deliveries
          SET
            status = 'claimed',
            claimed_at = NOW(),
            claim_expires_at = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
            claimed_by = ${workerId},
            updated_at = NOW()
          WHERE id IN (SELECT id FROM candidates)
          RETURNING *
        )
        SELECT updated.*
        FROM updated
        JOIN candidates ON candidates.id = updated.id
        ORDER BY candidates.claim_order ASC
      `;
			return (rows as any[]).map(rowToDelivery);
		},

		async cancelScheduledDeliveries(userId) {
			if (!prisma.$queryRaw) {
				throw new Error(
					"[herald] cancelScheduledDeliveries requires $queryRaw on your Prisma client.",
				);
			}
			const rows = await prisma.$queryRaw`
        UPDATE herald_deliveries
        SET status = 'redacted', updated_at = NOW()
        WHERE user_id = ${userId}
          AND status IN ('scheduled', 'claimed')
        RETURNING id, queue_job_id
      `;
			return (rows as any[]).map((r: any) => ({
				id: r.id as string,
				queueJobId: (r.queue_job_id ?? null) as string | null,
			}));
		},

		async findAuditLogByAction(userId, action) {
			return prisma.heraldAuditLog.findFirst({
				where: { userId, action },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			}) as Promise<AuditLog | null>;
		},

		async purgeExpiredDeliveries(olderThan) {
			const result = await prisma.heraldDelivery.deleteMany({
				where: {
					createdAt: { lt: olderThan },
					status: { notIn: ["scheduled", "claimed", "retrying"] },
				},
			});
			return result.count;
		},

		async purgeExpiredAuditLogs(olderThan) {
			const result = await prisma.heraldAuditLog.deleteMany({
				where: { createdAt: { lt: olderThan } },
			});
			return result.count;
		},

		// ── User resolution ───────────────────────────────────────

		async getUserEmail(userId) {
			if (opts.getUserEmail) return opts.getUserEmail(userId);
			if (!prisma.user) {
				throw new Error(
					'[herald] Cannot resolve user email: no "user" model on Prisma client. ' +
						"Pass a custom getUserEmail option to createPrismaAdapter().",
				);
			}
			const user = await prisma.user.findUnique({
				where: { id: userId },
				select: { email: true },
			});
			return user?.email ?? null;
		},
	};
}
