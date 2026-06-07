import { readFile } from "node:fs/promises";

import type {
	NormalizedFixtureIndex,
	NormalizedFixtureSchema,
	NormalizedFixtureTable,
} from "./types.js";

const MODEL_PATTERN = /model\s+(\w+)\s*\{([\s\S]*?)\n\s*\}/gu;
const FIELD_MAP_PATTERN = /@map\("([^"]+)"\)/u;
const TABLE_MAP_PATTERN = /@@map\("([^"]+)"\)/u;
const INDEX_PATTERN = /@@index\(\s*\[([^\]]*)\]([\s\S]*?)\)/gu;
const INDEX_MAP_PATTERN = /map:\s*"([^"]+)"/u;
const INDEX_WHERE_PATTERN = /where:\s*\{\s*(\w+):\s*"([^"]+)"\s*\}/u;

export async function extractPrismaFixtureSchema(
	sourcePath: string,
): Promise<NormalizedFixtureSchema> {
	return extractPrismaFixtureSchemaFromSource(
		sourcePath,
		await readFile(sourcePath, "utf8"),
	);
}

export function extractPrismaFixtureSchemaFromSource(
	sourcePath: string,
	source: string,
): NormalizedFixtureSchema {
	return {
		sourcePath,
		tables: [...source.matchAll(MODEL_PATTERN)]
			.map((match) => normalizeModel(sourcePath, match))
			.sort((left, right) => left.tableName.localeCompare(right.tableName)),
	};
}

function normalizeModel(
	sourcePath: string,
	match: RegExpMatchArray,
): NormalizedFixtureTable {
	const modelName = requireMatchGroup(
		match,
		1,
		`${sourcePath}: Prisma model name`,
	);
	const body = requireMatchGroup(match, 2, `${sourcePath}: Prisma model body`);
	const tableName = extractTableName(sourcePath, modelName, body);
	const columnByProperty = extractColumns(body);

	return {
		tableName,
		columns: [...columnByProperty.values()],
		indexes: extractIndexes(sourcePath, tableName, body, columnByProperty),
	};
}

function extractTableName(
	sourcePath: string,
	modelName: string,
	body: string,
): string {
	const match = TABLE_MAP_PATTERN.exec(body);
	if (!match) {
		throw new Error(
			`${sourcePath}: Prisma model ${modelName} is missing @@map`,
		);
	}
	return requireMatchGroup(match, 1, `${sourcePath}: ${modelName} @@map`);
}

function extractColumns(body: string): Map<string, string> {
	const columns = new Map<string, string>();
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) {
			continue;
		}
		const [propertyName] = trimmed.split(/\s+/u);
		if (!propertyName) continue;
		const mapMatch = FIELD_MAP_PATTERN.exec(trimmed);
		columns.set(propertyName, mapMatch?.[1] ?? propertyName);
	}
	return columns;
}

function extractIndexes(
	sourcePath: string,
	tableName: string,
	body: string,
	columnByProperty: ReadonlyMap<string, string>,
): NormalizedFixtureIndex[] {
	return [...body.matchAll(INDEX_PATTERN)].map((match) => {
		const fieldsSource = requireMatchGroup(
			match,
			1,
			`${sourcePath}: ${tableName} index fields`,
		);
		const indexOptions = requireMatchGroup(
			match,
			2,
			`${sourcePath}: ${tableName} index options`,
		);
		const indexName = extractIndexName(sourcePath, tableName, indexOptions);

		return {
			name: indexName,
			tableName,
			columns: fieldsSource
				.split(",")
				.map((field) => field.trim())
				.filter(Boolean)
				.map((field) =>
					lookupColumnName(
						sourcePath,
						tableName,
						indexName,
						field,
						columnByProperty,
					),
				),
			...(extractPredicate(
				sourcePath,
				tableName,
				indexName,
				indexOptions,
				columnByProperty,
			) ?? {}),
		};
	});
}

function extractIndexName(
	sourcePath: string,
	tableName: string,
	indexOptions: string,
): string {
	const match = INDEX_MAP_PATTERN.exec(indexOptions);
	if (!match) {
		throw new Error(
			`${sourcePath}: Prisma index on ${tableName} is missing map`,
		);
	}
	return requireMatchGroup(match, 1, `${sourcePath}: ${tableName} index map`);
}

function extractPredicate(
	sourcePath: string,
	tableName: string,
	indexName: string,
	indexOptions: string,
	columnByProperty: ReadonlyMap<string, string>,
): Pick<NormalizedFixtureIndex, "where"> | undefined {
	const match = INDEX_WHERE_PATTERN.exec(indexOptions);
	if (!match) return undefined;
	const field = requireMatchGroup(
		match,
		1,
		`${sourcePath}: ${tableName}.${indexName} predicate field`,
	);
	return {
		where: {
			field: lookupColumnName(
				sourcePath,
				tableName,
				indexName,
				field,
				columnByProperty,
			),
			equals: requireMatchGroup(
				match,
				2,
				`${sourcePath}: ${tableName}.${indexName} predicate value`,
			),
		},
	};
}

function lookupColumnName(
	sourcePath: string,
	tableName: string,
	indexName: string,
	fieldName: string,
	columnByProperty: ReadonlyMap<string, string>,
): string {
	const columnName = columnByProperty.get(fieldName);
	if (!columnName) {
		throw new Error(
			`${sourcePath}: index ${indexName} on ${tableName} references unknown Prisma field/property ${fieldName}`,
		);
	}
	return columnName;
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
