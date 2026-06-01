export interface RealDbConformanceEnv {
	enabled: boolean;
	url: string | null;
	adapters: string[];
	keepSchema: boolean;
}

export function parseRealDbConformanceEnv(
	env: NodeJS.ProcessEnv = process.env,
): RealDbConformanceEnv {
	const enabled = env.HERALD_DB_CONFORMANCE === "1";
	const url = env.HERALD_DB_CONFORMANCE_URL?.trim() || null;
	const adapters = (env.HERALD_DB_CONFORMANCE_ADAPTERS ?? "")
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
	const keepSchema = env.HERALD_DB_CONFORMANCE_KEEP_SCHEMA === "1";
	return { enabled, url, adapters, keepSchema };
}

export function ensureRealDbConformanceUrl(
	parsed: RealDbConformanceEnv,
): string {
	if (!parsed.enabled) {
		throw new Error(
			"HERALD_DB_CONFORMANCE is not enabled. Set HERALD_DB_CONFORMANCE=1 to run real DB adapter conformance.",
		);
	}
	if (!parsed.url) {
		throw new Error(
			"HERALD_DB_CONFORMANCE_URL is required when HERALD_DB_CONFORMANCE=1.",
		);
	}
	return parsed.url;
}

export function shouldRunRealDbAdapter(
	adapter: string,
	parsed: RealDbConformanceEnv,
): boolean {
	if (!parsed.enabled) return false;
	if (parsed.adapters.length === 0) return true;
	return parsed.adapters.includes(adapter);
}

export function getRealDbSkipReason(
	adapter: string,
	parsed: RealDbConformanceEnv,
): string | null {
	if (!parsed.enabled) {
		return "Set HERALD_DB_CONFORMANCE=1 to enable real DB-backed conformance targets.";
	}
	if (!parsed.url) {
		return "Set HERALD_DB_CONFORMANCE_URL when HERALD_DB_CONFORMANCE=1.";
	}
	if (parsed.adapters.length > 0 && !parsed.adapters.includes(adapter)) {
		return `Adapter ${adapter} is filtered out by HERALD_DB_CONFORMANCE_ADAPTERS=${parsed.adapters.join(",")}.`;
	}
	return null;
}
