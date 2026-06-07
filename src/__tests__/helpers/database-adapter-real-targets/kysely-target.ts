import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import {
	createKyselyAdapter,
	type HeraldDatabase,
} from "../../../adapters/db/kysely.js";
import type { RealDbConformanceTarget, RealDbTargetContext } from "./target.js";
import { createRealDbConformanceHelpers } from "./target.js";
import {
	cleanupAfterCreateFailure,
	createSchemaName,
	createPostgresTestbed,
	quotePostgresIdentifier,
	type SqlExecutor,
} from "./postgres-testbed.js";
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

export interface KyselyRealTargetOptions {
	url: string;
	keepSchema?: boolean;
}

export function createKyselyRealConformanceTarget(
	options: KyselyRealTargetOptions,
): RealDbConformanceTarget<
	RealDbTargetContext & {
		pool: Pool;
		kysely: Kysely<HeraldDatabase>;
		adminPool: Pool;
		adminClient: PoolClient;
	}
> {
	const schema = createSchemaName("herald_kysely_conformance");

	return {
		name: "kysely-real-postgres",
		async create() {
			const adminPool = new Pool({
				connectionString: depoolNeonUrl(options.url),
			});
			let adminClient: PoolClient | null = null;
			let testbed: ReturnType<typeof createPostgresTestbed> | null = null;
			let pool: Pool | null = null;
			let kysely: Kysely<HeraldDatabase> | null = null;

			try {
				adminClient = await adminPool.connect();
				const executor = new PgSqlExecutor(adminClient);
				testbed = createPostgresTestbed({
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

				pool = new Pool({
					connectionString: withSearchPath(depoolNeonUrl(options.url), schema),
					max: 1,
				});

				kysely = new Kysely<HeraldDatabase>({
					dialect: new PostgresDialect({ pool }),
				});
				const adapter = createKyselyAdapter(kysely, {
					getUserEmail: (userId) => users.getUserEmail(userId),
				});

				const context = {
					schema,
					executor,
					users,
					pool,
					kysely,
					adminPool,
					adminClient,
				};
				return { adapter, context };
			} catch (error) {
				return cleanupAfterCreateFailure(error, () =>
					cleanupKyselyCreateFailure({
						adminPool,
						adminClient,
						keepSchema: options.keepSchema,
						kysely,
						pool,
						testbed,
					}),
				);
			}
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
			await context.kysely.destroy();
			try {
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

async function cleanupKyselyCreateFailure(args: {
	adminPool: Pool;
	adminClient: PoolClient | null;
	keepSchema?: boolean;
	kysely: Kysely<HeraldDatabase> | null;
	pool: Pool | null;
	testbed: ReturnType<typeof createPostgresTestbed> | null;
}): Promise<void> {
	try {
		if (args.kysely) {
			await args.kysely.destroy();
		} else {
			await args.pool?.end();
		}
	} finally {
		try {
			if (!args.keepSchema && args.testbed) {
				await args.testbed.dropSchema();
			}
		} finally {
			args.adminClient?.release();
			await args.adminPool.end();
		}
	}
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
