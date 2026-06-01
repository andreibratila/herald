# Change Proposal: split-send-pipeline-phases

## Problem

`src/core/runtime/send.ts` currently implements the generated event send path as one large function that mixes distinct responsibilities: option guards, runtime startup and event lookup, payload validation, dispatch and recipient/template validation, channel availability checks, compliance policy resolution/evaluation, compliance audit logging, idempotent delivery persistence, bypass audit logging, scheduling behavior, queue enqueueing, queue job ID persistence, and per-recipient error aggregation.

That concentration makes Herald's highest-risk runtime path harder to reason about and review. Compliance, idempotency, scheduling, and queue payload semantics are tightly interleaved, so small changes require reviewers to mentally re-derive the whole send flow. This increases the chance of accidental regressions in privacy/compliance behavior or delivery persistence when future changes touch only one phase.

## Intent

Refactor the send pipeline into explicit internal phases while preserving current behavior exactly. The change should improve maintainability, testability, and review isolation without changing Herald's public API, package exports, persistence schema, queue payloads, compliance decisions, idempotency scoping, scheduling behavior, or hook/audit semantics.

## Goals

- Split the generated send path into focused internal helpers under `src/core/runtime/send/`.
- Preserve the configured public API and generated `herald.events.*` behavior.
- Preserve payload privacy semantics: safe snapshots persist to DB, full payload only travels through immediate queue jobs, and delayed scheduled jobs continue to enqueue without payload when supported.
- Preserve compliance behavior, including legal basis resolution, consent/suppression/evidence checks, bypass behavior, denial audit logs, and scheduled bypass metadata semantics.
- Preserve idempotency scoping as `${idempotencyKey}:${userId}:${channel}:${template}`.
- Preserve per-recipient/per-channel error aggregation and skip reporting.
- Keep implementation reviewable using work-unit commits and, if necessary, chained PR slices within the 400 changed-line review budget.

## Non-Goals

- Do not redesign `SendResult`, `SendOptions`, recipients, templates, compliance policy types, queue contracts, or database adapter contracts.
- Do not introduce async dispatch or change the invariant that `dispatch()` is pure and synchronous.
- Do not change package `exports` or add new public entrypoints.
- Do not change the delivery schema, notification schema, audit log schema, queue job shape, or adapter behavior.
- Do not introduce new dependencies or new runtime infrastructure.
- Do not optimize performance or alter retry semantics as part of this refactor.

## Proposed Scope

Create focused internal modules under `src/core/runtime/send/` and reduce `src/core/runtime/send.ts` to orchestration and public factory wiring.

Proposed helper boundaries:

- `guards.ts` — validate send options such as `scheduledAt` future checks and scheduled send `resolvePayload` requirements.
- `prepare.ts` — start runtime, resolve registered event, parse payload, run dispatch, validate recipients/templates, and produce a prepared send context.
- `channel-phase.ts` — determine channel support, invoke skip hooks for unavailable channels, and return structured skip decisions.
- `compliance-phase.ts` — resolve event/channel compliance policy, enforce DB capability assertions, evaluate or bypass compliance, write denial audit logs, and return compliance decisions/skip results.
- `delivery-phase.ts` — construct idempotency keys and delivery creation payloads, call idempotent delivery creation, push successful deliveries, and write bypass/scheduled audit logs for newly created deliveries.
- `enqueue-phase.ts` — enqueue immediate and scheduled jobs, preserving full payload for immediate jobs only and delayed scheduled enqueue behavior only when queue capabilities support delayed jobs.
- Shared local types, if needed, for prepared context and phase results. These should remain internal to `src/core/runtime/send/`.

Exact filenames may be adjusted during design if TypeScript import boundaries are cleaner with fewer modules, but the implementation should keep phase ownership explicit and avoid moving behavior into generic utility files.

## Out of Scope

- Reworking `processDelivery`, scheduled worker internals, queue drivers, or DB adapters.
- Changing tests to assert new implementation details rather than observable behavior.
- Expanding public documentation except if a later implementation needs an internal architecture note.
- Combining this refactor with compliance policy redesign, scheduler redesign, or queue adapter capability changes.
- Rewriting unrelated runtime files for style consistency.

## Affected Areas

- `src/core/runtime/send.ts` — remains the exported factory module but becomes a smaller orchestrator.
- New internal modules under `src/core/runtime/send/` — contain phase helpers and private phase types.
- Existing send/runtime tests may need targeted additions or refactoring only to prove behavior is unchanged around phase boundaries.
- Type-only imports from `src/types/index.ts`, compliance helpers, queue types, and runtime event/template types may be redistributed across the new modules.

## Alternatives Considered

1. **Leave `send.ts` monolithic.**
   - Avoids short-term churn, but keeps compliance, persistence, scheduling, and enqueue behavior coupled in a single review unit.

2. **Extract only tiny generic utilities.**
   - Lowers file size slightly, but does not establish meaningful phase boundaries or improve review of high-risk behavior.

3. **Introduce a formal middleware/pipeline abstraction.**
   - Could make phases extensible, but would be a larger design change with new contracts. That is unnecessary for an internal behavior-preserving refactor.

4. **Refactor and redesign behavior together.**
   - Might address future opportunities, but it would mix mechanical extraction with semantic changes in compliance and queueing. This proposal intentionally avoids that.

## Impact

### Public API

No intended public API change. Application code should continue using `configureHerald`, `heraldApp.defineEvent`, `heraldApp.create`, and generated `herald.events.*` methods exactly as before.

### Runtime Behavior

No intended runtime behavior change. The send path must preserve validation order where observable, skip/error aggregation, hook invocation behavior, audit log creation, delivery creation fields, idempotency scoping, scheduling behavior, and queue payload semantics.

### Privacy and Compliance

The refactor touches privacy- and compliance-critical code. The spec/design phase should explicitly pin requirements for:

- no full payload persistence in delivery records,
- immediate queue jobs carrying validated payload,
- delayed scheduled jobs not carrying payload in Herald enqueue calls,
- denial audit metadata preservation,
- bypass audit behavior preservation, and
- scheduled bypass compliance decision fields remaining equivalent.

### Review Workload

The change may exceed 400 changed lines if helpers and tests are extracted in one PR. The recommended chain forecast is:

1. **Slice A — Guard and preparation extraction.** Move startup/event lookup, option guards, validation, dispatch, and template validation into preparation helpers.
2. **Slice B — Channel and compliance extraction.** Extract channel availability and compliance decision/audit handling while preserving skip semantics.
3. **Slice C — Delivery and enqueue extraction.** Extract idempotent delivery creation, audit logging for created deliveries, scheduling, and queue job ID persistence.

Because this session's chained PR strategy is `ask-always`, implementation should pause before apply/PR planning if the task forecast exceeds the 400 changed-line review budget and ask whether to use chained PRs or accept a `size:exception`.

## Migration and Review Strategy

- Treat the change as an internal architecture refactor with no migration required for users.
- Keep commits by work unit, with behavior tests or verification evidence in the same work unit as the extracted phase.
- Prefer moving code first and only then tightening helper names/types to avoid semantic drift.
- Review by phase invariants: guards/preparation, channel/compliance, delivery/enqueue.
- Require clean verification at the end of each implementation slice: `npm run typecheck`, `npm run lint`, and relevant Vitest coverage, with full `npm run test` before completion.

## Risks

- Reordering validation, hooks, audit writes, or enqueue calls could create subtle observable behavior changes.
- Compliance bypass and scheduled delivery metadata have nuanced semantics that are easy to accidentally normalize incorrectly.
- Error aggregation could change if helper exceptions are caught at a different level.
- Type extraction may create circular dependencies or overly broad phase context types.
- A mechanical refactor plus tests may exceed the review budget without changing behavior.

## Rollback

Rollback is straightforward: restore the pre-refactor `src/core/runtime/send.ts` implementation and remove the new `src/core/runtime/send/` helper modules. Because the proposal does not change public APIs, database schema, package exports, or persisted data shape, rollback should not require user migration or adapter changes.

## Success Criteria

- `send.ts` delegates to explicit phase helpers and is easier to review as orchestration rather than a monolithic pipeline.
- Public API, package exports, DB adapter contract, queue contract, and event definition API remain unchanged.
- Compliance decisions, audit logs, idempotency keys, delivery fields, scheduling behavior, queue payload shape, skip reasons, and error aggregation remain behaviorally equivalent.
- Existing tests pass, and spec/design identifies targeted regression coverage for compliance denial, compliance bypass, scheduled sends with delayed queues, scheduled sends without delayed queues, unsupported channels, idempotent duplicate sends, and per-channel error aggregation.
- Implementation delivery plan respects the 400 changed-line review budget or obtains an explicit chained PR/`size:exception` decision before apply.

## Acceptance Criteria for Moving to Spec/Design

Proceed to spec/design when the team agrees that:

- This is a behavior-preserving internal refactor only.
- The spec will define observable invariants for validation order, compliance, idempotency, scheduling, enqueueing, hooks, audit logs, and error/skip aggregation.
- The design will choose concrete helper module boundaries and private phase types without creating new public API.
- The tasks phase will include a review workload forecast and, under `ask-always`, a decision gate before implementation if the estimated diff exceeds 400 changed lines.
