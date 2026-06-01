# Tasks — split-send-pipeline-phases

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 700–1000 total (split across 3 PRs, ~180–350 each) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Slice A) → PR 2 (Slice B) → PR 3 (Slice C) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

## Decision Evidence

- User explicitly selected **chained PRs** for this change.
- Design summary already defines three independent slices (A/B/C).
- Prior project experience (`split-types-barrel`) validated **stacked-to-main** as workable here.
- Single-PR forecast is likely above the 400-line review budget once helper extraction + regression tests land.

## Chained PR Dependency Diagram

```text
main
 └─ PR 1 📍 Slice A: guards + preparation extraction
     └─ PR 2 Slice B: channel + compliance extraction
         └─ PR 3 Slice C: delivery + enqueue extraction
```

## Task Plan (dependency ordered)

### PR 1 — Slice A (guards + preparation)

1. **Create internal send phase scaffolding (types + boundaries)**
   - Files: `src/core/runtime/send/` (new), `src/core/runtime/send.ts`
   - Add private phase context/result types needed by extraction (no public exports).
   - Stop rule: `send.ts` still exports same `createSendFunction` and `SendResult` shape.

2. **Extract option guards into dedicated helper**
   - Files: `src/core/runtime/send/guards.ts`, `src/core/runtime/send.ts`
   - Preserve exact behavior/order for:
     - past `scheduledAt` rejection before runtime startup
     - scheduled send requiring `resolvePayload` after event lookup
   - Verification target tests:
     - `core/runtime/scheduled-worker.test.ts` (scheduledAt and resolvePayload guards)
     - `core/runtime/send.test.ts` (unknown event + payload guards baseline)

3. **Extract preparation pipeline helper**
   - Files: `src/core/runtime/send/prepare.ts`, `src/core/runtime/send.ts`
   - Move and preserve: `start()`, event lookup, schema parse, dispatch, `validateRecipients`, renderer validation.
   - Keep synchronous dispatch assumption unchanged.

4. **Slice A validation and rollback gate**
   - Run: `npm run typecheck`, `npm run lint`, `npx vitest run core/runtime/send.test.ts core/runtime/scheduled-worker.test.ts`
   - Rollback boundary: revert `src/core/runtime/send/guards.ts`, `src/core/runtime/send/prepare.ts`, and matching `send.ts` orchestration changes only.

---

### PR 2 — Slice B (channel + compliance)

5. **Extract channel support skip phase**
   - Files: `src/core/runtime/send/channel-phase.ts`, `src/core/runtime/send.ts`
   - Preserve skip reason `channel_unavailable:<channel>` and safe `hooks.onSkipped` behavior.

6. **Extract compliance phase**
   - Files: `src/core/runtime/send/compliance-phase.ts`, `src/core/runtime/send.ts`
   - Preserve policy resolution, DB assertions, bypass decision shape, denied skip/audit behavior, and metadata fields.
   - Keep denied path side effects: skip hook + `compliance.denied` audit + skipped result entry.

7. **Add/adjust focused regression coverage for channel/compliance equivalence**
   - Primary test files: `core/runtime/send.test.ts`, `core/herald.test.ts`
   - Concrete checks to keep/expand:
     - unsupported channel skip reason/hook
     - bypass compliance allowed path
     - compliance denied skip reason + audit metadata

8. **Slice B validation and rollback gate**
   - Run: `npm run typecheck`, `npm run lint`, `npx vitest run core/runtime/send.test.ts core/herald.test.ts compliance/compliance.test.ts`
   - Rollback boundary: revert channel/compliance phase modules and `send.ts` wiring, keep Slice A intact.

---

### PR 3 — Slice C (delivery + enqueue)

9. **Extract delivery persistence/idempotency phase**
   - Files: `src/core/runtime/send/delivery-phase.ts`, `src/core/runtime/send.ts`
   - Preserve:
     - idempotency key scoping `${key}:${userId}:${channel}:${template}`
     - persisted delivery fields/status/compliance fields
     - created=false behavior (no create-only side effects)
     - bypass/scheduled audit behavior boundaries

10. **Extract enqueue phase and queueJobId persistence behavior**
    - Files: `src/core/runtime/send/enqueue-phase.ts`, `src/core/runtime/send.ts`
    - Preserve:
      - immediate enqueue carries full validated payload
      - scheduled + delayedJobs enqueue uses `{ deliveryId, scheduledAt }` only
      - scheduled + no delayedJobs skips enqueue
      - update `queueJobId` only when non-empty job id returned

11. **Ensure error aggregation envelope unchanged after full phase extraction**
    - Files: `src/core/runtime/send.ts` (loop orchestration), tests in `core/runtime/send.test.ts`
    - Preserve per recipient/channel isolation and non-Error normalization.

12. **Slice C validation and final change gate**
    - Run: `npm run typecheck`, `npm run lint`, `npm run test`
    - Rollback boundary: revert delivery/enqueue modules and related orchestration wiring; keep Slices A/B if stable.

## Cross-slice guardrails

- No changes to public API signatures, package exports, adapter contracts, DB schema, queue payload contract semantics, or compliance semantics.
- No scheduled-worker bug fix work in this change.
- Keep each PR independently reviewable and mergeable with passing checks.
- If any slice approaches >400 changed lines during implementation, split that slice into an additional chained PR before merge.
