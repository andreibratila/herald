# Database Adapter Conformance

## Requirements

### Requirement: Reusable Conformance Harness Contract
The conformance suite **MUST** provide a reusable harness that accepts an adapter factory and lifecycle hooks, provisions fresh isolated adapter state per scenario, creates deterministic fixtures, exposes grouped entrypoints by adapter method area, and runs a base unit suite without requiring external DB infrastructure.

#### Scenario: Harness runs against mock adapter without external DB
- **Given** a conformance harness configured with a mock adapter factory
- **When** grouped conformance suites are executed
- **Then** each scenario receives fresh isolated state
- **And** fixture timestamps/ids used for ordering checks are deterministic
- **And** grouped entrypoints can be invoked independently by method area
- **And** no external database service is required for the base unit suite

### Requirement: Notification Operations Semantics
Database adapters **MUST** support notification create/list/get/count/mark-read semantics with deterministic pagination and ordering.

#### Scenario: Notification list defaults and explicit pagination
- **Given** notifications exist for a user
- **When** `getNotifications(userId)` is called without options
- **Then** the adapter applies `limit=20` and `offset=0`
- **And** results are sorted by `createdAt` descending then `id` descending
- **When** explicit `limit` and `offset` are provided
- **Then** explicit pagination values are honored exactly

#### Scenario: Notification read and lookup behavior
- **Given** unread notifications exist for a user
- **When** unread list/count, `markRead`, `markAllRead`, and `getNotificationByDeliveryId` are exercised
- **Then** unread list/count reflect read transitions correctly
- **And** `markRead` on a missing notification id is a no-op and does not throw

### Requirement: Delivery and Idempotency Semantics
Database adapters **MUST** support delivery create/update/get/list/idempotency lookup with deterministic reusable selection rules.

#### Scenario: Delivery list defaults and explicit pagination
- **Given** deliveries exist for a user
- **When** `getDeliveriesByUser(userId)` is called without options
- **Then** the adapter applies `limit=20` and `offset=0`
- **And** results are sorted by `createdAt` descending then `id` descending
- **When** explicit `limit` and `offset` are provided
- **Then** explicit pagination values are honored exactly

#### Scenario: Reusable idempotent selection matrix
- **Given** prior deliveries exist for an idempotency key across statuses
- **When** `createDeliveryIdempotent` or `getDeliveryByIdempotencyKey` is evaluated
- **Then** reusable statuses are only `pending|scheduled|claimed|dispatched|retrying|accepted`
- **And** non-reusable statuses are `failed|skipped|redacted`
- **And** reusable candidate selection is deterministic by `updatedAt` descending, then `createdAt` descending, then `id` descending

### Requirement: Consent and Suppression Semantics
Database adapters **MUST** preserve append-only consent evidence and suppression lookup precedence.

#### Scenario: Consent evidence append-only with filters
- **Given** multiple consent events for a subject
- **When** `getConsentEvents` is queried with channel and/or purpose filters
- **Then** returned evidence is append-only history
- **And** filter constraints are honored without mutating prior evidence

#### Scenario: Suppression lookup precedence
- **Given** both purpose-specific and global suppressions for the same address hash and channel
- **When** `findSuppression` is called with a purpose
- **Then** newest matching purpose-specific suppression is returned first
- **And** if none exists, newest global suppression is returned
- **When** `findSuppression` is called without a purpose
- **Then** only global suppressions are eligible

### Requirement: Audit Log Semantics
Database adapters **MUST** support deterministic audit create/list/find semantics.

#### Scenario: Audit list and action lookup behavior
- **Given** multiple audit records for a user and action
- **When** `getAuditLogs` is called with an optional limit
- **Then** records are returned newest-first by `createdAt` then `id`
- **And** limit is honored
- **When** `findAuditLogByAction(userId, action)` is called
- **Then** the newest existing matching record is returned deterministically
- **And** adapter behavior does not require uniqueness enforcement at write time

### Requirement: Compliance Lifecycle and Export Semantics
Database adapters **MUST** preserve compliance evidence during erasure and provide user export data with redaction markers.

#### Scenario: Erasure redacts and preserves evidence
- **Given** stored user-owned records and compliance/audit history
- **When** `eraseSubject(userId)` is executed
- **Then** subject-linked personal fields are redacted rather than destructively deleted
- **And** audit/compliance evidence remains queryable for traceability

#### Scenario: Export includes expected user-owned data
- **Given** a user with deliveries, notifications, suppressions, and audit/compliance history
- **When** `exportUser(userId)` is executed after normal and redacted states
- **Then** export includes expected user-owned datasets
- **And** redacted fields are represented with redaction markers where applicable
- **And** suppression association is included when present

### Requirement: Retention Purge Boundary and Counts
Database adapters **MUST** implement strict older-than purge boundaries with accurate deletion counts.

#### Scenario: Purge deletes strictly older records
- **Given** delivery and audit records before, at, and after an `olderThan` boundary
- **When** `purgeExpiredDeliveries(olderThan)` and `purgeExpiredAuditLogs(olderThan)` are executed
- **Then** only records strictly older than the boundary are deleted
- **And** boundary-equal records remain
- **And** returned counts equal deleted row totals

### Requirement: Scheduled Claim, Reclaim, and Cancellation Semantics
Database adapters **MUST** enforce deterministic scheduled lifecycle selection and cancellation behavior.

#### Scenario: Claim due scheduled and expired claimed deliveries
- **Given** scheduled, claimed, and terminal-status deliveries with mixed due times and lease expirations
- **When** `claimScheduledBatch(before, workerId, limit, leaseMs)` is executed
- **Then** eligible rows are only `scheduled` with `scheduledAt <= before` and `claimed` with expired lease
- **And** future scheduled rows, terminal/non-reusable statuses, and non-expired claimed rows are excluded
- **And** lease metadata is set on claimed rows
- **And** result ordering is deterministic by due time ascending, then ID descending
- **And** `limit` is honored

#### Scenario: Cancel scheduled/claimed deliveries for one user
- **Given** a user with scheduled/claimed deliveries and other statuses
- **When** `cancelScheduledDeliveries(userId)` is executed
- **Then** only that user's scheduled/claimed deliveries are transitioned to `redacted`
- **And** the method returns affected delivery ids with their `queueJobId` values
- **And** unaffected users or statuses are not changed

### Requirement: User Lookup Coverage Scope
Conformance coverage **MUST** include user lookup hooks because `HeraldDatabaseAdapter` currently defines `getUserEmail` as part of the normative contract.

#### Scenario: User email lookup behavior
- **Given** an adapter implementation with stored users
- **When** `getUserEmail(userId)` is called for existing and missing users
- **Then** existing users resolve to email strings
- **And** missing users resolve to `null`
