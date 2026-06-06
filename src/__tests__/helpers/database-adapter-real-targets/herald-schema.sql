-- PR 5A-real-base shared fixture for real conformance testbed bootstrapping.
-- Derived from the Kysely SQL emitted by `npx herald generate --adapter kysely`.
-- Keep this fixture broad enough for official adapters to insert/update/read all Herald columns.

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
  accepted_at          TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ,
  claimed_at           TIMESTAMPTZ,
  claim_expires_at     TIMESTAMPTZ,
  claimed_by           TEXT,
  resolve_attempts     INTEGER     NOT NULL DEFAULT 0,
  queue_job_id         TEXT,
  bypass_compliance_check BOOLEAN  NOT NULL DEFAULT FALSE,
  side_effects_completed_at TIMESTAMPTZ,
  rendered_hash        TEXT,
  address_hash         TEXT,
  purpose              TEXT,
  legal_basis_at_send  TEXT,
  consent_event_id     TEXT,
  suppression_id       TEXT,
  compliance_evidence_id TEXT,
  compliance_required  BOOLEAN,
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
CREATE INDEX IF NOT EXISTS herald_delivery_status_claim_expires_idx   ON herald_deliveries (status, claim_expires_at);
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
