# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Herald is not deployed and has no published version yet. There are no external users and no installed instances to maintain compatibility with. This is not an MVP — it is a complete, production-quality TypeScript library. Every architectural and API decision should be made for the long term, not for speed. Breaking changes are not a concern: implement the correct API from the start.

## Commands

```bash
npm run build        # tsup → dist/ (ESM + CJS + types)
npm run dev          # tsup --watch
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src
npm run test         # vitest run (single pass)
npm run test:watch   # vitest (watch mode)
```

Run a single test file:

```bash
npx vitest run src/path/to/file.test.ts
```

## Architecture

Herald is a TypeScript library (not a service) — zero external infra by default. Users bring their DB and mail provider; Herald handles everything else.

### Entrypoints

The package exposes multiple independent entrypoints (see `package.json` exports + `tsup.config.ts`):

| Import                       | Source                            | Status                                  |
| ---------------------------- | --------------------------------- | --------------------------------------- |
| `herald`                     | `src/index.ts`                    | Implemented                             |
| `herald/adapters/prisma`     | `src/adapters/db/prisma.ts`       | Implemented                             |
| `herald/adapters/drizzle`    | `src/adapters/db/drizzle.ts`      | Implemented                             |
| `herald/adapters/kysely`     | `src/adapters/db/kysely.ts`       | Implemented; PostgreSQL SQL assumptions |
| `herald/adapters/resend`     | `src/adapters/mail/resend.ts`     | Implemented                             |
| `herald/adapters/nodemailer` | `src/adapters/mail/nodemailer.ts` | Implemented                             |
| `herald/adapters/postmark`   | `src/adapters/mail/postmark.ts`   | Implemented; uses `fetch`, no SDK peer  |
| `herald/adapters/sendgrid`   | `src/adapters/mail/sendgrid.ts`   | Implemented                             |

All peer deps (`drizzle-orm`, `kysely`, `pg-boss`, mail SDKs) are external to the bundle — never bundled in.

### Core data flow

```
configureHerald({ channels, compliance })
         ↓  returns HeraldApp with an app-scoped defineEvent()
heraldApp.defineEvent("name", { schema, safeFields, templates, dispatch, compliance })
         ↓  returns branded EventRef (pure factory, no global side effects)
heraldApp.create({ events: { eventKey: ref }, db, queue, hooks })
         ↓  builds per-instance registries and generated event methods
herald.events.eventKey(payload, options)
  1. Validate payload and dispatch result for configured channels/templates
  2. Route to the internal runtime pipeline by stable event name
  3. Evaluate compliance per recipient/channel/purpose/legal basis
  4. Scope idempotency per userId + channel + template
  5. db.createDelivery() with safe snapshots/legal evidence, not the full payload
  6. queue.enqueue({ deliveryId, payload })  ← full payload travels here
         ↓
processDelivery(job)
  - renders template with full payload  → SHA-256 stored as Delivery.renderedHash for email
  - sends email via mail adapter
  - creates in-app notification records
  - updates delivery status + audit log
```

### Key design invariants

**Configured API is the public path.** Root `herald` exports `configureHerald`; normal application code defines events through the configured app and sends through generated `herald.events.*` methods. Low-level runtime factories are implementation/test primitives and must not appear in user-facing guidance.

**Payload PII does not persist by default.** Only fields listed in `safeFields` are stored in delivery snapshots and in-app `data`. The full payload travels through the queue job in memory (or pg-boss's own table, which auto-cleans). Current caveat: rendered in-app `title`, `body`, and `href` are persisted notification fields, so templates must treat them as durable user-visible content until the privacy model is hardened.

**`dispatch()` must be pure and synchronous.** No async work inside. Resolve all DB data (admin IDs, user emails, etc.) before calling generated `herald.events.*` methods.

**Per-instance registries.** `heraldApp.defineEvent()` is a pure factory — no global side effects. The registry lives inside `heraldApp.create()`, built from the `events` object map at construction time. Duplicate stable event names throw at construction, not at module load. Tests create a new runtime instance per test case; there is no `_clearRegistries()` and no global state to reset.

**Idempotency key scoping.** The key passed to a generated event method is internally scoped to `${key}:${userId}:${channel}:${template}` — safe for fan-out (same event to multiple recipients).

**Auto-start.** Generated event methods call the internal runtime `start()` implicitly on first use — no need to call it manually unless using the db queue worker separately.

### Compliance lifecycle

- Events declare compliance with `purpose` and `legalBasis`.
- Consent-based events require append-only `ConsentEvent` evidence.
- Suppressions are channel/purpose scoped by app-supplied `addressHash`.
- `herald.compliance.eraseSubject()` anonymizes records with `[redacted]` markers — rows are never deleted to preserve audit trail integrity.
- The erasure audit log entry stores a SHA-256 hash of the subject ID for cross-reference.

### Queue drivers

- **`sync`** (default) — processes deliveries in-band within the same request
- **`db`** (pg-boss) — async, PostgreSQL-only; pg-boss is a lazy dynamic import and must be installed separately
- **`adapter`** — public custom queue adapter contract via `HeraldQueueAdapter`; adapters declare `durable`, `delayedJobs`, `cancellation`, `nativeRetries`, and optional `concurrency` capabilities

### React and realtime status

Herald currently does **not** export `herald/react` or a built-in `createSSEHandler`. The supported current position is docs-only recipes under `docs/examples/` for polling, TanStack Query, Postgres LISTEN/NOTIFY, and Redis pub/sub. If a package-level React hook or SSE helper is added later, it needs a separate OpenSpec change covering transport contracts, auth/user resolution, peer dependency policy, and tests.

### Source layout

All authoritative source lives in `src/`. Root-level TypeScript files are config files only (`tsup.config.ts`, `vitest.config.ts`); there are no active root-level draft API copies.

### CLI (`npx herald generate`)

Outputs DB schema snippets to stdout. Supports `--adapter prisma|drizzle|kysely`. No side effects — safe to pipe or redirect.

### Implementing a custom DB adapter

Implement the `HeraldDatabaseAdapter` interface from `herald` (method groups covering notifications, deliveries, consent events, suppressions, audit logs, compliance lifecycle, and scheduled delivery lifecycle). See `src/types/index.ts` for the full contract.

### Implementing a custom mail adapter

Implement `HeraldMailAdapter` — one method: `send(input: SendEmailInput): Promise<SendEmailResult>`.
