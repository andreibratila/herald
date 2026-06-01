export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const t = setTimeout(resolve, ms);
		t.unref?.();
	});
}

export async function safeHook(
	fn: () => PromiseLike<void> | void,
): Promise<void> {
	try {
		await fn();
	} catch (e) {
		console.warn("[herald] Hook threw:", e);
	}
}
