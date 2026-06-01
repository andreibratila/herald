export const DRIZZLE_SCHEMA = `
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
    data:         json("data"),           // derived from persistedFields payload paths
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
