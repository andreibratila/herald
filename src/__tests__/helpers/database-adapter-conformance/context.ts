import { afterEach, beforeEach } from "vitest";
import type { Delivery, HeraldDatabaseAdapter } from "../../../types/index.js";

export interface DatabaseAdapterConformanceHelpers<TContext> {
	setNotificationCreatedAt?(
		context: TContext,
		id: string,
		createdAt: Date,
	): Promise<void> | void;
	setDeliveryTimestamps?(
		context: TContext,
		id: string,
		timestamps: Partial<Pick<Delivery, "createdAt" | "updatedAt">>,
	): Promise<void> | void;
	setAuditLogCreatedAt?(
		context: TContext,
		id: string,
		createdAt: Date,
	): Promise<void> | void;
	hashSubjectId?(
		context: TContext,
		subjectId: string,
	): Promise<string> | string;
	seedUserEmail?(
		context: TContext,
		userId: string,
		email: string | null,
	): Promise<void> | void;
}

export interface DatabaseAdapterConformanceTarget<TContext = unknown> {
	name: string;
	create():
		| Promise<{ adapter: HeraldDatabaseAdapter; context: TContext }>
		| { adapter: HeraldDatabaseAdapter; context: TContext };
	reset?(context: TContext): Promise<void> | void;
	destroy?(context: TContext): Promise<void> | void;
	helpers?: DatabaseAdapterConformanceHelpers<TContext>;
}

export interface ConformanceRuntime<TContext> {
	target: DatabaseAdapterConformanceTarget<TContext>;
	getAdapter(): HeraldDatabaseAdapter;
	getContext(): TContext;
}

export function setupConformanceRuntime<TContext>(
	target: DatabaseAdapterConformanceTarget<TContext>,
): ConformanceRuntime<TContext> {
	let adapter: HeraldDatabaseAdapter | null = null;
	let context: TContext | null = null;

	beforeEach(async () => {
		const created = await target.create();
		adapter = created.adapter;
		context = created.context;
	});

	afterEach(async () => {
		if (context !== null && target.reset) {
			await target.reset(context);
		}
		if (context !== null && target.destroy) {
			await target.destroy(context);
		}
		adapter = null;
		context = null;
	});

	return {
		target,
		getAdapter() {
			if (!adapter) throw new Error("Conformance adapter not initialized");
			return adapter;
		},
		getContext() {
			if (context === null) {
				throw new Error("Conformance context not initialized");
			}
			return context;
		},
	};
}
