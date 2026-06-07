import type {
	DbDefaultKind,
	DbScalarKind,
} from "../../../../internal/db-schema/types.js";

export type NormalizedColumnDefault = Exclude<
	DbDefaultKind,
	"generatedId" | "updatedAt"
> | "none" | "updatedAt";

export interface NormalizedFixtureColumn {
	readonly name: string;
	readonly kind: DbScalarKind;
	readonly nullable: boolean;
	readonly primaryKey: boolean;
	readonly default: NormalizedColumnDefault;
}

export interface NormalizedPartialPredicate {
	readonly field: string;
	readonly equals: string;
}

export interface NormalizedFixtureIndex {
	readonly name: string;
	readonly tableName: string;
	readonly columns: readonly string[];
	readonly where?: NormalizedPartialPredicate;
}

export interface NormalizedFixtureTable {
	readonly tableName: string;
	readonly columns: readonly NormalizedFixtureColumn[];
	readonly indexes: readonly NormalizedFixtureIndex[];
}

export interface NormalizedFixtureSchema {
	readonly sourcePath: string;
	readonly tables: readonly NormalizedFixtureTable[];
}
