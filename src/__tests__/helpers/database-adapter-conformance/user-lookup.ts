import { describe, expect, it } from "vitest";
import type { DatabaseAdapterConformanceTarget } from "./context.js";
import { setupConformanceRuntime } from "./context.js";
import { USERS } from "./fixtures.js";

export function runUserLookupConformance<TContext>(
	target: DatabaseAdapterConformanceTarget<TContext>,
): void {
	describe(`user lookup conformance: ${target.name}`, () => {
		const runtime = setupConformanceRuntime(target);

		it("user lookup: resolves existing user email and returns null for missing users", async () => {
			const db = runtime.getAdapter();
			const context = runtime.getContext();

			if (!target.helpers?.seedUserEmail) {
				throw new Error(
					`Target ${target.name} must provide helpers.seedUserEmail to run user lookup conformance.`,
				);
			}

			await target.helpers.seedUserEmail(
				context,
				USERS.alpha,
				"alpha@example.test",
			);
			await target.helpers.seedUserEmail(context, USERS.beta, null);

			expect(await db.getUserEmail(USERS.alpha)).toBe("alpha@example.test");
			expect(await db.getUserEmail(USERS.beta)).toBeNull();
			expect(await db.getUserEmail("missing-user")).toBeNull();
		});
	});
}
