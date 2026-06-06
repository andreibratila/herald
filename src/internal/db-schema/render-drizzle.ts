import type {
	DbDefaultKind,
	DbFieldMetadata,
	DbIndexMetadata,
	DbSchemaMetadata,
	DbTableMetadata,
} from "./types.js";

const DRIZZLE_EXPORT_NAMES: Record<string, string> = {
	notifications: "heraldNotifications",
	deliveries: "heraldDeliveries",
	consentEvents: "heraldConsentEvents",
	suppressions: "heraldSuppressions",
	auditLogs: "heraldAuditLogs",
};

const PROPERTY_WIDTH_BY_TABLE: Record<string, number> = {
	notifications: 14,
	deliveries: 20,
	consentEvents: 22,
	suppressions: 13,
	auditLogs: 12,
};

const PROPERTY_WIDTH_OVERRIDES: Record<string, number> = {};

export function renderDrizzleSchema(schema: DbSchemaMetadata): string {
	return `
// ─── Add to your Drizzle schema ──────────────────────────────
// Run: npx herald generate --adapter drizzle >> src/db/herald.schema.ts
// Then pass the exported tables to createDrizzleAdapter()

import {
  pgTable, text, boolean, integer,
  timestamp, json, index,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

const createId = () => crypto.randomUUID()

${schema.tables.map(renderTable).join("\n\n")}
`;
}

function renderTable(table: DbTableMetadata): string {
	return `export const ${drizzleExportName(table)} = pgTable(
  "${table.tableName}",
  {
${table.fields.map((field) => `    ${renderField(table, field)}`).join("\n")}
  },
  (t) => [
${table.indexes.map((index) => `    ${renderIndex(index)},`).join("\n")}
  ]
)`;
}

function drizzleExportName(table: DbTableMetadata): string {
	const name = DRIZZLE_EXPORT_NAMES[table.id];
	if (!name) {
		throw new Error(
			`Unknown Drizzle export name for DB schema table "${table.id}"`,
		);
	}
	return name;
}

function renderField(table: DbTableMetadata, field: DbFieldMetadata): string {
	const property = `${field.propertyName}:`.padEnd(propertyWidth(table, field));
	const expression = `${drizzleColumn(field)},`;
	const comment =
		field.comment && shouldRenderDrizzleComment(field)
			? `           // ${field.comment}`
			: "";
	return `${property}${expression}${comment}`;
}

function propertyWidth(table: DbTableMetadata, field: DbFieldMetadata): number {
	return Math.max(
		PROPERTY_WIDTH_OVERRIDES[`${table.id}.${field.propertyName}`] ??
			PROPERTY_WIDTH_BY_TABLE[table.id] ??
			0,
		field.propertyName.length + 2,
	);
}

function drizzleColumn(field: DbFieldMetadata): string {
	let value = `${drizzleBuilder(field.kind)}("${field.columnName}")`;
	if (field.primaryKey) {
		value += ".primaryKey()";
	}
	if (!field.nullable && !field.primaryKey) {
		value += ".notNull()";
	}
	const defaultValue = drizzleDefault(field.default);
	if (defaultValue) {
		value += defaultValue;
	}
	return value;
}

function drizzleBuilder(kind: DbFieldMetadata["kind"]): string {
	switch (kind) {
		case "integer":
			return "integer";
		case "boolean":
			return "boolean";
		case "timestamp":
			return "timestamp";
		case "json":
			return "json";
		default:
			return "text";
	}
}

function drizzleDefault(defaultKind: DbDefaultKind | undefined): string {
	switch (defaultKind) {
		case "generatedId":
			return ".$defaultFn(() => createId())";
		case "now":
		case "updatedAt":
			return ".defaultNow()";
		case "pending":
			return '.default("pending")';
		case "zero":
			return ".default(0)";
		case "false":
			return ".default(false)";
		default:
			return "";
	}
}

function shouldRenderDrizzleComment(field: DbFieldMetadata): boolean {
	return field.propertyName === "data" || field.propertyName === "metadata";
}

function renderIndex(index: DbIndexMetadata): string {
	const fields = index.fields.map((field) => `t.${field}`).join(", ");
	const base = `index("${index.name}").on(${fields})`;
	if (index.where) {
		return `${base}.where(sql\`${index.where.field} = '${index.where.equals}'\`)`;
	}
	return base;
}
