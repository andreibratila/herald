import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { main } from "../../../cli/index.js";

const readFixture = (name: string) =>
	readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const schemaFixtures = {
	prisma: readFixture("prisma.schema.prisma"),
	drizzle: readFixture("drizzle.schema.ts"),
	kysely: readFixture("kysely.schema.sql"),
} as const;

describe("CLI — main(argv)", () => {
	it.each([
		["prisma", schemaFixtures.prisma],
		["drizzle", schemaFixtures.drizzle],
		["kysely", schemaFixtures.kysely],
	] as const)("%s adapter output matches the golden fixture", (adapter, fixture) => {
		const { stdout, exitCode } = main(["generate", "--adapter", adapter]);
		expect(exitCode).toBe(0);
		expect(stdout).toBe(fixture);
	});

	it("prisma adapter outputs HeraldNotification schema", () => {
		const { stdout, exitCode } = main(["generate", "--adapter", "prisma"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("HeraldNotification");
	});

	it("drizzle adapter outputs heraldNotifications schema without extra ID deps", () => {
		const { stdout, exitCode } = main(["generate", "--adapter", "drizzle"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("heraldNotifications");
		expect(stdout).toContain("crypto.randomUUID()");
		expect(stdout).toContain('import { sql } from "drizzle-orm"');
		expect(stdout).not.toContain("@paralleldrive/cuid2");
		expect(stdout).not.toContain("index, sql,");
	});

	it("kysely adapter outputs herald_notifications schema", () => {
		const { stdout, exitCode } = main(["generate", "--adapter", "kysely"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("herald_notifications");
	});

	it("unknown adapter returns exitCode 1", () => {
		const { exitCode } = main(["generate", "--adapter", "mongo"]);
		expect(exitCode).toBe(1);
	});

	it("no arguments shows usage and returns exitCode 0", () => {
		const { stdout, exitCode } = main([]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Usage:");
	});
});

// ─── (T37): renderedHash present in all adapter outputs ──

describe("CLI — renderedHash field appears in all adapter outputs", () => {
	it("T37a: prisma adapter output contains renderedHash", () => {
		const { stdout } = main(["generate", "--adapter", "prisma"]);
		expect(stdout).toContain("renderedHash");
	});

	it("T37b: drizzle adapter output contains rendered_hash", () => {
		const { stdout } = main(["generate", "--adapter", "drizzle"]);
		expect(stdout).toContain("rendered_hash");
	});

	it("T37c: kysely adapter output contains rendered_hash", () => {
		const { stdout } = main(["generate", "--adapter", "kysely"]);
		expect(stdout).toContain("rendered_hash");
	});
});

// ─── CLI scheduled_at partial index ──────────────────

describe("CLI — scheduled_at partial index output", () => {
	it("4.1 prisma output contains @@index([scheduledAt]) with where clause", () => {
		const { stdout } = main(["generate", "--adapter", "prisma"]);
		expect(stdout).toContain("@@index([scheduledAt]");
		expect(stdout).toContain("herald_delivery_scheduled_idx");
		// where clause for partial index
		expect(stdout).toMatch(/@@index\(\[scheduledAt\][^)]*where/);
	});

	it("4.2 drizzle output contains status = 'scheduled' in index definition", () => {
		const { stdout } = main(["generate", "--adapter", "drizzle"]);
		expect(stdout).toContain("status = 'scheduled'");
		expect(stdout).toContain("herald_delivery_scheduled_idx");
	});

	it("4.3 kysely output contains WHERE status = 'scheduled' in CREATE INDEX", () => {
		const { stdout } = main(["generate", "--adapter", "kysely"]);
		expect(stdout).toContain("WHERE status = 'scheduled'");
		expect(stdout).toContain("herald_delivery_scheduled_idx");
	});
});

// ─── Slice 7: compliance schema output ───────────────────────

describe("CLI — compliance schema output", () => {
	it.each([
		"prisma",
		"drizzle",
		"kysely",
	] as const)("%s output removes legacy preferences and consent tables", (adapter) => {
		const { stdout } = main(["generate", "--adapter", adapter]);
		expect(stdout).not.toContain("herald_preferences");
		expect(stdout).not.toContain("herald_consents");
		expect(stdout).not.toContain("herald_erased_consents");
	});

	it.each([
		"prisma",
		"drizzle",
		"kysely",
	] as const)("%s output contains compliance consent events, suppressions, and delivery snapshots", (adapter) => {
		const { stdout } = main(["generate", "--adapter", adapter]);
		expect(stdout).toMatch(
			/herald_consent_events|HeraldConsentEvent|heraldConsentEvents/,
		);
		expect(stdout).toMatch(
			/herald_suppressions|HeraldSuppression|heraldSuppressions/,
		);
		expect(stdout).toMatch(/addressHash|address_hash/);
		expect(stdout).toMatch(/legalBasisAtSend|legal_basis_at_send/);
		expect(stdout).toMatch(/complianceDecision|compliance_decision/);
		expect(stdout).toMatch(/complianceRequired|compliance_required/);
		expect(stdout).toMatch(
			/complianceRequiresConsentEvent|compliance_requires_consent_event/,
		);
		expect(stdout).toMatch(
			/complianceRequiresSuppressionCheck|compliance_requires_suppression_check/,
		);
		expect(stdout).toMatch(
			/complianceRequiresEvidence|compliance_requires_evidence/,
		);
		expect(stdout).toMatch(
			/complianceDefaultDecision|compliance_default_decision/,
		);
		expect(stdout).toMatch(/complianceCheckedAt|compliance_checked_at/);
	});

	it.each([
		"prisma",
		"drizzle",
		"kysely",
	] as const)("%s output indexes idempotency keys without uniqueness", (adapter) => {
		const { stdout } = main(["generate", "--adapter", adapter]);
		expect(stdout).toContain("idempotency");
		expect(stdout).toContain("herald_delivery_idempotency_idx");
		expect(stdout).not.toMatch(/idempotencyKey\s+String\?\s+@unique/);
		expect(stdout).not.toMatch(/idempotency_key[^\n]+UNIQUE/);
		expect(stdout).not.toMatch(/idempotencyKey:[^\n]+\.unique\(/);
	});

	it("prisma output maps camelCase fields to snake_case database columns", () => {
		const { stdout } = main(["generate", "--adapter", "prisma"]);
		expect(stdout).toContain('userId             String    @map("user_id")');
		expect(stdout).toContain(
			'scheduledAt        DateTime? @map("scheduled_at")',
		);
		expect(stdout).toContain(
			'claimExpiresAt     DateTime? @map("claim_expires_at")',
		);
		expect(stdout).toContain(
			'queueJobId         String?   @map("queue_job_id")',
		);
		expect(stdout).toContain(
			'complianceEvidenceId String? @map("compliance_evidence_id")',
		);
	});
});
