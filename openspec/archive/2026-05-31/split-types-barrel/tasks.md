## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900–1300 total across chain (per PR target: 180–360) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | chained PRs |
| Chain strategy | stacked-to-main |

Decision needed before apply: No — user selected stacked-to-main before apply.
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

## Chained PR dependency diagram

```text
✅ PR 1 (schema/mail/channels split, compatibility-first) 
  -> ✅ PR 2 (compliance/records split)
    -> ✅ PR 3 (events/database split)
      -> ✅ PR 4 (queue/config + final barrel cleanup)
```

## Compatibility strategy for the chain

- Keep `src/types/index.ts` as the only import target for existing internal/external call sites during all slices.
- In each PR, extract one domain module and immediately replace the moved declarations in `src/types/index.ts` with `export type`/`export` re-exports from that new module.
- Do not change `package.json` exports or root `src/index.ts` export wiring.
- Keep cross-module links type-only (`import type`) to avoid runtime changes.

## PR 1 — Extract low-coupling foundations (`schema`, `mail`, `channels`)

- **Status:** Completed.
- **Start state:** monolithic `src/types/index.ts` contains all declarations.
- **End state:** new `schema.ts`, `mail.ts`, `channels.ts`; `src/types/index.ts` re-exports moved symbols; API surface unchanged.
- **Depends on:** none.
- **Changed files:**
  - `src/types/schema.ts` (new)
  - `src/types/mail.ts` (new)
  - `src/types/channels.ts` (new)
  - `src/types/index.ts` (replace moved blocks with re-exports)
- **Implementation tasks:**
  1. Move `HeraldSchema`/`InferSchema` to `schema.ts`.
  2. Move mail adapter contracts (`SendEmailInput`, `SendEmailResult`, `HeraldMailAdapter`, lazy adapter input types) to `mail.ts`.
  3. Move channel vocabulary/config (`Channel`, channel config input/output types) to `channels.ts`.
  4. Update `src/types/index.ts` to re-export those symbols; remove duplicate declarations.
- **Validation:**
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test -- src/__tests__/types.test.ts`
- **Rollback:** revert PR 1 commit(s), restoring original blocks in `src/types/index.ts` and deleting the three new files.
- **Review budget estimate:** 220–320 changed lines.
- **Evidence:** `npm run typecheck`, `npm run lint` (warnings only), `npx vitest run src/__tests__/types.test.ts`, full `npm run test`, and `npm run build` passed. Fresh reviewer found no blockers or should-fix items.

## PR 2 — Extract compliance and records domains (`compliance`, `records`)

- **Status:** Completed.
- **Start state:** PR 1 merged; `index.ts` already partially barrelized.
- **End state:** compliance and record/audit contracts live in dedicated files; `index.ts` re-exports all moved symbols.
- **Depends on:** PR 1.
- **Changed files:**
  - `src/types/compliance.ts` (new)
  - `src/types/records.ts` (new)
  - `src/types/index.ts`
- **Implementation tasks:**
  1. Move legal basis/compliance policies, consent/suppression, compliance DB contract, retention/compliance config types into `compliance.ts`.
  2. Move `DeliveryStatus`, `Notification`, `Delivery`, `AuditLog`, `ComplianceExportData` into `records.ts`.
  3. Add needed `import type` references between `compliance.ts` and `records.ts` (no value imports).
  4. Re-export from `src/types/index.ts`; ensure no symbol rename.
- **Validation:**
  - `npm run typecheck`
  - `npm run lint`
  - `npx vitest run src/compliance/legal-bases.test.ts src/core/runtime/compliance-lifecycle.test.ts`
- **Rollback:** revert PR 2 only; PR 1 remains intact.
- **Review budget estimate:** 280–360 changed lines.
- **Evidence:** `npm run typecheck`, `npm run lint` (warnings only), targeted compliance/type tests, full `npm run test`, and `npm run build` passed. Fresh reviewer found no blockers or should-fix items.

## PR 3 — Extract event and DB contracts (`events`, `database`)

- **Status:** Completed.
- **Start state:** PR 2 merged.
- **End state:** event/template/send options and DB adapter interfaces moved out; `index.ts` remains compatibility barrel.
- **Depends on:** PR 2.
- **Changed files:**
  - `src/types/events.ts` (new)
  - `src/types/database.ts` (new)
  - `src/types/index.ts`
- **Implementation tasks:**
  1. Move recipient, templates, `EventDefinition`, `EventRef` family, `SendOptions` to `events.ts`.
  2. Move `HeraldDatabaseAdapter` and related DB-facing contracts to `database.ts`.
  3. Ensure imports from `schema/channels/compliance/records` are type-only and acyclic.
  4. Re-export from `src/types/index.ts` to preserve all previous names.
- **Validation:**
  - `npm run typecheck`
  - `npm run lint`
  - `npx vitest run src/core/herald.test.ts src/core/runtime/send.test.ts src/__tests__/mock-db-adapter.test.ts`
- **Rollback:** revert PR 3 only.
- **Review budget estimate:** 260–340 changed lines.
- **Evidence:** `npm run typecheck`, `npm run lint` (warnings only), targeted herald/send/mock-db/type tests, full `npm run test`, and `npm run build` passed. Fresh reviewer found no blockers or should-fix items.

## PR 4 — Extract queue/config and finalize barrel (`queue`, `config`, final `index`)

- **Status:** Completed.
- **Start state:** PR 3 merged; most declarations already modularized.
- **End state:** queue + app config contracts moved; `src/types/index.ts` reduced to organized exports only.
- **Depends on:** PR 3.
- **Changed files:**
  - `src/types/queue.ts` (new)
  - `src/types/config.ts` (new)
  - `src/types/index.ts`
- **Implementation tasks:**
  1. Move queue job/processor/capabilities/adapter and queue config union to `queue.ts`.
  2. Move hooks, `HeraldConfig`, `StartScheduledWorkerOptions` to `config.ts`.
  3. Convert `src/types/index.ts` to final barrel export layout for all domain modules.
  4. Confirm no package export-map updates and no call-site rewrites outside `src/types/`.
- **Validation:**
  - `npm run build`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test`
- **Rollback:** revert PR 4 only; earlier split PRs still valid.
- **Review budget estimate:** 180–280 changed lines.
- **Evidence:** `npm run typecheck`, `npm run lint` (warnings only), full `npm run test`, `npm run build`, and `rg 'from "./index.js"' src/types --glob '*.ts'` passed/no matches. Fresh reviewer found no blockers or should-fix items and recommended SDD verify.

## Final verification evidence

- **SDD verify verdict:** PASS with warnings.
- **Validation:** `npm run typecheck`, `npm run lint` (0 errors, 57 warnings), `npm run test` (23 files / 308 tests), and `npm run build` passed.
- **Architecture checks:** `src/types/index.ts` is a barrel-only file; all sibling imports under `src/types/` use direct modules and `import type`; no imports from `./index.js` were found under `src/types/`.
- **Warnings:** Workspace lacks `.git` metadata, so diff-based export-map immutability and exact changed-line history could not be independently verified. This is a traceability warning, not a code blocker.

## Cross-PR verification checklist (applies at each PR)

1. Root `src/index.ts` type exports still compile without edits.
2. `src/types/index.ts` continues exporting every pre-change public type name.
3. No runtime imports introduced from `src/types/*` modules.
4. No non-`src/types/*` call-site import rewrite is included.
5. Diff stays under ~400 changed lines; if exceeded, split PR before apply.
