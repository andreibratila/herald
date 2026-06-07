# Real DB conformance tests

Herald's normal test suite does not require external services. Real database conformance tests are opt-in checks for contributors who want to validate the Prisma, Drizzle, and Kysely adapters against a live PostgreSQL-compatible database.

## Quick path

1. Add a local `.env` value. Do not commit it.

   ```dotenv
   HERALD_DB_CONFORMANCE_URL="postgres://user:password@host:5432/database?sslmode=verify-full"
   ```

2. Run one adapter.

   ```bash
   set -a
   source .env
   set +a

   HERALD_DB_CONFORMANCE=1 \
   HERALD_DB_CONFORMANCE_ADAPTERS=prisma \
   npx vitest run src/__tests__/conformance/adapters-db/prisma.real-conformance.test.ts
   ```

3. Expect the test to create and drop an isolated PostgreSQL schema for the run.

## Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `HERALD_DB_CONFORMANCE` | Yes | Set to `1` to enable real DB conformance. Without it, real tests skip. |
| `HERALD_DB_CONFORMANCE_URL` | Yes when enabled | PostgreSQL connection URL used by the real targets. Keep this in `.env` or your shell, never in Git. |
| `HERALD_DB_CONFORMANCE_ADAPTERS` | No | Comma-separated adapter filter: `prisma`, `drizzle`, `kysely`, or any combination such as `prisma,drizzle`. If omitted while enabled, all real adapter tests are eligible. |
| `HERALD_DB_CONFORMANCE_KEEP_SCHEMA` | No | Set to `1` to keep the generated schema after a run for debugging. Default behavior drops it. |

## Commands

Run all real adapter entrypoints in their default skip mode:

```bash
npx vitest run \
  src/__tests__/conformance/adapters-db/prisma.real-conformance.test.ts \
  src/__tests__/conformance/adapters-db/drizzle.real-conformance.test.ts \
  src/__tests__/conformance/adapters-db/kysely.real-conformance.test.ts
```

Run all selected adapters against a live DB:

```bash
set -a
source .env
set +a

HERALD_DB_CONFORMANCE=1 \
HERALD_DB_CONFORMANCE_ADAPTERS=prisma,drizzle,kysely \
npx vitest run src/__tests__/conformance/adapters-db
```

Keep the schema for debugging:

```bash
HERALD_DB_CONFORMANCE=1 \
HERALD_DB_CONFORMANCE_ADAPTERS=prisma \
HERALD_DB_CONFORMANCE_KEEP_SCHEMA=1 \
npx vitest run src/__tests__/conformance/adapters-db/prisma.real-conformance.test.ts
```

## Database behavior

Each real target:

1. connects to the configured PostgreSQL database;
2. creates a unique schema such as `herald_prisma_conformance_<id>`;
3. applies Herald's real schema fixture;
4. runs the shared adapter conformance scenarios;
5. drops the schema unless `HERALD_DB_CONFORMANCE_KEEP_SCHEMA=1` is set.

The configured database should be disposable or dedicated to testing. Herald does not create a database; it only creates schemas inside the database named by the URL.

## TLS and hosted Postgres

Use explicit TLS verification when your provider supports it:

```dotenv
HERALD_DB_CONFORMANCE_URL="postgres://user:password@host:5432/database?sslmode=verify-full"
```

Some hosted URLs use `sslmode=require`, `prefer`, or `verify-ca`. Current `pg` tooling may treat those similarly to `verify-full`, but future versions warn that semantics will change. Prefer `sslmode=verify-full` when possible so the test configuration keeps strict certificate verification.

## Secrets checklist

- Keep `.env` untracked.
- Do not paste real URLs into issues, PRs, docs, or test output.
- Use placeholders in examples.
- Use `HERALD_DB_CONFORMANCE_KEEP_SCHEMA=1` only for short-lived debugging, then drop the schema manually if needed.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Test says it is skipped | Confirm `HERALD_DB_CONFORMANCE=1` is set in the same shell command. |
| Enabled test fails fast without URL | Confirm `HERALD_DB_CONFORMANCE_URL` is loaded from `.env` or exported in the shell. |
| Adapter is skipped | Confirm `HERALD_DB_CONFORMANCE_ADAPTERS` includes that adapter name. |
| SSL warning appears | Prefer adding `sslmode=verify-full` to the test URL when your provider supports it. |
| Schema remains after a failed run | Drop schemas matching `herald_*_conformance_*`, or rerun without `HERALD_DB_CONFORMANCE_KEEP_SCHEMA=1`. |
