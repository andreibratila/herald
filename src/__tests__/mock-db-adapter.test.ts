// ============================================================
// herald — src/__tests__/mock-db-adapter.test.ts
// Tests for the in-memory mock DB adapter
// ============================================================

import { describe, it, expect, beforeEach } from "vitest"
import { createMockDb } from "./helpers/mock-db-adapter.js"
import type { Delivery } from "../types/index.js"

// ─── Helpers ─────────────────────────────────────────────────

function makeDelivery(
  db: ReturnType<typeof createMockDb>,
  overrides: Partial<Omit<Delivery, "id" | "createdAt" | "updatedAt">> = {}
): Promise<Delivery> {
  return db.createDelivery({
    userId:       "user_1",
    eventType:    "order.completed",
    templateName: "order-user",
    channel:      "email",
    status:       "pending",
    attempts:     0,
    ...overrides,
  })
}

// ─── Task 2.3 RED: purgeExpiredDeliveries skips status="scheduled" ─

describe("mock-db-adapter — purgeExpiredDeliveries scheduled guard", () => {
  let db: ReturnType<typeof createMockDb>
  const now = new Date("2030-06-01T12:00:00Z")
  const oldDate = new Date("2030-01-01T00:00:00Z") // older than cutoff

  beforeEach(() => {
    db = createMockDb()
  })

  it("does NOT delete a scheduled delivery older than cutoff", async () => {
    const sched = await db.createDelivery({
      userId:       "user_1",
      eventType:    "order.completed",
      templateName: "order-user",
      channel:      "email",
      status:       "scheduled",
      attempts:     0,
      scheduledAt:  new Date("2030-06-15T00:00:00Z"),
      // We manually set createdAt via a trick — store then manipulate via _deliveries
    })

    // Backdating createdAt so it's older than the purge cutoff
    const stored = db._deliveries.get(sched.id)!
    stored.createdAt = oldDate

    const deleted = await db.purgeExpiredDeliveries(now)
    expect(deleted).toBe(0)
    expect(db._deliveries.has(sched.id)).toBe(true)
  })

  it("still deletes non-scheduled expired rows", async () => {
    const accepted = await db.createDelivery({
      userId:       "user_1",
      eventType:    "order.completed",
      templateName: "order-user",
      channel:      "email",
      status:       "accepted",
      attempts:     1,
    })

    // Backdate createdAt
    const stored = db._deliveries.get(accepted.id)!
    stored.createdAt = oldDate

    const deleted = await db.purgeExpiredDeliveries(now)
    expect(deleted).toBe(1)
    expect(db._deliveries.has(accepted.id)).toBe(false)
  })

  it("does not delete scheduled rows while deleting old non-scheduled ones", async () => {
    // scheduled + old (must survive)
    const sched = await makeDelivery(db, { status: "scheduled", scheduledAt: new Date("2030-06-15T00:00:00Z") })
    db._deliveries.get(sched.id)!.createdAt = oldDate

    // accepted + old (must be deleted)
    const accepted = await makeDelivery(db, { status: "accepted" })
    db._deliveries.get(accepted.id)!.createdAt = oldDate

    const deleted = await db.purgeExpiredDeliveries(now)
    expect(deleted).toBe(1)
    expect(db._deliveries.has(sched.id)).toBe(true)
    expect(db._deliveries.has(accepted.id)).toBe(false)
  })
})
