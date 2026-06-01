import { describe, expect, it } from "vitest";
import {
	ensureRealDbConformanceUrl,
	getRealDbSkipReason,
	parseRealDbConformanceEnv,
	shouldRunRealDbAdapter,
} from "./env.js";

describe("real DB conformance env", () => {
	it("parses defaults with disabled mode", () => {
		const parsed = parseRealDbConformanceEnv({});
		expect(parsed).toEqual({
			enabled: false,
			url: null,
			adapters: [],
			keepSchema: false,
		});
		expect(getRealDbSkipReason("kysely", parsed)).toContain(
			"HERALD_DB_CONFORMANCE=1",
		);
	});

	it("parses enabled mode and adapter filters", () => {
		const parsed = parseRealDbConformanceEnv({
			HERALD_DB_CONFORMANCE: "1",
			HERALD_DB_CONFORMANCE_URL: "postgres://localhost/db",
			HERALD_DB_CONFORMANCE_ADAPTERS: "kysely, drizzle",
			HERALD_DB_CONFORMANCE_KEEP_SCHEMA: "1",
		});
		expect(parsed.enabled).toBe(true);
		expect(parsed.url).toBe("postgres://localhost/db");
		expect(parsed.adapters).toEqual(["kysely", "drizzle"]);
		expect(parsed.keepSchema).toBe(true);
		expect(ensureRealDbConformanceUrl(parsed)).toBe("postgres://localhost/db");
		expect(shouldRunRealDbAdapter("kysely", parsed)).toBe(true);
		expect(shouldRunRealDbAdapter("prisma", parsed)).toBe(false);
	});

	it("fails fast when enabled without URL", () => {
		const parsed = parseRealDbConformanceEnv({ HERALD_DB_CONFORMANCE: "1" });
		expect(() => ensureRealDbConformanceUrl(parsed)).toThrow(
			"HERALD_DB_CONFORMANCE_URL",
		);
		expect(getRealDbSkipReason("kysely", parsed)).toContain("URL");
	});
});
