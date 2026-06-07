import { readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { createPrismaAdapter } from "../../../adapters/db/prisma.js";
import type { RealDbConformanceTarget, RealDbTargetContext } from "./target.js";
import { createRealDbConformanceHelpers } from "./target.js";
import {
	cleanupAfterCreateFailure,
	createPostgresTestbed,
	createSchemaName,
	type SqlExecutor,
} from "./postgres-testbed.js";
import { createUserEmailStore } from "./user-email-store.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const HERALD_SCHEMA_SQL = readFileSync(
	join(__dirname, "herald-schema.sql"),
	"utf8",
);
const PRISMA_SCHEMA_TEMPLATE = readFileSync(
	join(__dirname, "prisma-schema.template"),
	"utf8",
);
const PRISMA_CLIENT_OUTPUT_ROOT = join(__dirname, "prisma-generated-client");

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

export interface PrismaRealTargetOptions {
	url: string;
	keepSchema?: boolean;
}

type GeneratedPrismaClientModule = {
	PrismaClient: new (...args: any[]) => any;
};

const prismaClientModulePromises = new Map<
	string,
	Promise<GeneratedPrismaClientModule>
>();

export function createPrismaRealConformanceTarget(
	options: PrismaRealTargetOptions,
): RealDbConformanceTarget<
	RealDbTargetContext & {
		adminPool: Pool;
		adminClient: PoolClient;
		prisma: any;
	}
> {
	const schema = createSchemaName("herald_prisma_conformance");

	return {
		name: "prisma-real-postgres",
		async create() {
			const adminPool = new Pool({
				connectionString: depoolNeonUrl(options.url),
			});
			let adminClient: PoolClient | null = null;
			let testbed: ReturnType<typeof createPostgresTestbed> | null = null;
			let prisma: any = null;

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
				const prismaModule = await loadGeneratedPrismaClient(schema);
				const prismaConnectionString = withSearchPath(
					depoolNeonUrl(options.url),
					schema,
				);
				prisma = new prismaModule.PrismaClient({
					adapter: new PrismaPg({ connectionString: prismaConnectionString }),
				});
				const adapter = createPrismaAdapter(prisma, {
					getUserEmail: (userId) => users.getUserEmail(userId),
				});
				return {
					adapter,
					context: {
						schema,
						executor,
						users,
						adminPool,
						adminClient,
						prisma,
					},
				};
			} catch (error) {
				return cleanupAfterCreateFailure(error, () =>
					cleanupPrismaCreateFailure({
						adminPool,
						adminClient,
						keepSchema: options.keepSchema,
						prisma,
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
			await context.prisma.$disconnect();
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

async function loadGeneratedPrismaClient(
	schema: string,
): Promise<GeneratedPrismaClientModule> {
	const cached = prismaClientModulePromises.get(schema);
	if (cached) return cached;

	const promise = generateAndImportPrismaClient(schema);
	prismaClientModulePromises.set(schema, promise);
	promise.catch(() => {
		prismaClientModulePromises.delete(schema);
	});
	return promise;
}

async function generateAndImportPrismaClient(
	schema: string,
): Promise<GeneratedPrismaClientModule> {
	const clientOutput = join(PRISMA_CLIENT_OUTPUT_ROOT, schema);
	const clientEntry = join(clientOutput, "index.js");
	const schemaPath = join(
		__dirname,
		`prisma-schema.${schema}.generated.prisma`,
	);
	const generatedSchema = PRISMA_SCHEMA_TEMPLATE.split("__DATABASE_SCHEMA__")
		.join(schema)
		.replace("__PRISMA_CLIENT_OUTPUT__", clientOutput.replace(/\\/g, "\\\\"));
	await writeFile(schemaPath, generatedSchema, "utf8");

	try {
		await execFileAsync("npx", ["prisma", "generate", "--schema", schemaPath]);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			"Failed to generate Prisma conformance client. Install prisma/@prisma/client and run: npx prisma generate --schema <schema>. Reason: " +
				reason,
		);
	} finally {
		await rm(schemaPath, { force: true });
	}

	try {
		return (await import(
			pathToFileURL(clientEntry).href
		)) as GeneratedPrismaClientModule;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			"Failed to import generated Prisma conformance client at " +
				clientEntry +
				". Reason: " +
				reason,
		);
	}
}

async function cleanupPrismaCreateFailure(args: {
	adminPool: Pool;
	adminClient: PoolClient | null;
	keepSchema?: boolean;
	prisma: any;
	testbed: ReturnType<typeof createPostgresTestbed> | null;
}): Promise<void> {
	try {
		await args.prisma?.$disconnect();
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
	parsed.searchParams.append("options", `-c search_path=${schema}`);
	return parsed.toString();
}

function depoolNeonUrl(url: string): string {
	const parsed = new URL(url);
	parsed.hostname = parsed.hostname.replace("-pooler.", ".");
	return parsed.toString();
}
