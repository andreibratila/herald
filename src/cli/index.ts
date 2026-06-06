#!/usr/bin/env node
// ============================================================
// herald — src/cli/index.ts
// CLI schema generator
// Usage: npx herald generate --adapter prisma|drizzle|kysely
// ============================================================

import { DRIZZLE_SCHEMA } from "./schemas/drizzle.js";
import { KYSELY_SCHEMA } from "./schemas/kysely.js";
import { PRISMA_SCHEMA } from "./schemas/prisma.js";

export function main(argv: string[]): { stdout: string; exitCode: number } {
	const command = argv[0];

	if (!command || command === "--help" || command === "-h") {
		return {
			stdout: `
herald CLI

Usage:
  npx herald generate --adapter <prisma|drizzle|kysely>

Commands:
  generate    Output the DB schema for your chosen adapter

Options:
  --adapter   Target adapter (default: prisma)
  --help      Show this help

Examples:
  # Append or merge into an existing Prisma schema:
  # Requires Prisma >=7.4.0 and generator previewFeatures = ["partialIndexes"].
  # Herald emits schema text only; run your normal Prisma workflow after review.
  npx herald generate --adapter prisma >> prisma/schema.prisma

  # Create a new drizzle schema file:
  npx herald generate --adapter drizzle > src/db/herald.schema.ts

  # Create a SQL migration:
  npx herald generate --adapter kysely > migrations/herald_init.sql
`,
			exitCode: 0,
		};
	}

	if (command !== "generate") {
		return {
			stdout: `Unknown command "${command}". Run: npx herald --help\n`,
			exitCode: 1,
		};
	}

	const adapterIdx = argv.indexOf("--adapter");
	const adapter = adapterIdx !== -1 ? argv[adapterIdx + 1] : "prisma";

	switch (adapter) {
		case "prisma":
			return { stdout: PRISMA_SCHEMA, exitCode: 0 };
		case "drizzle":
			return { stdout: DRIZZLE_SCHEMA, exitCode: 0 };
		case "kysely":
			return { stdout: KYSELY_SCHEMA, exitCode: 0 };
		default:
			return {
				stdout: `Unknown adapter "${adapter}". Use: prisma | drizzle | kysely\n`,
				exitCode: 1,
			};
	}
}

// ── Module-main guard (ESM) ───────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
	const { stdout, exitCode } = main(process.argv.slice(2));
	if (exitCode !== 0) process.stderr.write(stdout);
	else process.stdout.write(stdout);
	process.exit(exitCode);
}
