# Change Proposal: split-types-barrel

## Problem

`src/types/index.ts` is the authoritative type contract for Herald and has grown into a 700+ line mixed-domain file. It currently contains schema abstractions, channel and compliance vocabulary, event/template definitions, delivery and notification records, database and mail adapter contracts, queue configuration, hooks, send options, and main runtime configuration in one module.

This makes the public type surface harder to review and maintain because unrelated concepts are adjacent, changes to one domain create noisy diffs in the central type file, and future contributors have no clear module boundary for adding or evolving type contracts.

## Intent

Decompose the type contract into focused domain modules while keeping `src/types/index.ts` as the compatibility barrel and preserving the existing public export surface.

The first implementation slice should be a structural refactor only: move type declarations into domain files, export them from the barrel, and avoid rewriting internal call-site imports or package exports.

## Goals

- Improve readability and maintainability of Herald's type contract.
- Introduce clear domain ownership under `src/types/` without changing runtime behavior.
- Preserve all current public exports available through `herald` and existing internal imports from `src/types/index.ts`.
- Keep generated declarations semantically equivalent for consumers.
- Keep the first implementation reviewable within the 400 changed-line budget where practical.

## Non-Goals

- Do not redesign public APIs or type names.
- Do not change package `exports` or add new public subpath imports.
- Do not rewrite call-site imports away from `src/types/index.ts` in the first slice.
- Do not alter runtime behavior, queue behavior, compliance semantics, adapter behavior, or persistence behavior.
- Do not introduce new dependencies or build tooling.

## Proposed Scope

Create focused type modules under `src/types/` and turn `src/types/index.ts` into a barrel that re-exports those modules.

Proposed initial module boundaries:

- `schema.ts` — `HeraldSchema`, `InferSchema`.
- `channels.ts` — channel vocabulary and channel configuration types.
- `compliance.ts` — legal basis, consent, suppression, compliance decisions, compliance DB contract, retention and compliance config, export/audit-related compliance types where appropriate.
- `events.ts` — event definitions, recipient, templates, event refs, send options.
- `records.ts` — delivery status, delivery record, notification record, audit log, compliance export data if not housed in `compliance.ts`.
- `adapters.ts` or split `database.ts` / `mail.ts` — `HeraldDatabaseAdapter`, mail adapter input/result/contracts.
- `queue.ts` — queue configs, queue job/processor/capabilities/adapter.
- `config.ts` — main `HeraldConfig`, hooks, scheduled worker options, and cross-domain config composition.
- `index.ts` — compatibility barrel only, exporting the focused modules.

Final file boundaries may be adjusted during design if dependency cycles are clearer with a slightly different split. The spec/design phase should decide exact filenames and ownership rules.

## Out of Scope

- Moving implementation code outside `src/types/`.
- Re-exporting new public subpaths from `package.json`.
- Renaming public types.
- Changing type semantics, generic parameters, or structural shapes.
- Updating README/docs examples except if a later implementation discovers generated docs depend on source file paths.
- Splitting adapter entrypoints or runtime registries.

## Affected Areas

- `src/types/index.ts` becomes a barrel.
- New files under `src/types/` contain the moved declarations.
- Type-only imports between new type modules may be required, especially for shared dependencies such as `Channel`, `EventRefMap`, `HeraldSchema`, and `type-fest` helpers.
- Build/typecheck/lint/test should remain unchanged.

## Alternatives Considered

1. **Leave `src/types/index.ts` as-is.**
   - Lowest short-term risk, but does not address maintainability or reviewability.

2. **Split the file and update every call site immediately.**
   - Provides stronger internal boundaries, but increases changed lines and review surface. This should be deferred until after the compatibility barrel split, if still valuable.

3. **Expose new public subpath exports such as `herald/types/compliance`.**
   - Could help consumers, but expands the public API and requires package export policy decisions. Not needed for this first refactor.

4. **Redesign the type model while splitting.**
   - Tempting because boundaries reveal domain issues, but it mixes mechanical refactor with API design and makes review/rollback harder.

## Impact

### Public API

No intended public API change. Consumers should continue importing types from `herald` exactly as before after build output is generated.

### Runtime Behavior

No runtime behavior change. The refactor is type/source organization only.

### Build and Declaration Output

Declaration output paths may show different internal source module names, but the package-level type entrypoint should continue to expose the same names. Spec/design should require a typecheck/build validation to catch accidental missing exports.

### Review Workload

The first slice may approach the 400 changed-line budget because moving 700+ lines can register as many additions/deletions even when semantics are unchanged. To keep review focused:

- Prefer pure move + barrel export only.
- Avoid import rewrites outside `src/types/`.
- Avoid formatting churn.
- If the implementation forecast exceeds 400 changed lines, mark the apply phase as requiring a chained/ask decision before coding, per the session `ask-always` chained PR preference.

## Migration and Review Strategy

- Treat this as a compatibility-preserving internal refactor.
- Review by domain module boundaries rather than by behavior changes.
- Keep commits as work units:
  1. Introduce domain modules and move declarations.
  2. Replace `src/types/index.ts` with barrel exports.
  3. Run verification and adjust only missing type-only imports/exports.
- If changed lines exceed the review budget, ask before implementation whether to:
  - use a chained PR strategy, or
  - accept a `size:exception` for a mechanical move.

## Risks

- Missing a re-export from `src/types/index.ts` could break consumers.
- Type-only dependency cycles could appear between proposed modules.
- Moving declarations may create lint/typecheck issues if `import type` boundaries are not precise.
- Mechanical move diffs may exceed the 400 changed-line budget despite low semantic risk.

## Rollback

Rollback is straightforward: restore the previous monolithic `src/types/index.ts` and remove the new domain files. Because no call-site imports, package exports, or runtime behavior should change in the first slice, rollback should not require wider code changes.

## Success Criteria

- `src/types/index.ts` is a barrel that re-exports focused domain modules.
- Existing public type names remain exported from the root package path after build.
- No package export changes are required.
- No internal call-site import rewrites are required outside `src/types/` for the first slice.
- `npm run typecheck`, `npm run lint`, and `npm run test` are expected to pass after implementation.
- Implementation plan identifies whether the 400 changed-line budget will be exceeded and asks for a chained/exception decision before apply if needed.

## Acceptance Criteria for Moving to Spec/Design

Proceed to spec/design when the team agrees that:

- The change is limited to source organization and compatibility-barrel preservation.
- Exact module boundaries can be specified without renaming or redesigning public types.
- Verification will include export completeness and normal project checks.
- Any >400 changed-line forecast will trigger a chained PR or `size:exception` decision before implementation.
