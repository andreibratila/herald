# Herald cleanup/refactor planning handoff

## Request / scope

Goal: build implementation-ready planning context for the next cleanup/refactor phase after prior extraction of runtime helpers from `src/core/herald.ts`.

Scope inspected:

- Runtime composer: `src/core/herald.ts`
- Runtime helpers: `src/core/runtime/*`
- Public/configured API: `src/core/configure.ts`, `src/core/define.ts`, `src/index.ts`
- Core types/contracts: `src/types/index.ts`
- Adapter entrypoints: `src/adapters/db/{prisma,drizzle,kysely}.ts`, `src/adapters/mail/*`
- Tests under `src/core/**/*.test.ts`
- Public docs: `README.md`, `package.json` exports/scripts

Non-goals for the next cleanup PR: no public API changes, no adapter contract changes, no behavior changes, no React/SSE package exports.

Project/user skills loaded: none (no specific skill path needed).

Engram note: I could not save discoveries to Engram because no memory tool is available in this subagent tool namespace.

## Current module boundaries

### Public surface and configured API

- `src/index.ts` exports the configured public API (`configureHerald`) plus types and compliance helpers. It does **not** export low-level `createHerald`/`defineEvent` from root (`src/index.ts:1-72`).
- `src/core/configure.ts` is the public path wrapper:
  - type-level channel narrowing lives here (`ConfiguredTemplateDefinition`, `ConfiguredRecipient`, etc.) (`src/core/configure.ts:33-112`).
  - app-scoped event branding prevents mixing event refs from different `configureHerald()` calls (`src/core/configure.ts:29`, `src/core/configure.ts:175-190`, `src/core/configure.ts:250-257`).
  - `create()` merges compliance config, resolves runtime channels/lazy adapter factories, constructs `createHeraldRuntime()`, and exposes generated `herald.events.*` methods while hiding string `send` (`src/core/configure.ts:193-237`).
- `src/core/define.ts` remains the low-level pure event-ref factory and recipient validator; public docs should continue steering users to `configureHerald(...).defineEvent(...)`.

### Runtime composer (`src/core/herald.ts`)

`createHeraldRuntime()` is now mostly a wiring/composition function:

- validates email default sender (`src/core/herald.ts:102-107`).
- validates event refs and builds `eventMap`/`templateMap` (`src/core/herald.ts:108-124`).
- creates queue and compliance lifecycle (`src/core/herald.ts:128-139`).
- creates processor, start controller, send function, in-app API, scheduled worker, warmup, and worker API (`src/core/herald.ts:141-237`).

Remaining local logic in `herald.ts`:

- `validateRecipientTemplateRenderers()` (`src/core/herald.ts:48-68`) is a runtime validation helper used only by `send.ts` through injection (`src/core/herald.ts:174-188`).
- `REUSABLE_STATUSES` (`src/core/herald.ts:73-80`) is idempotency policy passed into `send.ts` (`src/core/herald.ts:174-183`).

This is the clearest remaining seam for making `herald.ts` a pure composer without changing behavior.

### Runtime helper modules

- `runtime/config-normalization.ts`: unscoped `createHerald()` normalization. It computes default queue, retry config, runtime channels, defaultFrom, legal bases, retention (`src/core/runtime/config-normalization.ts:27-99`).
- `runtime/registry.ts`: duplicate stable event-name validation, compliance policy validation, runtime event/template maps (`src/core/runtime/registry.ts:12-68`).
- `runtime/send.ts`: large send pipeline. It performs scheduledAt validation, lazy start, event lookup, payload validation, dispatch/recipient validation, compliance evaluation, idempotent delivery creation, scheduled enqueue/no-enqueue behavior, immediate enqueue, and per-recipient error collection (`src/core/runtime/send.ts:70-328`).
- `runtime/processor.ts`: delivery side effects. It resolves missing payloads for scheduled jobs, finds event-scoped templates, renders/sends email, creates in-app notifications with safe `data`, writes side-effect guard state, marks accepted with retry, writes audits/hooks, and handles failures (`src/core/runtime/processor.ts:51-325`).
- `runtime/scheduled-worker.ts`: singleton interval worker for queues without native delayed jobs. It claims due deliveries, re-checks compliance, resolves payload, enqueues, resets or fails resolve errors, and writes fired audit logs (`src/core/runtime/scheduled-worker.ts:26-161`).
- `runtime/queue-processor.ts`: wraps durable queues with fire-time delivery/compliance guard and failed-delivery revival before delegating to `processDelivery` (`src/core/runtime/queue-processor.ts:24-54`).
- `runtime/compliance-gate.ts`: default compliance policy, adapter capability assertions, and scheduled fire-time compliance update/audit logic.
- `runtime/compliance-lifecycle.ts`: public `herald.compliance.*` methods plus auto-purge.
- `runtime/in-app-api.ts`, `misc-api.ts`, `start-controller.ts`, `delivery-persistence.ts`, `delivery-state.ts`, `channel-support.ts`, `utils.ts`: small focused helpers.

### Types and adapter constraints

- Core domain, config, queue, DB, and mail contracts live in one large `src/types/index.ts` file. Key invariants:
  - channels are currently only `"email" | "inApp"` (`src/types/index.ts:18-20`).
  - `dispatch()` is synchronous and pure (`src/types/index.ts:209-218`).
  - `resolvePayload` is required for scheduled sends and reconstructs payload without persistent PII (`src/types/index.ts:219-227`).
  - `safeFields` and in-app `data` are explicitly non-PII persistence boundaries (`src/types/index.ts:197-202`, `src/types/index.ts:240-246`, `src/types/index.ts:254-269`).
  - `Delivery` stores scheduling, idempotency, side-effect guard, rendered hash, and compliance snapshots (`src/types/index.ts:271-333`).
  - `HeraldDatabaseAdapter` is broad and required by official DB adapters (`src/types/index.ts:387-487`).
  - custom queue capabilities are explicit (`src/types/index.ts:600-642`).
- Package exports expose root and adapter entrypoints only; peer deps are optional/external (`package.json:23-64`, `package.json:85-111`).
- Official DB adapters mirror the broad DB contract and include PostgreSQL scheduling/idempotency assumptions; refactors should avoid contract churn unless explicitly approved.

### Public docs constraints

- README documents the configured API as the normal path and generated `herald.events.*` methods (`README.md:45-206`).
- README says custom queue adapters declare capabilities, delayed queues omit full scheduled payload, and non-delayed queues require `startScheduledWorker()` (`README.md:382-431`).
- README says Herald has no built-in realtime transport; recipes live under `docs/examples/` (`README.md:435-444`).

## Important patterns already used

- **Dependency injection for runtime helpers**: `herald.ts` injects helpers into factories (e.g. `createSendFunction`, `createRuntimeQueueProcessor`, `createScheduledWorkerStarter`) instead of importing all details directly inside helpers (`src/core/herald.ts:141-188`, `src/core/herald.ts:203-212`). Keep this pattern unless there is a concrete readability win.
- **Runtime factories return closures**: start controller, send function, processor, scheduled worker all close over runtime state and return one public method.
- **Per-instance registries**: event refs are pure; runtime maps are built inside `createHeraldRuntime()` (`src/core/herald.ts:108-124`, `src/core/runtime/registry.ts:44-68`).
- **Behavior is heavily tested via public-ish runtime entrypoints**: most tests use `createHerald()`/configured API and mock DB/mail adapters rather than unit-testing every helper directly.
- **No payload PII persistence by default**: send enqueues validated full payload for immediate jobs (`src/core/runtime/send.ts:309-313`), processor only persists rendered hash/email external ID or filtered in-app data (`src/core/runtime/processor.ts:192-229`).

## Likely next work units

### Recommended Work Unit 1 — make `herald.ts` a pure runtime composer (small, reviewable)

Intent: finish the extraction already started by moving the remaining runtime policy/validation details out of `src/core/herald.ts`, without changing behavior.

Suggested changes:

1. Move `validateRecipientTemplateRenderers()` from `src/core/herald.ts:48-68` into a focused runtime module, preferably:
   - `src/core/runtime/recipient-validation.ts`, or
   - `src/core/runtime/registry.ts` if the team prefers all event/template validation in one place.
2. Move `REUSABLE_STATUSES` from `src/core/herald.ts:73-80` into `src/core/runtime/delivery-state.ts` or new `src/core/runtime/idempotency.ts` and export it as a readonly policy constant.
3. Update `src/core/herald.ts` imports and `createSendFunction()` wiring only.
4. Add or adjust narrowly targeted tests only if existing coverage does not already catch the moved behavior. Existing coverage includes missing renderer errors (`src/core/configure.test.ts`), idempotency key/reuse (`src/core/runtime/send.test.ts`), and duplicate/template scope (`src/core/runtime/processor.test.ts`, `src/core/define.test.ts`).

Acceptance criteria:

- `src/core/herald.ts` contains no local runtime helper function/constant except `createHerald`, `createHeraldRuntime`, and type exports.
- No user-visible API or error message changes.
- Missing renderer validation still throws before enqueue/processing for both email and in-app.
- Idempotency reusable statuses remain exactly: `pending`, `scheduled`, `claimed`, `dispatched`, `retrying`, `accepted`; `failed` and `skipped` remain non-reusable.
- All existing tests pass.

Review workload estimate: ~40-90 changed lines across 2-4 files. Low risk. Good next PR if the goal is readability after extraction.

### Work Unit 2 — consolidate runtime normalization seams between configured and unscoped paths (medium, still reviewable)

Intent: reduce drift between `configureHerald().create()` and low-level `createHerald()` by sharing queue/retry/compliance/channel normalization primitives.

Current duplication/evidence:

- Unscoped path uses `normalizeHeraldRuntimeConfig()` (`src/core/herald.ts:84-89`, `src/core/runtime/config-normalization.ts:85-99`).
- Configured path has its own `mergeComplianceConfig()`, `resolveQueueConfig()`, `resolveProcessorRetryConfig()`, `resolveRuntimeChannels()`, `resolveEmailChannelConfig()` (`src/core/configure.ts:259-360`).
- Both paths need equivalent defaults for queue, retry, legal bases, retention, and channel/defaultFrom resolution. Lazy adapter factories must remain invoked only at `create()`, not at `configureHerald()` construction (`src/core/configure.ts:170-221`, `src/core/configure.ts:351-359`; test coverage exists in `src/core/configure.test.ts`).

Suggested changes:

1. Export shared primitives from `runtime/config-normalization.ts` for:
   - `resolveQueueConfig`
   - `resolveProcessorRetryConfig`
   - legal-basis/retention normalization or merge helpers
   - runtime channel normalization for already-resolved channels
2. Keep configured-specific responsibilities in `configure.ts`:
   - app branding and app-ref checks,
   - channel type narrowing,
   - lazy adapter factory resolution at create-time,
   - generated `events` facade and hiding string `send`.
3. Avoid changing public types unless strictly necessary.

Acceptance criteria:

- Queue/retry defaults are defined in one place.
- Retention defaults (`90d`, `2y`, `autoPurge: true`) and legal-basis merge semantics are unchanged for both configured and unscoped paths.
- Lazy email adapter factories are still not invoked until `heraldApp.create()`.
- Configured runtime still rejects event refs from other apps and still hides public string `send`.

Review workload estimate: ~120-220 changed lines across 2-3 files plus tests. Medium risk because configured API type inference is sensitive; keep it separate from Work Unit 1 unless the reviewer explicitly wants one combined cleanup PR.

### Possible later Work Unit — split `runtime/send.ts` phases (larger; do not bundle with WU1)

Intent: make the send pipeline easier to read by extracting pure-ish phase helpers such as `validateSendInput`, `evaluateRecipientCompliance`, `buildDeliveryDraft`, and `enqueueCreatedDelivery`.

Why later: `send.ts` is behavior-dense and touches compliance, idempotency, scheduling, hooks, and queue behavior (`src/core/runtime/send.ts:93-326`). This is worthwhile, but higher review burden than finishing the `herald.ts` composer cleanup.

Review workload estimate: ~180-350 changed lines, 3-6 files/tests. Needs strong test evidence and should be its own PR.

## Implementation risks / constraints

- Do not alter public exports in `src/index.ts` or `package.json` unless explicitly requested.
- Do not weaken configured API invariants: app-scoped event refs, generated `events` methods, no public string `send` on configured runtimes.
- Do not persist payload fields beyond existing safe boundaries. Immediate queue jobs may carry full payload; DB records should not.
- Preserve exact-ish error behavior unless tests are intentionally updated. Many tests assert friendly messages.
- Avoid adapter contract changes. DB adapters are broad and schedule/idempotency-sensitive.
- Keep Work Unit 1 separate from `send.ts` restructuring to preserve a small reviewable PR.

## Validation commands

Minimum for Work Unit 1:

```bash
npm run typecheck
npx vitest run src/core/configure.test.ts src/core/define.test.ts src/core/runtime/send.test.ts src/core/runtime/processor.test.ts
```

Recommended full validation before handoff/PR:

```bash
npm run lint
npm run test
npm run build
```

If Work Unit 2 is implemented, add:

```bash
npx vitest run src/core/configure.test.ts src/core/define.test.ts src/core/herald.test.ts src/core/herald-registry.test.ts
```

## Compact worker meta-prompt

Implement **Work Unit 1 only** unless the parent explicitly approves Work Unit 2.

Goal: finish the runtime-helper extraction by making `src/core/herald.ts` a pure composer. Move the remaining `validateRecipientTemplateRenderers()` helper and `REUSABLE_STATUSES` policy constant into focused `src/core/runtime/*` modules, update imports/wiring, and preserve behavior exactly.

Context/evidence:

- `src/core/herald.ts:48-68` contains `validateRecipientTemplateRenderers()` and injects it into `createSendFunction()` at `src/core/herald.ts:174-188`.
- `src/core/herald.ts:73-80` contains idempotency reusable statuses and injects them at `src/core/herald.ts:174-183`.
- `send.ts` consumes the helper/policy through `CreateSendFunctionConfig` and applies renderer validation at `src/core/runtime/send.ts:122-132`, idempotent delivery creation at `src/core/runtime/send.ts:221-264`.
- Preserve reusable statuses exactly: `pending`, `scheduled`, `claimed`, `dispatched`, `retrying`, `accepted`; keep `failed` and `skipped` non-reusable.
- Existing tests cover missing renderers, idempotency, and processing behavior; prefer no new tests unless moving exposes a gap.

Success criteria:

- `src/core/herald.ts` is orchestration-only: no local send/recipient/idempotency helper definitions.
- Public API, exported package entrypoints, error messages, and runtime behavior are unchanged.
- Typecheck and targeted tests pass.

Hard constraints:

- No public API or type contract changes.
- No adapter contract changes.
- No docs changes unless needed to fix a directly caused inconsistency.
- Do not start the larger `send.ts` decomposition in this PR.

Suggested approach:

1. Create `src/core/runtime/recipient-validation.ts` or extend `runtime/registry.ts` for renderer validation.
2. Export reusable idempotency statuses from `runtime/delivery-state.ts` or new `runtime/idempotency.ts`.
3. Update `herald.ts` imports and wiring.
4. Run targeted validation, then full validation if practical.

Validation:

```bash
npm run typecheck
npx vitest run src/core/configure.test.ts src/core/define.test.ts src/core/runtime/send.test.ts src/core/runtime/processor.test.ts
npm run lint
npm run build
```

Stop/escalation rules:

- Stop and ask if a change appears to require public API/export changes.
- Stop and ask before changing adapter contracts, package exports, queue semantics, or compliance behavior.
- If type inference in configured API breaks, do not broaden public types casually; ask for direction.

Resolved assumptions:

- This is cleanup/refactor only; no behavior change is desired.
- No project/user skill path is needed.
- Work Unit 1 is the best next reviewable PR; Work Unit 2 is a follow-up, not part of the same PR by default.
