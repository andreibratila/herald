import type { DatabaseAdapterConformanceTarget } from "../database-adapter-conformance.js";
import {
	hashSubjectId,
	updateAuditLogCreatedAtSql,
	updateDeliveryTimestampsSql,
	updateNotificationCreatedAtSql,
} from "./helpers.js";
import type { SqlExecutor } from "./postgres-testbed.js";
import { createUserEmailStore } from "./user-email-store.js";

export interface RealDbTargetContext {
	schema: string;
	executor: SqlExecutor;
	users: ReturnType<typeof createUserEmailStore>;
}

export function createRealDbConformanceHelpers(schema: string) {
	return {
		hashSubjectId: (_context: RealDbTargetContext, subjectId: string) =>
			hashSubjectId(subjectId),
		setNotificationCreatedAt: async (
			context: RealDbTargetContext,
			id: string,
			createdAt: Date,
		) => {
			await context.executor.execute(updateNotificationCreatedAtSql(schema), [
				id,
				createdAt,
			]);
		},
		setDeliveryTimestamps: async (
			context: RealDbTargetContext,
			id: string,
			timestamps: { createdAt?: Date; updatedAt?: Date },
		) => {
			await context.executor.execute(updateDeliveryTimestampsSql(schema), [
				id,
				timestamps.createdAt ?? timestamps.updatedAt,
				timestamps.updatedAt ?? timestamps.createdAt,
			]);
		},
		setAuditLogCreatedAt: async (
			context: RealDbTargetContext,
			id: string,
			createdAt: Date,
		) => {
			await context.executor.execute(updateAuditLogCreatedAtSql(schema), [
				id,
				createdAt,
			]);
		},
		seedUserEmail: async (
			context: RealDbTargetContext,
			userId: string,
			email: string | null,
		) => {
			context.users.seed(userId, email);
		},
	};
}

export type RealDbConformanceTarget<TContext extends RealDbTargetContext> =
	DatabaseAdapterConformanceTarget<TContext>;
