import { describe, expect, it } from "vitest";
import * as herald from "../index.js";

describe("root public API", () => {
	it("exports the configured API and quarantines old root runtime factories", () => {
		expect(typeof herald.configureHerald).toBe("function");
		expect("defineEvent" in herald).toBe(false);
		expect("createHerald" in herald).toBe(false);
		expect("createHeraldRuntime" in herald).toBe(false);
	});
});
