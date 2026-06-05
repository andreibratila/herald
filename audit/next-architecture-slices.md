# Next Architecture Slices

## Current State

The previous broad audit docs are partly stale. The codebase already has:

- centralized config defaults in `src/core/runtime/config-defaults.ts`;
- domain-split type modules with `src/types/index.ts` as a compatibility barrel;
- split send and processor runtime phases;
- scheduled-worker error-domain regression coverage;
- DB adapter conformance helpers plus env-gated real adapter tests.

Remaining work is mostly schema organization and review-load reduction.

## Completed

### P0 — Clarify/harden in-app `persistedFields` persistence contract

Implemented: `safeFields` was renamed to `persistedFields`; durable in-app `notification.data` is derived from precise validated payload paths, not from template-produced structured data.

## Prioritized Backlog

### P1 — Extract CLI schema strings from `src/cli/index.ts`

Implemented: inline Prisma, Drizzle, and Kysely schema strings were moved to focused modules under `src/cli/schemas/` without changing generated output.

### P1 — Split oversized tests by behavior

- **Scope**: Move-only split of large test files to reduce review burden without changing assertions.
- **Completed slices**:
  - split the former `src/core/herald.test.ts` into behavior-focused files: `src/core/herald.compliance-consent.test.ts`, `src/core/herald.compliance-send.test.ts`, `src/core/herald.lifecycle.test.ts`, `src/core/herald.send-basics.test.ts`, and `src/core/herald.validation.test.ts`.
  - split the former `src/core/runtime/scheduled-worker.test.ts` into `src/core/runtime/scheduled-send.test.ts`, `src/core/runtime/scheduled-process-delivery.test.ts`, `src/core/runtime/scheduled-worker-lifecycle.test.ts`, and `src/core/runtime/scheduled-worker-failures.test.ts`.
- **Remaining likely files**: `src/__tests__/integration/scheduled-worker.test.ts`, `src/core/runtime/processor.test.ts`, and `src/core/herald-registry.test.ts`.
- **Risk**: Low if move-only.
- **Validation**: targeted moved test set plus `npm run test`.
- **SDD**: Not needed for mechanical split.

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

Continue with **P1 — Split oversized tests by behavior**.

Reason: the CLI schema extraction is complete; the remaining low-risk work is reducing large test files before taking on schema metadata or adapter cleanup.

## Audit Doc Disposition

- `audit/handoff-plan.md` — mostly stale; keep only for historical context.
- `audit/reviewer-code-health.md` — stale after P0 except as historical context.
- `audit/scout-architecture.md` — keep temporarily as historical broad map, but many items are now stale.
