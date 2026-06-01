#!/usr/bin/env node
// ============================================================
// herald — src/cli/index.ts
// CLI schema generator
// Usage: npx herald generate --adapter prisma|drizzle|kysely
// ============================================================

const PRISMA_SCHEMA = `
// ─── Add to your schema.prisma ───────────────────────────────
// Run: npx herald generate --adapter prisma >> prisma/schema.prisma
// Requires Prisma generator previewFeatures = ["partialIndexes"]
// Herald intentionally emits Prisma's documented @@index(..., where: ...) partial-index syntax.
// Then: npx prisma migrate dev

model HeraldNotification {
  id           String    @id @default(cuid())
  userId       String    @map("user_id")
  eventType    String    @map("event_type")
  templateName String    @map("template_name")
  deliveryId   String?   @map("delivery_id")
  title        String
  body         String?
  href         String?
  data         Json?     // safeFields only — no PII persisted
  readAt       DateTime? @map("read_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  @@index([userId, readAt])
  @@index([userId, createdAt])
  @@index([deliveryId])
  @@map("herald_notifications")
}

model HeraldDelivery {
  id                 String    @id @default(cuid())
  userId             String    @map("user_id")
  eventType          String    @map("event_type")
  templateName       String    @map("template_name")
  channel            String    // "email" | "inApp"
  status             String    @default("pending")
  attempts           Int       @default(0)
  lastError          String?   @map("last_error")
  externalId         String?   @map("external_id") // provider message ID
  idempotencyKey     String?   @map("idempotency_key")
  scheduledAt        DateTime? @map("scheduled_at")
  acceptedAt             DateTime? @map("accepted_at")
  failedAt           DateTime? @map("failed_at")
  claimedAt          DateTime? @map("claimed_at") // when worker claimed this row
  claimExpiresAt     DateTime? @map("claim_expires_at") // lease expiry — if past, re-claimable
  claimedBy          String?   @map("claimed_by") // worker ID string
  resolveAttempts    Int       @default(0) @map("resolve_attempts") // count of resolvePayload failures
  queueJobId         String?   @map("queue_job_id") // pg-boss job ID for cancelJobs
  bypassComplianceCheck Boolean @default(false) @map("bypass_compliance_check")
  sideEffectsCompletedAt  DateTime? @map("side_effects_completed_at") // set after email+inApp, before updateDelivery("accepted")
  renderedHash       String?   @map("rendered_hash") // SHA-256 hex of subject+html after rendering
  addressHash        String?   @map("address_hash") // app-supplied hash for suppression checks
  purpose            String?   // compliance purpose snapshot
  legalBasisAtSend   String?   @map("legal_basis_at_send") // legal basis snapshot
  consentEventId     String?   @map("consent_event_id") // consent evidence ID used at send/fire time
  suppressionId      String?   @map("suppression_id") // suppression ID when denied at fire time
  complianceEvidenceId String? @map("compliance_evidence_id") // app-owned legal-basis evidence reference
  complianceRequired Boolean? @map("compliance_required")
  complianceRequiresConsentEvent Boolean? @map("compliance_requires_consent_event")
  complianceRequiresSuppressionCheck Boolean? @map("compliance_requires_suppression_check")
  complianceRequiresEvidence Boolean? @map("compliance_requires_evidence")
  complianceDefaultDecision String? @map("compliance_default_decision")
  complianceDecision String?   @map("compliance_decision") // allowed | denied | bypassed
  complianceCheckedAt DateTime? @map("compliance_checked_at") // when compliance was evaluated
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  @@index([userId])
  @@index([idempotencyKey], map: "herald_delivery_idempotency_idx")
  @@index([createdAt])
  @@index([status, scheduledAt])
  @@index([status, claimExpiresAt])
  @@index([scheduledAt], where: { status: "scheduled" }, map: "herald_delivery_scheduled_idx")
  @@map("herald_deliveries")
}

model HeraldConsentEvent {
  id                    String   @id @default(cuid())
  subjectId             String   @map("subject_id")
  subjectType           String?  @map("subject_type")
  channel               String
  purpose               String
  status                String   // "granted" | "withdrawn"
  legalBasis            String   @map("legal_basis")
  source                String
  formId                String?  @map("form_id")
  legalNoticeVersionId  String?  @map("legal_notice_version_id")
  privacyPolicyVersion  String?  @map("privacy_policy_version")
  checkboxTextVersion   String?  @map("checkbox_text_version")
  ipHash                String?  @map("ip_hash")
  userAgentHash         String?  @map("user_agent_hash")
  metadata              Json?
  createdAt             DateTime @default(now()) @map("created_at")

  @@index([subjectId, channel, purpose, createdAt])
  @@map("herald_consent_events")
}

model HeraldSuppression {
  id          String   @id @default(cuid())
  addressHash String   @map("address_hash")
  channel     String
  purpose     String?
  reason      String   // unsubscribe | spam_complaint | hard_bounce | manual | legal
  source      String?
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([addressHash, channel, purpose])
  @@map("herald_suppressions")
}

model HeraldAuditLog {
  id         String   @id @default(cuid())
  userId     String?  @map("user_id") // null for system actions (purge, compliance.erase, etc.)
  action     String
  eventType  String?  @map("event_type")
  deliveryId String?  @map("delivery_id")
  metadata   Json?    // non-PII only
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@index([createdAt])
  @@map("herald_audit_logs")
}
`;

const DRIZZLE_SCHEMA = `
// ─── Add to your Drizzle schema ──────────────────────────────
// Run: npx herald generate --adapter drizzle >> src/db/herald.schema.ts
// Then pass the exported tables to createDrizzleAdapter()

import {
  pgTable, text, boolean, integer,
  timestamp, json, index,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

const createId = () => crypto.randomUUID()

export const heraldNotifications = pgTable(
  "herald_notifications",
  {
    id:           text("id").primaryKey().$defaultFn(() => createId()),
    userId:       text("user_id").notNull(),
    eventType:    text("event_type").notNull(),
    templateName: text("template_name").notNull(),
    deliveryId:   text("delivery_id"),
    title:        text("title").notNull(),
    body:         text("body"),
    href:         text("href"),
    data:         json("data"),           // safeFields only — no PII
    readAt:       timestamp("read_at"),
    createdAt:    timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("herald_notif_user_read_idx").on(t.userId, t.readAt),
    index("herald_notif_user_created_idx").on(t.userId, t.createdAt),
    index("herald_notif_delivery_idx").on(t.deliveryId),
  ]
)

export const heraldDeliveries = pgTable(
  "herald_deliveries",
  {
    id:                 text("id").primaryKey().$defaultFn(() => createId()),
    userId:             text("user_id").notNull(),
    eventType:          text("event_type").notNull(),
    templateName:       text("template_name").notNull(),
    channel:            text("channel").notNull(),
    status:             text("status").notNull().default("pending"),
    attempts:           integer("attempts").notNull().default(0),
    lastError:          text("last_error"),
    externalId:         text("external_id"),
    idempotencyKey:     text("idempotency_key"),
    scheduledAt:        timestamp("scheduled_at"),
    acceptedAt:             timestamp("accepted_at"),
    failedAt:           timestamp("failed_at"),
    claimedAt:          timestamp("claimed_at"),
    claimExpiresAt:     timestamp("claim_expires_at"),
    claimedBy:          text("claimed_by"),
    resolveAttempts:    integer("resolve_attempts").notNull().default(0),
    queueJobId:         text("queue_job_id"),
    bypassComplianceCheck: boolean("bypass_compliance_check").notNull().default(false),
    sideEffectsCompletedAt:  timestamp("side_effects_completed_at"),
    renderedHash:       text("rendered_hash"),
    addressHash:        text("address_hash"),
    purpose:            text("purpose"),
    legalBasisAtSend:   text("legal_basis_at_send"),
    consentEventId:     text("consent_event_id"),
    suppressionId:      text("suppression_id"),
    complianceEvidenceId: text("compliance_evidence_id"),
    complianceRequired: boolean("compliance_required"),
    complianceRequiresConsentEvent: boolean("compliance_requires_consent_event"),
    complianceRequiresSuppressionCheck: boolean("compliance_requires_suppression_check"),
    complianceRequiresEvidence: boolean("compliance_requires_evidence"),
    complianceDefaultDecision: text("compliance_default_decision"),
    complianceDecision: text("compliance_decision"),
    complianceCheckedAt: timestamp("compliance_checked_at"),
    createdAt:          timestamp("created_at").notNull().defaultNow(),
    updatedAt:          timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("herald_delivery_user_idx").on(t.userId),
    index("herald_delivery_idempotency_idx").on(t.idempotencyKey),
    index("herald_delivery_created_idx").on(t.createdAt),
    index("herald_delivery_status_scheduled_idx").on(t.status, t.scheduledAt),
    index("herald_delivery_status_claim_expires_idx").on(t.status, t.claimExpiresAt),
    index("herald_delivery_scheduled_idx").on(t.scheduledAt).where(sql\`status = 'scheduled'\`),
  ]
)

export const heraldConsentEvents = pgTable(
  "herald_consent_events",
  {
    id:                   text("id").primaryKey().$defaultFn(() => createId()),
    subjectId:            text("subject_id").notNull(),
    subjectType:          text("subject_type"),
    channel:              text("channel").notNull(),
    purpose:              text("purpose").notNull(),
    status:               text("status").notNull(),
    legalBasis:           text("legal_basis").notNull(),
    source:               text("source").notNull(),
    formId:               text("form_id"),
    legalNoticeVersionId: text("legal_notice_version_id"),
    privacyPolicyVersion: text("privacy_policy_version"),
    checkboxTextVersion:  text("checkbox_text_version"),
    ipHash:               text("ip_hash"),
    userAgentHash:        text("user_agent_hash"),
    metadata:             json("metadata"),
    createdAt:            timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("herald_consent_event_scope_idx").on(t.subjectId, t.channel, t.purpose, t.createdAt),
  ]
)

export const heraldSuppressions = pgTable(
  "herald_suppressions",
  {
    id:          text("id").primaryKey().$defaultFn(() => createId()),
    addressHash: text("address_hash").notNull(),
    channel:     text("channel").notNull(),
    purpose:     text("purpose"),
    reason:      text("reason").notNull(),
    source:      text("source"),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("herald_suppression_lookup_idx").on(t.addressHash, t.channel, t.purpose),
  ]
)

export const heraldAuditLogs = pgTable(
  "herald_audit_logs",
  {
    id:         text("id").primaryKey().$defaultFn(() => createId()),
    userId:     text("user_id"),
    action:     text("action").notNull(),
    eventType:  text("event_type"),
    deliveryId: text("delivery_id"),
    metadata:   json("metadata"),           // non-PII only
    createdAt:  timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("herald_audit_user_idx").on(t.userId),
    index("herald_audit_created_idx").on(t.createdAt),
  ]
)
`;

const KYSELY_SCHEMA = `
-- ─── Herald SQL migration for Kysely ─────────────────────────
-- Run: npx herald generate --adapter kysely > migrations/herald_init.sql
-- Then run the migration via your preferred tool (kysely-migration, flyway, etc.)
-- See herald docs for the TypeScript Database interface additions.

CREATE TABLE IF NOT EXISTS herald_notifications (
  id            TEXT        PRIMARY KEY,
  user_id       TEXT        NOT NULL,
  event_type    TEXT        NOT NULL,
  template_name TEXT        NOT NULL,
  delivery_id   TEXT,
  title         TEXT        NOT NULL,
  body          TEXT,
  href          TEXT,
  data          JSONB,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS herald_notif_user_read_idx     ON herald_notifications (user_id, read_at);
CREATE INDEX IF NOT EXISTS herald_notif_user_created_idx  ON herald_notifications (user_id, created_at);
CREATE INDEX IF NOT EXISTS herald_notif_delivery_idx      ON herald_notifications (delivery_id);

CREATE TABLE IF NOT EXISTS herald_deliveries (
  id                   TEXT        PRIMARY KEY,
  user_id              TEXT        NOT NULL,
  event_type           TEXT        NOT NULL,
  template_name        TEXT        NOT NULL,
  channel              TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'pending',
  attempts             INTEGER     NOT NULL DEFAULT 0,
  last_error           TEXT,
  external_id          TEXT,
  idempotency_key      TEXT,
  scheduled_at         TIMESTAMPTZ,
  accepted_at              TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ,
  claimed_at           TIMESTAMPTZ,
  claim_expires_at     TIMESTAMPTZ,
  claimed_by           TEXT,
  resolve_attempts     INTEGER     NOT NULL DEFAULT 0,
  queue_job_id         TEXT,
  bypass_compliance_check BOOLEAN     NOT NULL DEFAULT FALSE,
  side_effects_completed_at TIMESTAMPTZ,
  rendered_hash        TEXT,
  address_hash         TEXT,
  purpose              TEXT,
  legal_basis_at_send  TEXT,
  consent_event_id     TEXT,
  suppression_id       TEXT,
  compliance_evidence_id TEXT,
  compliance_required   BOOLEAN,
  compliance_requires_consent_event BOOLEAN,
  compliance_requires_suppression_check BOOLEAN,
  compliance_requires_evidence BOOLEAN,
  compliance_default_decision TEXT,
  compliance_decision  TEXT,
  compliance_checked_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS herald_delivery_user_idx               ON herald_deliveries (user_id);
CREATE INDEX IF NOT EXISTS herald_delivery_idempotency_idx        ON herald_deliveries (idempotency_key);
CREATE INDEX IF NOT EXISTS herald_delivery_created_idx            ON herald_deliveries (created_at);
CREATE INDEX IF NOT EXISTS herald_delivery_status_scheduled_idx   ON herald_deliveries (status, scheduled_at);
CREATE INDEX IF NOT EXISTS herald_delivery_status_claim_exp_idx   ON herald_deliveries (status, claim_expires_at);
CREATE INDEX IF NOT EXISTS herald_delivery_scheduled_idx          ON herald_deliveries (scheduled_at) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS herald_consent_events (
  id                       TEXT        PRIMARY KEY,
  subject_id               TEXT        NOT NULL,
  subject_type             TEXT,
  channel                  TEXT        NOT NULL,
  purpose                  TEXT        NOT NULL,
  status                   TEXT        NOT NULL,
  legal_basis              TEXT        NOT NULL,
  source                   TEXT        NOT NULL,
  form_id                  TEXT,
  legal_notice_version_id  TEXT,
  privacy_policy_version   TEXT,
  checkbox_text_version    TEXT,
  ip_hash                  TEXT,
  user_agent_hash          TEXT,
  metadata                 JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS herald_consent_event_scope_idx ON herald_consent_events (subject_id, channel, purpose, created_at);

CREATE TABLE IF NOT EXISTS herald_suppressions (
  id            TEXT        PRIMARY KEY,
  address_hash  TEXT        NOT NULL,
  channel       TEXT        NOT NULL,
  purpose       TEXT,
  reason        TEXT        NOT NULL,
  source        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS herald_suppression_lookup_idx ON herald_suppressions (address_hash, channel, purpose);

CREATE TABLE IF NOT EXISTS herald_audit_logs (
  id           TEXT        PRIMARY KEY,
  user_id      TEXT,
  action       TEXT        NOT NULL,
  event_type   TEXT,
  delivery_id  TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS herald_audit_user_idx     ON herald_audit_logs (user_id);
CREATE INDEX IF NOT EXISTS herald_audit_created_idx  ON herald_audit_logs (created_at);

-- TypeScript: add this to your Kysely Database interface:
-- import type { HeraldDatabase } from "herald/adapters/kysely"
-- interface Database extends HeraldDatabase { /* your tables */ }
`;

export function main(argv: string[]): { stdout: string; exitCode: number } {
	const command = argv[0];

	if (!command || command === "--help" || command === "-h") {
		return {
			stdout: `
herald CLI

Usage:
  npx herald generate --adapter <prisma|drizzle|kysely>

Commands:
  generate    Output the DB schema for your chosen adapter

Options:
  --adapter   Target adapter (default: prisma)
  --help      Show this help

Examples:
  # Append to existing prisma schema:
  # Requires Prisma generator previewFeatures = ["partialIndexes"]
  # Herald emits Prisma's documented @@index(..., where: ...) partial-index syntax.
  npx herald generate --adapter prisma >> prisma/schema.prisma

  # Create a new drizzle schema file:
  npx herald generate --adapter drizzle > src/db/herald.schema.ts

  # Create a SQL migration:
  npx herald generate --adapter kysely > migrations/herald_init.sql
`,
			exitCode: 0,
		};
	}

	if (command !== "generate") {
		return {
			stdout: `Unknown command "${command}". Run: npx herald --help\n`,
			exitCode: 1,
		};
	}

	const adapterIdx = argv.indexOf("--adapter");
	const adapter = adapterIdx !== -1 ? argv[adapterIdx + 1] : "prisma";

	switch (adapter) {
		case "prisma":
			return { stdout: PRISMA_SCHEMA, exitCode: 0 };
		case "drizzle":
			return { stdout: DRIZZLE_SCHEMA, exitCode: 0 };
		case "kysely":
			return { stdout: KYSELY_SCHEMA, exitCode: 0 };
		default:
			return {
				stdout: `Unknown adapter "${adapter}". Use: prisma | drizzle | kysely\n`,
				exitCode: 1,
			};
	}
}

// ── Module-main guard (ESM) ───────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
	const { stdout, exitCode } = main(process.argv.slice(2));
	if (exitCode !== 0) process.stderr.write(stdout);
	else process.stdout.write(stdout);
	process.exit(exitCode);
}
