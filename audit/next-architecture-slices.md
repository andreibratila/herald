# Next Architecture Slices

## Current State

The previous broad audit docs are partly stale. The codebase already has:

- centralized config defaults in `src/core/runtime/config-defaults.ts`;
- domain-split type modules with `src/types/index.ts` as a compatibility barrel;
- split send and processor runtime phases;
- scheduled-worker error-domain regression coverage;
- centralized test files under `src/__tests__/unit`, `src/__tests__/integration`, and `src/__tests__/conformance` with no `*.test.ts` files left in production folders;
- generic reusable test adapters under `src/__tests__/support/adapters`;
- DB adapter conformance helpers plus env-gated real adapter tests.

Remaining work is mostly schema organization and adapter internals cleanup.

## Completed

### P0 — Clarify/harden in-app `persistedFields` persistence contract

Implemented: `safeFields` was renamed to `persistedFields`; durable in-app `notification.data` is derived from precise validated payload paths, not from template-produced structured data.

## Prioritized Backlog

### P1 — Extract CLI schema strings from `src/cli/index.ts`

Implemented: inline Prisma, Drizzle, and Kysely schema strings were moved to focused modules under `src/cli/schemas/` without changing generated output.

### P1 — Split oversized tests and centralize test layout

Implemented.

- **Oversized split slices**:
  - split the former `src/core/herald.test.ts` into behavior-focused core tests.
  - split the former `src/core/runtime/scheduled-worker.test.ts` into scheduled-send/process-delivery/lifecycle/failure tests.
  - split the former `src/__tests__/integration/scheduled-worker.test.ts` into behavior-focused integration tests.
  - split in-app notification persistence coverage from `src/core/runtime/processor.test.ts` into `processor-in-app.test.ts`.
  - split the former `src/core/herald-registry.test.ts` into behavior-focused registry/configured-event tests.
- **Folder cleanup slices**:
  - moved reusable mock DB/mail adapters to `src/__tests__/support/adapters/`.
  - moved root core tests to `src/__tests__/unit/core/`.
  - moved runtime tests to `src/__tests__/unit/core-runtime/`.
  - moved compliance, queue, and CLI tests to `src/__tests__/unit/{compliance,queue,cli}/`.
  - moved DB adapter tests to `src/__tests__/unit/adapters-db/` and real adapter conformance tests to `src/__tests__/conformance/adapters-db/`.
- **Current convention**: no `*.test.ts` files should live outside `src/__tests__/`.
- **Helper decision**: keep `src/__tests__/helpers/database-adapter-conformance*` and `src/__tests__/helpers/database-adapter-real-targets/*` in place for now. They are specialized conformance/testbed helpers, not generic support. Revisit only as a dedicated conformance-architecture slice.
- **Validation**: targeted moved test sets plus full `npm run test` passed during the move slices.

### P2 — Centralize adapter/CLI schema metadata

- **Scope**: Introduce neutral DB schema/column metadata after CLI strings are isolated.
- **Likely files**: CLI schema modules, DB adapters, adapter tests, conformance helpers.
- **Risk**: High. Cross-cuts adapters, generated schemas, and setup docs.
- **Validation**: CLI tests, adapter tests, conformance tests, typecheck, build, env-gated real DB tests when configured.
- **SDD**: Yes.

### P2 — Continue adapter internals cleanup behind conformance

- **Scope**: Deduplicate adapter internals one tiny helper/surface at a time, protected by existing conformance suites.
- **Likely files**: `src/adapters/db/{prisma,drizzle,kysely}.ts`, conformance helpers.
- **Risk**: Medium-high if touching multiple adapters at once.
- **Validation**: conformance tests, adapter tests, typecheck, real adapter tests when env is available.
- **SDD**: Yes if cross-adapter.

## Recommended Immediate Slice

Proceed to **P2 — Centralize adapter/CLI schema metadata**.

Reason: the low-risk test split and folder-layout cleanup backlog is complete; the next useful work is structural and should be planned before implementation.

## Audit Doc Disposition

- `audit/handoff-plan.md` — mostly stale; keep only for historical context.
- `audit/reviewer-code-health.md` — stale after P0 except as historical context.
- `audit/scout-architecture.md` — keep temporarily as historical broad map, but many items are now stale.
