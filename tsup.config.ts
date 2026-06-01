import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		// Core entrypoint
		index: "src/index.ts",
		// DB adapters (public path: herald/adapters/prisma etc.)
		"adapters/db/prisma": "src/adapters/db/prisma.ts",
		"adapters/db/drizzle": "src/adapters/db/drizzle.ts",
		"adapters/db/kysely": "src/adapters/db/kysely.ts",
		// Mail adapters
		"adapters/mail/resend": "src/adapters/mail/resend.ts",
		"adapters/mail/nodemailer": "src/adapters/mail/nodemailer.ts",
		"adapters/mail/sendgrid": "src/adapters/mail/sendgrid.ts",
		"adapters/mail/postmark": "src/adapters/mail/postmark.ts",
		// CLI
		"cli/index": "src/cli/index.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	sourcemap: true,
	clean: true,
	splitting: false,
	treeshake: true,
	external: [
		"@prisma/client",
		"drizzle-orm",
		"kysely",
		"pg-boss",
		"resend",
		"nodemailer",
		"@sendgrid/mail",
	],
});
