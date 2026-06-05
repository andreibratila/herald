import { describe, expect, it } from "vitest";
import {
	runAuditConformance,
	runComplianceLifecycleConformance,
	runConsentSuppressionConformance,
	runDeliveryConformance,
	runNotificationConformance,
	runScheduledLifecycleConformance,
	runUserLookupConformance,
} from "../../helpers/database-adapter-conformance.js";
import {
	getRealDbSkipReason,
	parseRealDbConformanceEnv,
	shouldRunRealDbAdapter,
} from "../../helpers/database-adapter-real-targets/env.js";
import { createPrismaRealConformanceTarget } from "../../helpers/database-adapter-real-targets/prisma-target.js";

const env = parseRealDbConformanceEnv();
const adapter = "prisma";

describe("Prisma adapter — real DB conformance (env-gated)", () => {
	const shouldRun = shouldRunRealDbAdapter(adapter, env);
	const skipReason = getRealDbSkipReason(adapter, env);

	if (!shouldRun) {
		it(skipReason ?? "skipped by env configuration", () => {
			expect(shouldRun).toBe(false);
		});
		return;
	}

	if (!env.url) {
		it("fails fast when explicit real DB mode is enabled without URL", () => {
			throw new Error(
				"HERALD_DB_CONFORMANCE=1 for adapter=prisma requires HERALD_DB_CONFORMANCE_URL. Example: HERALD_DB_CONFORMANCE=1 HERALD_DB_CONFORMANCE_ADAPTERS=prisma HERALD_DB_CONFORMANCE_URL=postgres://... npx vitest run src/__tests__/conformance/adapters-db/prisma.real-conformance.test.ts",
			);
		});
		return;
	}

	const target = createPrismaRealConformanceTarget({
		url: env.url,
		keepSchema: env.keepSchema,
	});

	runNotificationConformance(target);
	runDeliveryConformance(target);
	runConsentSuppressionConformance(target);
	runAuditConformance(target);
	runComplianceLifecycleConformance(target);
	runScheduledLifecycleConformance(target);
	runUserLookupConformance(target);
});
