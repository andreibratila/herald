export interface UserEmailStore {
	getUserEmail(userId: string): Promise<string | null>;
	seed(userId: string, email: string | null): void;
	reset(): void;
}

export function createUserEmailStore(): UserEmailStore {
	const users = new Map<string, string | null>();
	return {
		async getUserEmail(userId: string) {
			return users.get(userId) ?? null;
		},
		seed(userId: string, email: string | null) {
			users.set(userId, email);
		},
		reset() {
			users.clear();
		},
	};
}
