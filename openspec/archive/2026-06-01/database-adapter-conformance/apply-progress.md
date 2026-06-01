# Apply Progress — database-adapter-conformance

## Current slice
- Scope: **PR 5D-drizzle completed** (real DB-backed Drizzle target through shared testbed) on top of completed PR 1A + PR 1B + PR 2 + PR 3 + PR 4 + PR 5A-real-base + PR 5B-kysely + PR 5C-prisma
- Delivery boundary: completed PR 1A + PR 1B + PR 2 + PR 3 + PR 4 + PR 5A-real-base + PR 5B-kysely + PR 5C-prisma + PR 5D-drizzle target wiring/fixes; official real DB adapter targets are now implemented for Kysely, Prisma, and Drizzle

## Completed tasks
- [x] Added conformance harness scaffold:
  - `src/__tests__/helpers/database-adapter-conformance.ts`
  - `src/__tests__/helpers/database-adapter-conformance/context.ts`
  - `src/__tests__/helpers/database-adapter-conformance/fixtures.ts`
  - `src/__tests__/helpers/database-adapter-conformance/assertions.ts`
- [x] Added notification conformance suite:
  - `src/__tests__/helpers/database-adapter-conformance/notifications.ts`
- [x] Added mock target entry test (notifications only):
  - `src/__tests__/helpers/mock-db-adapter.conformance.test.ts`
- [x] Updated mock adapter notification semantics in:
  - `src/__tests__/helpers/mock-db-adapter.ts`
    - default `getNotifications()` pagination now `limit=20`, `offset=0`
    - deterministic ordering now `createdAt desc`, then `id desc`
    - explicit pagination still honored
    - `markRead` missing-id remains no-op
- [x] Updated test discovery config so conformance test under helpers can run:
  - `vitest.config.ts` (removed `src/__tests__/helpers/**` from test exclude)
- [x] Updated PR 1A checkboxes in `tasks.md`

## TDD Cycle Evidence

### PR 1A (notifications)

| Cycle | Evidence |
|---|---|
| RED | Added conformance tests and ran `npx vitest run src/__tests__/helpers/mock-db-adapter.conformance.test.ts` → failures: default pagination expected 20 got 25; tie-break ordering expected latest id first. |
| GREEN | Implemented minimal `getNotifications` changes in mock adapter (default limit + id tie-break); reran targeted test file → all tests passed. |
| TRIANGULATE | Kept and validated explicit pagination + tie-break scenarios in conformance suite (including equal timestamp ordering case). |
| REFACTOR | Refactored notification suite setup with local `seedNotifications()` helper to reduce duplication; reran tests successfully. |

### PR 1B (deliveries/idempotency)

| Cycle | Evidence |
|---|---|
| RED | Added deliveries conformance suite and ran `npx vitest run src/__tests__/helpers/mock-db-adapter.conformance.test.ts` → failures: `getDeliveriesByUser` default pagination returned 25 instead of 20, delivery tie-break ordering failed, and `getDeliveryByIdempotencyKey` returned a terminal-only record instead of `null`. |
| GREEN | Updated mock delivery behavior: `getDeliveriesByUser` now defaults to `limit=20`/`offset=0` with `createdAt desc, id desc`; `getDeliveryByIdempotencyKey` now returns only reusable statuses and `null` for terminal-only/missing keys. Reran targeted tests to green. |
| TRIANGULATE | Added reusable-status matrix scenarios for all reusable statuses plus terminal-only (`failed|skipped|redacted`) behavior and deterministic selection by `updatedAt`/`createdAt`/`id`. |
| REFACTOR | Reused shared `deliveryInput`, `expectDeliveryOrderNewestFirst`, and local `seedDeliveries` helper to reduce per-test setup duplication while keeping scenario clarity. |

### PR 2 (consent/suppression + audit)

| Cycle | Evidence |
|---|---|
| RED | Added consent/suppression + audit conformance suites and ran `npx vitest run src/__tests__/helpers/mock-db-adapter.conformance.test.ts` → failures around suppression precedence/fallback semantics and audit newest-first deterministic lookup semantics. |
| GREEN | Updated mock behavior: `findSuppression` now uses purpose-specific-first lookup with global fallback and deterministic `createdAt desc, id desc`; `getAuditLogs` and `findAuditLogByAction` now sort deterministically by `createdAt desc, id desc`. |
| TRIANGULATE | Added conformance scenarios for consent filter combinations, suppression tie-break/isolation + purpose fallback, and audit list/action lookup deterministic behavior (including ties and missing results). |
| REFACTOR | Added shared fixture/assertion helpers (`consentEventInput`, `suppressionInput`, `auditLogInput`, consent/audit order assertions) and audit timestamp helper hook to reduce duplication while preserving scenario clarity. |

### PR 3 (compliance lifecycle/export/purge)

| Cycle | Evidence |
|---|---|
| RED | Added `compliance-lifecycle` conformance suite and wired it into the mock conformance run; initial failures highlighted missing harness support for hash-based evidence lookup after erasure. |
| GREEN | Added minimal helper hook (`hashSubjectId`) and mock target implementation; implemented lifecycle scenarios for erasure redaction, export before/after, and strict purge boundaries/counts. |
| TRIANGULATE | Added coverage for hashed evidence lookup (`getConsentEvents` + `findAuditLogByAction` post-erasure), capability-scoped suppression export behavior, and boundary-equal purge retention for deliveries/audit logs. |
| REFACTOR | Kept reusable fixture builders and timestamp hooks; avoided broad adapter rewrites by using existing mock semantics and focused conformance assertions. |

### PR 4 (scheduled lifecycle/cancellation)

| Cycle | Evidence |
|---|---|
| RED | Added `scheduled-lifecycle` conformance suite and wired it into the mock conformance run; initial run failed because expired-claim test data was not actually expired and mock claim ordering lacked deterministic ID tie-break for equal due time. |
| GREEN | Corrected expired/non-expired claimed fixture timestamps to be relative to real current time and updated mock `claimScheduledBatch` ordering to `scheduledAt asc` then `id desc`; reran conformance suite to green. |
| TRIANGULATE | Added scenarios covering due scheduled + expired claimed inclusion, future/non-expired/terminal/pending exclusion, lease field assertions, limit behavior, and cancellation semantics with queueJobId null/non-null plus user/status isolation. |
| REFACTOR | Kept existing fixture helpers and lifecycle hooks; implemented only scheduled-focused conformance file plus minimal mock ordering adjustment. |

### PR 5A-real-base (shared real DB testbed base)

| Cycle | Evidence |
|---|---|
| RED | Added env/testbed helper tests first (`env.test.ts`, `user-email-store.test.ts`, `postgres-testbed.test.ts`) to lock skip-safe default mode, explicit-mode URL guardrails, in-memory user store behavior, and schema lifecycle SQL generation contracts. |
| GREEN | Implemented shared base under `src/__tests__/helpers/database-adapter-real-targets/`: env parser/fail-fast helpers, user email store, SQL fixture, Postgres testbed skeleton, and target helper bridge with hash/timestamp helper names. |
| TRIANGULATE | Added adapter filter (`HERALD_DB_CONFORMANCE_ADAPTERS`) + keep-schema parsing, and search_path assertion/truncate SQL generation checks to broaden infrastructure behavior without requiring external DB in default runs. |
| REFACTOR | Kept the base dependency-light via abstract `SqlExecutor`; no `pg`/ORM target execution yet, enabling reuse for Kysely/Prisma/Drizzle slices. |

### PR 5B-kysely (real DB-backed target wiring)

| Cycle | Evidence |
|---|---|
| RED | Review requested that env-enabled Kysely conformance must not pass green without executing real conformance. Existing `kysely.test.ts` placeholder path was fail-closed only and did not run the shared real testbed/harness. |
| GREEN | Added real Kysely target factory (`kysely-target.ts`) using shared env/testbed primitives, Postgres pool + Kysely dialect, schema lifecycle/reset/destroy, and helper bridge (`hashSubjectId`, timestamp patch SQL, user email seeding). Added env-gated `kysely.real-conformance.test.ts` that runs full harness groups when explicit mode + URL are provided. Removed legacy `HERALD_KYSELY_CONFORMANCE` placeholder block from `kysely.test.ts`. |
| TRIANGULATE | Added safe schema-qualified SQL helpers and quoting regression coverage in real-target helper tests; validated that default runs stay infra-free while explicit mode now has actionable URL guardrails through shared env parser. |
| REFACTOR | Reused shared `SqlExecutor`/testbed/user-email-store bridge; kept adapter-specific logic isolated to `kysely-target.ts`. Live Neon execution exposed and drove bounded Kysely target/adapter fixes. |

### PR 5C-prisma (real DB-backed target wiring)

| Cycle | Evidence |
|---|---|
| RED | Added env-gated Prisma real target/test entry and ran explicit Neon command; initial failures showed Prisma client generation/setup incompatibility and multiple adapter semantic gaps. |
| GREEN | Added Prisma target factory (`prisma-target.ts`) using shared testbed lifecycle and user email store, plus env-gated `prisma.real-conformance.test.ts`. Added conformance schema template + runtime client generation and Prisma adapter fixes for deterministic ordering, reusable-only idempotency lookup, no-op `markRead`, suppression precedence, audit/action ordering, deterministic scheduled claim ordering, redaction body marker, non-null compliance defaults, and lexicographically monotonic IDs. |
| TRIANGULATE | Validated default mode remains infra-free (skip-safe real test), helper suites remain green, and explicit Prisma run fails meaningfully until generation/runtime URL shaping is correct; fixed Neon-specific raw SQL schema visibility by adding search_path startup options on the Prisma target URL. |
| REFACTOR | Kept Prisma-specific setup isolated to test-only files (`prisma-target.ts`, schema template, real-conformance entry) and reused shared Postgres testbed/contracts. |

## Tests run
- `npx vitest run src/adapters/db/kysely.test.ts` ✅
- `npx vitest run src/__tests__/helpers/database-adapter-real-targets/*.test.ts` ✅
- `npx vitest run src/__tests__/helpers/mock-db-adapter.conformance.test.ts` ✅
- `npm run typecheck` ✅
- `npm run lint` ✅ (repo has pre-existing warnings unrelated to this slice; no new lint errors)
- `HERALD_DB_CONFORMANCE=1 HERALD_DB_CONFORMANCE_ADAPTERS=kysely HERALD_DB_CONFORMANCE_URL=<url> npx vitest run src/adapters/db/kysely.real-conformance.test.ts` ✅ (22/22 against Neon Postgres)
- `HERALD_DB_CONFORMANCE=1 HERALD_DB_CONFORMANCE_ADAPTERS=prisma HERALD_DB_CONFORMANCE_URL=<url> npx vitest run src/adapters/db/prisma.real-conformance.test.ts` ✅ (22/22 against Neon Postgres)
- `HERALD_DB_CONFORMANCE=1 HERALD_DB_CONFORMANCE_ADAPTERS=drizzle HERALD_DB_CONFORMANCE_URL=<url> npx vitest run src/adapters/db/drizzle.real-conformance.test.ts` ✅ (22/22 against Neon Postgres)
- `HERALD_DB_CONFORMANCE=1 HERALD_DB_CONFORMANCE_ADAPTERS=kysely,prisma,drizzle HERALD_DB_CONFORMANCE_URL=<url> npx vitest run src/adapters/db/kysely.real-conformance.test.ts src/adapters/db/prisma.real-conformance.test.ts src/adapters/db/drizzle.real-conformance.test.ts` ✅ (69/69 against Neon Postgres)

## Review and repair evidence
- PR 5B-kysely fresh review found the real target wiring was present but explicit real conformance would expose known Kysely semantic mismatches.
- Repaired Kysely semantics for accepted conformance contract: id tie-breaks on notification/delivery/audit lists, reusable-only `getDeliveryByIdempotencyKey`, deterministic suppression lookup, deterministic audit action lookup, and scheduled claim ordering via ordered CTE/select.
- Re-ran Kysely unit tests, real-target helper tests, mock conformance, typecheck, and lint after PR 5B repair.
- After a Neon Postgres URL became available, explicit Kysely real conformance initially failed because Neon pooler rejects startup `options=search_path`; repaired the Kysely real target to de-pool Neon URLs for the schema-scoped Kysely connection and avoid double-ending the pg pool after `kysely.destroy()`.
- Live Kysely conformance exposed adapter semantic gaps: generated UUIDs were not sortable for `createdAt` ties, delivery inserts wrote `NULL` into non-null `bypass_compliance_check`, and erasure redacted notification body to `null` instead of `[redacted]`. Repaired Kysely generated IDs to be lexicographically monotonic, defaulted `bypass_compliance_check` to `false`, and redacted notification body with `[redacted]`.
- Explicit real DB conformance now passes against Neon Postgres: `src/adapters/db/kysely.real-conformance.test.ts` 22/22.

### PR 5C-prisma (real DB-backed target wiring)

| Cycle | Evidence |
|---|---|
| RED | Initial explicit Prisma real run failed at target wiring/generation and then surfaced adapter semantic gaps under live Postgres. Fresh review then blocked acceptance because generated Prisma client artifacts were present under source and `createDeliveryIdempotent()` used raw input data on the no-key branch. |
| GREEN | Added env-gated Prisma target/test/template, runtime Prisma client generation, and bounded Prisma adapter fixes for ordering/tie-breaks, idempotency, suppression/audit lookup, scheduled claim ordering, redaction markers, deterministic IDs, non-null delivery defaults, and normalized no-key idempotent create. |
| TRIANGULATE | Confirmed default Prisma real test remains skip-safe, explicit Neon Prisma conformance passes 22/22, generated client artifacts are removed from source, and `.gitignore` excludes the runtime generated Prisma client directory. |
| REFACTOR | Kept Prisma client generation isolated to explicit real-target setup; no Drizzle work included in PR 5C. |

### PR 5D-drizzle (real DB-backed target wiring)

| Cycle | Evidence |
|---|---|
| RED | Initial Drizzle apply delegation failed without edits; scout mapped required target wiring and likely adapter semantic gaps. Explicit real Drizzle run then exposed raw SQL timestamp mapping returning strings for scheduled claim rows. |
| GREEN | Added Drizzle conformance table definitions, Drizzle real target, and env-gated real conformance entrypoint. Fixed Drizzle adapter semantics for deterministic IDs/order, non-null delivery defaults, reusable-only idempotency lookup, suppression/audit ordering, erasure body redaction, scheduled claim deterministic CTE ordering, and raw SQL result/date normalization. |
| TRIANGULATE | Confirmed default Drizzle real test remains skip-safe and explicit Neon Drizzle conformance passes 22/22. Re-ran real-target helpers, mock conformance, typecheck, and lint. |
| REFACTOR | Kept Drizzle target test-only, dependency-neutral, and aligned with the shared Postgres testbed/Kysely target pattern; no generated artifacts. |

### Verify repair: user lookup + combined real DB run

| Cycle | Evidence |
|---|---|
| RED | SDD verify failed because the spec-required `getUserEmail` conformance group was missing and the combined explicit all-adapter real DB command failed under parallel execution with schema/search_path interference. |
| GREEN | Added `runUserLookupConformance`, helper `seedUserEmail`, and invocations for mock/Kysely/Prisma/Drizzle targets. Updated mock `getUserEmail` missing-user behavior to return `null`. Changed real target admin pools to use de-pooled Neon URLs so schema setup/search_path state is not affected by the Neon pooler during parallel combined runs. |
| TRIANGULATE | Default mock + real skip-safe conformance now includes user lookup and passes 26 tests. Combined explicit Kysely+Prisma+Drizzle Neon command now passes 69/69. |
| REFACTOR | Kept user lookup coverage as a small grouped conformance file and reused existing real-target user email store helper. |
- PR 5A-real-base fresh review requested a fuller Kysely-derived SQL fixture and safe schema-qualified timestamp helper SQL.
- Repaired `herald-schema.sql` to include the Kysely-generated Herald table columns/indexes needed by official adapters instead of a too-minimal bootstrap fixture.
- Repaired timestamp helper SQL to quote schema/table identifiers via shared `quotePostgresIdentifier`.
- Added helper tests for quoted timestamp patch SQL and identifier escaping.
- Re-ran real-target helper tests, Kysely unit tests, mock conformance, typecheck, and lint after PR 5A-real-base repair.
- PR 5A-real-base implementation is intentionally bounded: shared env-gated Postgres testbed base is added without official adapter execution and without forcing default external DB setup.
- Added explicit-mode fail-fast helper path (`HERALD_DB_CONFORMANCE=1` requires `HERALD_DB_CONFORMANCE_URL`) while keeping default mode skip-safe and infra-free.
- Added reusable shared primitives for later official targets: schema lifecycle SQL builders, fixture loading/truncation contracts, deterministic hash helper, timestamp patch helper SQL names, and Map-backed user email override.
- Deferred real official adapter execution to PR 5B/5C/5D by design.
- PR 5B-kysely replaced the legacy `HERALD_KYSELY_CONFORMANCE` placeholder in `kysely.test.ts` with a real env-gated target file (`kysely.real-conformance.test.ts`) and shared real-target factory wiring (`kysely-target.ts`).
- Added `pg` and `@types/pg` as dev dependencies for Kysely real-target infrastructure.
- Explicit real DB conformance command could not be executed in this environment because `HERALD_DB_CONFORMANCE_URL` is unset; target remains env-gated and default runs remain infra-free.
- PR 4 fresh review requested a true limit test, `updatedAt` lease metadata assertion, retrying exclusion coverage, and explicit scheduled ordering direction in SDD artifacts.
- Repaired scheduled claim coverage by adding a fourth eligible row beyond `limit=3` and asserting it remains scheduled.
- Repaired lease assertions to verify `updatedAt` is a `Date`, advances to the claim operation timestamp, and matches `claimedAt`.
- Repaired exclusion coverage with a due `retrying` row that must remain retrying.
- Updated scheduled ordering contract in spec/design to `scheduledAt`/due time ascending, then ID descending.
- Re-ran targeted conformance tests, scheduled worker integration, typecheck, and lint after PR 4 repair.
- PR 3 fresh review requested less-prescriptive post-erasure export behavior and mandatory evidence verification through either redacted raw export or hashed lookup.
- Repaired export-after-erasure coverage to accept either redacted queryable records or empty raw export with hashed evidence lookup; if no `hashSubjectId` helper is supplied, the test now requires redacted raw export plus consent/audit evidence in the raw export path.
- Strengthened export-before-erasure coverage to assert exported IDs match alpha-owned notification/delivery/consent/audit records and exclude beta-owned rows.
- Re-ran targeted conformance tests, compliance erasure integration, typecheck, and lint after PR 3 repair.
- PR 3 re-review requested mandatory evidence preservation in the no-`hashSubjectId` path, not only redacted notification/delivery export.
- Repaired erasure and export-after-erasure tests so targets without `hashSubjectId` must expose preserved consent/audit evidence through raw export.
- Re-ran targeted conformance tests, compliance erasure integration, typecheck, and lint after PR 3 re-review repair.
- PR 1A fresh review initially requested stronger notification coverage and a generic context lifecycle fix.
- Repaired default pagination coverage to assert the newest alpha page (`n-24` through `n-5`) and exclude a newer beta notification.
- Repaired unread transition coverage to assert alpha unread IDs, post-`markRead` unread list state, post-`markAllRead` empty alpha unread list, and unchanged beta unread count.
- Repaired conformance runtime cleanup/accessors to allow valid falsy generic contexts by checking `context !== null` / `context === null`.
- PR 1A fresh re-review status: approved.
- PR 1B fresh review requested fuller idempotency tie-break and lookup matrix coverage.
- Repaired delivery idempotency coverage to assert both `createDeliveryIdempotent` and `getDeliveryByIdempotencyKey` select by `updatedAt desc`, then `createdAt desc`, then `id desc`.
- Repaired lookup coverage to assert every reusable status is returned, every terminal status (`failed|skipped|redacted`) is ignored when terminal-only, and a newer terminal record does not hide an older reusable record.
- Re-ran targeted conformance tests, typecheck, and lint after PR 1B repair.
- PR 2 fresh review requested consent equal-timestamp ID tie coverage, suppression field persistence, purpose-specific suppression tie coverage, and persisted audit field assertions.
- Repaired consent coverage with same-subject equal-`createdAt` events and ID tie assertion.
- Repaired suppression coverage to assert persisted metadata (`addressHash`, `channel`, `purpose`, `reason`, `source`, `createdAt`) and purpose-specific equal-timestamp tie behavior.
- Repaired audit coverage to assert persisted fields from `getAuditLogs`, not only the immediate `createAuditLog` return value.
- Re-ran targeted conformance tests, typecheck, and lint after PR 2 repair.

## Files changed
- `vitest.config.ts`
- `src/__tests__/helpers/mock-db-adapter.ts`
- `src/__tests__/helpers/database-adapter-conformance.ts`
- `src/__tests__/helpers/database-adapter-conformance/context.ts`
- `src/__tests__/helpers/database-adapter-conformance/fixtures.ts`
- `src/__tests__/helpers/database-adapter-conformance/assertions.ts`
- `src/__tests__/helpers/database-adapter-conformance/notifications.ts`
- `src/__tests__/helpers/database-adapter-conformance/deliveries.ts`
- `src/__tests__/helpers/database-adapter-conformance/consent-suppression.ts`
- `src/__tests__/helpers/database-adapter-conformance/audit.ts`
- `src/__tests__/helpers/database-adapter-conformance/compliance-lifecycle.ts`
- `src/__tests__/helpers/database-adapter-conformance/scheduled-lifecycle.ts`
- `src/__tests__/helpers/mock-db-adapter.conformance.test.ts`
- `src/__tests__/helpers/database-adapter-real-targets/env.ts`
- `src/__tests__/helpers/database-adapter-real-targets/user-email-store.ts`
- `src/__tests__/helpers/database-adapter-real-targets/helpers.ts`
- `src/__tests__/helpers/database-adapter-real-targets/postgres-testbed.ts`
- `src/__tests__/helpers/database-adapter-real-targets/target.ts`
- `src/__tests__/helpers/database-adapter-real-targets/herald-schema.sql`
- `src/__tests__/helpers/database-adapter-real-targets/env.test.ts`
- `src/__tests__/helpers/database-adapter-real-targets/user-email-store.test.ts`
- `src/__tests__/helpers/database-adapter-real-targets/postgres-testbed.test.ts`
- `src/__tests__/helpers/database-adapter-real-targets/kysely-target.ts`
- `src/__tests__/helpers/database-adapter-real-targets/prisma-target.ts`
- `src/__tests__/helpers/database-adapter-real-targets/prisma-schema.template`
- `src/__tests__/helpers/database-adapter-real-targets/drizzle-schema.ts`
- `src/__tests__/helpers/database-adapter-real-targets/drizzle-target.ts`
- `src/adapters/db/kysely.real-conformance.test.ts`
- `src/adapters/db/kysely.test.ts`
- `src/adapters/db/prisma.real-conformance.test.ts`
- `src/adapters/db/drizzle.real-conformance.test.ts`
- `src/adapters/db/drizzle.ts`
- `package.json`
- `package-lock.json`
- `openspec/changes/database-adapter-conformance/tasks.md`
- `openspec/changes/database-adapter-conformance/apply-progress.md`

## Deviations from design/tasks
- Minor tooling-support change: `vitest.config.ts` exclude list was adjusted so the mandated test file path under helpers can be discovered by Vitest. Without this, the required validation command could not run any tests.

## Review workload / line forecast
- Estimated changed lines for PR 1A: **~260-320** (under 400-line budget)
- Estimated changed lines for PR 1B: **~180-260** (under 400-line budget)
- Estimated changed lines for PR 2: **~260-340** (under 400-line budget)
- Estimated changed lines for PR 3: **~220-320** (under 400-line budget)
- Estimated changed lines for PR 4: **~180-260** (under 400-line budget)
- Estimated changed lines for PR 5A-real-base shared testbed: **~260-360** (under 400-line budget)
- Estimated changed lines for PR 5B-kysely real target wiring: **~220-340** (under 400-line budget)
- Estimated changed lines for PR 5C-prisma real target wiring: **~320-390** (under 400-line budget)
- Estimated changed lines for PR 5D-drizzle real target wiring: **~300-390** (under 400-line budget)
- Combined chain remains split by design; no size exception used.

## Remaining tasks
- No remaining required adapter conformance tasks. User lookup conformance is implemented and invoked across mock, Kysely, Prisma, and Drizzle targets.

## Checkpoint status
- Checkpoint A (post-PR1A): completed; PR 1B executed as separate slice under budget.
- Checkpoint B (before PR3): completed; proceeded with bounded PR 3 lifecycle/export/purge slice under budget.
- Checkpoint C (before PR5): completed; switched to shared PR 5A-real-base testbed before official adapter targets.
