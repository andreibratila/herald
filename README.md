# Herald

> Embedded notification engine for TypeScript apps.  
> DB-first · Headless · Compliance primitives · Zero framework opinions.

Herald is a TypeScript library for product notifications. You bring your database and delivery providers; Herald handles event dispatch, delivery tracking, in-app inbox records, idempotency, scheduling, compliance evidence, suppressions, and audit logs.

Herald provides technical compliance primitives and audit evidence. It is not legal advice, and it does not decide whether your business has a valid legal basis in every jurisdiction. You configure purposes, legal bases, consent evidence, suppressions, and retention according to your own legal requirements.

---

## Install

```bash
npm install herald
```

Optional — install only what you use:

```bash
npm install zod             # If you use Zod schemas in your event definitions
npm install resend          # Resend mail adapter
npm install nodemailer      # SMTP mail adapter
npm install @sendgrid/mail  # SendGrid mail adapter
npm install pg-boss         # Async DB queue (PostgreSQL only)
```

Herald accepts any schema object with a `parse(input)` method. Zod is used in the examples and tests, but it is not bundled or required at runtime unless your app chooses it.

---

## Quick start

### 1. Generate and apply the DB schema

```bash
# Prisma
# Requires Prisma's partialIndexes preview feature.
# Herald intentionally emits @@index(..., where: { status: "scheduled" })
# using Prisma's documented partial-index support.
npx herald generate --adapter prisma >> prisma/schema.prisma
npx prisma migrate dev

# Drizzle
npx herald generate --adapter drizzle >> src/db/herald.schema.ts

# Kysely (raw SQL)
npx herald generate --adapter kysely > migrations/herald_init.sql
```

### 2. Configure your Herald app

Configure channels once, then export the app-scoped `defineEvent`. Event files import this scoped function so templates and dispatch are limited to the channels you configured.

```ts
// lib/herald-app.ts
import { configureHerald } from "herald";
import { createResendAdapter } from "herald/adapters/resend";

export const heraldApp = configureHerald({
  channels: {
    email: {
      // Prefer a lazy adapter factory so importing event files does not eagerly
      // touch provider SDKs or environment variables.
      adapter: () => createResendAdapter(process.env.RESEND_API_KEY!),
      defaultFrom: "hello@yourapp.com",
    },
    inApp: true,
  },

  compliance: {
    // Custom legal bases extend/override Herald's built-ins by default.
    // Set replaceDefaultLegalBases: true only if you want a closed registry.
    legalBases: {
      partner_agreement: {
        label: "Partner agreement",
        requiresConsentEvent: false,
        requiresSuppressionCheck: false,
        requiresEvidence: true,
        defaultDecision: "deny_without_evidence",
        minimumRequirements: { evidence: true },
      },
    },
  },
});

export const defineEvent = heraldApp.defineEvent;
```

### 3. Define events and templates

Templates are colocated inside `defineEvent`. The object key passed later to `heraldApp.create({ events })` becomes the generated method name; the string passed to `defineEvent("order.completed", ...)` remains the stable storage/audit identity.

```ts
// lib/events/order.ts
import { defineEvent } from "@/lib/herald-app";
import { z } from "zod";

export const orderCompleted = defineEvent("order.completed", {
  schema: z.object({
    orderId: z.string(),
    amount: z.number(),
    userId: z.string(),
    adminIds: z.array(z.string()),
  }),
  safeFields: ["orderId", "amount"], // only these are persisted, no payload PII

  compliance: {
    purpose: "transactional.order_update",
    legalBasis: "contract",
    required: true,
  },

  templates: {
    "order-user": {
      email: (p) => ({
        subject: `Order #${p.orderId} confirmed`,
        html: `<p>Your order for $${p.amount} has been confirmed.</p>`,
      }),
      inApp: (p) => ({
        title: "Order confirmed",
        body: `#${p.orderId} — $${p.amount}`,
        href: `/orders/${p.orderId}`,
      }),
    },
    "order-admin": {
      email: (p) => ({
        subject: `New order #${p.orderId} — $${p.amount}`,
        html: "<p>New order received.</p>",
      }),
    },
  },

  dispatch: (payload) => [
    {
      to: payload.userId,
      channels: ["email", "inApp"],
      template: "order-user",
    },
    ...payload.adminIds.map((id) => ({
      to: id,
      channels: ["email"],
      template: "order-admin",
    })),
  ],
});
```

Marketing or commercial messages use consent evidence and suppressions:

```ts
export const newsletterWeekly = defineEvent("newsletter.weekly", {
  schema: z.object({
    userId: z.string(),
    campaignId: z.string(),
    subject: z.string(),
    html: z.string(),
    addressHash: z.string(),
  }),
  safeFields: ["campaignId"],

  compliance: {
    purpose: "marketing.newsletter",
    legalBasis: "consent",
  },

  templates: {
    "newsletter-main": {
      email: (p) => ({ subject: p.subject, html: p.html }),
    },
  },

  dispatch: (payload) => [
    {
      to: payload.userId,
      channels: ["email"],
      template: "newsletter-main",
      // App-supplied hashed/canonical address for suppression lookup.
      addressHash: payload.addressHash,
    },
  ],
});
```

Campaign management is intentionally out of scope for Herald. Use app-owned safe metadata such as `campaignId` to distinguish concrete sends.

### 4. Create the runtime instance

```ts
// lib/herald.ts
import { createPrismaAdapter } from "herald/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { heraldApp } from "@/lib/herald-app";
import { orderCompleted, newsletterWeekly } from "@/lib/events/order";

export const herald = heraldApp.create({
  db: createPrismaAdapter(prisma),
  events: {
    orderCompleted,
    newsletterWeekly,
  },
});
```

### 5. Send notifications

```ts
import { herald } from "@/lib/herald";

await herald.events.orderCompleted({
  orderId: "ord_123",
  amount: 149.9,
  userId: session.user.id,
  adminIds,
});

await herald.events.newsletterWeekly({
  userId: "user_123",
  campaignId: "camp_may_2026",
  subject: "May updates",
  html: "<p>...</p>",
  addressHash: "sha256:7f83b1657ff1...",
});

// Idempotent, internally scoped per userId + concrete channel + template.
await herald.events.orderCompleted(payload, {
  idempotencyKey: `order-${orderId}-completed`,
});
```

---

## Compliance API

Herald uses `herald.compliance` for consent evidence, suppressions, export, erasure, purge, and audit lookup.

### Record channel-specific consent

Consent is append-only and channel-scoped. Consent for email does not authorize in-app notifications, and future transport channels will require their own channel-scoped evidence.

```ts
await herald.compliance.recordConsent({
  subjectId: "user_123",
  channel: "email",
  purpose: "marketing.newsletter",
  status: "granted",
  legalBasis: "consent",
  source: "newsletter_form",
  formId: "footer_newsletter_v2",
  legalNoticeVersionId: "privacy_2026_05",
  checkboxTextVersion: "newsletter_checkbox_2026_05",
  ipHash,
  userAgentHash,
});

await herald.compliance.recordConsent({
  subjectId: "user_123",
  channel: "email",
  purpose: "marketing.newsletter",
  status: "withdrawn",
  legalBasis: "consent",
  source: "unsubscribe_link",
});
```

### Suppress future sends

Suppressions are durable blocks used for unsubscribe, spam complaint, hard bounce, manual block, or legal restriction.

```ts
await herald.compliance.suppress({
  channel: "email",
  addressHash: "sha256:7f83b1657ff1...",
  purpose: "marketing.newsletter",
  reason: "unsubscribe",
  source: "unsubscribe_link",
});
```

`addressHash` is supplied by your app in this version. Herald does not implement hashing or HMAC yet. Prefer a stable canonical hash/HMAC strategy in your app, and do not pass raw email or phone values as `addressHash`. A future Herald privacy layer should make address hashing configurable and versionable, with safe defaults and app overrides for canonicalization, HMAC keys, and rotation.

For legal bases with `requiresEvidence: true` and `defaultDecision: "deny_without_evidence"`, pass an app-owned evidence reference at send time:

```ts
await herald.events.marketingReactivation(payload, {
  complianceEvidenceId: "legitimate-interest-assessment:2026-05",
});
```

Herald stores the reference for audit reconstruction; your app owns the evidence record and legal review process.

### Export, erase, purge, audit

```ts
const data = await herald.compliance.exportSubject(userId);

await herald.compliance.eraseSubject(userId);

await herald.compliance.purge();

const audit = await herald.compliance.getAuditLog(userId, { limit: 50 });
```

`eraseSubject()` preserves audit integrity, cancels scheduled deliveries for the subject, best-effort cancels queued jobs when supported, and records hash-based erasure evidence.

### Legal basis presets

Herald ships legal-basis presets and lets you extend, override, or replace them with configured behavior. Events and channels may make requirements stricter, but cannot relax locked/minimum requirements from the selected legal basis.

Common presets include:

- `consent`
- `contract`
- `legal_obligation`
- `legitimate_interest`
- `soft_opt_in_contractual_relationship`
- `vital_interests`
- `public_task`

---

## In-app reads

Herald exposes pure functions. Wire them into your own routes however you prefer:

```ts
// app/api/notifications/route.ts
import { herald } from "@/lib/herald";
import { auth } from "@/lib/auth";

export async function GET(req: Request) {
  const userId = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 20);
  const offset = Number(url.searchParams.get("offset") ?? 0);

  const notifications = await herald.getNotifications(userId, {
    limit,
    offset,
  });
  const unreadCount = await herald.countUnread(userId);
  return Response.json({ notifications, unreadCount });
}

export async function POST(req: Request) {
  const userId = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { action, id } = await req.json();
  if (action === "markRead") await herald.markRead(id);
  if (action === "markAllRead") await herald.markAllRead(userId);

  return Response.json({ ok: true });
}
```

---

## DB Adapters

| Adapter | Import                                                           |
| ------- | ---------------------------------------------------------------- |
| Prisma  | `import { createPrismaAdapter } from "herald/adapters/prisma"`   |
| Drizzle | `import { createDrizzleAdapter } from "herald/adapters/drizzle"` |
| Kysely  | `import { createKyselyAdapter } from "herald/adapters/kysely"`   |
| Custom  | Implement `HeraldDatabaseAdapter` from `"herald"`                |

## Mail Adapters

| Adapter    | Import                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| Resend     | `import { createResendAdapter } from "herald/adapters/resend"`         |
| Nodemailer | `import { createNodemailerAdapter } from "herald/adapters/nodemailer"` |
| SendGrid   | `import { createSendGridAdapter } from "herald/adapters/sendgrid"`     |
| Postmark   | `import { createPostmarkAdapter } from "herald/adapters/postmark"`     |
| Custom     | Implement `HeraldMailAdapter` — one method: `send()`                   |

---

## Queue

```ts
// Sync (default), processes in-band.
queue: { driver: "sync" }

// DB queue via pg-boss, PostgreSQL only.
queue: {
  driver: "db",
  connectionString: process.env.DATABASE_URL!,
  concurrency: 5,
  retries: 3,
  backoff: "exponential",
}

// Custom queue adapter.
queue: {
  driver: "adapter",
  adapter: myQueueAdapter,
}
```

Custom queue adapters implement `HeraldQueueAdapter` from `herald` and declare their guarantees up front:

```ts
import type { HeraldQueueAdapter } from "herald";

export const myQueueAdapter: HeraldQueueAdapter = {
  name: "my-queue",
  capabilities: {
    durable: true,
    delayedJobs: true,
    cancellation: true,
    nativeRetries: true,
    concurrency: true,
  },
  async enqueue(job) {
    const jobId = await queue.enqueue(job);
    return { jobId };
  },
  async start(process) {
    queue.process((job) => process(job.data));
  },
  async cancelJobs(jobIds) {
    await queue.cancel(jobIds);
  },
};
```

If `delayedJobs` is `true`, Herald enqueues scheduled deliveries with `scheduledAt` and omits the full payload. If it is `false`, run `herald.startScheduledWorker(...)` so Herald polls due deliveries from its DB and enqueues them when ready.

---

## Real-time notifications

Herald does not include a real-time transport. Choose what fits your stack. Copy-paste examples are available in [`docs/examples/`](./docs/examples/):

| Pattern         | File                                                         | Best for               |
| --------------- | ------------------------------------------------------------ | ---------------------- |
| Polling         | [vanilla-react.md](./docs/examples/vanilla-react.md)         | Any stack, low traffic |
| React Query     | [react-query.md](./docs/examples/react-query.md)             | Apps using TanStack    |
| Postgres LISTEN | [realtime-postgres.md](./docs/examples/realtime-postgres.md) | Long-running Node apps |
| Redis pub/sub   | [realtime-redis.md](./docs/examples/realtime-redis.md)       | Redis/Upstash stacks   |

---

## License

MIT AND Commons-Clause
