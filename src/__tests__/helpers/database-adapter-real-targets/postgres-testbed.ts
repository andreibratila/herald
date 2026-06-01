import { randomUUID } from "node:crypto";

export interface SqlExecutor {
	execute(sql: string, params?: unknown[]): Promise<unknown>;
	queryOne?<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface PostgresTestbed {
	schema: string;
	createSchema(): Promise<void>;
	dropSchema(): Promise<void>;
	applySchemaFixture(): Promise<void>;
	truncateTables(): Promise<void>;
	assertSearchPath(): Promise<void>;
}

export function createSchemaName(seed = "herald_conformance"): string {
	const entropy = randomUUID().replace(/-/g, "").slice(0, 12);
	return `${seed}_${entropy}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

export function createPostgresTestbed(args: {
	executor: SqlExecutor;
	schema: string;
	schemaSql: string;
	tables: string[];
}): PostgresTestbed {
	const schemaRef = quotePostgresIdentifier(args.schema);
	const tableRefs = args.tables.map(
		(table) => `${schemaRef}.${quotePostgresIdentifier(table)}`,
	);

	return {
		schema: args.schema,
		async createSchema() {
			await args.executor.execute(buildCreateSchemaSql(schemaRef));
			await args.executor.execute(buildSetSearchPathSql(schemaRef));
		},
		async dropSchema() {
			await args.executor.execute(buildDropSchemaSql(schemaRef));
		},
		async applySchemaFixture() {
			await args.executor.execute(buildSetSearchPathSql(schemaRef));
			await args.executor.execute(args.schemaSql);
		},
		async truncateTables() {
			if (tableRefs.length === 0) return;
			await args.executor.execute(buildTruncateSql(tableRefs));
		},
		async assertSearchPath() {
			if (!args.executor.queryOne) return;
			const row = await args.executor.queryOne<{ current_schema: string }>(
				"SELECT current_schema() as current_schema",
			);
			if (!row || row.current_schema !== args.schema) {
				throw new Error(
					`Expected current_schema()=${args.schema}, got ${row?.current_schema ?? "null"}`,
				);
			}
		},
	};
}

export function quotePostgresIdentifier(input: string): string {
	return `"${input.replace(/"/g, '""')}"`;
}

function buildCreateSchemaSql(schemaRef: string): string {
	return "CREATE SCHEMA IF NOT EXISTS " + schemaRef;
}

function buildSetSearchPathSql(schemaRef: string): string {
	return "SET search_path TO " + schemaRef;
}

function buildDropSchemaSql(schemaRef: string): string {
	return "DROP SCHEMA IF EXISTS " + schemaRef + " CASCADE";
}

function buildTruncateSql(tableRefs: string[]): string {
	return "TRUNCATE TABLE " + tableRefs.join(", ") + " RESTART IDENTITY CASCADE";
}
