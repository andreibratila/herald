export type DbScalarKind = "string" | "integer" | "boolean" | "timestamp" | "json";

export type DbDefaultKind = "generatedId" | "now" | "updatedAt" | "pending" | "zero" | "false";

export type DbPrivacyAnnotation =
	| "subjectIdentifier"
	| "userVisibleContent"
	| "persistedPayloadSubset"
	| "providerIdentifier"
	| "appSuppliedHash"
	| "complianceEvidence"
	| "auditMetadataNonPii"
	| "operational";

export interface DbFieldMetadata {
	readonly propertyName: string;
	readonly columnName: string;
	readonly kind: DbScalarKind;
	readonly nullable: boolean;
	readonly primaryKey?: boolean;
	readonly default?: DbDefaultKind;
	readonly comment?: string;
	readonly annotations?: readonly DbPrivacyAnnotation[];
}

export interface DbIndexMetadata {
	readonly name: string;
	readonly fields: readonly string[];
	readonly unique?: boolean;
	readonly where?: { readonly field: string; readonly equals: string };
}

export interface DbTableMetadata {
	readonly id: string;
	readonly tableName: string;
	readonly comment?: string;
	readonly annotations?: readonly string[];
	readonly fields: readonly DbFieldMetadata[];
	readonly indexes: readonly DbIndexMetadata[];
}

export interface DbSchemaMetadata {
	readonly version: 1;
	readonly tables: readonly DbTableMetadata[];
}
