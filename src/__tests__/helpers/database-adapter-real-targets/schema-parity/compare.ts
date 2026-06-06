import type {
	NormalizedFixtureIndex,
	NormalizedFixtureSchema,
	NormalizedFixtureTable,
} from "./types.js";

export function compareFixtureToMetadata(
	expected: NormalizedFixtureSchema,
	actual: NormalizedFixtureSchema,
): string[] {
	const diagnostics: string[] = [];
	const expectedTables = mapBy(expected.tables, (table) => table.tableName);
	const actualTables = mapBy(actual.tables, (table) => table.tableName);

	for (const tableName of sortedKeys(expectedTables)) {
		if (!actualTables.has(tableName)) {
			diagnostics.push(
				diagnostic(
					actual.sourcePath,
					`missing table ${tableName}`,
					tableName,
					"<missing>",
				),
			);
		}
	}

	for (const tableName of sortedKeys(actualTables)) {
		if (tableName.startsWith("herald_") && !expectedTables.has(tableName)) {
			diagnostics.push(
				diagnostic(
					actual.sourcePath,
					`extra table ${tableName}`,
					"<missing>",
					tableName,
				),
			);
		}
	}

	for (const tableName of sortedUnion(expectedTables, actualTables)) {
		const expectedTable = expectedTables.get(tableName);
		const actualTable = actualTables.get(tableName);
		if (!expectedTable || !actualTable) continue;
		diagnostics.push(
			...compareColumns(actual.sourcePath, expectedTable, actualTable),
		);
		diagnostics.push(
			...compareIndexes(
				actual.sourcePath,
				expectedTable,
				actualTable,
				actual.tables,
			),
		);
	}

	return diagnostics;
}

function compareColumns(
	sourcePath: string,
	expectedTable: NormalizedFixtureTable,
	actualTable: NormalizedFixtureTable,
): string[] {
	const diagnostics: string[] = [];
	const expected = new Set(expectedTable.columns);
	const actual = new Set(actualTable.columns);

	for (const column of [...expected].sort()) {
		if (!actual.has(column)) {
			diagnostics.push(
				diagnostic(
					sourcePath,
					`table ${expectedTable.tableName} missing column ${column}`,
					column,
					"<missing>",
				),
			);
		}
	}
	for (const column of [...actual].sort()) {
		if (!expected.has(column)) {
			diagnostics.push(
				diagnostic(
					sourcePath,
					`table ${expectedTable.tableName} extra column ${column}`,
					"<missing>",
					column,
				),
			);
		}
	}

	return diagnostics;
}

function compareIndexes(
	sourcePath: string,
	expectedTable: NormalizedFixtureTable,
	actualTable: NormalizedFixtureTable,
	allActualTables: readonly NormalizedFixtureTable[],
): string[] {
	const diagnostics: string[] = [];
	const expected = mapBy(expectedTable.indexes, (index) => index.name);
	const actual = mapBy(actualTable.indexes, (index) => index.name);

	for (const indexName of sortedKeys(expected)) {
		const expectedIndex = expected.get(indexName);
		const actualIndex = actual.get(indexName);
		if (!expectedIndex) continue;
		if (!actualIndex) {
			const misplaced = findIndexByName(allActualTables, indexName);
			diagnostics.push(
				misplaced
					? diagnostic(
							sourcePath,
							`index ${indexName} has incorrect table association`,
							`table ${expectedIndex.tableName}`,
							`table ${misplaced.tableName}`,
						)
					: diagnostic(
							sourcePath,
							`missing index ${indexName}`,
							formatIndex(expectedIndex),
							"<missing>",
						),
			);
			continue;
		}
		if (actualIndex.tableName !== expectedIndex.tableName) {
			diagnostics.push(
				diagnostic(
					sourcePath,
					`index ${indexName} has incorrect table association`,
					`table ${expectedIndex.tableName}`,
					`table ${actualIndex.tableName}`,
				),
			);
		}
		if (actualIndex.columns.join("\0") !== expectedIndex.columns.join("\0")) {
			diagnostics.push(
				diagnostic(
					sourcePath,
					`index ${indexName} has incorrect field order`,
					`columns(${expectedIndex.columns.join(", ")})`,
					`columns(${actualIndex.columns.join(", ")})`,
				),
			);
		}
		if (
			formatPredicate(actualIndex.where) !==
			formatPredicate(expectedIndex.where)
		) {
			diagnostics.push(
				diagnostic(
					sourcePath,
					`index ${indexName} has incorrect predicate`,
					formatPredicate(expectedIndex.where),
					formatPredicate(actualIndex.where),
				),
			);
		}
	}

	for (const indexName of sortedKeys(actual)) {
		const actualIndex = actual.get(indexName);
		if (actualIndex && !expected.has(indexName)) {
			diagnostics.push(
				diagnostic(
					sourcePath,
					`extra index ${indexName}`,
					"<missing>",
					formatIndex(actualIndex),
				),
			);
		}
	}

	return diagnostics;
}

function diagnostic(
	sourcePath: string,
	title: string,
	expected: string,
	actual: string,
): string {
	return `${sourcePath}: ${title}\n  expected metadata value: ${expected}\n  actual fixture value: ${actual}`;
}

function findIndexByName(
	tables: readonly NormalizedFixtureTable[],
	indexName: string,
): NormalizedFixtureIndex | undefined {
	return tables
		.flatMap((table) => table.indexes)
		.find((index) => index.name === indexName);
}

function formatIndex(index: NormalizedFixtureIndex): string {
	return `table ${index.tableName}, columns(${index.columns.join(", ")}), predicate ${formatPredicate(index.where)}`;
}

function formatPredicate(predicate: NormalizedFixtureIndex["where"]): string {
	return predicate ? `${predicate.field} = '${predicate.equals}'` : "<none>";
}

function mapBy<T>(
	values: readonly T[],
	getKey: (value: T) => string,
): Map<string, T> {
	return new Map(values.map((value) => [getKey(value), value]));
}

function sortedKeys(map: ReadonlyMap<string, unknown>): string[] {
	return [...map.keys()].sort();
}

function sortedUnion(
	...maps: ReadonlyArray<ReadonlyMap<string, unknown>>
): string[] {
	return [...new Set(maps.flatMap((map) => [...map.keys()]))].sort();
}
