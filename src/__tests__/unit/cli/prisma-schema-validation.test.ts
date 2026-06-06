import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { main } from "../../../cli/index.js";

const execFileAsync = promisify(execFile);

function wrapPrismaSnippet(snippet: string): string {
	return `generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["partialIndexes"]
}

datasource db {
  provider = "postgresql"
}
${snippet}`;
}

describe("CLI — Prisma schema validation", () => {
	it("emits a Prisma model snippet that validates inside a Prisma 7 wrapper", async () => {
		const { stdout, exitCode } = main(["generate", "--adapter", "prisma"]);
		expect(exitCode).toBe(0);
		expect(stdout).not.toContain("generator client");
		expect(stdout).not.toContain("datasource db");
		expect(stdout).toContain(
			'@@index([scheduledAt], where: { status: "scheduled" }, map: "herald_delivery_scheduled_idx")',
		);

		const directory = await mkdtemp(join(tmpdir(), "herald-prisma-schema-"));
		const schemaPath = join(directory, "schema.prisma");

		try {
			await writeFile(schemaPath, wrapPrismaSnippet(stdout), "utf8");
			await expect(
				execFileAsync("npx", ["prisma", "validate", "--schema", schemaPath]),
			).resolves.toBeDefined();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
