# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Scheduled deliveries**: generated event methods accept `{ scheduledAt: Date }`, create a delivery with `status: "scheduled"`, and fire at or after the given UTC date.
  - **Sync driver**: call `herald.startScheduledWorker(intervalMs)` to start a polling loop that picks up due deliveries and processes them. Cadence = max dispatch latency.
  - **DB driver (pg-boss)**: `startAfter` is passed to pg-boss automatically — no polling needed.
  - **PII-safe**: Herald never stores the full payload for scheduled sends. Register `resolvePayload` on the event definition; Herald calls it at fire time to fetch the payload from your own datasource.
  - **`DeliveryStatus += "scheduled"`**: new status value for deliveries awaiting dispatch.
  - **`HeraldDatabaseAdapter.getPendingScheduled(before: Date): Promise<Delivery[]>`**: new required method on the adapter contract. Returns scheduled deliveries due before the given date.
  - **CLI**: `npx herald generate` now emits a partial index on `scheduled_at WHERE status = 'scheduled'` for all three adapter targets.
  - **Kysely bug fix**: `updateDelivery` previously silently dropped `scheduledAt` patches — now correctly maps to `scheduled_at`.
- **Retry logic on sync driver** (`QueueConfigSync`): three optional fields — `retries` (default `0`), `backoff` (`"exponential" | "linear"`, default `"exponential"`), and `backoffDelay` (ms, default `1000`). Default `retries: 0` preserves existing behavior (single attempt, no change).
- **Email idempotency guard**: `processDelivery` tracks a local `externalId` across retry attempts. If the mail provider succeeds but a subsequent step throws, retries skip the send. Null-id providers store the sentinel `"accepted"` so the guard still fires.
- **In-app idempotency guard**: before calling `db.createNotification`, `processDelivery` checks `db.getNotificationByDeliveryId(deliveryId)`. If a notification already exists it is reused — no duplicate in-app notifications across retries.
- **`Notification.deliveryId`**: new nullable field (`string | null`) linking a notification back to its delivery row. Populated on every new notification; `null` on legacy rows (additive, no migration error).
- **`HeraldDatabaseAdapter.getNotificationByDeliveryId(deliveryId: string): Promise<Notification | null>`**: new method implemented in the Prisma, Drizzle, and Kysely adapters, and in the test mock.
- **Schema**: `herald_notifications` gains a nullable `delivery_id` column with an index. CLI (`npx herald generate`) emits the column for all three adapter targets.
- **`onRetry` hook receives correct attempt numbers**: first retry fires with `attempt = 1`, second with `2`, etc.
- **Delivery acceptance semantics**: successful provider submission now uses `DeliveryStatus = "accepted"`, `acceptedAt`, `sideEffectsCompletedAt`, and `notification.accepted` audit events.
- **Custom queue adapters**: `queue: { driver: "adapter", adapter }` accepts public `HeraldQueueAdapter` implementations with explicit queue capabilities (`durable`, `delayedJobs`, `cancellation`, `nativeRetries`, `concurrency`).

### Changed

- `QueueConfigSync` now accepts `retries`, `backoff`, and `backoffDelay`.
- `QueueConfig` now includes `QueueConfigAdapter` for custom queue adapters.
- `QueueConfigDb` no longer accepts `retries`, `backoff`, or `backoffDelay` at the type level — pg-boss owns retry config for the db driver.
- `processDelivery` status transitions: on each retryable failure the delivery is set to `"retrying"` with an updated `attempts` counter; on exhaustion it is set to `"failed"`.

### Breaking Changes

- **`HeraldDatabaseAdapter.getPendingScheduled` is now required.** Any hand-rolled adapter must implement `getPendingScheduled(before: Date): Promise<Delivery[]>`. Return an empty array if you don't use scheduled deliveries — but the method must exist or it won't compile.
- **`HeraldDatabaseAdapter.getNotificationByDeliveryId` is now required.** Any hand-rolled adapter that does not implement this method will fail to compile. Add the method and return `null` when no matching notification is found.
- **Delivery status/schema update:** provider-accepted deliveries use `"accepted"`; generated schemas use `accepted_at` and `side_effects_completed_at`.
- **`QueueConfigDb` no longer accepts `retries`, `backoff`, `backoffDelay`.** If you were setting these fields on a db-driver config they must be removed. pg-boss retry behavior is controlled via `createDbDriver` pg-boss options.

### Migration Notes

1. **Custom adapter authors**: add `getPendingScheduled(before: Date): Promise<Delivery[]>` to your adapter. If you don't need scheduling, return `[]`.
2. **Database migration**: run `npx herald generate --adapter <prisma|drizzle|kysely>` to get the updated schema with the new `scheduled_at` partial index. Add the index via your migration tool.
3. **Using scheduled sends**: register `resolvePayload` on each event that uses `scheduledAt`:
   ```ts
   export const orderCreated = heraldApp.defineEvent("order.created", {
     schema: z.object({ ... }),
     resolvePayload: async (delivery) => myDb.getOrderPayload(delivery.id),
     // ...
   })
   ```
4. **Custom adapter authors**: add `getNotificationByDeliveryId(deliveryId: string): Promise<Notification | null>` to your adapter implementation.
5. **Database migration**: add a nullable `delivery_id` column to `herald_notifications`. Run `npx herald generate --adapter <prisma|drizzle|kysely>` to see the updated schema. The column is nullable — no row backfill required.
6. **`QueueConfigDb` users**: remove any `retries`, `backoff`, or `backoffDelay` fields from your db-driver config object. Configure pg-boss retries via the pg-boss options passed to `createDbDriver`.
