import { describe, expect, it } from "vitest";
import {
	updateAuditLogCreatedAtSql,
	updateDeliveryTimestampsSql,
	updateNotificationCreatedAtSql,
} from "./helpers.js";

describe("real DB conformance SQL helpers", () => {
	it("quotes schema-qualified timestamp patch statements", () => {
		expect(updateNotificationCreatedAtSql('debug"schema')).toBe(
			'UPDATE "debug""schema"."herald_notifications" SET created_at = $2 WHERE id = $1',
		);
		expect(updateDeliveryTimestampsSql("herald_conformance_test")).toBe(
			'UPDATE "herald_conformance_test"."herald_deliveries" SET created_at = $2, updated_at = $3 WHERE id = $1',
		);
		expect(updateAuditLogCreatedAtSql("herald_conformance_test")).toBe(
			'UPDATE "herald_conformance_test"."herald_audit_logs" SET created_at = $2 WHERE id = $1',
		);
	});
});
