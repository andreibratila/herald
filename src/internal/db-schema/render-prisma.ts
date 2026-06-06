import type {
	DbDefaultKind,
	DbFieldMetadata,
	DbIndexMetadata,
	DbSchemaMetadata,
	DbTableMetadata,
} from "./types.js";

const PRISMA_MODEL_NAMES: Record<string, string> = {
	notifications: "HeraldNotification",
	deliveries: "HeraldDelivery",
	consentEvents: "HeraldConsentEvent",
	suppressions: "HeraldSuppression",
	auditLogs: "HeraldAuditLog",
};

const FIELD_NAME_WIDTH_BY_TABLE: Record<string, number> = {
	notifications: 13,
	deliveries: 19,
	consentEvents: 22,
	suppressions: 12,
	auditLogs: 11,
};

const FIELD_NAME_WIDTH_OVERRIDES: Record<string, number> = {};

const TYPE_WIDTH_BY_TABLE: Record<string, number> = {
	notifications: 10,
	deliveries: 10,
	consentEvents: 9,
	suppressions: 9,
	auditLogs: 9,
};

const TYPE_WIDTH_OVERRIDES: Record<string, number> = {
	"deliveries.complianceRequired": "Boolean?".length + 1,
};

export function renderPrismaSchema(schema: DbSchemaMetadata): string {
	return `
// ─── Herald Prisma models snippet ────────────────────────────
// Append or merge into your Prisma schema:
//   npx herald generate --adapter prisma >> prisma/schema.prisma
// Requires Prisma >=7.4.0 and generator previewFeatures = ["partialIndexes"].
// Herald emits schema text only; review it and run your normal Prisma workflow.

${schema.tables.map(renderTable).join("\n\n")}
`;
}

function renderTable(table: DbTableMetadata): string {
	return `model ${prismaModelName(table)} {
${table.fields.map((field) => `  ${renderField(table, field)}`).join("\n")}

${table.indexes.map((index) => `  ${renderIndex(index)}`).join("\n")}
  @@map("${table.tableName}")
}`;
}

function prismaModelName(table: DbTableMetadata): string {
	const name = PRISMA_MODEL_NAMES[table.id];
	if (!name) {
		throw new Error(
			`Unknown Prisma model name for DB schema table "${table.id}"`,
		);
	}
	return name;
}

function renderField(table: DbTableMetadata, field: DbFieldMetadata): string {
	const name = field.propertyName.padEnd(fieldNameWidth(table, field));
	const type = prismaType(field).padEnd(typeWidth(table, field));
	const suffix = renderFieldSuffix(field);
	return `${name}${type}${suffix}`.trimEnd();
}

function fieldNameWidth(
	table: DbTableMetadata,
	field: DbFieldMetadata,
): number {
	return Math.max(
		FIELD_NAME_WIDTH_OVERRIDES[`${table.id}.${field.propertyName}`] ??
			FIELD_NAME_WIDTH_BY_TABLE[table.id] ??
			0,
		field.propertyName.length + 1,
	);
}

function typeWidth(table: DbTableMetadata, field: DbFieldMetadata): number {
	const type = prismaType(field);
	const configuredNameWidth =
		FIELD_NAME_WIDTH_OVERRIDES[`${table.id}.${field.propertyName}`] ??
		FIELD_NAME_WIDTH_BY_TABLE[table.id] ??
		0;
	const override = TYPE_WIDTH_OVERRIDES[`${table.id}.${field.propertyName}`];
	if (override) {
		return override;
	}
	if (field.propertyName.length + 1 > configuredNameWidth) {
		return type.length + 1;
	}
	return Math.max(TYPE_WIDTH_BY_TABLE[table.id] ?? 0, type.length + 1);
}

function prismaType(field: DbFieldMetadata): string {
	const base =
		field.kind === "integer"
			? "Int"
			: field.kind === "boolean"
				? "Boolean"
				: field.kind === "timestamp"
					? "DateTime"
					: field.kind === "json"
						? "Json"
						: "String";
	return `${base}${field.nullable ? "?" : ""}`;
}

function renderFieldSuffix(field: DbFieldMetadata): string {
	const parts: string[] = [];
	if (field.primaryKey) {
		parts.push("@id");
	}
	const defaultValue = prismaDefault(field.default);
	if (defaultValue) {
		parts.push(defaultValue);
	}
	if (field.columnName !== field.propertyName) {
		parts.push(`@map("${field.columnName}")`);
	}
	if (field.comment) {
		parts.push(`// ${field.comment}`);
	}
	return parts.join(" ");
}

function prismaDefault(
	defaultKind: DbDefaultKind | undefined,
): string | undefined {
	switch (defaultKind) {
		case "generatedId":
			return "@default(cuid())";
		case "now":
			return "@default(now())";
		case "updatedAt":
			return "@updatedAt";
		case "pending":
			return '@default("pending")';
		case "zero":
			return "@default(0)";
		case "false":
			return "@default(false)";
		default:
			return undefined;
	}
}

function renderIndex(index: DbIndexMetadata): string {
	const fields = index.fields.join(", ");
	if (index.where) {
		return `@@index([${fields}], where: { ${index.where.field}: "${index.where.equals}" }, map: "${index.name}")`;
	}
	return `@@index([${fields}], map: "${index.name}")`;
}
