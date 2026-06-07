import { describe, expect, it } from "vitest";
import {
	cleanupAfterCreateFailure,
	createPostgresTestbed,
	createSchemaName,
	quotePostgresIdentifier,
	type SqlExecutor,
} from "./postgres-testbed.js";

function makeExecutor() {
	const calls: Array<{ sql: string; params?: unknown[] }> = [];
	const executor: SqlExecutor = {
		async execute(sql, params) {
			calls.push({ sql, params });
		},
		async queryOne<T = unknown>(_sql: string, _params?: unknown[]) {
			return { current_schema: "herald_conformance_test" } as T;
		},
	};
	return { executor, calls };
}

describe("postgres testbed", () => {
	it("builds safe schema names and quotes identifiers", () => {
		const schema = createSchemaName("herald-conformance");
		expect(schema).toMatch(/^herald_conformance_[a-z0-9_]+$/);
		expect(quotePostgresIdentifier('debug"schema')).toBe('"debug""schema"');
	});

	it("emits lifecycle SQL for schema + fixture + truncate", async () => {
		const { executor, calls } = makeExecutor();
		const testbed = createPostgresTestbed({
			executor,
			schema: "herald_conformance_test",
			schemaSql: "CREATE TABLE x(id text)",
			tables: ["herald_notifications", "herald_deliveries"],
		});

		await testbed.createSchema();
		await testbed.applySchemaFixture();
		await testbed.truncateTables();
		await testbed.dropSchema();

		expect(calls.map((call) => call.sql)).toEqual([
			'CREATE SCHEMA IF NOT EXISTS "herald_conformance_test"',
			'SET search_path TO "herald_conformance_test"',
			'SET search_path TO "herald_conformance_test"',
			"CREATE TABLE x(id text)",
			'TRUNCATE TABLE "herald_conformance_test"."herald_notifications", "herald_conformance_test"."herald_deliveries" RESTART IDENTITY CASCADE',
			'DROP SCHEMA IF EXISTS "herald_conformance_test" CASCADE',
		]);
	});

	it("preserves the original create error when cleanup succeeds", async () => {
		const originalError = new Error("create failed");

		await expect(
			cleanupAfterCreateFailure(originalError, async () => {}),
		).rejects.toBe(originalError);
	});

	it("preserves the original create error when cleanup also fails", async () => {
		const originalError = new Error("create failed");
		const cleanupError = new Error("cleanup failed");

		await expect(
			cleanupAfterCreateFailure(originalError, async () => {
				throw cleanupError;
			}),
		).rejects.toBe(originalError);
		expect((originalError as { cleanupError?: unknown }).cleanupError).toBe(
			cleanupError,
		);
		expect(Object.keys(originalError)).not.toContain("cleanupError");
	});
});
