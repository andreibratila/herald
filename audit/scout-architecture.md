# Herald architecture/refactor scout audit

## Scope and validation

- Inspected repository structure, `src/`, key tests, README/docs/package exports, and runtime extraction state.
- This folder is not currently a git repository (`git status` reports `not a git repo`).
- Validation run: `npm run typecheck && npm run test` passed: 22 test files, 303 tests.
- Engram save was requested, but no Engram/memory tool is available in this subagent runtime.

## Files retrieved

1. `package.json` (full) - public exports, peer deps, scripts.
2. `tsup.config.ts` (full) - build entrypoints and externals.
3. `src/index.ts` (full) - root public API surface.
4. `src/core/herald.ts` (lines 1-242) - runtime composition/root factory.
5. `src/core/configure.ts` (lines 1-360) - configured API, app scoping, channel/compliance normalization.
6. `src/core/define.ts` (lines 1-101) - pure event-ref factory and recipient validation.
7. `src/core/runtime/send.ts` (lines 1-328) - send pipeline: validation, compliance, idempotency, delivery creation, enqueue.
8. `src/core/runtime/processor.ts` (lines 1-325) - delivery side effects, rendering, retries, status/audit updates.
9. `src/core/runtime/compliance-lifecycle.ts` (lines 1-188) - consent/suppression/export/purge/erase lifecycle.
10. `src/core/runtime/scheduled-worker.ts` (lines 1-161) - sync-driver scheduled delivery polling/claim/enqueue.
11. `src/core/runtime/queue-processor.ts` (lines 1-55) - durable queue fire-time guard wrapper.
12. `src/core/runtime/config-normalization.ts` (lines 1-100) - low-level runtime normalization path.
13. `src/core/runtime/registry.ts` (lines 1-68) - per-instance registry validation/maps.
14. `src/types/index.ts` (lines 1-711) - central public/internal type contract.
15. `src/queue/index.ts` (lines 1-267) - queue drivers: sync, pg-boss, adapter, backoff.
16. `src/compliance/index.ts` (lines 1-378) - legal-basis registry, policy resolution, compliance evaluation.
17. `src/adapters/db/kysely.ts` (lines 1-877) - largest DB adapter, mappers and PostgreSQL SQL assumptions.
18. `src/adapters/db/prisma.ts` (lines 1-494) - Prisma adapter and raw scheduled SQL paths.
19. `src/adapters/db/drizzle.ts` (lines 1-543) - Drizzle adapter and PostgreSQL scheduled SQL paths.
20. `src/cli/index.ts` (lines 1-456) - inline schema generator strings and CLI parsing.
21. `README.md` (selected grep around lines 53-152, 285-386) - configured API examples and queue/compliance docs references.

## Current architecture map

### Public surface

- Root export `src/index.ts` exposes `configureHerald` and types only; low-level `createHerald`/`defineEvent` are not exported from the package root. This matches the constraint that the configured API is the public path.
- Package exports only root plus DB/mail adapters (`package.json` exports). No `herald/react` or SSE helper export found.
- Build entries in `tsup.config.ts` mirror package exports plus CLI entry; peer deps are externalized.

### Configured API and event registration

- `configureHerald()` in `src/core/configure.ts` validates channel keys, creates an app-local `appId` symbol, exposes app-scoped `defineEvent`, and rejects refs from another app before creating a runtime.
- `src/core/define.ts` remains a pure factory: returns an `EventRef` with default `safeFields: []`; no global registry writes.
- Runtime registries are constructed in `src/core/runtime/registry.ts`; duplicate stable event names are checked at runtime construction.

### Runtime composition

- `src/core/herald.ts` is now mostly a composition root. It wires:
  - config normalization/registry validation,
  - queue creation,
  - compliance lifecycle,
  - processor creation,
  - start controller,
  - send function,
  - in-app API,
  - scheduled worker,
  - warmup/worker helpers.
- This extraction is a clear improvement: most old helper behavior is now in `src/core/runtime/*`.

### Delivery flow

- `src/core/runtime/send.ts` validates payload, calls pure sync `dispatch`, validates recipients/templates, evaluates compliance, creates idempotent delivery rows, and enqueues immediate/scheduled jobs.
- Full payload is enqueued for immediate jobs; scheduled jobs require `resolvePayload` so the payload is rebuilt at fire time instead of persisted long-term.
- `src/core/runtime/processor.ts` resolves payload if absent, renders email/in-app, persists only safe in-app `data` via `safeFields`, hashes rendered email content, updates delivery status, and writes audit logs.

### Compliance/scheduling/queue

- `src/compliance/index.ts` owns pure legal-basis defaults, policy validation/resolution, and DB-backed compliance decisions.
- `src/core/runtime/compliance-lifecycle.ts` owns consent/suppression/export/purge/erasure lifecycle and calls queue cancellation for scheduled erasure.
- `src/core/runtime/queue-processor.ts` wraps durable queue processing with fire-time status/compliance guards.
- `src/core/runtime/scheduled-worker.ts` owns polling/claiming for queues without delayed jobs.
- `src/queue/index.ts` owns sync, pg-boss, custom adapter drivers.

## Modules still too complex or confusing

### 1. `src/types/index.ts` is a 711-line mixed public contract

It combines schema contracts, compliance models, delivery/notification records, event refs, DB adapter, mail adapter, channel config, queue contracts, hooks, send options, and scheduled worker options. This makes the public API hard to scan and increases merge/review cost when adding fields.

### 2. `src/core/runtime/send.ts` is still a monolithic use case

At 328 lines, it performs option validation, runtime start, event lookup, schema parse, dispatch validation, template renderer validation, compliance resolution/evaluation/audit, idempotency key construction, delivery persistence, scheduled audit/enqueue, immediate enqueue, hooks, and per-recipient error collection. The extraction from `herald.ts` helped, but `send.ts` now carries too many policy decisions in one loop.

### 3. `src/core/runtime/processor.ts` remains a large side-effect transaction script

At 325 lines, it mixes missing-delivery handling, scheduled payload recovery, template lookup, channel capability checks, retry loop, email rendering/sending, in-app creation/safe data filtering, side-effect idempotency, accepted-state persistence retry, audit logging, and hooks. This is the highest-risk runtime file because it combines idempotency and external side effects.

### 4. DB adapters duplicate large field maps and lifecycle behavior

`src/adapters/db/kysely.ts` (877 lines), `drizzle.ts` (543), and `prisma.ts` (494) repeat the same delivery field mapping, reusable status list logic, erasure/export/purge behavior, scheduled claim/cancel semantics, and audit conventions. This is readable per adapter but architecturally brittle: any new delivery/compliance field requires synchronized edits across adapters, CLI schemas, tests, and mock adapter.

### 5. `src/cli/index.ts` embeds generated schemas as long strings

At 456 lines, the CLI interleaves schema content and command parsing. The same schema columns are duplicated across Prisma/Drizzle/Kysely strings and DB adapter row/table definitions. The formatting also contains suspicious alignment artifacts like `acceptedAt             DateTime?` / `accepted_at              TIMESTAMPTZ`, which are harmless but reduce polish.

### 6. Configuration normalization is duplicated

There are two normalization paths:

- `src/core/configure.ts` handles public configured API merge/normalization (`mergeComplianceConfig`, `resolveQueueConfig`, `resolveProcessorRetryConfig`, `resolveRuntimeChannels`).
- `src/core/runtime/config-normalization.ts` handles low-level `createHerald(config)` normalization.

This is understandable while low-level runtime factories remain for tests, but the two paths can drift on defaults and legal-basis behavior.

### 7. Tests are comprehensive but heavy around old low-level factories

Tests still exercise `createHerald`/`defineEvent` directly in many files, especially `src/core/herald.test.ts`, `src/compliance/compliance.test.ts`, and integration tests. That is fine for implementation primitives, but public API guidance should stay configured-first. Consider adding/keeping configured-API parity tests whenever refactoring internals.

## Ranked next refactor candidates

### P0 — Split `send.ts` into explicit pipeline steps without changing behavior

**Why:** It is central to correctness, compliance, idempotency, and PII guarantees. Current tests pass, so this is a good moment to refactor behind the same API.

**Suggested shape:**

- `runtime/send/options.ts`: validate `scheduledAt`, compute scoped idempotency key.
- `runtime/send/event-resolution.ts`: start runtime, lookup event, validate scheduled `resolvePayload`, parse payload, dispatch, validate recipients/renderers.
- `runtime/send/compliance.ts`: resolve/evaluate/bypass compliance, write denied/bypassed audits.
- `runtime/send/deliveries.ts`: create delivery row, enqueue immediate/scheduled jobs, write scheduled audit.
- Keep `createSendFunction()` as the composition wrapper so external behavior remains stable.

**Validation:**

- `npx vitest run src/core/runtime/send.test.ts src/core/herald.test.ts src/core/configure.test.ts src/__tests__/readme-configured-api.test.ts`
- `npm run typecheck`
- Add no behavior changes initially; snapshot existing error messages where tests do not already pin them.

### P0 — Split `processor.ts` by rendering/side-effects/status transitions

**Why:** It is the main side-effect boundary. Small readability gains here reduce the chance of regressions in retries, duplicate sends, and PII persistence.

**Suggested shape:**

- `runtime/processor/payload.ts`: scheduled payload resolution and schema parsing.
- `runtime/processor/render.ts`: email/in-app rendering and rendered hash.
- `runtime/processor/side-effects.ts`: email send and notification creation with safe `data` filtering.
- `runtime/processor/status.ts`: fail delivery, retry state, accepted persistence retry, audit helpers.
- Keep one `createProcessor()` orchestrator.

**Validation:**

- `npx vitest run src/core/runtime/processor.test.ts src/__tests__/integration/process-delivery.test.ts src/core/db-queue-retry.test.ts`
- `npm run typecheck`
- Manually verify no new persistence of raw payload or rendered in-app `data` outside `safeFields`.

### P1 — Split `src/types/index.ts` into domain-focused type modules with barrel exports

**Why:** Public contract is hard to navigate, and every architectural change touches one huge file.

**Suggested shape:**

- `types/schema.ts`
- `types/compliance.ts`
- `types/domain.ts` (`Notification`, `Delivery`, `AuditLog`)
- `types/events.ts`
- `types/adapters.ts`
- `types/config.ts`
- `types/queue.ts`
- Keep `types/index.ts` as a pure barrel to preserve internal import paths during transition.

**Validation:**

- `npm run typecheck`
- `npx vitest run src/__tests__/types.test.ts src/__tests__/public-api.test.ts`
- `npm run build` to ensure declaration output and package root exports remain correct.

### P1 — Centralize schema/column metadata for adapters and CLI

**Why:** Delivery/compliance columns are duplicated in adapters, CLI generated schemas, and tests. The next field addition will be costly and error-prone.

**Suggested shape:**

- Introduce internal metadata such as `src/adapters/db/schema/columns.ts` describing tables/columns/indexes at a neutral level.
- Generate CLI strings from metadata per adapter.
- Reuse delivery reusable statuses from one exported internal constant instead of repeating arrays in adapter methods.
- Do this incrementally: start with delivery field maps, then migrate all table schemas.

**Validation:**

- `npx vitest run src/cli/cli.test.ts src/adapters/db/kysely.test.ts src/__tests__/mock-db-adapter.test.ts`
- Add golden tests for CLI output if not already sufficient.
- `npm run build` to validate adapter entrypoints.

### P1 — Consolidate config normalization paths

**Why:** `configure.ts` and `runtime/config-normalization.ts` both resolve queue retry, legal bases, retention defaults, and runtime channels in slightly different contexts. Drift here would be subtle.

**Suggested shape:**

- Create a shared internal `runtime/config/defaults.ts` or `core/config/defaults.ts` with:
  - default retention config,
  - legal-basis merge,
  - queue default and retry derivation.
- Public configured API can still enforce app-scoped channel typing and app ownership; low-level runtime can reuse the same primitives.

**Validation:**

- `npx vitest run src/core/configure.test.ts src/core/herald.test.ts src/core/herald-registry.test.ts src/compliance/legal-bases.test.ts`
- `npm run typecheck`.

### P2 — Split compliance module into policy/evaluation/hash files

**Why:** `src/compliance/index.ts` is manageable at 378 lines but mixes legal-basis constants, validation, policy resolution, evaluation, and hashing. Splitting would make it easier to audit legal semantics.

**Suggested shape:**

- `compliance/legal-bases.ts`
- `compliance/policy.ts`
- `compliance/evaluate.ts`
- `compliance/hash.ts`
- Keep `compliance/index.ts` as a barrel.

**Validation:**

- `npx vitest run src/compliance/compliance-engine.test.ts src/compliance/compliance.test.ts src/compliance/legal-bases.test.ts src/core/runtime/send.test.ts`
- `npm run typecheck`.

### P2 — Move CLI schemas out of `src/cli/index.ts`

**Why:** This is not runtime-critical, but improves maintainability and makes CLI parsing visibly separate from generated artifacts.

**Suggested shape:**

- `src/cli/schemas/prisma.ts`
- `src/cli/schemas/drizzle.ts`
- `src/cli/schemas/kysely.ts`
- `src/cli/index.ts` remains argument parsing and dispatch.

**Validation:**

- `npx vitest run src/cli/cli.test.ts`
- `npm run build`

### P2 — Clarify low-level runtime API status in code/tests

**Why:** Root exports correctly hide low-level factories, but many tests use them directly. That is OK if they are explicitly documented as internal/test primitives.

**Suggested shape:**

- Keep low-level `createHerald` and `defineEvent` unexported from root.
- Add brief file-level comments in tests that use them as implementation primitives.
- Prefer configured API in new public-facing tests and README examples.

**Validation:**

- `npx vitest run src/__tests__/public-api.test.ts src/__tests__/readme-configured-api.test.ts src/__tests__/types.test.ts`

## Risks and constraints for the next refactor

- **Do not change behavior while splitting.** The test suite is green; first refactors should be move/extract-only with stable error messages.
- **Protect PII invariants.** Raw payload must not enter Herald DB tables. In-app `data` must stay filtered by `safeFields`; rendered in-app `title/body/href` are intentionally persisted user-visible content today.
- **Protect idempotency semantics.** Scoped keys currently include userId/channel/template. Processor side-effect idempotency depends on `externalId`, `sideEffectsCompletedAt`, and notification-by-delivery lookup.
- **Protect scheduled-delivery semantics.** Scheduled sends require `resolvePayload`; durable delayed queue jobs omit payload; sync scheduled worker claims rows and resolves payload at fire time.
- **Protect compliance evidence/audit semantics.** Denials, bypasses, scheduled creation/firing, erasure, purge, and accepted/failed states all write audit records with specific metadata used by tests and likely docs.
- **Adapter/schema drift is the biggest architectural risk.** Any field change must update types, adapters, CLI schemas, mock adapter, README/docs if applicable, and tests.

## Non-goals

- Do not add React/SSE exports or realtime package APIs in this refactor stream.
- Do not reintroduce global registries or public low-level event APIs.
- Do not persist full payloads to Herald DB for convenience.
- Do not optimize for backward compatibility; project constraints say no deployed users, but still keep production-quality API and tests.
- Do not bundle peer dependencies into package outputs.

## Start here

Open `src/core/runtime/send.ts` first. It is the highest-leverage next refactor: central to configured event calls, compliance, idempotency, enqueueing, and PII guarantees, while already covered by a strong focused test file.
