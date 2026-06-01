# Design: database-adapter-conformance

Create a reusable Vitest conformance harness for the full `HeraldDatabaseAdapter` contract, starting with `createMockDb()` and expanding through a forced chained PR sequence. The harness is test-only, lives under `src/__tests__/helpers/`, and does not change public package exports or require external database infrastructure for the base unit suite.

## Decisions

| Topic | Decision |
| --- | --- |
| Public API | Preserve `HeraldDatabaseAdapter`; any inability to express official-adapter setup remains an implementation/open-question issue, not a design-time API change. |
| First executable target | `createMockDb()` is the canonical initial target for all groups added in PRs 1-4. |
| Base test infra | Base unit tests run entirely in memory through the mock adapter and regular `vitest`; real database harness wiring is deferred to PR 5 and must be opt-in. |
| Harness shape | Export grouped suite functions plus one convenience `runDatabaseAdapterConformance()` wrapper. |
| Fixture policy | Use deterministic fixture builders with explicit IDs in payload fields where allowed, stable user IDs, and explicit timestamp patching through adapter methods or lifecycle helpers. |
| Setup policy | Prefer public adapter methods for seeding. Allow helper-only setup only for fields the public create methods intentionally own (`id`, `createdAt`, `updatedAt`) or for backend lifecycle concerns such as resetting a real schema. |
| Capabilities/skips | The harness should default to full contract coverage. PR 5 may add narrowly documented capabilities/skips only for unavoidable backend setup constraints, not for semantic disagreements. |
| Scheduled time control | Scheduled tests use fixed timestamps and derive lease expiry from observed `claimedAt`/`claimExpiresAt`; avoid wall-clock sleeps. |
| Delivery strategy | Force chained PRs exactly as proposed, with PR 5 split by adapter if it risks the 400-line budget. |

## File layout

```text
src/__tests__/helpers/
├─ database-adapter-conformance.ts        # public test-harness entrypoint
├─ database-adapter-conformance/
│  ├─ context.ts                          # suite types, setup/teardown wrapper
│  ├─ fixtures.ts                         # deterministic builders and constants
│  ├─ assertions.ts                       # common ordering/redaction helpers
│  ├─ notifications.ts                    # notification group
│  ├─ deliveries.ts                       # delivery/idempotency group
│  ├─ consent-suppression.ts              # consent + suppression group
│  ├─ audit.ts                            # audit group
│  ├─ compliance-lifecycle.ts             # erase/export/purge group
│  ├─ scheduled-lifecycle.ts              # claim/reclaim/cancel group
│  └─ user-lookup.ts                      # getUserEmail group
└─ mock-db-adapter.conformance.test.ts    # mock adapter entry test
```

Keep the harness under the existing test helper tree instead of `src/adapters/db/` so it remains adapter-agnostic and can be imported by mock, Kysely, Prisma, and Drizzle tests without implying a production export.

## Harness API

The harness entrypoint should expose one adapter target contract and grouped suite functions:

```ts
export interface DatabaseAdapterConformanceTarget<TContext = unknown> {
  name: string;
  create(): Promise<{
    adapter: HeraldDatabaseAdapter;
    context: TContext;
  }> | { adapter: HeraldDatabaseAdapter; context: TContext };
  reset?(context: TContext): Promise<void> | void;
  destroy?(context: TContext): Promise<void> | void;
  helpers?: DatabaseAdapterConformanceHelpers<TContext>;
  capabilities?: DatabaseAdapterConformanceCapabilities;
}

export interface DatabaseAdapterConformanceHelpers<TContext> {
  setNotificationCreatedAt?(context: TContext, id: string, createdAt: Date): Promise<void> | void;
  setDeliveryTimestamps?(context: TContext, id: string, timestamps: Partial<Pick<Delivery, "createdAt" | "updatedAt">>): Promise<void> | void;
  setAuditLogCreatedAt?(context: TContext, id: string, createdAt: Date): Promise<void> | void;
  seedUserEmail?(context: TContext, userId: string, email: string | null): Promise<void> | void;
  associateSuppressionWithUser?(context: TContext, userId: string, suppressionId: string): Promise<void> | void;
}

export interface DatabaseAdapterConformanceCapabilities {
  userEmailLookup?: boolean;
  suppressionExportAssociation?: boolean;
}
```

Grouped entrypoints:

```ts
runNotificationConformance(target);
runDeliveryConformance(target);
runConsentSuppressionConformance(target);
runAuditConformance(target);
runComplianceLifecycleConformance(target);
runScheduledLifecycleConformance(target);
runUserLookupConformance(target);
runDatabaseAdapterConformance(target); // calls all groups
```

Each group should create a fresh adapter per scenario with `beforeEach`, call `reset` defensively after each scenario when supplied, and call `destroy` in `afterEach` or `afterAll` for real DB resources. Failure messages should name the contract behavior, e.g. `notifications: default pagination must use limit=20 offset=0`.

## Mock adapter entry test

`mock-db-adapter.conformance.test.ts` should be the first consumer:

```ts
import { runNotificationConformance, runDeliveryConformance } from "./database-adapter-conformance.js";
import { createMockDb } from "./mock-db-adapter.js";

const target = {
  name: "createMockDb",
  create: () => {
    const adapter = createMockDb();
    return { adapter, context: adapter };
  },
  reset: (db) => db._reset(),
  helpers: {
    setNotificationCreatedAt: (db, id, createdAt) => { db._notifications.get(id)!.createdAt = createdAt; },
    setDeliveryTimestamps: (db, id, timestamps) => { Object.assign(db._deliveries.get(id)!, timestamps); },
    setAuditLogCreatedAt: (db, id, createdAt) => { db._auditLogs.find((l) => l.id === id)!.createdAt = createdAt; },
    seedUserEmail: (db, userId, email) => { db._userEmails.set(userId, email); },
  },
  capabilities: { userEmailLookup: true },
};
```

Only groups implemented in the current chained PR should be invoked. PR 1 imports notifications and deliveries only; later PRs append groups in place.

## Deterministic fixtures

Use fixed constants rather than generated randomness:

| Fixture | Value pattern |
| --- | --- |
| Users | `user_alpha`, `user_beta`, `user_missing` |
| Emails | `alpha@example.test`, `beta@example.test` |
| Event types | `order.completed`, `newsletter.weekly`, `security.alert` |
| Templates | `email-primary`, `inapp-primary`, `digest-primary` |
| Idempotency keys | `idem:alpha:primary`, `idem:alpha:terminal` |
| Address hashes | `hash:alpha@example.test`, `hash:beta@example.test` |
| Timestamps | `BASE = 2030-01-01T00:00:00.000Z`; offsets in seconds/minutes |
| Workers | `worker-a`, `worker-b` |

Create helpers such as `at(seconds: number): Date`, `notificationInput(overrides)`, `deliveryInput(overrides)`, `auditLogInput(overrides)`, `consentEventInput(overrides)`, and `suppressionInput(overrides)`.

Because adapter create methods own `id` and timestamps, scenarios that need tie-break ordering should:

1. Create records through public adapter methods.
2. Use helper timestamp setters when ordering cannot be made deterministic through public inputs.
3. Verify returned adapter-owned IDs only by comparing them with records returned from previous public calls, not by assuming a storage-generated format.

## Seeding policy

Public method seeding is the default:

- Notifications: create through `createNotification`.
- Deliveries: create through `createDelivery` or `createDeliveryIdempotent`; mutate status/timestamps through `updateDelivery` where sufficient.
- Consent: create through `createConsentEvent`, using explicit `createdAt` from the public input type.
- Suppressions: create through `createSuppression`, using explicit `createdAt` if accepted by the input type.
- Audit: create through `createAuditLog`; set `createdAt` via helper where ordering/boundary tests require exact times.
- Lifecycle: create user-owned rows through the relevant public methods before `eraseSubject`/`exportUser`/purge calls.
- Scheduled: create through `createDelivery` with scheduled/claimed fields set in the input.
- User lookup: seed through target helper or adapter factory override; do not require a built-in users table for mock tests.

Helper-only setup is allowed when public methods intentionally hide the value under test: exact `createdAt`, exact `updatedAt`, generated IDs, real DB cleanup, and optional user-email fixture storage. Helper-only setup must not bypass the adapter method whose behavior is under test.

## Suite contracts by group

### Notifications

Scenarios:

- Default `getNotifications(userId)` uses `limit=20`, `offset=0`.
- Explicit `limit`/`offset` are honored.
- Ordering is `createdAt` descending, then `id` descending for timestamp ties.
- User isolation excludes other users.
- `getUnreadNotifications` and `countUnread` reflect `markRead` and `markAllRead` transitions.
- `markRead("missing")` is a no-op.
- `getNotificationByDeliveryId` returns the matching notification or `null`.

### Deliveries and idempotency

Scenarios:

- Create/update/get round-trip preserves key fields and updates `updatedAt`.
- Default and explicit pagination mirror notification defaults.
- Ordering is `createdAt` descending, then `id` descending.
- `createDeliveryIdempotent` creates fresh when no reusable record exists.
- Reusable statuses are `pending`, `scheduled`, `claimed`, `dispatched`, `retrying`, `accepted`.
- Terminal statuses `failed`, `skipped`, `redacted` do not block a fresh create.
- Reusable selection is by `updatedAt` descending, then `createdAt` descending, then `id` descending.
- `getDeliveryByIdempotencyKey` follows the same reusable selection matrix and returns `null` for missing keys.

### Consent/suppression

Scenarios:

- Consent evidence is append-only and newest-first with ID tie-break.
- `subjectId`, `channel`, and `purpose` filters are honored in all combinations.
- `createSuppression` persists address hash/channel/purpose/reason metadata.
- `findSuppression` with purpose returns newest purpose-specific suppression first.
- If no purpose-specific suppression exists, purpose lookup falls back to newest global suppression.
- Without purpose, only global suppressions match.
- Other address hashes/channels do not match.

### Audit

Scenarios:

- `createAuditLog` persists user/action/event/delivery/metadata fields.
- `getAuditLogs` returns newest-first by `createdAt`, then `id`.
- `limit` is honored.
- `findAuditLogByAction` returns the newest deterministic match and does not require write-time uniqueness.
- Missing user/action returns `null`.

### Compliance lifecycle/export/purge

Scenarios:

- `eraseSubject` redacts subject-linked notification fields and delivery identifiers without deleting evidence rows.
- Consent and audit records remain queryable by the adapter's hashed/redacted subject strategy.
- `exportUser(userId)` before erasure includes expected notifications, deliveries, consent events, audit logs, and associated suppressions when the target declares `suppressionExportAssociation`.
- `exportUser(userId)` after erasure exposes redaction markers for redacted records where the adapter can still query them by the requested identifier; otherwise verify preservation through audit/consent lookup semantics.
- `purgeExpiredDeliveries(olderThan)` deletes only records strictly older than the boundary and returns the deletion count. Tests should use purge-eligible terminal statuses, not protected scheduled/claimed/retrying rows.
- `purgeExpiredAuditLogs(olderThan)` uses the same strict boundary and count semantics.

### Scheduled lifecycle/cancellation

Scenarios:

- `claimScheduledBatch(before, workerId, limit, leaseMs)` claims only scheduled rows with `scheduledAt <= before`.
- Future scheduled rows, terminal statuses, retrying/pending rows, and non-expired claimed rows are excluded.
- Expired claimed rows are reclaimable.
- Claimed rows get `status="claimed"`, `claimedBy`, `claimedAt`, `claimExpiresAt`, and fresh `updatedAt`.
- `limit` is honored and result ordering is deterministic by due time ascending, then ID descending.
- `cancelScheduledDeliveries(userId)` redacts only that user's scheduled/claimed rows.
- Cancellation returns affected delivery IDs with `queueJobId` values, including `null` where absent.

Time/lease control: create a non-expired claimed row using `claimExpiresAt` far in the future and an expired claimed row using a timestamp far in the past relative to normal test execution. Do not sleep. For assertions involving lease duration, assert `claimExpiresAt.getTime() - claimedAt.getTime() === leaseMs` or within a tiny synchronous tolerance if an adapter stores only millisecond precision.

### User lookup

Scenarios:

- Existing seeded user resolves to email.
- Seeded `null` or missing user resolves to `null` where the target declares lookup support.
- Official adapters in PR 5 should satisfy this by passing `getUserEmail` overrides, not by requiring application-specific user tables in conformance tests.

## Official adapter opt-in plan

PR 5 should add adapter-specific entry tests only after mock coverage passes. These tests should not run against external services by default.

| Adapter | Initial opt-in path | Notes |
| --- | --- | --- |
| Kysely | First official target; prefer an existing mock Kysely builder for SQL-shape/unit coverage, then add real DB conformance only behind an explicit env flag if needed. | Some contract behavior needs actual row storage, so Kysely may require a lightweight in-memory fake or env-gated Postgres test. Do not make Postgres mandatory for `npm test`. |
| Prisma | Use factory override for `getUserEmail`; real-client conformance should be env-gated. | Likely needs `markRead` missing-id fix and ordering/pagination checks. |
| Drizzle | Use factory override for `getUserEmail`; real DB conformance should be env-gated. | Suppression precedence and deterministic tie-breaks likely need verification/fixes. |

Capabilities/skips must be documented in the target declaration with a reason and issue/TODO. They may skip infrastructure-only cases, such as suppression-to-user export association when the adapter contract cannot infer the subject from an address hash, but must not skip normative semantics like pagination defaults, idempotent `markRead`, or strict purge boundaries.

## Expected implementation fixes

The conformance suite is expected to expose these likely adapter changes:

- `createMockDb().getNotifications` and `getDeliveriesByUser` currently default to returning all rows; the accepted contract requires `limit=20`.
- Mock notification and delivery ordering currently lacks `id` tie-breaks.
- Mock `findSuppression` currently returns insertion order rather than newest purpose-specific/global precedence.
- Mock audit ordering and `findAuditLogByAction` need deterministic newest-first tie-breaks.
- Prisma `markRead` likely throws on a missing notification ID; accepted semantics require no-op.
- Official adapters likely need explicit `id` tie-breaks on newest-first queries.
- Prisma/Drizzle suppression lookup may need purpose-specific precedence rather than broad OR plus recency.
- Scheduled claim query names must consistently use `scheduledAt`/`scheduled_at`; tests should verify due selection, expired lease reclaim, and limit semantics.
- Export suppression association may remain capability-scoped because suppressions are address-hash scoped and not necessarily subject-owned.

## Chained PR mapping

Forced chain strategy:

```text
tracker/base
└─ PR 1 📍 harness + notifications + deliveries/idempotency against mock adapter
   └─ PR 2 consent/suppression + audit
      └─ PR 3 compliance lifecycle/export/purge
         └─ PR 4 scheduled lifecycle/cancellation
            └─ PR 5 official adapters through harness, Kysely first
```

| PR | Scope | Validation | Review workload forecast |
| --- | --- | --- | --- |
| 1 | Harness core, fixtures/assertions, mock entry test, notification group, delivery/idempotency group, mock fixes for those groups. | `npx vitest run src/__tests__/helpers/mock-db-adapter.conformance.test.ts`; `npm run typecheck`; `npm run lint`. | High risk near/over 400 lines because harness + two groups are substantial. If forecast exceeds budget during apply, split PR 1A harness+notifications and PR 1B deliveries/idempotency under the same forced chain rather than taking a size exception. |
| 2 | Consent/suppression and audit group suites plus mock fixes. | Same targeted conformance file; `npm run typecheck`; `npm run lint`. | Medium, likely 250-350 changed lines. |
| 3 | Compliance lifecycle/export/purge group plus mock fixes. | Targeted conformance file; existing `src/__tests__/integration/compliance-erase.test.ts`; `npm run typecheck`; `npm run lint`. | Medium/high, likely 300-400 lines due redaction/export edge cases. Split purge into a follow-up if necessary. |
| 4 | Scheduled claim/reclaim/cancel group plus mock fixes. | Targeted conformance file; existing `src/__tests__/integration/scheduled-worker.test.ts`; `npm run typecheck`; `npm run lint`. | Medium, likely 250-350 lines if focused. |
| 5 | Official adapter harness targets, Kysely first; Prisma/Drizzle only if each remains reviewable. | Adapter-specific targeted tests; existing `src/adapters/db/kysely.test.ts`; env-gated real DB commands only when configured; `npm run typecheck`; `npm run lint`. | High. Split by adapter before exceeding 400 lines. |

## Validation plan

Base validation for PRs 1-4:

```bash
npx vitest run src/__tests__/helpers/mock-db-adapter.conformance.test.ts
npm run typecheck
npm run lint
```

Additional targeted regression tests:

```bash
npx vitest run src/__tests__/integration/compliance-erase.test.ts
npx vitest run src/__tests__/integration/scheduled-worker.test.ts
npx vitest run src/adapters/db/kysely.test.ts
```

Full validation before merging the completed chain:

```bash
npm run test
npm run typecheck
npm run lint
npm run build
```

Real DB-backed official adapter conformance, if added, must be guarded by explicit environment variables and documented commands so normal contributors can run `npm test` without PostgreSQL, Prisma migrations, or Drizzle/Kysely external services.

## Rollout and rollback

- PRs 1-4 are test-only plus mock test-helper fixes; rollback removes the relevant conformance group and any same-slice mock adjustments.
- PR 5 is adapter-test wiring plus official adapter fixes; rollback can remove one adapter target independently.
- No production exports, package exports, schema generation, or consumer migration steps are planned.

## Open questions

- Should `getDeliveryByIdempotencyKey` return `null` when only non-reusable terminal records exist, or return the latest terminal record for observability? The spec currently requires the same reusable selection matrix; implementation should follow that unless reviewers revise the spec before apply.
- Can official adapters provide full lifecycle/export conformance without env-gated real databases? If not, PR 5 should document env-gated commands and keep base unit tests mock-only.
- Should suppression-to-user export association become a required adapter contract later? Current design treats it as capability-scoped because suppressions are address-hash scoped.
