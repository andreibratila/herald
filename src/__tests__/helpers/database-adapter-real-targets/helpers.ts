import { createHash } from "node:crypto";
import { quotePostgresIdentifier } from "./postgres-testbed.js";

export function hashSubjectId(subjectId: string): string {
	return createHash("sha256").update(subjectId).digest("hex");
}

export function updateNotificationCreatedAtSql(schema: string): string {
	return `UPDATE ${tableRef(schema, "herald_notifications")} SET created_at = $2 WHERE id = $1`;
}

export function updateDeliveryTimestampsSql(schema: string): string {
	return `UPDATE ${tableRef(schema, "herald_deliveries")} SET created_at = $2, updated_at = $3 WHERE id = $1`;
}

export function updateAuditLogCreatedAtSql(schema: string): string {
	return `UPDATE ${tableRef(schema, "herald_audit_logs")} SET created_at = $2 WHERE id = $1`;
}

function tableRef(schema: string, table: string): string {
	return `${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(table)}`;
}
