# Future Slice — Notification DB Schema Contract

## Goal

Define Herald's minimum notification DB contract while allowing users/adapters to map field names and add extra columns without making the core adapt to every table shape.

## Context

During the `persistedFields` privacy-contract discussion, we decided P0 should only control durable notification `data`: it must be derived from validated payload paths, not from template-produced `data`.

A separate concern remains: users bring their own DB shape. Herald should have a stable minimum contract for in-app notification records, and adapters should translate that contract to the user's schema.

Better Auth uses a similar pattern: core models define expected fields and metadata, adapters map operations to the actual DB, users can remap field names and add additional fields.

## Proposed Minimum Contract

Herald core should normalize in-app notifications to a stable internal shape similar to:

```ts
interface NotificationRecord {
  id: string;
  userId: string;
  deliveryId: string;
  title: string;
  body?: string | null;
  href?: string | null;
  data?: Record<string, unknown> | null;
  readAt?: Date | null;
  createdAt: Date;
}
```

`title` should remain required for an in-app notification. Optional fields should be explicitly optional/null-tolerant.

## Possible Extension API

Do not implement this during P0. For a future slice, consider schema metadata/config such as:

```ts
notifications: {
  fields: {
    title: "message",
    href: "url",
  },
  additionalFields: {
    icon: { type: "string", required: false },
    severity: { type: "string", required: false },
  },
}
```

Adapters would map Herald's stable input shape to DB-specific column names and optional custom columns.

## Non-goals for P0

- Do not add notification schema metadata now.
- Do not make `persistedFields` recipient/template-specific.
- Do not let in-app templates decide durable `data`.
- Do not change DB adapter contracts except where required by the `persistedFields` rename.

## Suggested Validation When Implemented

- DB adapter conformance for notification creation/read/update.
- CLI/schema generation tests if schema metadata affects generated output.
- Runtime processor tests for required `title`, optional `body`/`href`, and durable `data`.
