# Herald code-health / architecture review

Fresh-context review based on `plan.md`, `src/`, docs, and tests. `progress.md` was requested but is not present in this checkout. No source files were modified. Evidence: `npm run typecheck` and `npm run test` both pass (`303` tests across `22` files).

## Blockers

1. **Scheduled sync worker conflates enqueue/processing failures with `resolvePayload` failures.**
   - Evidence: `src/core/runtime/scheduled-worker.ts:76-104` wraps compliance, `resolvePayload`, schema validation, and `queue.enqueue()` in one `try`; the `catch` at `src/core/runtime/scheduled-worker.ts:105-124` increments `resolveAttempts` and may reset the delivery to `scheduled`.
   - Why it matters: with the sync queue, `queue.enqueue()` runs the delivery processor in-band. If the mail provider/send path fails, `createProcessor()` correctly marks the delivery `failed` and throws (`src/core/runtime/processor.ts:290-321`), but `startScheduledWorker()` catches that same throw and can overwrite the state back to `scheduled` while incrementing `resolveAttempts`. This makes send failures look like payload-resolution failures and can create confusing retry/resend behavior.
   - Test gap: scheduled-worker tests cover resolver/schema failures (`src/core/runtime/scheduled-worker.test.ts:571-628`) and successful in-band processing (`src/core/runtime/scheduled-worker.test.ts:258-313`), but I did not find a scheduled sync-worker test where `mail.send`/`processDelivery` fails after a valid payload.
   - Smallest safe next step: split the scheduled worker into two error domains: (a) fire-time compliance + resolve + schema validation may increment `resolveAttempts`; (b) `queue.enqueue()`/processor failures must not be converted into resolver failures. Add a regression test with a valid `resolvePayload` and a failing mail adapter asserting the final delivery state is not reset to `scheduled`.

## Should do next

1. **Finish the test readability refactor by reducing “runtime tests through full Herald” where it obscures ownership, but do not do another broad cut/paste pass first.**
   - Evidence: the plan’s split has mostly happened (`src/core/runtime/scheduled-worker.test.ts`, `processor.test.ts`, `send.test.ts`, `compliance-lifecycle.test.ts`, `test-utils.ts` exist), and all tests pass. But large files remain: `src/core/herald.test.ts` is `862` lines, `src/core/runtime/processor.test.ts` is `894` lines, `src/core/runtime/scheduled-worker.test.ts` is `682` lines, and the integration scheduled-worker suite is `1493` lines.
   - Smallest safe next step: after the blocker above, split `src/core/herald.test.ts` by behavior, not implementation module: construction/config validation, hooks/autostart, send-time compliance integration. Keep only cross-module orchestration in `herald.test.ts`. Do not rewrite assertions during the split.

2. **Add DB adapter conformance coverage before refactoring adapter internals.**
   - Evidence: there is Kysely-focused adapter coverage (`src/adapters/db/kysely.test.ts`), but no equivalent Prisma/Drizzle adapter tests in the file list. The three official DB adapters each implement compliance erase/export, scheduled claiming, cancellation, purge, idempotency, and row mapping separately; for example Prisma has raw scheduled claim/cancel paths at `src/adapters/db/prisma.ts:404-457`, Drizzle at `src/adapters/db/drizzle.ts:421-500`, and Kysely at `src/adapters/db/kysely.ts:795-842`.
   - Why it matters: these are production-critical invariants and the duplicated logic is easy to drift. The Kysely adapter has helper mappers; Drizzle inlines a large delivery row mapper in `claimScheduledBatch` (`src/adapters/db/drizzle.ts:443-482`).
   - Smallest safe next step: create a small adapter conformance test contract around idempotency reuse, erasure redaction, scheduled claim/cancel, and purge semantics. Use it first against the mock DB and Kysely fake; then decide whether Prisma/Drizzle need test fakes or documented integration tests.

3. **Harden or clarify the `safeFields` model for in-app `data`.**
   - Evidence: `safeFields` is defined as payload keys (`src/core/configure.ts:75-77`), but in-app persistence filters keys from `rendered.data`, not directly from the validated payload (`src/core/runtime/processor.ts:216-228`). Existing coverage verifies key filtering only (`src/core/runtime/processor.test.ts:124-160`).
   - Risk: a template can put transformed PII under an allowed key, and Herald will persist it because only the key name is checked. This may be acceptable if templates are trusted durable content, but the current “safeFields only” wording can be read as payload-value whitelisting.
   - Smallest safe next step: decide the intended contract. If `safeFields` means payload-value whitelist, build notification `data` from the validated payload and let templates only render durable `title/body/href`. If templates own notification `data`, rename/clarify the docs and add a test that demonstrates the intended responsibility.

4. **Align the internal default compliance fallback with the public configured API direction.**
   - Evidence: the configured event type requires `compliance` (`src/core/configure.ts:70-82`), but the send path still silently defaults missing event compliance to `{ purpose: eventName, legalBasis: "contract" }` (`src/core/runtime/compliance-gate.ts:14-18`, used at `src/core/runtime/send.ts:134-136`). Many tests still use `createHerald()`/`defineEvent()` directly.
   - Smallest safe next step: keep the fallback only for internal/test primitives if needed, but add an explicit test/documentation boundary: root exports already quarantine low-level factories (`src/index.ts:6-15`, `src/__tests__/public-api.test.ts:4-10`). For production-quality API clarity, consider enabling `requireExplicitEventCompliance` by default for configured apps and making missing compliance a runtime construction error even when types are bypassed.

5. **Separate provider side-effect semantics from delivery-state bookkeeping in `processor.ts`.**
   - Evidence: `createProcessor()` handles rendering, provider send, notification creation, side-effect idempotency, status transitions, accepted-status retry, audit logs, and hooks in one long loop (`src/core/runtime/processor.ts:168-321`). The logic is covered, but dense.
   - Smallest safe next step: after the scheduled-worker bug is fixed, extract tiny private helpers only around state transitions (`markDispatched`, `markAcceptedWithRetry`, `markFailed`) and keep provider calls in place. Avoid a big architecture rewrite.

## Later cleanup

- **Adapter code generation/consolidation.** The adapter implementations contain repeated erasure, export, scheduled claim/cancel, purge, and mapping logic across Prisma/Drizzle/Kysely (`src/adapters/db/prisma.ts:320-470`, `src/adapters/db/drizzle.ts:320-500`, `src/adapters/db/kysely.ts:680-850`). Do not consolidate before conformance tests exist.
- **Reduce low-level runtime use in docs-facing examples/tests.** README already shows the configured API (`README.md:53-120`), and root public API tests enforce that `createHerald`/`defineEvent` are not root exports. Keep this direction; migrate user-facing tests/examples first, not implementation tests.
- **Review scheduled-worker duplication between unit-ish and integration suites.** The integration scheduled-worker test file is very large (`1493` lines). Once the blocker has a focused regression test, identify duplicate happy-path coverage and keep the integration suite for DB/queue lifecycle behavior only.

## What NOT to refactor now

- Do **not** rewrite the public API shape; `configureHerald()` + generated `herald.events.*` is already the documented and exported path.
- Do **not** remove low-level `createHerald()`/runtime factories from internal tests yet; they are useful implementation/test primitives and root exports already quarantine them.
- Do **not** consolidate Prisma/Drizzle/Kysely adapter internals before adding adapter conformance coverage.
- Do **not** spend time on formatting/style churn; current high-value work is state semantics, tests, and API/privacy contracts.

## Engram note

The task requested saving important discoveries to Engram with project `herald-package`, but this subagent environment exposes no callable Engram/memory tools. Findings are persisted in this audit artifact only.
