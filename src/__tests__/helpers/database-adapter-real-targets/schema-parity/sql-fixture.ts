import { readFile } from "node:fs/promises";

import type {
	NormalizedColumnDefault,
	NormalizedFixtureColumn,
	NormalizedFixtureIndex,
	NormalizedFixtureSchema,
	NormalizedFixtureTable,
} from "./types.js";

const TABLE_PATTERN =
	/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\((.*?)\);/gis;
const INDEX_PATTERN =
	/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]*)\)\s*(?:WHERE\s+([^;]+))?;/gis;
const SIMPLE_EQUALITY_PREDICATE = /^(\w+)\s*=\s*'([^']+)'$/iu;

export async function extractSqlFixtureSchema(
	sourcePath: string,
): Promise<NormalizedFixtureSchema> {
	return extractSqlFixtureSchemaFromSource(
		sourcePath,
		await readFile(sourcePath, "utf8"),
	);
}

export function extractSqlFixtureSchemaFromSource(
	sourcePath: string,
	source: string,
): NormalizedFixtureSchema {
	const tableByName = new Map<string, NormalizedFixtureTable>();
	const uncommentedSource = stripLineComments(source);

	for (const match of uncommentedSource.matchAll(TABLE_PATTERN)) {
		const tableName = requireMatchGroup(match, 1, "SQL table name");
		tableByName.set(tableName, {
			tableName,
			columns: extractTableColumns(
				requireMatchGroup(match, 2, `SQL table body for ${tableName}`),
			),
			indexes: [],
		});
	}

	for (const match of uncommentedSource.matchAll(INDEX_PATTERN)) {
		const index = normalizeIndex(
			requireMatchGroup(match, 1, "SQL index name"),
			requireMatchGroup(match, 2, "SQL index table"),
			requireMatchGroup(match, 3, "SQL index columns"),
			match[4],
		);
		const table = tableByName.get(index.tableName) ?? {
			tableName: index.tableName,
			columns: [],
			indexes: [],
		};
		tableByName.set(index.tableName, {
			...table,
			indexes: [...table.indexes, index],
		});
	}

	return {
		sourcePath,
		tables: [...tableByName.values()].sort((left, right) =>
			left.tableName.localeCompare(right.tableName),
		),
	};
}

function stripLineComments(source: string): string {
	return source
		.split("\n")
		.map((line) => line.replace(/--.*$/u, ""))
		.join("\n");
}

function extractTableColumns(tableBody: string): NormalizedFixtureColumn[] {
	return tableBody
		.split("\n")
		.map((line) => line.trim().replace(/,$/u, ""))
		.filter((line) => line.length > 0 && !isTableConstraint(line))
		.map(parseColumnLine);
}

function isTableConstraint(line: string): boolean {
	return /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/iu.test(line);
}

function normalizeIndex(
	name: string,
	tableName: string,
	columnsSource: string,
	predicateSource: string | undefined,
): NormalizedFixtureIndex {
	return {
		name,
		tableName,
		columns: columnsSource
			.split(",")
			.map((column) => column.trim())
			.filter(Boolean),
		...(predicateSource
			? { where: normalizePredicate(predicateSource.trim()) }
			: {}),
	};
}

function normalizePredicate(
	predicateSource: string,
): NormalizedFixtureIndex["where"] {
	const match = SIMPLE_EQUALITY_PREDICATE.exec(predicateSource);
	return match
		? {
				field: requireMatchGroup(
					match,
					1,
					`SQL predicate field ${predicateSource}`,
				),
				equals: requireMatchGroup(
					match,
					2,
					`SQL predicate value ${predicateSource}`,
				),
			}
		: { field: predicateSource, equals: "<unsupported>" };
}

function parseColumnLine(line: string): NormalizedFixtureColumn {
	const parts = line.split(/\s+/u);
	const name = parts[0];
	const type = parts[1];
	if (!name || !type) {
		throw new Error(`Unable to extract SQL column from line: ${line}`);
	}
	return {
		name,
		kind: normalizeSqlKind(type),
		nullable: !/\bNOT\s+NULL\b/iu.test(line) && !/\bPRIMARY\s+KEY\b/iu.test(line),
		primaryKey: /\bPRIMARY\s+KEY\b/iu.test(line),
		default: normalizeSqlDefault(name, line),
	};
}

function normalizeSqlKind(type: string): NormalizedFixtureColumn["kind"] {
	const normalized = type.toUpperCase();
	if (normalized === "TEXT") return "string";
	if (normalized === "INTEGER") return "integer";
	if (normalized === "BOOLEAN") return "boolean";
	if (normalized === "JSONB" || normalized === "JSON") return "json";
	if (normalized === "TIMESTAMPTZ" || normalized === "TIMESTAMP") return "timestamp";
	throw new Error(`Unsupported SQL column type ${type}`);
}

function normalizeSqlDefault(
	columnName: string,
	line: string,
): NormalizedColumnDefault {
	const defaultMatch = /\bDEFAULT\s+([^\s,]+)/iu.exec(line);
	const defaultSource = defaultMatch?.[1];
	if (!defaultSource) return "none";
	const value = defaultSource.replace(/[()]/gu, "").toLowerCase();
	if (value === "now") return columnName === "updated_at" ? "updatedAt" : "now";
	if (value === "'pending'") return "pending";
	if (value === "0") return "zero";
	if (value === "false") return "false";
	throw new Error(
		`Unsupported SQL default for column ${columnName}: ${defaultSource}`,
	);
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
