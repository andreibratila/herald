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
	readonly columns: readonly string[];
	readonly indexes: readonly NormalizedFixtureIndex[];
}

export interface NormalizedFixtureSchema {
	readonly sourcePath: string;
	readonly tables: readonly NormalizedFixtureTable[];
}
