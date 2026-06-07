import type {
	DbSchemaMetadata,
	DbTableMetadata,
} from "../../../../internal/db-schema/types.js";
import type {
	NormalizedFixtureSchema,
	NormalizedFixtureTable,
} from "./types.js";

export function normalizeHeraldDbSchema(
	schema: DbSchemaMetadata,
): NormalizedFixtureSchema {
	return {
		sourcePath: "HERALD_DB_SCHEMA",
		tables: schema.tables.map(normalizeTable),
	};
}

function normalizeTable(table: DbTableMetadata): NormalizedFixtureTable {
	const columnByProperty = new Map(
		table.fields.map((field) => [field.propertyName, field.columnName]),
	);

	return {
		tableName: table.tableName,
		columns: table.fields.map((field) => ({
			name: field.columnName,
			kind: field.kind,
			nullable: field.nullable,
			primaryKey: field.primaryKey ?? false,
			default: normalizeMetadataDefault(field.default),
		})),
		indexes: table.indexes.map((index) => ({
			name: index.name,
			tableName: table.tableName,
			columns: index.fields.map((fieldName) =>
				lookupColumnName(
					table.tableName,
					index.name,
					fieldName,
					columnByProperty,
				),
			),
			...(index.where
				? {
						where: {
							field: lookupColumnName(
								table.tableName,
								index.name,
								index.where.field,
								columnByProperty,
							),
							equals: index.where.equals,
						},
					}
				: {}),
		})),
	};
}

function normalizeMetadataDefault(
	defaultKind: DbTableMetadata["fields"][number]["default"],
): "none" | "now" | "pending" | "zero" | "false" | "updatedAt" {
	if (!defaultKind || defaultKind === "generatedId") return "none";
	return defaultKind;
}

function lookupColumnName(
	tableName: string,
	indexName: string,
	fieldName: string,
	columnByProperty: ReadonlyMap<string, string>,
): string {
	const columnName = columnByProperty.get(fieldName);
	if (!columnName) {
		throw new Error(
			`HERALD_DB_SCHEMA index ${indexName} on ${tableName} references unknown field/property ${fieldName}`,
		);
	}
	return columnName;
}
