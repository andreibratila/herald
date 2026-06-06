import type {
	DbDefaultKind,
	DbFieldMetadata,
	DbIndexMetadata,
	DbSchemaMetadata,
	DbTableMetadata,
} from "./types.js";

const COLUMN_WIDTH_BY_TABLE: Record<string, number> = {
	notifications: 14,
	deliveries: 21,
	consentEvents: 25,
	suppressions: 14,
	auditLogs: 13,
};

const COLUMN_WIDTH_OVERRIDES: Record<string, number> = {
	"deliveries.acceptedAt": 25,
	"deliveries.complianceRequired": 22,
};

const POSTGRES_INDEX_NAMES: Record<string, string> = {
	herald_delivery_status_claim_expires_idx: "herald_delivery_status_claim_exp_idx",
};

const INDEX_NAME_WIDTH: Record<string, number> = {
	herald_notif_user_read_idx: 30,
	herald_notif_user_created_idx: 30,
	herald_notif_delivery_idx: 30,
	herald_delivery_user_idx: 38,
	herald_delivery_idempotency_idx: 38,
	herald_delivery_created_idx: 38,
	herald_delivery_status_scheduled_idx: 38,
	herald_delivery_status_claim_exp_idx: 38,
	herald_delivery_scheduled_idx: 38,
	herald_audit_user_idx: 25,
	herald_audit_created_idx: 25,
};

export function renderKyselyPostgresSchema(schema: DbSchemaMetadata): string {
	return `
-- ─── Herald SQL migration for Kysely ─────────────────────────
-- Run: npx herald generate --adapter kysely > migrations/herald_init.sql
-- Then run the migration via your preferred tool (kysely-migration, flyway, etc.)
-- See herald docs for the TypeScript Database interface additions.

${schema.tables.map(renderTable).join("\n\n")}

-- TypeScript: add this to your Kysely Database interface:
-- import type { HeraldDatabase } from "herald/adapters/kysely"
-- interface Database extends HeraldDatabase { /* your tables */ }
`;
}

function renderTable(table: DbTableMetadata): string {
	return `CREATE TABLE IF NOT EXISTS ${table.tableName} (
${table.fields.map((field, index) => `  ${renderField(table, field)}${index === table.fields.length - 1 ? "" : ","}`).join("\n")}
);
${table.indexes.map((index) => renderIndex(table, index)).join("\n")}`;
}

function renderField(table: DbTableMetadata, field: DbFieldMetadata): string {
	const column = field.columnName.padEnd(columnWidth(table, field));
	const type = postgresType(field.kind).padEnd(typeWidth(field));
	return `${column}${type}${postgresSuffix(field)}`.trimEnd();
}

function columnWidth(table: DbTableMetadata, field: DbFieldMetadata): number {
	return Math.max(
		COLUMN_WIDTH_OVERRIDES[`${table.id}.${field.propertyName}`] ??
			COLUMN_WIDTH_BY_TABLE[table.id] ??
			0,
		field.columnName.length + 1,
	);
}

function postgresType(kind: DbFieldMetadata["kind"]): string {
	switch (kind) {
		case "integer":
			return "INTEGER";
		case "boolean":
			return "BOOLEAN";
		case "timestamp":
			return "TIMESTAMPTZ";
		case "json":
			return "JSONB";
		default:
			return "TEXT";
	}
}

function typeWidth(field: DbFieldMetadata): number {
	return field.kind === "timestamp" ? 12 : 12;
}

function postgresSuffix(field: DbFieldMetadata): string {
	const parts: string[] = [];
	if (field.primaryKey) {
		parts.push("PRIMARY KEY");
	}
	if (!field.nullable && !field.primaryKey) {
		parts.push("NOT NULL");
	}
	const defaultValue = postgresDefault(field.default);
	if (defaultValue) {
		parts.push(defaultValue);
	}
	return parts.join(" ");
}

function postgresDefault(defaultKind: DbDefaultKind | undefined): string | undefined {
	switch (defaultKind) {
		case "now":
		case "updatedAt":
			return "DEFAULT NOW()";
		case "pending":
			return "DEFAULT 'pending'";
		case "zero":
			return "DEFAULT 0";
		case "false":
			return "DEFAULT FALSE";
		default:
			return undefined;
	}
}

function renderIndex(table: DbTableMetadata, index: DbIndexMetadata): string {
	const name = POSTGRES_INDEX_NAMES[index.name] ?? index.name;
	const indexName = name.padEnd(INDEX_NAME_WIDTH[name] ?? name.length);
	const columns = index.fields.map((field) => columnName(table, field)).join(", ");
	const where = index.where ? ` WHERE ${columnName(table, index.where.field)} = '${index.where.equals}'` : "";
	return `CREATE INDEX IF NOT EXISTS ${indexName} ON ${table.tableName} (${columns})${where};`;
}

function columnName(table: DbTableMetadata, fieldName: string): string {
	const field = table.fields.find((candidate) => candidate.propertyName === fieldName);
	if (!field) {
		throw new Error(`Unknown DB schema field "${fieldName}" on table "${table.id}"`);
	}
	return field.columnName;
}
