# Send Runtime Pipeline Phases

## Requirements

### Requirement: Send Pipeline Behavioral Equivalence
The split-send-pipeline-phases refactor **MUST** preserve observable behavior of generated `herald.events.*` send execution.

#### Scenario: No public or contract surface changes
- **Given** a Herald application using current configured APIs, package entrypoints, DB adapters, queue adapters, and schema contracts
- **When** split-send-pipeline-phases is applied
- **Then** no public API signatures, package exports, persistence schema fields, or adapter contracts are changed
- **And** behavior changes are limited to internal code organization

### Requirement: Send Option Guards and Observable Order
Send option guards **MUST** remain behaviorally equivalent where ordering is externally observable.

#### Scenario: Past schedule is rejected before runtime startup
- **Given** `scheduledAt` is earlier than `Date.now() - 5000ms`
- **When** a generated send method is called
- **Then** it throws an error indicating `scheduledAt` must be in the future
- **And** runtime startup is not required before this rejection

#### Scenario: Scheduled send requires resolvePayload after event lookup
- **Given** `scheduledAt` is provided and the event has no `resolvePayload`
- **When** the send method is called for a registered event
- **Then** it throws an error requiring `resolvePayload` for scheduled sends

### Requirement: Event Preparation and Validation Pipeline
Preparation flow **MUST** preserve lookup, parsing, dispatch, and recipient/template validation semantics.

#### Scenario: Unknown event is rejected
- **Given** an event name not present in the runtime event map
- **When** send is called
- **Then** it throws an event-not-registered error

#### Scenario: Payload and dispatch output are validated before channel/compliance phases
- **Given** a registered event and input payload
- **When** send executes
- **Then** the payload is parsed through the event schema
- **And** `dispatch(validatedPayload)` is used for recipients
- **And** recipient/template and renderer validations run before per-recipient channel/compliance handling

### Requirement: Channel Support Skip Semantics
Unavailable channel behavior **MUST** preserve skip reason and hook invocation semantics.

#### Scenario: Unsupported or unconfigured channel is skipped
- **Given** a recipient channel that is not supported by runtime channels
- **When** send processes that recipient/channel pair
- **Then** `hooks.onSkipped` is invoked safely with a channel-unavailable message
- **And** the pair is recorded in `result.skipped` with reason `channel_unavailable:<channel>`
- **And** no compliance evaluation, delivery persistence, or enqueue is attempted for that pair

### Requirement: Compliance Resolution, Evaluation, Bypass, and Denial Auditing
Compliance behavior **MUST** preserve policy resolution, DB assertions, bypass semantics, denial skipping, and denial audit metadata.

#### Scenario: Compliance evaluation path is enforced when bypass is false
- **Given** a supported recipient/channel pair and `bypassComplianceCheck` is false
- **When** send processes the pair
- **Then** channel-specific policy is resolved from event/default compliance policy
- **And** compliance DB capability assertions are applied before evaluation
- **And** compliance is evaluated with subject, address hash, purpose, legal basis, and evidence inputs

#### Scenario: Compliance bypass returns allowed decision shape
- **Given** a supported recipient/channel pair and `bypassComplianceCheck` is true
- **When** send processes the pair
- **Then** compliance evaluation is bypassed
- **And** the decision is treated as allowed with decision `bypassed` and checked timestamp

#### Scenario: Denied compliance is skipped and audited
- **Given** compliance decision is denied for a recipient/channel pair
- **When** send handles the denied pair
- **Then** `hooks.onSkipped` is invoked safely with a compliance-denied message
- **And** an audit log entry with action `compliance.denied` is written with decision metadata
- **And** the pair is recorded in `result.skipped` with reason `compliance_denied:<reason-or-unknown>`
- **And** no delivery is created and no enqueue is attempted for that pair

### Requirement: Idempotency Scope and Delivery Persistence Fields
Delivery persistence **MUST** preserve idempotency scoping and persisted field semantics.

#### Scenario: Idempotency key is scoped per recipient, channel, and template
- **Given** `options.idempotencyKey` is provided
- **When** a recipient/channel/template pair is persisted
- **Then** delivery idempotency key is `${idempotencyKey}:${userId}:${channel}:${template}`

#### Scenario: Delivery record fields preserve scheduling and compliance semantics
- **Given** an allowed recipient/channel pair
- **When** delivery is created idempotently
- **Then** status is `scheduled` when `scheduledAt` exists, otherwise `pending`
- **And** `scheduledAt`, compliance policy fields, and decision/evidence references are persisted equivalently
- **And** for scheduled sends with compliance bypass, `complianceDecision` and `complianceCheckedAt` are persisted as `null`

### Requirement: Enqueue Behavior and Queue Payload Shapes
Queueing behavior **MUST** preserve immediate versus delayed scheduling semantics and payload handling.

#### Scenario: Immediate delivery enqueues full validated payload
- **Given** an allowed non-scheduled newly created delivery
- **When** enqueue is performed
- **Then** queue input includes `{ deliveryId, payload: validatedPayload }`
- **And** full validated payload is not persisted into delivery DB fields by this phase

#### Scenario: Scheduled delivery with delayed queue support enqueues without payload
- **Given** an allowed scheduled newly created delivery and queue supports delayed jobs
- **When** enqueue is performed
- **Then** queue input includes `{ deliveryId, scheduledAt }` without payload

#### Scenario: Scheduled delivery without delayed queue support is not enqueued
- **Given** an allowed scheduled newly created delivery and queue does not support delayed jobs
- **When** send processes the delivery
- **Then** no queue enqueue is attempted in send
- **And** scheduled worker polling remains responsible for later processing

### Requirement: Queue Job ID Persistence
Queue job IDs **MUST** be persisted equivalently when returned by queue drivers.

#### Scenario: queueJobId is stored only when queue returns a job id
- **Given** send enqueues an immediate or delayed scheduled job
- **When** queue returns a non-empty job ID
- **Then** `db.updateDelivery(deliveryId, { queueJobId })` is called
- **And** when queue returns no job ID, no queueJobId update is written

### Requirement: Created-Only Side Effects for Audit and Enqueue
Post-create side effects **MUST** remain gated to newly created deliveries.

#### Scenario: Duplicate idempotent delivery skips enqueue and creation-side audits
- **Given** idempotent delivery create returns `created = false`
- **When** send processes that recipient/channel pair
- **Then** the delivery is included in `result.deliveries`
- **And** bypass/scheduled creation audit side effects and enqueue are not executed for that pair

### Requirement: Per-Recipient/Channel Error Aggregation
Errors **MUST** remain isolated and aggregated per recipient/channel processing attempt.

#### Scenario: One pair failure does not abort remaining pairs
- **Given** one recipient/channel pair throws during processing
- **When** send continues iteration
- **Then** the error is captured in `result.errors` with its recipient
- **And** remaining recipient/channel pairs continue processing
- **And** thrown non-Error values are normalized to `Error(String(value))`
