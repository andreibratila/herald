# Sync Report: prisma-real-fixture-parity-contract

Date: 2026-06-06

## Status

Synced.

## Spec Updated

Updated canonical spec:

- `openspec/specs/database-adapter/spec.md`

## Synced Requirements

### Real DB Fixture Structural Parity

The canonical fixture parity requirement now includes the Prisma real fixture template alongside SQL and Drizzle:

- `src/__tests__/helpers/database-adapter-real-targets/herald-schema.sql`
- `src/__tests__/helpers/database-adapter-real-targets/drizzle-schema.ts`
- `src/__tests__/helpers/database-adapter-real-targets/prisma-schema.template`

The spec now records that Prisma fixture validation uses narrow fixture-style parsing for:

- model blocks;
- field `@map` column names;
- model `@@map` table names;
- mapped `@@index` declarations;
- simple equality partial-index predicates;
- datasource `schemas`;
- model `@@schema` declarations.

It also records the Prisma >=7.4 template contract:

- `previewFeatures = ["partialIndexes"]`;
- no schema-file datasource `url`;
- explicit schema placeholders for real-target generation;
- delivery `updatedAt` uses `@updatedAt`;
- `@db.Timestamptz(6)` remains accepted for the real target.

### Prisma Real Target Schema Isolation

Added a canonical requirement that the Prisma real database conformance target must isolate both ORM model queries and raw SQL paths to the per-test PostgreSQL schema.

The spec now records:

- generated Prisma schema includes datasource `schemas` for the isolated schema;
- each Herald model uses `@@schema` for the isolated schema;
- runtime uses `@prisma/adapter-pg` rather than datasource URL overrides;
- connection string sets `search_path` for raw SQL query paths;
- ORM and raw SQL queries operate against the same isolated schema.

## Evidence

Verification report:

- `openspec/changes/prisma-real-fixture-parity-contract/verify-report.md`

Implementation commits:

- `3bb289b test: validate prisma schema snippet`
- `776a56f test: validate prisma real fixture parity`
- `fb8e862 test: migrate prisma real target to adapter`
- `d766031 docs: verify prisma fixture parity change`

## Residual Follow-up

No required follow-up for this SDD change.

Optional future hardening:

- Key the generated Prisma client module cache by schema if future tests instantiate multiple Prisma real targets with different schemas in the same process.
- Tighten real-target create-time cleanup if failures occur after schema/pool setup but before target creation returns.
- Consider documenting recommended `sslmode=verify-full` for real DB test URLs to silence future `pg-connection-string` SSL mode warning.
