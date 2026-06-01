# Tasks: database-adapter-conformance

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,300-2,100 total across chain; 280-520 per slice before splits |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1A → PR 1B → PR 2 → PR 3 → PR 4 → PR 5A/5B/5C |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

## Scope boundaries (must hold for all slices)

- No production exports or runtime/public API changes.
- Base conformance unit suite must run without external DB infra.
- Official adapters are deferred to the final slice(s) only.
- Do not implement outside this change scope.

## PR chain and dependencies

```text
Tracker/base
└─ PR 1A 📍 harness core + notifications
   └─ PR 1B deliveries/idempotency
      └─ PR 2 consent/suppression + audit
         └─ PR 3 compliance lifecycle/export/purge
            └─ PR 4 scheduled lifecycle/cancellation
               └─ PR 5A Kysely harness target
                  └─ PR 5B Prisma harness target
                     └─ PR 5C Drizzle harness target
```

- PR 1B depends on PR 1A.
- PR 2 depends on PR 1B.
- PR 3 depends on PR 2.
- PR 4 depends on PR 3.
- PR 5A depends on PR 4; PR 5B depends on PR 5A; PR 5C depends on PR 5B.

## Split rule (mandatory)

- If projected diff for combined harness + notifications + deliveries/idempotency exceeds 400 changed lines, split into:
  - **PR 1A:** harness + notifications only
  - **PR 1B:** deliveries/idempotency
- Do not request size exception for PR 1.

## Apply instructions (first implementation slice only)

- Start with **harness + notifications**.
- Include deliveries/idempotency in same slice only if live forecast remains safely under 400 changed lines; otherwise execute PR 1A then PR 1B.

## Tasks by slice

### PR 1A — Harness core + notifications (first apply slice)

- [x] Create harness scaffold and grouped runner entrypoints in:
  - `src/__tests__/helpers/database-adapter-conformance.ts`
  - `src/__tests__/helpers/database-adapter-conformance/context.ts`
  - `src/__tests__/helpers/database-adapter-conformance/fixtures.ts`
  - `src/__tests__/helpers/database-adapter-conformance/assertions.ts`
- [x] Add notification conformance group in `src/__tests__/helpers/database-adapter-conformance/notifications.ts`.
- [x] Add mock target entry test in `src/__tests__/helpers/mock-db-adapter.conformance.test.ts` running only harness + notifications.
- [x] Update `src/__tests__/helpers/mock-db-adapter.ts` only as needed to satisfy notification semantics.
- [x] TDD evidence:
  - RED: notification/default pagination + ordering + markRead no-op failures
  - GREEN: minimal fixes to pass
  - TRIANGULATE: add tie-break and explicit pagination edge scenarios
  - REFACTOR: reduce duplication in fixtures/assertions
- [x] Validation:
  - `npx vitest run src/__tests__/helpers/mock-db-adapter.conformance.test.ts`
  - `npm run typecheck`
  - `npm run lint`

### PR 1B — Deliveries/idempotency

- [x] Add delivery/idempotency conformance group in `src/__tests__/helpers/database-adapter-conformance/deliveries.ts`.
- [x] Extend `src/__tests__/helpers/mock-db-adapter.conformance.test.ts` to run deliveries group.
- [x] Update `src/__tests__/helpers/mock-db-adapter.ts` only as needed for reusable-status matrix, deterministic selection, and pagination defaults.
- [x] TDD evidence: RED → GREEN → TRIANGULATE → REFACTOR for reusable vs terminal matrix and ordering tie-breaks.
- [x] Validation:
  - `npx vitest run src/__tests__/helpers/mock-db-adapter.conformance.test.ts`
  - `npm run typecheck`
  - `npm run lint`

### PR 2 — Consent/suppression + audit

- [x] Add suites:
  - `src/__tests__/helpers/database-adapter-conformance/consent-suppression.ts`
  - `src/__tests__/helpers/database-adapter-conformance/audit.ts`
- [x] Extend mock conformance runner in `src/__tests__/helpers/mock-db-adapter.conformance.test.ts`.
- [x] Update `src/__tests__/helpers/mock-db-adapter.ts` for suppression precedence and audit deterministic newest-first behavior.
- [x] TDD evidence: RED → GREEN → TRIANGULATE → REFACTOR for filters, precedence fallback, action lookup semantics.
- [x] Validation:
  - `npx vitest run src/__tests__/helpers/mock-db-adapter.conformance.test.ts`
  - `npm run typecheck`
  - `npm run lint`

### PR 3 — Compliance lifecycle/export/purge

- [x] Add suite `src/__tests__/helpers/database-adapter-conformance/compliance-lifecycle.ts`.
- [x] Extend mock conformance runner.
- [x] Update `src/__tests__/helpers/mock-db-adapter.ts` where needed for redaction markers, export completeness, strict purge boundary/counts.
- [x] Add/adjust regression coverage targets only if required:
  - `src/__tests__/integration/compliance-erase.test.ts`
- [x] TDD evidence: RED → GREEN → TRIANGULATE → REFACTOR for erase/export before/after and purge boundary equality.
- [x] Validation:
  - `npx vitest run src/__tests__/helpers/mock-db-adapter.conformance.test.ts`
  - `npx vitest run src/__tests__/integration/compliance-erase.test.ts`
  - `npm run typecheck`
  - `npm run lint`

### PR 4 — Scheduled lifecycle/cancellation

- [x] Add suite `src/__tests__/helpers/database-adapter-conformance/scheduled-lifecycle.ts`.
- [x] Extend mock conformance runner.
- [x] Update `src/__tests__/helpers/mock-db-adapter.ts` for due claim + expired lease reclaim + limit + cancel semantics.
- [x] Add/adjust regression coverage target if required:
  - `src/__tests__/integration/scheduled-worker.test.ts`
- [x] TDD evidence: RED → GREEN → TRIANGULATE → REFACTOR with fixed times (no sleeps).
- [x] Validation:
  - `npx vitest run src/__tests__/helpers/mock-db-adapter.conformance.test.ts`
  - `npx vitest run src/__tests__/integration/scheduled-worker.test.ts`
  - `npm run typecheck`
  - `npm run lint`

### PR 5 real DB testbed + official adapters through harness (final slices)

Design addendum: `openspec/changes/database-adapter-conformance/real-db-testbed-design.md`.

- [x] **PR 5A-real-base:** add shared env-gated Postgres testbed under `src/__tests__/helpers/database-adapter-real-targets/`:
  - env parsing for `HERALD_DB_CONFORMANCE=1` and `HERALD_DB_CONFORMANCE_URL`
  - isolated schema create/drop and `search_path` smoke checks
  - shared Herald SQL fixture, truncation helpers, timestamp patch helpers, and Map-backed `getUserEmail`
  - no official adapter target execution yet
- [x] **PR 5B-kysely:** replace Kysely fail-closed placeholder with a real Kysely target through the shared testbed and full conformance harness (env-gated; default runs infra-free).
- [x] **PR 5C-prisma:** add Prisma real target through the shared testbed, including conformance-only schema/client setup and `getUserEmail` override.
- [x] **PR 5D-drizzle:** add Drizzle real target through the shared testbed, including conformance-only table definitions and `getUserEmail` override.
- [x] Add user lookup conformance group invocation as supported via target helpers/capabilities.
- [x] Keep external DB-backed runs env-gated and documented; default unit suite remains infra-free (Kysely PR 5A assessment).
- [x] Kysely PR 5A assessment recorded: SQL-shape mocks are insufficient for full conformance, and `HERALD_KYSELY_CONFORMANCE=1` fails closed until real target setup exists.
- [x] Validation (per adapter slice):
  - targeted vitest file(s)
  - explicit real conformance command when `HERALD_DB_CONFORMANCE_URL` is configured
  - `npm run typecheck`
  - `npm run lint`

## Risk checkpoints (must confirm before widening scope)

- [x] **Checkpoint A (after PR 1A forecast update):** completed; proceeded with PR 1B as a separate under-budget slice.
- [x] **Checkpoint B (before PR 3):** confirmed and proceeded with bounded PR 3 lifecycle/export/purge slice under budget without production API scope creep.
- [x] **Checkpoint C (before PR 5):** confirmed; switched from placeholder adapter wiring to reusable shared real-DB testbed base before official adapter targets.
- [ ] **Checkpoint D (any slice >400 forecast):** pause and confirm additional split; do not take size exception by default.
