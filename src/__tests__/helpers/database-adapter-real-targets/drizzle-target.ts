import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { createDrizzleAdapter } from "../../../adapters/db/drizzle.js";
import type { RealDbConformanceTarget, RealDbTargetContext } from "./target.js";
import { createRealDbConformanceHelpers } from "./target.js";
import {
	createPostgresTestbed,
	createSchemaName,
	quotePostgresIdentifier,
	type SqlExecutor,
} from "./postgres-testbed.js";
import { drizzleHeraldTables } from "./drizzle-schema.js";
import { createUserEmailStore } from "./user-email-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HERALD_SCHEMA_SQL = readFileSync(
	join(__dirname, "herald-schema.sql"),
	"utf8",
);

const HERALD_TABLES = [
	"herald_notifications",
	"herald_deliveries",
	"herald_consent_events",
	"herald_suppressions",
	"herald_audit_logs",
] as const;

class PgSqlExecutor implements SqlExecutor {
	constructor(private readonly client: PoolClient) {}

	async execute(sql: string, params?: unknown[]): Promise<unknown> {
		return this.client.query(sql, params as unknown[] | undefined);
	}

	async queryOne<T = unknown>(
		sql: string,
		params?: unknown[],
	): Promise<T | null> {
		const result = await this.client.query<QueryResultRow>(
			sql,
			params as unknown[] | undefined,
		);
		return (result.rows[0] as T | undefined) ?? null;
	}
}

export interface DrizzleRealTargetOptions {
	url: string;
	keepSchema?: boolean;
}

export function createDrizzleRealConformanceTarget(
	options: DrizzleRealTargetOptions,
): RealDbConformanceTarget<
	RealDbTargetContext & {
		adminPool: Pool;
		adminClient: PoolClient;
		pool: Pool;
	}
> {
	const schema = createSchemaName("herald_drizzle_conformance");

	return {
		name: "drizzle-real-postgres",
		async create() {
			const adminPool = new Pool({
				connectionString: depoolNeonUrl(options.url),
			});
			const adminClient = await adminPool.connect();
			const executor = new PgSqlExecutor(adminClient);
			const testbed = createPostgresTestbed({
				executor,
				schema,
				schemaSql: HERALD_SCHEMA_SQL,
				tables: [...HERALD_TABLES],
			});
			await testbed.createSchema();
			await testbed.applySchemaFixture();
			await testbed.assertSearchPath();
			await testbed.truncateTables();

			const users = createUserEmailStore();
			const pool = new Pool({
				connectionString: withSearchPath(depoolNeonUrl(options.url), schema),
				max: 1,
			});
			const db = drizzle(pool);
			const adapter = createDrizzleAdapter(db, drizzleHeraldTables, {
				getUserEmail: (userId) => users.getUserEmail(userId),
			});

			return {
				adapter,
				context: { schema, executor, users, adminPool, adminClient, pool },
			};
		},
		async reset(context) {
			const testbed = createPostgresTestbed({
				executor: context.executor,
				schema: context.schema,
				schemaSql: HERALD_SCHEMA_SQL,
				tables: [...HERALD_TABLES],
			});
			await testbed.truncateTables();
			context.users.reset();
		},
		async destroy(context) {
			try {
				await context.pool.end();
				if (!options.keepSchema) {
					const testbed = createPostgresTestbed({
						executor: context.executor,
						schema: context.schema,
						schemaSql: HERALD_SCHEMA_SQL,
						tables: [...HERALD_TABLES],
					});
					await testbed.dropSchema();
				}
			} finally {
				context.adminClient.release();
				await context.adminPool.end();
			}
		},
		helpers: createRealDbConformanceHelpers(schema),
	};
}

function withSearchPath(url: string, schema: string): string {
	const parsed = new URL(url);
	const quotedSchema = quotePostgresIdentifier(schema);
	parsed.searchParams.append("options", `-c search_path=${quotedSchema}`);
	return parsed.toString();
}

function depoolNeonUrl(url: string): string {
	const parsed = new URL(url);
	parsed.hostname = parsed.hostname.replace("-pooler.", ".");
	return parsed.toString();
}
