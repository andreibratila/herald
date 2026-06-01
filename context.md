# Current Herald Context

## Completed architecture debt

- Config defaults/normalization are centralized in `src/core/runtime/config-defaults.ts` and covered by `src/core/runtime/config-defaults.test.ts`.
- `src/types/index.ts` is a compatibility barrel over focused domain type modules.
- Runtime send and processor flows are split into phase/helper modules.
- Scheduled-worker error-domain regression coverage exists.
- DB adapter conformance helpers and env-gated real adapter tests exist for Prisma, Drizzle, and Kysely.

## Current privacy contract

`safeFields` was replaced by `persistedFields`.

- `persistedFields` lists precise validated payload paths Herald may persist.
- In-app notification `data` is derived from those payload paths only.
- In-app templates render durable user-visible content (`title`, optional `body`, optional `href`) but do not choose arbitrary structured data to persist.
- `InAppTemplate.data` is not a normal public API surface.

Example:

```ts
persistedFields: ["order.id", "order.total"]
```

Given payload:

```ts
{ order: { id: "ord_123", total: 49 }, email: "user@example.com" }
```

Herald persists notification data as:

```ts
{ order: { id: "ord_123", total: 49 } }
```

## Next slices

See `audit/next-architecture-slices.md` and `audit/db-notification-schema-slice.md`.

Recommended next implementation slice after P0: extract CLI schema strings from `src/cli/index.ts` into focused modules without changing generated output.
