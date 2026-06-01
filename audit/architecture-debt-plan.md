I did not write `/home/andrei/projects/herald-package/audit/architecture-debt-plan.md` because the task also says review-only/no file modification, and that no-edit constraint wins. Engram tools were not available in this subagent runtime.

# Implementation Plan

## Goal
Choose the next small, reviewable architecture-debt unit after the processor refactor, prioritizing readability/architecture before functionality.

## Recommendation

**Implement now:** consolidate config normalization/default logic.

This is the safest next work unit under ~400 changed lines. It directly addresses known debt, has low behavioral risk, and avoids the large-review traps in `src/types/index.ts`, adapter schema metadata, `send.ts`, DB conformance tests, and scheduled-worker bug work.

## Tasks

1. **Extract shared config defaults and retry normalization**
   - File: `src/core/runtime/config-defaults.ts`
   - Changes:
     - New internal helper module.
     - Move/shared define:
       - `DEFAULT_RETENTION_CONFIG`
       - queue default helper: `resolveQueueConfig(queue)`
       - retry helper: `resolveProcessorRetryConfig(queue)`
       - legal-basis merge helper for low-level and configured paths.
   - Acceptance:
     - No public API change.
     - `configureHerald()` and low-level `createHerald()` keep current behavior.

2. **Use shared helpers in low-level runtime normalization**
   - File: `src/core/runtime/config-normalization.ts`
   - Changes:
     - Replace local `resolveProcessorRetryConfig()` and compliance default logic with imports from `config-defaults.ts`.
     - Keep `normalizeHeraldRuntimeConfig()` as the low-level adapter boundary.
   - Acceptance:
     - `npm run typecheck`
     - `npx vitest run src/core/herald.test.ts src/core/herald-registry.test.ts`

3. **Use shared helpers in configured API normalization**
   - File: `src/core/configure.ts`
   - Changes:
     - Remove duplicate `DEFAULT_RETENTION_CONFIG`, `resolveQueueConfig()`, and `resolveProcessorRetryConfig()`.
     - Keep app-scoped channel validation, event ownership, and configured-only type constraints local to this file.
     - Use shared legal-basis/retention merge helper for `mergeComplianceConfig()`.
   - Acceptance:
     - `npx vitest run src/core/configure.test.ts src/__tests__/types.test.ts src/__tests__/readme-configured-api.test.ts`

4. **Run full validation**
   - Commands:
     - `npm run typecheck`
     - `npm run test`
     - Optional: `npm run build`
   - Acceptance:
     - All pass.
     - Diff stays focused and under ~400 changed lines.

## Files to Modify

- `src/core/runtime/config-defaults.ts` - new shared config/default helper module.
- `src/core/runtime/config-normalization.ts` - consume shared helpers.
- `src/core/configure.ts` - consume shared helpers while preserving configured API concerns.

## New Files

- `src/core/runtime/config-defaults.ts` - shared internal queue/retry/compliance/retention defaults.

## Dependencies

- Task 1 must happen before Tasks 2 and 3.
- Tasks 2 and 3 can be implemented sequentially in one work unit.
- Full validation depends on all code changes.

## Optional Follow-up Chain

1. **PR 1: Config normalization consolidation** — immediate recommended slice.
2. **PR 2: Type contract split, one domain at a time**
   - Start with compliance/domain types only.
   - Keep `src/types/index.ts` as a barrel.
   - Avoid changing all imports in the same PR.
3. **PR 3: CLI schema extraction**
   - First move giant schema strings out of `src/cli/index.ts` without generating from metadata yet.
   - Metadata generation can be a later PR.
4. **PR 4: Adapter/CLI schema metadata**
   - Higher risk; defer until after schema strings are isolated.
5. **PR 5: `send.ts` phase extraction**
   - Defer until after config/type surface is cleaner.
6. **PR 6: DB adapter conformance tests**
   - Functional/test architecture work; useful but larger.
7. **PR 7: Scheduled-worker bug**
   - Last, per current preference.

## Risks

- Legal-basis config merge semantics differ slightly between configured and low-level paths; helper API must preserve both.
- Do not move channel validation into shared config defaults; configured app typing/validation belongs in `src/core/configure.ts`.
- Avoid starting with `src/types/index.ts`: a clean split likely exceeds the 400-line review budget.
- Avoid centralizing adapter/CLI schema metadata now: current duplication is real, but a proper metadata model would likely touch CLI, adapters, tests, and generated output at once.

## Compact Worker Prompt

Implement the next architecture-debt slice: consolidate duplicated config normalization/default logic without behavior changes. Create `src/core/runtime/config-defaults.ts` for shared queue defaults, retry config, legal-basis registry merge, and retention defaults. Update `src/core/runtime/config-normalization.ts` and `src/core/configure.ts` to use it while keeping configured API channel validation/app ownership local. Do not refactor unrelated files. Keep diff under ~400 changed lines. Validate with `npm run typecheck`, targeted config/herald/type tests, then `npm run test` if feasible.