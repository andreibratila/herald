import {
	runAuditConformance,
	runComplianceLifecycleConformance,
	runConsentSuppressionConformance,
	runDeliveryConformance,
	runNotificationConformance,
	runScheduledLifecycleConformance,
	runUserLookupConformance,
	type DatabaseAdapterConformanceTarget,
} from "./database-adapter-conformance.js";
import { createMockDb, type MockDb } from "./mock-db-adapter.js";

const target: DatabaseAdapterConformanceTarget<MockDb> = {
	name: "createMockDb",
	create: () => {
		const adapter = createMockDb();
		adapter.getUserEmail = async (userId) =>
			adapter._userEmails.get(userId) ?? null;
		return { adapter, context: adapter };
	},
	reset: (db) => db._reset(),
	helpers: {
		setNotificationCreatedAt: (db, id, createdAt) => {
			const existing = db._notifications.get(id);
			if (!existing) throw new Error(`Missing notification ${id}`);
			existing.createdAt = createdAt;
		},
		setDeliveryTimestamps: (db, id, timestamps) => {
			const existing = db._deliveries.get(id);
			if (!existing) throw new Error(`Missing delivery ${id}`);
			if (timestamps.createdAt) existing.createdAt = timestamps.createdAt;
			if (timestamps.updatedAt) existing.updatedAt = timestamps.updatedAt;
		},
		setAuditLogCreatedAt: (db, id, createdAt) => {
			const existing = db._auditLogs.find((log) => log.id === id);
			if (!existing) throw new Error(`Missing audit log ${id}`);
			existing.createdAt = createdAt;
		},
		hashSubjectId: async (_db, subjectId) => {
			const encoder = new TextEncoder();
			const data = encoder.encode(subjectId);
			const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
			return Array.from(new Uint8Array(hashBuffer))
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");
		},
		seedUserEmail: (db, userId, email) => {
			db._userEmails.set(userId, email);
		},
	},
};

runNotificationConformance(target);
runDeliveryConformance(target);
runConsentSuppressionConformance(target);
runAuditConformance(target);
runComplianceLifecycleConformance(target);
runScheduledLifecycleConformance(target);
runUserLookupConformance(target);
