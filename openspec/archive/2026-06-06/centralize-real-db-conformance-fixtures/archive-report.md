# Archive Report: centralize-real-db-conformance-fixtures

## Status

Archived after implementation, verification, canonical spec sync, and local chained PR branch preparation.

## Summary

This change prevents real SQL and Drizzle database conformance fixtures from silently diverging from Herald's authoritative database schema metadata (`HERALD_DB_SCHEMA`).

Implemented behavior:

- Added DB-free structural parity validation for real SQL and Drizzle fixtures.
- Normalized `HERALD_DB_SCHEMA`, SQL fixture source, and Drizzle fixture source into a shared test-only model.
- Added diagnostics for missing/extra tables, columns, indexes, wrong table/index association, wrong index field order, and simple partial predicate drift.
- Fixed known fixture drift from `herald_delivery_status_claim_exp_idx` to `herald_delivery_status_claim_expires_idx` in SQL and Drizzle fixtures.
- Synced the verified requirement into `openspec/specs/database-adapter/spec.md`.

Deferred scope:

- Prisma fixture parity.
- Fixture generation.
- CLI output parity.
- Live DB/Docker/migration-based validation.
- Full type/nullability/default/primary-key parity.
- General SQL or TypeScript parsing.

## Commits

| Commit | Slice | Summary |
| --- | --- | --- |
| `4e88840` | PR1a | `test: add real fixture parity comparator` |
| `a0742cb` | PR1b | `test: validate sql real fixture parity` |
| `fd08282` | PR2 | `test: validate drizzle real fixture parity` |
| `bb5ab58` | PR3 | `test: cover fixture parity diagnostics` |
| `b9834f3` | Sync | `docs: specify real fixture parity` |

## Local PR Branches Prepared

| Branch | Commit | Intended target |
| --- | --- | --- |
| `refactor/generated-schema-metadata` | `73e616b` | prerequisite base branch for prior metadata-renderer commits |
| `test/real-fixture-parity-comparator` | `4e88840` | `refactor/generated-schema-metadata` |
| `test/sql-real-fixture-parity` | `a0742cb` | `test/real-fixture-parity-comparator` |
| `test/drizzle-real-fixture-parity` | `fd08282` | `test/sql-real-fixture-parity` |
| `test/fixture-parity-diagnostics` | `bb5ab58` | `test/drizzle-real-fixture-parity` |
| `docs/real-fixture-parity-spec` | `b9834f3` | `test/fixture-parity-diagnostics` |

Real GitHub PRs were not opened in this session because:

- `gh` is not installed in the environment.
- The PR workflow requires a linked issue with `status:approved`; no issue number was available to verify.

## Verification

Final verification passed:

```bash
npx vitest run src/__tests__/unit/adapters-db/real-fixture-structural-parity.test.ts
npm run typecheck
npm run lint
npm run test
```

Results:

- Focused parity test: 1 file / 7 tests passed.
- Typecheck: passed.
- Lint: passed with existing warnings.
- Full test suite: 55 files / 355 tests passed.
- Fresh SDD verify review: PASS, no blockers.
- Sync review: PASS, no blockers.

## Review Workload

Each review slice stayed under the 400-line budget:

- `4e88840`: 378 insertions.
- `a0742cb`: 162 changed lines.
- `fd08282`: 331 changed lines.
- `bb5ab58`: 108 changed lines.
- `b9834f3`: 51 insertions.

## Residual Risks

- SQL and Drizzle scanners are intentionally narrow and fixture-shape-specific.
- Future fixture syntax changes may require updating the test scanners.
- Prisma fixture parity remains intentionally deferred.
- The local branch chain depends on prerequisite local commits through `73e616b`; PR targets must account for that prerequisite branch or an already-open predecessor chain.

## Relevant Files

- `openspec/specs/database-adapter/spec.md` — canonical requirement after sync.
- `src/__tests__/helpers/database-adapter-real-targets/schema-parity/types.ts` — normalized parity model.
- `src/__tests__/helpers/database-adapter-real-targets/schema-parity/metadata.ts` — metadata normalization.
- `src/__tests__/helpers/database-adapter-real-targets/schema-parity/compare.ts` — structural comparator and diagnostics.
- `src/__tests__/helpers/database-adapter-real-targets/schema-parity/sql-fixture.ts` — SQL fixture scanner.
- `src/__tests__/helpers/database-adapter-real-targets/schema-parity/drizzle-fixture.ts` — Drizzle fixture scanner.
- `src/__tests__/unit/adapters-db/real-fixture-structural-parity.test.ts` — parity and diagnostics coverage.
- `src/__tests__/helpers/database-adapter-real-targets/herald-schema.sql` — SQL fixture index fix.
- `src/__tests__/helpers/database-adapter-real-targets/drizzle-schema.ts` — Drizzle fixture index fix.
