import type { AsyncReturnType } from "type-fest";
import type {
	CreateConsentEventInput,
	CreateSuppressionInput,
	HeraldDatabaseAdapter,
} from "../../types/index.js";
import type { QueueDriver } from "../../queue/index.js";
import { hashSubjectId } from "../../compliance/index.js";

export interface RetentionConfig {
	deliveryRetention: `${number}d` | `${number}y`;
	auditLogRetention: `${number}d` | `${number}y`;
	autoPurge: boolean;
}

export interface ComplianceLifecycleConfig {
	db: HeraldDatabaseAdapter;
	queue: QueueDriver;
	retentionConfig: RetentionConfig;
}

function parseRetentionDate(value: `${number}d` | `${number}y`): Date {
	const num = parseInt(value, 10);
	const unit = value.slice(-1);
	if (unit === "d") return new Date(Date.now() - num * 86_400_000);
	const d = new Date();
	d.setUTCFullYear(d.getUTCFullYear() - num);
	return d;
}

export function createComplianceLifecycle({
	db,
	queue,
	retentionConfig,
}: ComplianceLifecycleConfig) {
	async function recordConsent(
		data: CreateConsentEventInput,
	): Promise<AsyncReturnType<HeraldDatabaseAdapter["createConsentEvent"]>> {
		if (!db.createConsentEvent) {
			throw new Error(
				"[herald] The configured database adapter does not implement compliance consent event storage.",
			);
		}
		const consent = await db.createConsentEvent(data);
		await db.createAuditLog({
			userId: data.subjectId,
			action: `compliance.consent.${data.status}`,
			metadata: {
				consentEventId: consent.id,
				channel: data.channel,
				purpose: data.purpose,
				legalBasis: data.legalBasis,
				source: data.source,
				legalNoticeVersionId: data.legalNoticeVersionId ?? null,
			},
		});
		return consent;
	}

	async function suppress(
		data: CreateSuppressionInput,
	): Promise<AsyncReturnType<HeraldDatabaseAdapter["createSuppression"]>> {
		if (!db.createSuppression) {
			throw new Error(
				"[herald] The configured database adapter does not implement compliance suppression storage.",
			);
		}
		const suppression = await db.createSuppression(data);
		await db.createAuditLog({
			userId: null,
			action: "compliance.suppressed",
			metadata: {
				suppressionId: suppression.id,
				addressHash: data.addressHash,
				channel: data.channel,
				purpose: data.purpose ?? null,
				reason: data.reason,
				source: data.source ?? null,
			},
		});
		return suppression;
	}

	async function exportSubject(userId: string) {
		const data = await db.exportUser(userId);
		await db.createAuditLog({
			userId,
			action: "compliance.export",
			metadata: { exportedAt: new Date().toISOString() },
		});
		return data;
	}

	async function purge(): Promise<{
		deliveriesPurged: number;
		auditLogsPurged: number;
	}> {
		const deliveryCutoff = parseRetentionDate(
			retentionConfig.deliveryRetention,
		);
		const auditLogCutoff = parseRetentionDate(
			retentionConfig.auditLogRetention,
		);
		const deliveriesPurged = await db.purgeExpiredDeliveries(deliveryCutoff);
		const auditLogsPurged = await db.purgeExpiredAuditLogs(auditLogCutoff);
		await db.createAuditLog({
			userId: null,
			action: "compliance.purge",
			metadata: {
				deliveriesPurged,
				auditLogsPurged,
				deliveryCutoffDate: deliveryCutoff.toISOString(),
				auditLogCutoffDate: auditLogCutoff.toISOString(),
				ranAt: new Date().toISOString(),
			},
		});
		return { deliveriesPurged, auditLogsPurged };
	}

	async function autoPurgeCompliance(): Promise<void> {
		if (!retentionConfig.autoPurge) return;
		await purge().catch((err) => {
			console.warn("[herald] Auto-purge failed:", err);
		});
	}

	async function getAuditLog(userId: string, opts?: { limit?: number }) {
		return db.getAuditLogs(userId, opts);
	}

	async function eraseSubject(userId: string): Promise<void> {
		const userIdHash = await hashSubjectId(userId);
		const existingCompliance = await db.findAuditLogByAction(
			userIdHash,
			"compliance.erase",
		);
		if (existingCompliance) return;

		const cancelled = await db.cancelScheduledDeliveries(userId);
		await db.createAuditLog({
			userId,
			action: "compliance.scheduled_deliveries_cancelled",
			metadata: {
				count: cancelled.length,
				cancelledAt: new Date().toISOString(),
			},
		});

		if (cancelled.length > 0) {
			const jobIds = cancelled
				.map((d) => d.queueJobId)
				.filter((id): id is string => id !== null);
			if (jobIds.length > 0) {
				await queue
					.cancelJobs?.(jobIds)
					.catch((e) =>
						console.warn("[herald] cancelJobs failed (non-fatal):", e),
					);
			}
		}

		await db.eraseSubject(userId);

		const adapterWroteCompliance = await db.findAuditLogByAction(
			userIdHash,
			"compliance.erase",
		);
		if (!adapterWroteCompliance) {
			await db.createAuditLog({
				userId: userIdHash,
				action: "compliance.erase",
				metadata: { userIdHash, erasedAt: new Date().toISOString() },
			});
		}
	}

	return {
		compliance: {
			recordConsent,
			suppress,
			eraseSubject,
			exportSubject,
			purge,
			getAuditLog,
		},
		autoPurgeCompliance,
	};
}
