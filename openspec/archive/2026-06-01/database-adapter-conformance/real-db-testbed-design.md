# Design Addendum: reusable real DB adapter conformance testbed

Yes: one reusable real DB-backed conformance testbed should serve Kysely, Prisma, and Drizzle. The shared layer should own PostgreSQL lifecycle, schema isolation, schema setup/cleanup, deterministic timestamp patch helpers, env gating, and the conformance target contract. Each official adapter should own only its client construction, schema artifact generation/imports, adapter factory call, and any ORM-specific disposal.

## Decision summary

| Topic | Decision |
| --- | --- |
| Reusability | Build one shared Postgres testbed with adapter-specific target factories for Kysely, Prisma, and Drizzle. |
| Default test behavior | `npm test` remains external-infra-free; real DB conformance is skipped unless explicitly requested. |
| Required DB opt-in | Use `HERALD_DB_CONFORMANCE_URL` as the shared Postgres connection URL. |
| Missing URL behavior | Default suite skips real DB targets; explicit real-conformance command fails fast if URL/setup is missing. |
| Testcontainers | Do **not** add `testcontainers` now. Add only later behind a separate design/task if maintainers want automatic local containers. |
| Schema lifecycle | Create an isolated PostgreSQL schema per Vitest worker/run, set `search_path`, truncate between scenarios, drop schema at teardown. |
| Schema source | Start from a shared hand-maintained SQL fixture derived from the Kysely generated SQL; later add a generator parity check rather than shelling through CLI per test. |
| Cleanup | Prefer `TRUNCATE ... RESTART IDENTITY CASCADE` between scenarios inside the isolated schema; do not rely on long-lived transaction rollback. |
| User lookup | Always pass `getUserEmail` override backed by an in-memory `Map`; do not require app-specific user tables. |
| Skips | Infrastructure-only skips are allowed; semantic skips are forbidden. |

## Shared vs adapter-specific responsibilities

| Layer | Shared responsibilities | Adapter-specific responsibilities |
| --- | --- | --- |
| Real DB testbed | Parse env, fail-fast policy, create/drop schema, set `search_path`, apply Herald tables, truncate, timestamp patch helpers, optional user-email map, shared command docs. | None. |
| Conformance harness bridge | Convert a real DB target into `DatabaseAdapterConformanceTarget`, including helper hooks for timestamps and hashed subject lookup. | None except passing the adapter factory. |
| Kysely target | None. | Create `pg` pool + Kysely Postgres dialect, apply `search_path`, call `createKyselyAdapter(db, { getUserEmail })`, destroy Kysely/pool. |
| Prisma target | None. | Provide a test Prisma schema/client, run/generate client explicitly, connect with schema-scoped URL or search path, call `createPrismaAdapter(prisma, { getUserEmail })`, disconnect. |
| Drizzle target | None. | Create `pg` pool + `drizzle-orm/node-postgres` db, import test table definitions, call `createDrizzleAdapter(db, tables, { getUserEmail })`, close pool. |

## Infrastructure approach

Use a shared env-gated Postgres URL first:

```bash
HERALD_DB_CONFORMANCE_URL=postgres://postgres:postgres@localhost:5432/herald_test \
HERALD_DB_CONFORMANCE=1 \
npx vitest run src/adapters/db/*.real-conformance.test.ts
```

Recommended env variables:

| Variable | Purpose |
| --- | --- |
| `HERALD_DB_CONFORMANCE=1` | Explicitly request real DB-backed official adapter conformance. |
| `HERALD_DB_CONFORMANCE_URL` | Shared PostgreSQL URL used by all official adapter targets. |
| `HERALD_DB_CONFORMANCE_ADAPTERS=kysely,prisma,drizzle` | Optional adapter filter for local runs. If omitted in explicit mode, run all real target files selected by the command. |
| `HERALD_DB_CONFORMANCE_KEEP_SCHEMA=1` | Optional debug mode to preserve the isolated schema after failure. Default drops it. |

Default `npm test` should not require Postgres, `pg`, Prisma engines, Docker, or Testcontainers. Real conformance files should be discovered safely but guarded so they either skip in normal mode or throw a targeted error in explicit mode when `HERALD_DB_CONFORMANCE_URL` is absent.

Do not add `testcontainers` as a dev dependency now. It would add Docker assumptions and dependency weight before one env-gated target proves the shared lifecycle. If desired later, add a second provider mode such as `HERALD_DB_CONFORMANCE_PROVIDER=testcontainers`, but keep URL mode as the stable CI-friendly contract.

## Proposed file layout

```text
src/__tests__/helpers/database-adapter-real-targets/
├─ env.ts                         # env parsing, explicit-mode fail-fast helpers
├─ postgres-testbed.ts            # schema create/drop, search_path, truncate, SQL execution
├─ herald-schema.sql              # test SQL fixture derived from generated Kysely SQL
├─ target.ts                      # shared bridge to DatabaseAdapterConformanceTarget
├─ user-email-store.ts            # Map-backed getUserEmail helper
├─ helpers.ts                     # timestamp patch helpers and hashSubjectId
├─ kysely-target.ts               # create/destroy Kysely target
├─ prisma/
│  ├─ schema.prisma               # conformance-only Prisma schema, no user model required
│  └─ prisma-target.ts            # dynamic generated-client import + adapter factory
└─ drizzle/
   ├─ schema.ts                   # conformance-only Drizzle table definitions
   └─ drizzle-target.ts           # Drizzle client + adapter factory

src/adapters/db/
├─ kysely.real-conformance.test.ts
├─ prisma.real-conformance.test.ts
└─ drizzle.real-conformance.test.ts
```

Keep the shared testbed under `src/__tests__/helpers/` so it remains test-only and adapter-agnostic. Keep adapter entry tests under `src/adapters/db/` so failures point maintainers to the official adapter under test.

## Schema lifecycle strategy

1. On explicit real-conformance startup, connect to `HERALD_DB_CONFORMANCE_URL` with a lightweight admin client.
2. Create a schema named with process/worker entropy, for example `herald_conformance_${process.pid}_${VITEST_POOL_ID}_${random}`.
3. For each adapter target connection, ensure queries resolve Herald tables in that schema:
   - Kysely/Drizzle: configure connection/session `search_path` before adapter operations.
   - Prisma: prefer URL query `?schema=<schemaName>` for PostgreSQL or execute `SET search_path` on connect if reliable for the generated client.
4. Apply the shared `herald-schema.sql` inside the isolated schema.
5. Before each scenario, truncate all Herald tables with `RESTART IDENTITY CASCADE`; after each scenario, optionally truncate again as defensive cleanup.
6. After all scenarios, drop the isolated schema unless `HERALD_DB_CONFORMANCE_KEEP_SCHEMA=1` is set.

Use schema-per-run/worker rather than schema-per-test to keep tests fast. Use TRUNCATE rather than transaction rollback because the adapter contract includes transactions, raw SQL, and ORM-specific connection usage that can fight with an outer test transaction. Isolated schemas plus per-scenario truncation are safe for parallel Vitest workers and easier to debug.

The first implementation should use a checked-in SQL fixture derived from `npx herald generate --adapter kysely`. This avoids invoking the CLI or parsing generated text during every test. Add a later parity test that compares important table/column/index presence against CLI output if drift becomes a concern.

## Adapter-specific target wrappers

### Kysely

- Add `pg` as a dev dependency in the Kysely real-target slice if not already available.
- Construct a `pg.Pool` from `HERALD_DB_CONFORMANCE_URL`.
- Ensure `search_path` is set for every connection used by the pool. Preferred options are a connection `options=-c search_path=<schema>` parameter or a pool connect hook; validate with a smoke query.
- Construct `new Kysely<HeraldDatabase>({ dialect: new PostgresDialect({ pool }) })`.
- Call `createKyselyAdapter(db, { getUserEmail: userEmailStore.get })`.
- Provide helper SQL updates for exact timestamps.
- Destroy with `db.destroy()` and pool shutdown.

### Prisma

Prisma needs the most setup and should remain a separate chained slice:

- Add `prisma` and `@prisma/client` dev dependencies only in the Prisma slice.
- Add a conformance-only `schema.prisma` containing only Herald models; do not add a user model.
- Configure datasource from `HERALD_DB_CONFORMANCE_URL` and generate a client through an explicit setup command, not default `npm test`.
- Prefer `prisma db push --schema src/__tests__/helpers/database-adapter-real-targets/prisma/schema.prisma` into the isolated schema, or keep using the shared SQL fixture if the generated client mapping exactly matches the physical tables.
- Import the generated client dynamically inside the env-gated target so normal typecheck/test runs are not blocked by an absent generated client.
- Call `createPrismaAdapter(prisma, { getUserEmail: userEmailStore.get })`.
- Disconnect with `prisma.$disconnect()`.

Open implementation detail: if dynamic generated-client import becomes too brittle for TypeScript/lint, use a committed minimal Prisma schema plus documented `npm run test:db:prisma:setup` command that generates into an ignored path before running the real target.

### Drizzle

- Add `pg` as a dev dependency when Kysely real target lands; Drizzle can reuse it.
- Use `drizzle-orm/node-postgres` with a `pg.Pool` scoped to the isolated schema.
- Add conformance-only Drizzle table definitions that match the adapter's expected camelCase columns and generated snippet shape.
- Call `createDrizzleAdapter(db, tables, { getUserEmail: userEmailStore.get })`.
- Provide timestamp patch helpers with raw SQL against the shared table names.
- Close the pool after tests.

## User lookup without user tables

All official adapter real targets should pass a `getUserEmail` override backed by a shared in-memory `Map<string, string | null>`:

```ts
const users = createUserEmailStore();
const adapter = createKyselyAdapter(db, { getUserEmail: users.getUserEmail });
```

The conformance target should expose a helper such as `seedUserEmail(userId, email)` once the user lookup group is wired. This satisfies the normative `getUserEmail` contract without requiring Prisma `User`, Drizzle app tables, or Kysely app-specific schemas. It also verifies the official adapter option path, which is the supported public extension point for app user lookup.

## Capability and skip policy

Allowed skips:

- Real DB target skipped in default mode because explicit env is absent.
- An adapter target skipped by `HERALD_DB_CONFORMANCE_ADAPTERS` filter.
- A Prisma target fail-fast when its generated conformance client has not been generated by the documented setup command.
- Temporary infrastructure inability with a TODO and issue reference, for example unsupported local Postgres version.

Forbidden skips:

- Pagination defaults.
- Ordering tie-breaks.
- Idempotency reusable-status matrix.
- `markRead` missing-id no-op.
- Suppression precedence.
- Audit newest-first/action lookup semantics.
- Strict purge boundaries.
- Scheduled claim/reclaim/cancel semantics.
- `getUserEmail` when an override is provided.

If an official adapter fails a semantic conformance test, fix the adapter in that same adapter slice or leave the slice red/unmerged; do not mark the semantic case skipped.

## Commands

Default command remains unchanged and infra-free:

```bash
npm test
```

Shared explicit command should fail fast when URL/setup is invalid:

```bash
HERALD_DB_CONFORMANCE=1 \
HERALD_DB_CONFORMANCE_URL=postgres://postgres:postgres@localhost:5432/herald_test \
npx vitest run src/adapters/db/*.real-conformance.test.ts
```

Adapter-specific local commands:

```bash
HERALD_DB_CONFORMANCE=1 HERALD_DB_CONFORMANCE_ADAPTERS=kysely \
HERALD_DB_CONFORMANCE_URL=postgres://postgres:postgres@localhost:5432/herald_test \
npx vitest run src/adapters/db/kysely.real-conformance.test.ts

HERALD_DB_CONFORMANCE=1 HERALD_DB_CONFORMANCE_ADAPTERS=prisma \
HERALD_DB_CONFORMANCE_URL=postgres://postgres:postgres@localhost:5432/herald_test \
npx vitest run src/adapters/db/prisma.real-conformance.test.ts

HERALD_DB_CONFORMANCE=1 HERALD_DB_CONFORMANCE_ADAPTERS=drizzle \
HERALD_DB_CONFORMANCE_URL=postgres://postgres:postgres@localhost:5432/herald_test \
npx vitest run src/adapters/db/drizzle.real-conformance.test.ts
```

If package scripts are added, prefer:

```json
{
  "test:db:conformance": "HERALD_DB_CONFORMANCE=1 vitest run src/adapters/db/*.real-conformance.test.ts",
  "test:db:conformance:kysely": "HERALD_DB_CONFORMANCE=1 HERALD_DB_CONFORMANCE_ADAPTERS=kysely vitest run src/adapters/db/kysely.real-conformance.test.ts"
}
```

Document that callers still must provide `HERALD_DB_CONFORMANCE_URL`; scripts should not embed credentials.

## Chained implementation plan under 400 changed lines

Use the existing force-chained strategy and replace repeated fail-closed guards with a shared base slice before individual adapters:

```text
PR 5A-real-base 📍 shared env-gated Postgres testbed, no official adapter yet
   └─ PR 5B-kysely real Kysely target through full harness
      └─ PR 5C-prisma real Prisma target through full harness
         └─ PR 5D-drizzle real Drizzle target through full harness
```

| Slice | Scope | Expected budget | Validation |
| --- | --- | --- | --- |
| PR 5A-real-base | `database-adapter-real-targets/` env parser, Postgres schema lifecycle, SQL fixture, target bridge, docs/tasks update. No adapter target execution. | 250-380 lines | `npm test`, `npm run typecheck`, `npm run lint`; optional smoke helper with URL if available. |
| PR 5B-kysely | Add `pg` dev dep if needed, Kysely target factory, `kysely.real-conformance.test.ts`, remove/replace Kysely fail-closed placeholder. Fix Kysely semantic failures exposed by full harness. | 250-400 lines; split if adapter fixes are large. | default targeted tests plus explicit Kysely real command. |
| PR 5C-prisma | Add Prisma dev deps/setup docs, conformance Prisma schema/client handling, `prisma.real-conformance.test.ts`, Prisma semantic fixes. | High risk; split setup and semantic fixes if over 400. | default tests plus explicit Prisma setup/run command. |
| PR 5D-drizzle | Add Drizzle schema definitions, target factory, `drizzle.real-conformance.test.ts`, Drizzle semantic fixes. | 250-400 lines. | default tests plus explicit Drizzle real command. |

Keep tests/docs with the work unit they verify. If any adapter slice discovers many semantic mismatches, split into `target wiring` followed by `adapter conformance fixes` rather than exceeding the review budget.

## Known risks and likely findings

- Current Kysely/Prisma/Drizzle `getDeliveryByIdempotencyKey` implementations appear to fall back to terminal records after checking reusable records, while the accepted spec says terminal-only should return `null`. Real conformance will likely require official adapter fixes.
- Current official adapter ordering often lacks `id` tie-breaks on notification/delivery/audit lists and suppression lookup; real DB tests will expose this more reliably than SQL-shape mocks.
- Kysely scheduled claiming raw SQL orders only by `scheduled_at ASC`; the spec requires due time ascending then ID descending.
- Prisma is dependency/setup heavy; keep it behind its own slice and dynamic/env-gated import path.
- Maintaining both generated CLI snippets and a checked-in SQL fixture can drift. Mitigate with a later parity check, but do not block the first reusable testbed on generator refactoring.
- Per-run schemas require careful connection `search_path` handling, especially with pools. Add a smoke assertion that `current_schema()` equals the isolated schema before running conformance.

## Recommendation

Proceed with the shared env-gated Postgres testbed first, without Testcontainers. Start with Kysely as the first real target because it is closest to raw SQL and has the clearest schema mapping. Then add Prisma and Drizzle as separate chained slices. Keep default test runs infra-free, use one shared `HERALD_DB_CONFORMANCE_URL`, and treat all semantic conformance failures as adapter bugs rather than skips.
