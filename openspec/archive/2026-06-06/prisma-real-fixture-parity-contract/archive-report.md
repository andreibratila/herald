# Archive Report: prisma-real-fixture-parity-contract

Date: 2026-06-06

## Status

Archived.

## Summary

Completed the Prisma real fixture parity contract and Prisma 7 real-target migration in three focused implementation slices plus verification and sync:

1. Prisma CLI snippet validation and Prisma >=7.4 dependency floor.
2. Prisma real fixture structural parity against `HERALD_DB_SCHEMA`.
3. Prisma 7 real conformance runtime migration to `@prisma/adapter-pg` with explicit schema isolation.

## Implementation Commits

- `3bb289b test: validate prisma schema snippet`
- `776a56f test: validate prisma real fixture parity`
- `fb8e862 test: migrate prisma real target to adapter`
- `d766031 docs: verify prisma fixture parity change`

## Synced Spec

- `openspec/specs/database-adapter/spec.md`

## Validation

Final verification passed:

- `npm run typecheck`
- `npm run lint` with existing warnings only
- `npm run test` — 56 files / 359 tests
- `npm run build`
- `npx prisma validate --schema src/__tests__/helpers/database-adapter-real-targets/prisma-schema.template`
- focused CLI/parity/env-gated skip suite — 4 files / 36 tests
- real Prisma conformance with `.env` `HERALD_DB_CONFORMANCE_URL` — 1 file / 23 tests

## Key Discovery

Real Prisma conformance showed that connection-string `search_path` alone does not isolate Prisma ORM model queries when using Prisma 7 with `@prisma/adapter-pg`. The final target needs both:

- Prisma schema metadata: datasource `schemas = ["__DATABASE_SCHEMA__"]` and per-model `@@schema("__DATABASE_SCHEMA__")`;
- connection-string `search_path` for raw SQL paths in the Prisma adapter.

## Residual Risks

No blocking residual risks.

Optional future work:

- Key the generated Prisma client cache by schema if multiple Prisma real targets are ever created in one process.
- Improve create-time cleanup for real targets if target creation fails before `destroy()` can run.
- Consider documenting `sslmode=verify-full` for real DB conformance URLs.
