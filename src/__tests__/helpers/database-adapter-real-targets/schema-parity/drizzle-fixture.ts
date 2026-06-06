import { readFile } from "node:fs/promises";

import type {
	NormalizedFixtureIndex,
	NormalizedFixtureSchema,
	NormalizedFixtureTable,
} from "./types.js";

const COLUMN_PATTERN =
	/(\w+)\s*:\s*(?:text|integer|boolean|jsonb|timestamp|timestamptz)\s*\(\s*"([^"]+)"/gu;
const INDEX_PATTERN =
	/index\s*\(\s*"([^"]+)"\s*\)\s*\.on\s*\(([\s\S]*?)\)\s*(?:\.where\s*\(\s*sql`([^`]*)`\s*\))?/gu;
const SIMPLE_EQUALITY_PREDICATE = /^(\w+)\s*=\s*'([^']+)'$/u;

export async function extractDrizzleFixtureSchema(
	sourcePath: string,
): Promise<NormalizedFixtureSchema> {
	return extractDrizzleFixtureSchemaFromSource(
		sourcePath,
		await readFile(sourcePath, "utf8"),
	);
}

export function extractDrizzleFixtureSchemaFromSource(
	sourcePath: string,
	source: string,
): NormalizedFixtureSchema {
	return {
		sourcePath,
		tables: findPgTableCalls(source)
			.map((call) => normalizePgTableCall(sourcePath, call))
			.sort((left, right) => left.tableName.localeCompare(right.tableName)),
	};
}

function normalizePgTableCall(
	sourcePath: string,
	callSource: string,
): NormalizedFixtureTable {
	const args = splitTopLevelArgs(callSource.slice("pgTable(".length, -1));
	if (args.length < 2) {
		throw new Error(
			`${sourcePath}: unsupported pgTable shape; expected at least table name and columns object`,
		);
	}

	const tableNameArg = requireArrayItem(
		args,
		0,
		`${sourcePath}: pgTable table name argument`,
	);
	const columnsArg = requireArrayItem(
		args,
		1,
		`${sourcePath}: pgTable columns argument`,
	);
	const indexesArg = args[2];
	const tableName = extractStringLiteral(
		tableNameArg,
		`${sourcePath}: pgTable table name`,
	);
	const columnsByProperty = extractColumns(sourcePath, tableName, columnsArg);

	return {
		tableName,
		columns: [...columnsByProperty.values()],
		indexes: indexesArg
			? extractIndexes(sourcePath, tableName, indexesArg, columnsByProperty)
			: [],
	};
}

function extractColumns(
	sourcePath: string,
	tableName: string,
	columnsSource: string,
): Map<string, string> {
	const columns = new Map<string, string>();
	for (const match of columnsSource.matchAll(COLUMN_PATTERN)) {
		columns.set(
			requireMatchGroup(
				match,
				1,
				`${sourcePath}: ${tableName} column property`,
			),
			requireMatchGroup(match, 2, `${sourcePath}: ${tableName} column name`),
		);
	}
	if (columns.size === 0) {
		throw new Error(
			`${sourcePath}: unsupported pgTable columns shape for ${tableName}`,
		);
	}
	return columns;
}

function extractIndexes(
	sourcePath: string,
	tableName: string,
	indexesSource: string,
	columnsByProperty: ReadonlyMap<string, string>,
): NormalizedFixtureIndex[] {
	return [...indexesSource.matchAll(INDEX_PATTERN)].map((match) => {
		const name = requireMatchGroup(
			match,
			1,
			`${sourcePath}: ${tableName} index name`,
		);
		return {
			name,
			tableName,
			columns: extractIndexColumns(
				sourcePath,
				tableName,
				name,
				requireMatchGroup(
					match,
					2,
					`${sourcePath}: ${tableName} index columns`,
				),
				columnsByProperty,
			),
			...(match[3] ? { where: normalizePredicate(match[3].trim()) } : {}),
		};
	});
}

function extractIndexColumns(
	sourcePath: string,
	tableName: string,
	indexName: string,
	onSource: string,
	columnsByProperty: ReadonlyMap<string, string>,
): string[] {
	const propertyNames = [...onSource.matchAll(/t\.(\w+)/gu)].map((match) =>
		requireMatchGroup(
			match,
			1,
			`${sourcePath}: ${tableName}.${indexName} index field`,
		),
	);
	if (propertyNames.length === 0) {
		throw new Error(
			`${sourcePath}: unsupported index columns for ${tableName}.${indexName}`,
		);
	}
	return propertyNames.map((propertyName) => {
		const columnName = columnsByProperty.get(propertyName);
		if (!columnName) {
			throw new Error(
				`${sourcePath}: index ${indexName} on ${tableName} references unknown Drizzle field/property ${propertyName}`,
			);
		}
		return columnName;
	});
}

function normalizePredicate(source: string): NormalizedFixtureIndex["where"] {
	const match = SIMPLE_EQUALITY_PREDICATE.exec(source);
	return match
		? {
				field: requireMatchGroup(match, 1, `Drizzle predicate field ${source}`),
				equals: requireMatchGroup(
					match,
					2,
					`Drizzle predicate value ${source}`,
				),
			}
		: { field: source, equals: "<unsupported>" };
}

function findPgTableCalls(source: string): string[] {
	const calls: string[] = [];
	let searchIndex = 0;
	while (true) {
		const start = source.indexOf("pgTable(", searchIndex);
		if (start === -1) return calls;
		const end = findMatchingParen(source, start + "pgTable".length);
		calls.push(source.slice(start, end + 1));
		searchIndex = end + 1;
	}
}

function findMatchingParen(source: string, openIndex: number): number {
	let depth = 0;
	let quote: '"' | "'" | "`" | undefined;
	for (let index = openIndex; index < source.length; index += 1) {
		const char = source[index];
		const previous = source[index - 1];
		if (quote) {
			if (char === quote && previous !== "\\") quote = undefined;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "(") depth += 1;
		if (char === ")") {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	throw new Error("Unable to find closing parenthesis for pgTable call");
}

function splitTopLevelArgs(source: string): string[] {
	const args: string[] = [];
	let start = 0;
	let depth = 0;
	let quote: '"' | "'" | "`" | undefined;
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		const previous = source[index - 1];
		if (quote) {
			if (char === quote && previous !== "\\") quote = undefined;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if ("([{".includes(char ?? "")) depth += 1;
		if (")]}".includes(char ?? "")) depth -= 1;
		if (char === "," && depth === 0) {
			args.push(source.slice(start, index).trim());
			start = index + 1;
		}
	}
	args.push(source.slice(start).trim());
	return args.filter(Boolean);
}

function extractStringLiteral(source: string, description: string): string {
	const match = /^\s*"([^"]+)"\s*$/u.exec(source);
	if (!match) throw new Error(`Unable to extract ${description}`);
	return requireMatchGroup(match, 1, description);
}

function requireArrayItem(
	values: readonly string[],
	index: number,
	description: string,
): string {
	const value = values[index];
	if (!value) throw new Error(`Unable to extract ${description}`);
	return value;
}

function requireMatchGroup(
	match: RegExpMatchArray,
	index: number,
	description: string,
): string {
	const value = match[index];
	if (!value) throw new Error(`Unable to extract ${description}`);
	return value;
}
