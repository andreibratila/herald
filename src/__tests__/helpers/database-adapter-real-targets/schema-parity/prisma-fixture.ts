import { readFile } from "node:fs/promises";

import type {
	NormalizedColumnDefault,
	NormalizedFixtureColumn,
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
		indexes: extractIndexes(
			sourcePath,
			tableName,
			body,
			new Map(
				[...columnByProperty].map(([property, column]) => [
					property,
					column.name,
				]),
			),
		),
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

function extractColumns(body: string): Map<string, NormalizedFixtureColumn> {
	const columns = new Map<string, NormalizedFixtureColumn>();
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) {
			continue;
		}
		const [propertyName, typeName] = trimmed.split(/\s+/u);
		if (!propertyName || !typeName) continue;
		const mapMatch = FIELD_MAP_PATTERN.exec(trimmed);
		columns.set(propertyName, {
			name: mapMatch?.[1] ?? propertyName,
			kind: normalizePrismaKind(typeName),
			nullable: typeName.endsWith("?"),
			primaryKey: trimmed.includes("@id"),
			default: normalizePrismaDefault(trimmed),
		});
	}
	return columns;
}

function normalizePrismaKind(typeName: string): NormalizedFixtureColumn["kind"] {
	const normalized = typeName.replace(/\?$/u, "");
	if (normalized === "String") return "string";
	if (normalized === "Int") return "integer";
	if (normalized === "Boolean") return "boolean";
	if (normalized === "Json") return "json";
	if (normalized === "DateTime") return "timestamp";
	throw new Error(`Unsupported Prisma field type ${typeName}`);
}

function normalizePrismaDefault(line: string): NormalizedColumnDefault {
	if (line.includes("@updatedAt")) return "updatedAt";
	if (line.includes("@default(now())")) return "now";
	if (/@default\(\s*"pending"\s*\)/u.test(line)) return "pending";
	if (/@default\(\s*0\s*\)/u.test(line)) return "zero";
	if (/@default\(\s*false\s*\)/u.test(line)) return "false";
	const unsupportedDefault = /@default\(([^)]*)\)/u.exec(line)?.[1];
	if (unsupportedDefault !== undefined) {
		throw new Error(
			`Unsupported Prisma default for field ${line.split(/\s+/u)[0]}: ${unsupportedDefault}`,
		);
	}
	return "none";
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
