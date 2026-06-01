# Change Proposal: database-adapter-conformance

## Problem

Herald has a full `HeraldDatabaseAdapter` contract, but it does not have a reusable conformance suite that every database implementation can run. Current adapter behavior is verified through fragmented tests around `createMockDb()`, scheduled-worker integration, compliance erasure, and a Kysely-specific adapter test.

That fragmentation lets semantic drift hide in adapter-specific code. It is especially risky for compliance, idempotency, scheduled delivery claiming, and audit-log behavior, where inconsistent adapter semantics can produce duplicate deliveries, missed erasures, or unverifiable audit trails.

## Intent

Create a complete reusable database-adapter conformance harness for the full `HeraldDatabaseAdapter` contract. The first implementation should target `createMockDb()` so the intended contract is defined in one place before official adapters are run through the same suite.

Implementation must be delivered as forced chained PRs to keep each review within the 400 changed-line budget and to avoid mixing unrelated adapter method groups.

## Goals

- Define one reusable conformance harness for `HeraldDatabaseAdapter` behavior.
- Cover the complete adapter contract by method group:
  - notifications,
  - deliveries and idempotency,
  - consent and suppression,
  - audit logs,
  - compliance lifecycle and export,
  - purge operations,
  - scheduled lifecycle and cancellation,
  - user lookup where relevant to full contract coverage.
- Establish canonical semantics for currently ambiguous behaviors before implementation.
- Start with `createMockDb()` to lock the test contract cheaply and deterministically.
- Add official adapters only after the harness shape and cost are understood.
- Prefer correct long-term semantics over preserving pre-release draft behavior.

## Non-Goals

- Do not implement tests or production code in the proposal phase.
- Do not change the public database adapter API unless a later spec/design proves the existing contract cannot express required behavior.
- Do not add external database infrastructure by default for the mock-focused initial slice.
- Do not require users to install or run Prisma, Drizzle, Kysely, PostgreSQL, or other external DB services merely to run the base unit test suite.
- Do not redesign queue, mail, compliance policy, or runtime event APIs.
- Do not encode official-adapter implementation quirks as contract behavior unless they are explicitly accepted as the desired semantics.

## Proposed Scope

### Shared conformance harness

Create reusable test utilities that accept an adapter factory and lifecycle hooks, then run method-group suites against that adapter. The harness should make setup requirements explicit so in-memory/mock adapters and real DB-backed adapters can share scenarios without sharing storage assumptions.

The harness should support:

- fresh adapter state per scenario,
- deterministic fixture creation,
- adapter capability/setup metadata for real database adapters,
- grouped test entrypoints so chained PRs can add coverage incrementally,
- clear failure messages that point to the contract requirement rather than the adapter internals.

### Method-group coverage

| Area | Coverage intent |
| --- | --- |
| Notifications | create, list by user, unread list/count, mark one read, mark all read, get by delivery ID, pagination and ordering. |
| Deliveries and idempotency | create, update, get by ID, list by user, idempotent create, lookup by idempotency key, reusable-status selection, non-reusable terminal status behavior. |
| Consent/suppression | append-only consent evidence, channel/purpose filters, suppression creation, purpose-specific/global suppression lookup precedence. |
| Audit logs | create, list by user, limit semantics, newest-first ordering, action lookup semantics used by erasure idempotency. |
| Compliance lifecycle/export | subject erasure anonymization, export shape for user-owned data, audit preservation, redaction markers. |
| Purge | delivery and audit-log retention deletion counts and older-than boundary semantics. |
| Scheduled lifecycle/cancellation | due claiming, limit handling, lease assignment, lease expiry reclaim, non-due exclusion, scheduled/claimed cancellation before erasure. |
| User lookup | default/override lookup behavior where adapters expose user email resolution through the contract. |

## Contract Decisions to Carry into Spec

These decisions should be treated as the proposed contract unless spec/design uncovers a stronger reason to adjust them.

| Ambiguity | Proposed decision |
| --- | --- |
| Default pagination | For paginated list methods, omitted `opts` means `offset = 0` and default `limit = 20`. Explicit `limit` and `offset` must be honored. Harness scenarios that need all rows should pass an explicit limit. |
| Ordering and tie-breaks | List and lookup methods that return newest records must sort by `createdAt` descending, then by `id` descending when timestamps tie. Delivery idempotency reuse should sort by `updatedAt` descending, then `createdAt` descending, then `id` descending. |
| `markRead` not-found semantics | `markRead(notificationId)` is idempotent: missing notification IDs are a no-op and must not throw. This matches the command-style return type and makes repeated UI actions safe. |
| `findSuppression` precedence | When `purpose` is provided, return the newest matching purpose-specific suppression first; if none exists, fall back to the newest global suppression for the same address hash/channel. When `purpose` is omitted, only global suppressions should match. Ties use newest timestamp, then ID. |
| Reusable status matrix for idempotency lookup | Reusable statuses are `pending`, `scheduled`, `claimed`, `dispatched`, `retrying`, and `accepted`. `failed`, `skipped`, and `redacted` are not reusable and allow a fresh delivery. Both `createDeliveryIdempotent` and `getDeliveryByIdempotencyKey` should follow the same selection matrix unless spec later removes or narrows the lookup method's reusable-status behavior. |
| `findAuditLogByAction` semantics | The method is an idempotency guard for compliance erasure and must return a deterministic existing record for `(userId, action)`: newest first, with ID tie-break. The adapter API does not require uniqueness enforcement at write time unless a later spec adds that requirement. |
| Purge boundary | `purgeExpiredDeliveries(olderThan)` and `purgeExpiredAuditLogs(olderThan)` delete records strictly older than `olderThan`; records exactly at the boundary remain. |
| Scheduled claiming | `claimScheduledBatch(before, workerId, limit, leaseMs)` claims due `scheduled` records with `scheduledFor <= before` plus `claimed` records with expired leases. It must exclude non-due records and non-expired claimed records, set claim metadata atomically where supported, and respect `limit`. |
| Scheduled cancellation | `cancelScheduledDeliveries(userId)` affects only that user's `scheduled` or `claimed` deliveries, sets status to `redacted`, and returns affected delivery IDs with their `queueJobId` values for queue cancellation. |

## Chained PR Strategy

The user selected `force-chained`; implementation should not collapse into a single PR even if early slices are small. Each PR should be a work unit with tests and any local documentation needed to understand that slice.

```text
tracker/base
└─ PR 1 📍 shared harness + notifications + deliveries/idempotency against mock adapter
   └─ PR 2 consent/suppression + audit log conformance
      └─ PR 3 compliance lifecycle + export + purge semantics
         └─ PR 4 scheduled claim/lease reclaim/cancel semantics
            └─ PR 5 official adapters through harness, Kysely first, Prisma/Drizzle after harness cost is known
```

| PR | Start state | End state | Scope | Out of scope |
| --- | --- | --- | --- | --- |
| 1 | No reusable harness. | Harness exists and runs notification + delivery/idempotency groups against `createMockDb()`. | Test harness structure, mock adapter fixtures, pagination/order/idempotency contract tests. | Consent, audit, lifecycle, scheduled, official adapters. |
| 2 | Harness covers first two groups. | Consent/suppression and audit-log groups run against `createMockDb()`. | Consent filters, suppression precedence, audit ordering/limit/action lookup. | Erasure/export/purge/scheduled/official adapters. |
| 3 | Compliance evidence and audit are covered. | Lifecycle/export/purge groups run against `createMockDb()`. | Erasure redaction, export completeness, retention deletion counts/boundaries. | Scheduled lease behavior and official adapters. |
| 4 | Mock lifecycle coverage exists except scheduled. | Scheduled claim, lease reclaim, and cancellation groups run against `createMockDb()`. | Due claim, expired lease reclaim, limit handling, queue job IDs, cancellation before erasure. | Official adapter enablement. |
| 5 | Full harness passes for mock adapter. | Official adapters are wired through the harness where feasible, starting with Kysely, then Prisma/Drizzle after cost is known. | Adapter-specific setup wrappers, documented skips/capabilities only where unavoidable. | Adding DB infra by default to normal unit tests; changing public API without new spec approval. |

Review budget target: keep each PR under 400 changed lines and reviewable in about 60 minutes. If an official-adapter slice exceeds budget, split PR 5 by adapter rather than requesting a size exception.

## Affected Areas

- `src/__tests__/helpers/mock-db-adapter.ts` as the first adapter under conformance.
- New shared test utilities under the existing test tree, exact path to be decided in design.
- Existing fragmented tests may remain until replacement is safe; later implementation can consolidate duplicate coverage only within the relevant PR slice.
- Official adapter test files for Kysely, Prisma, and Drizzle in the final chained phase.
- No production package exports or runtime entrypoints should change for the initial harness work.

## Migration and Compatibility Posture

Herald is pre-release and has no external compatibility burden. Correctness and explicit contract semantics should win over preserving draft behavior in the mock or official adapters.

For maintainers, this is primarily a test-contract change. If conformance exposes an adapter mismatch, the implementation phase should update that adapter to satisfy the accepted contract in the same PR slice that introduces the relevant conformance group.

## Risks

- The harness could accidentally encode current mock behavior instead of the intended adapter contract; the semantic decisions above are meant to prevent that.
- Scheduled lifecycle tests can be flaky if time, leases, and atomic claiming are not controlled carefully.
- Official adapter setup may exceed the review budget; split by adapter if needed.
- Some existing official adapters may fail newly explicit semantics, especially pagination defaults, `markRead` not-found behavior, suppression precedence, and tie-break ordering.
- Real DB transaction/locking guarantees may differ by adapter; the harness must distinguish contract requirements from backend setup limitations.

## Rollback

Each chained PR should be independently revertible:

- PR 1 rollback removes the harness and mock notification/delivery conformance tests.
- PRs 2–4 rollback only their added method-group suites and any mock fixes for those groups.
- PR 5 rollback removes official-adapter harness wiring and any adapter-specific conformance fixes from that slice.

Because the proposal does not require public API or schema changes, rollback should not require consumer migration steps.

## Success Criteria

- A reusable conformance harness exists and can run against `createMockDb()`.
- Every `HeraldDatabaseAdapter` method group has planned conformance coverage.
- Ambiguous semantics are captured as explicit contract requirements in spec/design.
- Implementation is sliced into the forced five-PR chain described above.
- No external DB infrastructure is required by default for the initial mock conformance slices.
- Official adapter conformance is deferred until the harness is stable, with Kysely first.

## Acceptance Criteria for Moving to Spec/Design

Proceed to spec/design when the team accepts that:

- the change solves the missing reusable conformance harness rather than adding another adapter-specific test file;
- the method-group scope covers the full `HeraldDatabaseAdapter` contract, including user lookup where applicable;
- the semantic decisions above are either accepted or explicitly revised in spec;
- the `force-chained` PR order is the delivery strategy for apply;
- public adapter API changes remain out of scope unless the spec/design phase proves they are necessary;
- the initial executable target is `createMockDb()` / mock DB, with official adapters reserved for later chained phases.
