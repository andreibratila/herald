import { describe, expect, it } from "vitest";
import { createUserEmailStore } from "./user-email-store.js";

describe("real DB user email store", () => {
	it("seeds and resolves values", async () => {
		const store = createUserEmailStore();
		store.seed("u1", "u1@example.test");
		store.seed("u2", null);
		expect(await store.getUserEmail("u1")).toBe("u1@example.test");
		expect(await store.getUserEmail("u2")).toBeNull();
		expect(await store.getUserEmail("missing")).toBeNull();
	});

	it("resets all values", async () => {
		const store = createUserEmailStore();
		store.seed("u1", "u1@example.test");
		store.reset();
		expect(await store.getUserEmail("u1")).toBeNull();
	});
});
