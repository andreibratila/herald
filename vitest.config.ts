import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globals: false,
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		exclude: ["node_modules", "dist", "**/*.d.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			include: [
				"src/core/**",
				"src/compliance/**",
				"src/queue/**",
				"src/cli/**",
			],
			exclude: [
				"src/__tests__/helpers/**",
				"**/*.d.ts",
				"**/*.test.{ts,tsx}",
				"src/types/**",
			],
			thresholds: {
				lines: 85,
				branches: 80,
				functions: 85,
				statements: 85,
			},
		},
	},
});
