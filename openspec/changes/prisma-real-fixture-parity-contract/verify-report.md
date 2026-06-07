# Verify Report: prisma-real-fixture-parity-contract

Date: 2026-06-06

## Status

Verified.

The Prisma 7 schema text/snippet work, Prisma real fixture parity work, and Prisma 7 real-target runtime migration are implemented in three focused commits:

- `3bb289b test: validate prisma schema snippet`
- `776a56f test: validate prisma real fixture parity`
- `586c2b1 test: migrate prisma real target to adapter`

## Scope Verified

### PR1 — Prisma schema snippet validation

Verified that Herald's CLI emits Prisma schema text as a snippet rather than a standalone schema, and that the snippet validates when wrapped with the Prisma 7 generator/datasource contract.

Evidence:

- `src/__tests__/unit/cli/prisma-schema-validation.test.ts`
- `src/__tests__/unit/cli/fixtures/prisma.schema.txt`
- `src/internal/db-schema/render-prisma.ts`
- `src/cli/index.ts`

### PR2 — Prisma real fixture parity

Verified that the real Prisma schema template is Prisma 7-valid and structurally compared against `HERALD_DB_SCHEMA`.

Evidence:

- `src/__tests__/helpers/database-adapter-real-targets/prisma-schema.template`
- `src/__tests__/helpers/database-adapter-real-targets/schema-parity/prisma-fixture.ts`
- `src/__tests__/unit/adapters-db/real-fixture-structural-parity.test.ts`

Key checks:

- `previewFeatures = ["partialIndexes"]` is present.
- `datasource db` declares provider only; no schema-file `url`.
- `schemas = ["__DATABASE_SCHEMA__"]` plus model `@@schema("__DATABASE_SCHEMA__")` are present for real-target schema isolation.
- Metadata-declared indexes are represented with stable `map` names.
- Partial scheduled-delivery index is represented with `where: { status: "scheduled" }`.
- Delivery `updatedAt` uses `@updatedAt`.
- `@db.Timestamptz(6)` remains as the accepted real-target exception.

### PR3 — Prisma 7 real-target runtime migration

Verified that the env-gated Prisma real conformance target no longer relies on removed Prisma 7 datasource URL override behavior.

Evidence:

- `package.json`
- `package-lock.json`
- `src/__tests__/helpers/database-adapter-real-targets/prisma-target.ts`

Key checks:

- `@prisma/adapter-pg` is dev-only and versioned as `^7.4.0`.
- Generated schema no longer replaces or requires `__DATABASE_URL__`.
- Generated schema replaces all `__DATABASE_SCHEMA__` placeholders before `prisma generate`.
- Runtime uses `new PrismaPg({ connectionString })` and `new PrismaClient({ adapter })`.
- Schema isolation is preserved both through explicit Prisma `@@schema` metadata for ORM queries and connection-string `search_path` options for raw SQL queries.
- No public Herald Prisma adapter API changed.

## Commands Run

```bash
npm run typecheck
```

Result: passed.

```bash
npm run lint
```

Result: passed with existing warnings only (`@typescript-eslint/no-explicit-any` warnings in existing adapter/type files).

```bash
npm run test
```

Result: passed — 56 test files, 359 tests.

```bash
npm run build
```

Result: passed.

```bash
npx prisma validate --schema src/__tests__/helpers/database-adapter-real-targets/prisma-schema.template
```

Result: passed.

```bash
npx vitest run \
  src/__tests__/unit/cli/cli.test.ts \
  src/__tests__/unit/cli/prisma-schema-validation.test.ts \
  src/__tests__/unit/adapters-db/real-fixture-structural-parity.test.ts \
  src/__tests__/conformance/adapters-db/prisma.real-conformance.test.ts
```

Result: passed — 4 test files, 36 tests. The Prisma real conformance test followed its env-gated skip path in this focused local command.

```bash
HERALD_DB_CONFORMANCE=1 \
HERALD_DB_CONFORMANCE_ADAPTERS=prisma \
npx vitest run src/__tests__/conformance/adapters-db/prisma.real-conformance.test.ts
```

Result: passed with `HERALD_DB_CONFORMANCE_URL` loaded from `.env` — 1 test file, 23 tests.

Note: this command emitted the existing `pg-connection-string` SSL-mode warning for the configured URL. The URL value was not printed.

Manual Prisma Client generation check from the URL-free template also passed with Prisma 7.8.0 when generated from inside the project using an absolute output path.

## Fresh Reviews

Fresh review was run after each implementation slice.

- PR1 review: approved; no code-level blockers.
- PR2 review: approved; no must-fix findings; review workload about 290 lines.
- PR3 review: approved with validation recommendation; no must-fix findings.

## Real-DB Discovery During Verify

The first real Prisma conformance run exposed a genuine Prisma 7 adapter isolation issue: connection-string `search_path` alone was not enough for Prisma ORM model queries. The tests read accumulated records from the default schema and scheduled raw queries did not align with ORM writes.

Fix:

- add datasource `schemas = ["__DATABASE_SCHEMA__"]` to the real Prisma template;
- add `@@schema("__DATABASE_SCHEMA__")` to each Herald model in the real Prisma template;
- replace every `__DATABASE_SCHEMA__` placeholder before generating the real conformance Prisma Client;
- keep connection-string `search_path` for raw SQL paths in the Prisma adapter.

The real conformance suite passed after this fix.

## Workspace State

At verification time, the only untracked path outside SDD scope was:

```text
tmp/
```

It was intentionally not staged or modified.

## Residual Risks

- Existing create-time cleanup behavior in the real target remains unchanged: if target creation fails after schema/pool setup but before the target is returned, normal `destroy()` cleanup is not reached. This was not introduced by this change and can be tracked separately if real-target robustness is tightened.
- The configured real DB URL emits a `pg-connection-string` warning about future SSL mode semantics. This is environment configuration, not Herald runtime behavior.

## Verdict

The SDD change is verified for local/unit/structural/build evidence and real Prisma/PostgreSQL conformance evidence. It is ready for sync/archive.
