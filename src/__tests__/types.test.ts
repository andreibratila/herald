// ============================================================
// herald — src/__tests__/types.test.ts
// Type-level and compile-time contract tests
// ============================================================

import { describe, it, expect, expectTypeOf } from "vitest";
import { z } from "zod";
import { configureHerald, legalBases } from "../index.js";
import { defineEvent } from "../core/define.js";
import { createHerald } from "../core/herald.js";
import { createMockDb } from "./helpers/mock-db-adapter.js";
import { createMockMailAdapter } from "./helpers/mock-mail-adapter.js";
import type {
	DeliveryStatus,
	SendOptions,
	HeraldDatabaseAdapter,
	Delivery,
	EventRef,
	ConsentEvent,
	AuditLog,
	HeraldConfig,
	EventRefMap,
	StartScheduledWorkerOptions,
	QueueConfigDb,
} from "../types/index.js";
import type { QueueDriver } from "../queue/index.js";

// ─── Task 1.1 RED: "scheduled" is a valid DeliveryStatus ─────

describe("DeliveryStatus", () => {
	it('accepts "scheduled" as a valid DeliveryStatus', () => {
		// Runtime check: "scheduled" must be assignable to DeliveryStatus
		const status: DeliveryStatus = "scheduled";
		expect(status).toBe("scheduled");
	});

	it("type check: DeliveryStatus includes scheduled", () => {
		expectTypeOf<"scheduled">().toMatchTypeOf<DeliveryStatus>();
	});

	it("'claimed' is assignable to DeliveryStatus", () => {
		expectTypeOf<"claimed">().toMatchTypeOf<DeliveryStatus>();
	});
});

// ─── Task 1.3 RED: SendOptions.scheduledAt?: Date compiles ───

describe("SendOptions", () => {
	it("accepts scheduledAt as an optional Date", () => {
		const opts: SendOptions = { scheduledAt: new Date("2030-01-01T09:00:00Z") };
		expect(opts.scheduledAt).toBeInstanceOf(Date);
	});

	it("type check: SendOptions.scheduledAt is optional Date", () => {
		expectTypeOf<SendOptions>().toHaveProperty("scheduledAt");
		expectTypeOf<SendOptions["scheduledAt"]>().toEqualTypeOf<
			Date | undefined
		>();
	});
});

// ─── new type tests ───────────────────────────────────

describe("Delivery has all 7 new optional fields", () => {
	it("claimedAt is Date | null | undefined", () => {
		type T = Delivery["claimedAt"];
		expectTypeOf<T>().toEqualTypeOf<Date | null | undefined>();
	});

	it("claimExpiresAt is Date | null | undefined", () => {
		type T = Delivery["claimExpiresAt"];
		expectTypeOf<T>().toEqualTypeOf<Date | null | undefined>();
	});

	it("claimedBy is string | null | undefined", () => {
		type T = Delivery["claimedBy"];
		expectTypeOf<T>().toEqualTypeOf<string | null | undefined>();
	});

	it("resolveAttempts is number | undefined", () => {
		type T = Delivery["resolveAttempts"];
		expectTypeOf<T>().toEqualTypeOf<number | undefined>();
	});

	it("bypassComplianceCheck is boolean | null | undefined", () => {
		type T = Delivery["bypassComplianceCheck"];
		expectTypeOf<T>().toEqualTypeOf<boolean | null | undefined>();
	});

	it("queueJobId is string | null | undefined", () => {
		type T = Delivery["queueJobId"];
		expectTypeOf<T>().toEqualTypeOf<string | null | undefined>();
	});

	it("sideEffectsCompletedAt is Date | null | undefined", () => {
		type T = Delivery["sideEffectsCompletedAt"];
		expectTypeOf<T>().toEqualTypeOf<Date | null | undefined>();
	});
});

describe("EventRef and ConsentEvent exported from types", () => {
	it("EventRef has name (string)", () => {
		type NameType = EventRef<string, any>["name"];
		expectTypeOf<NameType>().toEqualTypeOf<string>();
	});

	it("ConsentEvent has required compliance evidence fields", () => {
		type ChannelType = ConsentEvent["channel"];
		type PurposeType = ConsentEvent["purpose"];
		type StatusType = ConsentEvent["status"];
		type SourceType = ConsentEvent["source"];
		expectTypeOf<ChannelType>().toEqualTypeOf<ConsentEvent["channel"]>();
		expectTypeOf<PurposeType>().toEqualTypeOf<string>();
		expectTypeOf<StatusType>().toEqualTypeOf<"granted" | "withdrawn">();
		expectTypeOf<SourceType>().toEqualTypeOf<string>();
	});
});

describe("configured app defineEvent types", () => {
	it("constrains templates, dispatch channels, and safeFields to configured app types", () => {
		const app = configureHerald({
			channels: {
				email: {
					adapter: createMockMailAdapter(),
					defaultFrom: "hello@example.com",
				},
				inApp: true,
			},
		});

		const event = app.defineEvent("typed.order", {
			schema: z.object({ userId: z.string(), orderId: z.string() }),
			safeFields: ["orderId"],
			compliance: {
				purpose: "transactional.order_update",
				legalBasis: "contract",
			},
			templates: {
				customer: {
					email: (payload) => ({
						subject: payload.orderId,
						html: "<p>Order</p>",
					}),
					inApp: (payload) => ({ title: payload.orderId }),
				},
			},
			dispatch: (payload) => [
				{
					to: payload.userId,
					channels: ["email", "inApp"],
					template: "customer",
				},
			],
		});

		const herald = app.create({
			db: createMockDb(),
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { typedOrder: event },
		});

		expect(event.name).toBe("typed.order");
		expectTypeOf(herald.events.typedOrder).toBeFunction();
		expectTypeOf(herald.events.typedOrder).parameters.toEqualTypeOf<
			[
				payload: { userId: string; orderId: string },
				options?: SendOptions | undefined,
			]
		>();
		if (false) {
			// @ts-expect-error configured runtimes expose generated methods, not arbitrary string-send
			herald.send("typed.order", { userId: "u1", orderId: "o1" });
			// @ts-expect-error unknown generated method keys are rejected
			herald.events.unknownEvent;
		}
	});

	it("requires configured event compliance at the type level", () => {
		const app = configureHerald({ channels: { inApp: true } });

		if (false) {
			// @ts-expect-error configured events must declare their own compliance policy
			app.defineEvent("typed.missing-compliance", {
				schema: z.object({ userId: z.string() }),
				templates: { item: { inApp: () => ({ title: "Hello" }) } },
				dispatch: (payload: { userId: string }) => [
					{ to: payload.userId, channels: ["inApp"], template: "item" },
				],
			});
		}
	});

	it("rejects configured compliance default policies at the type level", () => {
		if (false) {
			configureHerald({
				channels: { inApp: true },
				compliance: {
					// @ts-expect-error configured apps do not support default event compliance policies
					defaultPolicy: {
						purpose: "transactional.default",
						legalBasis: "contract",
					},
				},
			});
		}
	});

	it("rejects event refs from apps with incompatible configured channels", () => {
		const emailApp = configureHerald({
			channels: {
				email: {
					adapter: createMockMailAdapter(),
					defaultFrom: "hello@example.com",
				},
			},
		});
		const inAppOnlyApp = configureHerald({
			channels: { inApp: true },
		});
		const emailOnlyEvent = emailApp.defineEvent("typed.email-only", {
			schema: z.object({ userId: z.string() }),
			compliance: {
				purpose: "transactional.email_only",
				legalBasis: "contract",
			},
			templates: {
				customer: {
					email: () => ({ subject: "Hello", html: "<p>Hello</p>" }),
				},
			},
			dispatch: (payload) => [
				{ to: payload.userId, channels: ["email"], template: "customer" },
			],
		});

		if (false) {
			inAppOnlyApp.create({
				db: createMockDb(),
				queue: { driver: "sync" },
				compliance: { retention: { autoPurge: false } },
				// @ts-expect-error event was defined for an incompatible configured app
				events: { emailOnlyEvent },
			});
		}
	});

	it("rejects unconfigured channel renderers and dispatch channels", () => {
		const app = configureHerald({ channels: { inApp: true } });

		app.defineEvent("typed.in-app", {
			schema: z.object({ userId: z.string(), orderId: z.string() }),
			// @ts-expect-error safeFields must be payload keys
			safeFields: ["missing"],
			compliance: {
				purpose: "transactional.order_update",
				legalBasis: "contract",
			},
			templates: {
				customer: {
					inApp: () => ({ title: "Order" }),
					// @ts-expect-error email was not configured for this app
					email: () => ({ subject: "Order", html: "<p>Order</p>" }),
				},
			},
			dispatch: (payload) => [
				{
					to: payload.userId,
					// @ts-expect-error email was not configured for this app
					channels: ["email"],
					template: "customer",
				},
			],
		});
	});
});

describe("HeraldConfig has events map", () => {
	it("events is a required EventRef map", () => {
		type T = HeraldConfig["events"];
		expectTypeOf<T>().toEqualTypeOf<EventRefMap>();
	});
});

describe("HeraldDatabaseAdapter new methods", () => {
	it("claimScheduledBatch returns Promise<Delivery[]>", () => {
		type Fn = HeraldDatabaseAdapter["claimScheduledBatch"];
		expectTypeOf<Fn>().toBeFunction();
		type Ret = ReturnType<Fn>;
		expectTypeOf<Ret>().toEqualTypeOf<Promise<Delivery[]>>();
	});

	it("cancelScheduledDeliveries returns Promise<Array<{id: string; queueJobId: string | null}>>", () => {
		type Fn = HeraldDatabaseAdapter["cancelScheduledDeliveries"];
		type Ret = ReturnType<Fn>;
		expectTypeOf<Ret>().toEqualTypeOf<
			Promise<Array<{ id: string; queueJobId: string | null }>>
		>();
	});

	it("findAuditLogByAction returns Promise<AuditLog | null>", () => {
		type Fn = HeraldDatabaseAdapter["findAuditLogByAction"];
		type Ret = ReturnType<Fn>;
		expectTypeOf<Ret>().toEqualTypeOf<Promise<AuditLog | null>>();
	});

	it("compliance evidence methods are required", () => {
		type CreateConsent = HeraldDatabaseAdapter["createConsentEvent"];
		type GetConsent = HeraldDatabaseAdapter["getConsentEvents"];
		type CreateSuppression = HeraldDatabaseAdapter["createSuppression"];
		type FindSuppression = HeraldDatabaseAdapter["findSuppression"];

		expectTypeOf<CreateConsent>().toBeFunction();
		expectTypeOf<GetConsent>().toBeFunction();
		expectTypeOf<CreateSuppression>().toBeFunction();
		expectTypeOf<FindSuppression>().toBeFunction();
		expectTypeOf<CreateConsent>().not.toEqualTypeOf<
			HeraldDatabaseAdapter["createConsentEvent"] | undefined
		>();
	});
});

describe("QueueDriver updated types", () => {
	it("enqueue returns Promise<string | null>", () => {
		type Fn = QueueDriver["enqueue"];
		type Ret = ReturnType<Fn>;
		expectTypeOf<Ret>().toEqualTypeOf<Promise<string | null>>();
	});

	it("cancelJobs is optional and returns Promise<void>", () => {
		type T = QueueDriver["cancelJobs"];
		type NonUndef = NonNullable<T>;
		expectTypeOf<NonUndef>().toBeFunction();
	});
});

describe("QueueConfigDb has retry fields", () => {
	it("retries is number | undefined", () => {
		type T = QueueConfigDb["retries"];
		expectTypeOf<T>().toEqualTypeOf<number | undefined>();
	});

	it("backoff is union | undefined", () => {
		type T = QueueConfigDb["backoff"];
		expectTypeOf<T>().toEqualTypeOf<
			"exponential" | "linear" | "fixed" | undefined
		>();
	});

	it("backoffDelay is number | undefined", () => {
		type T = QueueConfigDb["backoffDelay"];
		expectTypeOf<T>().toEqualTypeOf<number | undefined>();
	});
});

describe("StartScheduledWorkerOptions interface", () => {
	it("batchSize is number | undefined", () => {
		type T = StartScheduledWorkerOptions["batchSize"];
		expectTypeOf<T>().toEqualTypeOf<number | undefined>();
	});

	it("leaseMs is number | undefined", () => {
		type T = StartScheduledWorkerOptions["leaseMs"];
		expectTypeOf<T>().toEqualTypeOf<number | undefined>();
	});

	it("workerId is string | undefined", () => {
		type T = StartScheduledWorkerOptions["workerId"];
		expectTypeOf<T>().toEqualTypeOf<string | undefined>();
	});

	it("maxResolveAttempts is number | undefined", () => {
		type T = StartScheduledWorkerOptions["maxResolveAttempts"];
		expectTypeOf<T>().toEqualTypeOf<number | undefined>();
	});
});

// ─── T17: Compile-time type-safety for send() ─────────────────
// These tests verify that the generic createHerald<const TEvents> + EventPayloadMap
// produces correct compile-time errors for wrong event names and wrong payload shapes.

describe("T17 — send() compile-time type narrowing", () => {
	// Set up a typed herald for compile-time assertions
	const orderSchema = z.object({ orderId: z.string(), userId: z.string() });

	const orderCompleted = defineEvent("order.completed.types", {
		schema: orderSchema,
		templates: {
			"order-user": {
				email: (p) => ({ subject: `Order #${p.orderId}`, html: "<p/>" }),
			},
		},
		dispatch: (p) => [
			{ to: p.userId, channels: ["email"], template: "order-user" },
		],
	});

	const typedHerald = createHerald({
		db: createMockDb(),
		channels: {
			email: {
				adapter: createMockMailAdapter(),
				defaultFrom: "noreply@test.com",
			},
			inApp: false,
		},
		queue: { driver: "sync" },
		compliance: { retention: { autoPurge: false } },
		events: { orderCompleted },
	});

	it("(a) valid event name + correct payload shape compiles without error", () => {
		// This should compile — both name and payload shape are correct
		const call = () =>
			typedHerald.send("order.completed.types", {
				orderId: "o1",
				userId: "u1",
			});
		expect(typeof call).toBe("function");
	});

	it("(b) unknown dispatch key is a @ts-expect-error", () => {
		const validPayload = { orderId: "o1", userId: "u1" };
		// @ts-expect-error — "nonexistent-event" is not in EventPayloadMap, even with a valid payload shape
		const call = () => typedHerald.send("nonexistent-event", validPayload);
		expect(typeof call).toBe("function");
	});

	it("(c) send with wrong payload shape is a @ts-expect-error", () => {
		const call = () => {
			// @ts-expect-error — orderId must be string, not number; userId is required
			return typedHerald.send("order.completed.types", { orderId: 123 });
		};
		expect(typeof call).toBe("function");
	});

	it("(d) send with completely unknown event name is a @ts-expect-error", () => {
		const validPayload = { orderId: "o1", userId: "u1" };
		// @ts-expect-error — "unknown.event" is not in EventPayloadMap, even with a valid payload shape
		const call = () => typedHerald.send("unknown.event", validPayload);
		expect(typeof call).toBe("function");
	});
});

describe("compliance/channel public API examples", () => {
	const newsletterSchema = z.object({
		userId: z.string(),
		campaignId: z.string(),
		subject: z.string(),
		html: z.string(),
		addressHash: z.string(),
	});

	const newsletter = defineEvent("newsletter.types", {
		schema: newsletterSchema,
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
		dispatch: (p) => [
			{
				to: p.userId,
				channels: ["email"],
				template: "newsletter-main",
				addressHash: p.addressHash,
			},
		],
	});

	const herald = createHerald({
		db: createMockDb(),
		channels: {
			email: {
				adapter: createMockMailAdapter(),
				defaultFrom: "noreply@test.com",
			},
			inApp: true,
		},
		compliance: {
			retention: { autoPurge: false },
			legalBases: {
				...legalBases.defaults,
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
		queue: { driver: "sync" },
		events: { newsletter },
	});

	it("compiles channel config, compliance policy, consent evidence, suppression, and send", async () => {
		await herald.compliance.recordConsent({
			subjectId: "user_1",
			channel: "email",
			purpose: "marketing.newsletter",
			status: "granted",
			legalBasis: "consent",
			source: "newsletter_form",
			legalNoticeVersionId: "privacy_2026_05",
		});

		await herald.compliance.suppress({
			addressHash: "sha256:7f83b1657ff1...",
			channel: "email",
			purpose: "marketing.newsletter",
			reason: "unsubscribe",
			source: "unsubscribe_link",
		});

		const call = () =>
			herald.send("newsletter.types", {
				userId: "user_1",
				campaignId: "camp_001",
				subject: "May updates",
				html: "<p/>",
				addressHash: "sha256:7f83b1657ff1...",
			});
		expect(typeof call).toBe("function");
	});
});

// ─── T18: Runtime safeFields default test ─────────────────────
// defineEvent with no safeFields defaults to [] via defineEvent factory.
// The PII-never-persists invariant holds: no payload data appears in the delivery row.

describe("T18 — safeFields default: no safeFields means nothing persisted", () => {
	it("defineEvent with no safeFields: safeFields defaults to [] on the definition", () => {
		// When no safeFields provided, defineEvent applies [] as the default
		const ev = defineEvent("t18.no-safe-fields", {
			schema: z.object({ userId: z.string(), secret: z.string() }),
			templates: {
				"t18-tpl": {
					email: (p) => ({ subject: "hi", html: `<p>${p.userId}</p>` }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "t18-tpl" },
			],
			// NO safeFields specified
		});

		// safeFields defaults to [] — not undefined — so sanitizePayload returns null (nothing stored)
		expect(ev.definition.safeFields).toEqual([]);
	});

	it("send() with no safeFields: no PII payload data appears in the stored delivery row", async () => {
		const ev = defineEvent("t18.no-safe-pii", {
			schema: z.object({ userId: z.string(), creditCard: z.string() }),
			templates: {
				"t18-pii-tpl": {
					email: (p) => ({ subject: "hi", html: `<p>${p.userId}</p>` }),
				},
			},
			dispatch: (p) => [
				{ to: p.userId, channels: ["email"], template: "t18-pii-tpl" },
			],
			// NO safeFields — nothing should be stored from the payload
		});

		const db = createMockDb();
		const mail = createMockMailAdapter();
		const herald = createHerald({
			db,
			channels: {
				email: { adapter: mail, defaultFrom: "noreply@test.com" },
				inApp: false,
			},
			queue: { driver: "sync" },
			compliance: { retention: { autoPurge: false } },
			events: { ev },
		});

		await herald.send("t18.no-safe-pii", {
			userId: "user_1",
			creditCard: "4242424242424242",
		});

		// Delivery row is created (accepted successfully)
		expect(db._deliveries.size).toBe(1);
		// No PII in stored delivery data — safeFields=[] means nothing from payload persisted
		const stored = JSON.stringify([...db._deliveries.values()]);
		expect(stored).not.toContain("4242424242424242");
		expect(stored).not.toContain("creditCard");
	});
});
