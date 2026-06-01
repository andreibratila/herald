export const PRISMA_SCHEMA = `
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
  data         Json?     // derived from persistedFields payload paths
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
