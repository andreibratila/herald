import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { HERALD_DB_SCHEMA } from "../../../internal/db-schema/metadata.js";
import type { DbSchemaMetadata } from "../../../internal/db-schema/types.js";
import { compareFixtureToMetadata } from "../../helpers/database-adapter-real-targets/schema-parity/compare.js";
import {
	extractDrizzleFixtureSchema,
	extractDrizzleFixtureSchemaFromSource,
} from "../../helpers/database-adapter-real-targets/schema-parity/drizzle-fixture.js";
import { normalizeHeraldDbSchema } from "../../helpers/database-adapter-real-targets/schema-parity/metadata.js";
import { extractSqlFixtureSchema } from "../../helpers/database-adapter-real-targets/schema-parity/sql-fixture.js";
import type { NormalizedFixtureSchema } from "../../helpers/database-adapter-real-targets/schema-parity/types.js";

const sqlFixturePath = fileURLToPath(
	new URL(
		"../../helpers/database-adapter-real-targets/herald-schema.sql",
		import.meta.url,
	),
);
const drizzleFixturePath = fileURLToPath(
	new URL(
		"../../helpers/database-adapter-real-targets/drizzle-schema.ts",
		import.meta.url,
	),
);

describe("real DB fixture structural parity", () => {
	it("keeps the SQL real fixture aligned with HERALD_DB_SCHEMA structural metadata", async () => {
		const expected = normalizeHeraldDbSchema(HERALD_DB_SCHEMA);
		const actual = await extractSqlFixtureSchema(sqlFixturePath);

		const diagnostics = compareFixtureToMetadata(expected, actual);

		expect(diagnostics, diagnostics.join("\n\n")).toEqual([]);
	});

	it("keeps the Drizzle real fixture aligned with HERALD_DB_SCHEMA structural metadata", async () => {
		const expected = normalizeHeraldDbSchema(HERALD_DB_SCHEMA);
		const actual = await extractDrizzleFixtureSchema(drizzleFixturePath);

		const diagnostics = compareFixtureToMetadata(expected, actual);

		expect(diagnostics, diagnostics.join("\n\n")).toEqual([]);
	});

	it("throws when metadata indexes reference unknown table fields", () => {
		const schema: DbSchemaMetadata = {
			version: 1,
			tables: [
				{
					id: "deliveries",
					tableName: "herald_deliveries",
					fields: [
						{
							propertyName: "status",
							columnName: "status",
							kind: "string",
							nullable: false,
						},
					],
					indexes: [
						{
							name: "herald_delivery_unknown_idx",
							fields: ["missingProperty"],
						},
					],
				},
			],
		};

		expect(() => normalizeHeraldDbSchema(schema)).toThrow(
			"HERALD_DB_SCHEMA index herald_delivery_unknown_idx on herald_deliveries references unknown field/property missingProperty",
		);
	});

	it("reports index table association drift", () => {
		const expected = fixtureSchema("HERALD_DB_SCHEMA", [
			{
				tableName: "herald_deliveries",
				columns: ["id", "status", "scheduled_at"],
				indexes: [
					{
						name: "herald_delivery_scheduled_idx",
						tableName: "herald_deliveries",
						columns: ["status", "scheduled_at"],
						where: { field: "status", equals: "scheduled" },
					},
				],
			},
		]);
		const actual = fixtureSchema("drizzle-schema.ts", [
			{
				tableName: "herald_deliveries",
				columns: ["id", "status", "scheduled_at"],
				indexes: [],
			},
			{
				tableName: "herald_notifications",
				columns: [],
				indexes: [
					{
						name: "herald_delivery_scheduled_idx",
						tableName: "herald_notifications",
						columns: ["scheduled_at", "status"],
						where: { field: "status", equals: "queued" },
					},
				],
			},
		]);

		const diagnostics = compareFixtureToMetadata(expected, actual).join("\n\n");

		expect(diagnostics).toContain(
			"index herald_delivery_scheduled_idx has incorrect table association",
		);
		expect(diagnostics).toContain("expected metadata value: table herald_deliveries");
		expect(diagnostics).toContain("actual fixture value: table herald_notifications");
	});

	it("reports index field order and predicate drift", () => {
		const expected = fixtureSchema("HERALD_DB_SCHEMA", [
			{
				tableName: "herald_deliveries",
				columns: ["id", "status", "scheduled_at"],
				indexes: [
					{
						name: "herald_delivery_scheduled_idx",
						tableName: "herald_deliveries",
						columns: ["status", "scheduled_at"],
						where: { field: "status", equals: "scheduled" },
					},
				],
			},
		]);
		const actual = fixtureSchema("drizzle-schema.ts", [
			{
				tableName: "herald_deliveries",
				columns: ["id", "status", "scheduled_at"],
				indexes: [
					{
						name: "herald_delivery_scheduled_idx",
						tableName: "herald_deliveries",
						columns: ["scheduled_at", "status"],
						where: { field: "status", equals: "queued" },
					},
				],
			},
		]);

		const diagnostics = compareFixtureToMetadata(expected, actual).join("\n\n");

		expect(diagnostics).toContain(
			"index herald_delivery_scheduled_idx has incorrect field order",
		);
		expect(diagnostics).toContain("expected metadata value: columns(status, scheduled_at)");
		expect(diagnostics).toContain("actual fixture value: columns(scheduled_at, status)");
		expect(diagnostics).toContain(
			"index herald_delivery_scheduled_idx has incorrect predicate",
		);
		expect(diagnostics).toContain("expected metadata value: status = 'scheduled'");
		expect(diagnostics).toContain("actual fixture value: status = 'queued'");
	});

	it("throws when Drizzle indexes reference unknown table fields", () => {
		const source = `
			export const deliveries = pgTable("herald_deliveries", {
				status: text("status").notNull(),
			}, (t) => [
				index("herald_delivery_unknown_idx").on(t.missingProperty),
			]);
		`;

		expect(() =>
			extractDrizzleFixtureSchemaFromSource("drizzle-schema.ts", source),
		).toThrow(
			"drizzle-schema.ts: index herald_delivery_unknown_idx on herald_deliveries references unknown Drizzle field/property missingProperty",
		);
	});

	it("reports fixture path, affected object, expected value, and actual value for schema drift", () => {
		const expected = fixtureSchema("HERALD_DB_SCHEMA", [
			{
				tableName: "herald_deliveries",
				columns: ["id"],
				indexes: [
					{
						name: "herald_delivery_status_claim_expires_idx",
						tableName: "herald_deliveries",
						columns: ["status", "claim_expires_at"],
					},
				],
			},
		]);
		const actual = fixtureSchema(
			"src/__tests__/helpers/database-adapter-real-targets/herald-schema.sql",
			[
				{
					tableName: "herald_deliveries",
					columns: ["id", "legacy_column"],
					indexes: [
						{
							name: "herald_delivery_status_claim_exp_idx",
							tableName: "herald_deliveries",
							columns: ["status", "claim_expires_at"],
						},
					],
				},
			],
		);

		const diagnostics = compareFixtureToMetadata(expected, actual).join("\n\n");

		expect(diagnostics).toContain(
			"src/__tests__/helpers/database-adapter-real-targets/herald-schema.sql",
		);
		expect(diagnostics).toContain(
			"table herald_deliveries extra column legacy_column",
		);
		expect(diagnostics).toContain("expected metadata value: <missing>");
		expect(diagnostics).toContain("actual fixture value: legacy_column");
		expect(diagnostics).toContain(
			"missing index herald_delivery_status_claim_expires_idx",
		);
		expect(diagnostics).toContain(
			"extra index herald_delivery_status_claim_exp_idx",
		);
	});
});

function fixtureSchema(
	sourcePath: string,
	tables: NormalizedFixtureSchema["tables"],
): NormalizedFixtureSchema {
	return { sourcePath, tables };
}
