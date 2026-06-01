import type {
	AuditLog,
	ConsentEvent,
	Delivery,
	Notification,
	Suppression,
} from "../../../types/index.js";

export const USERS = {
	alpha: "user_alpha",
	beta: "user_beta",
} as const;

export const BASE_TIME = new Date("2030-01-01T00:00:00.000Z");

export function at(seconds: number): Date {
	return new Date(BASE_TIME.getTime() + seconds * 1000);
}

export function notificationInput(
	overrides: Partial<Omit<Notification, "id" | "createdAt">> = {},
): Omit<Notification, "id" | "createdAt"> {
	return {
		userId: USERS.alpha,
		eventType: "order.completed",
		templateName: "inapp-primary",
		deliveryId: null,
		title: "hello",
		body: "body",
		href: "/orders/1",
		data: { key: "value" },
		readAt: null,
		...overrides,
	};
}

export function deliveryInput(
	overrides: Partial<Omit<Delivery, "id" | "createdAt" | "updatedAt">> = {},
): Omit<Delivery, "id" | "createdAt" | "updatedAt"> {
	return {
		userId: USERS.alpha,
		eventType: "order.completed",
		templateName: "email-primary",
		channel: "email",
		status: "pending",
		attempts: 0,
		idempotencyKey: null,
		scheduledAt: null,
		...overrides,
	};
}

export function consentEventInput(
	overrides: Partial<Omit<ConsentEvent, "id" | "createdAt">> & {
		createdAt?: Date;
	} = {},
): Omit<ConsentEvent, "id"> {
	return {
		subjectId: USERS.alpha,
		subjectType: "user",
		channel: "email",
		purpose: "marketing",
		status: "granted",
		legalBasis: "consent",
		source: "preferences-page",
		createdAt: BASE_TIME,
		...overrides,
	};
}

export function suppressionInput(
	overrides: Partial<Omit<Suppression, "id" | "createdAt">> & {
		createdAt?: Date;
	} = {},
): Omit<Suppression, "id"> {
	return {
		addressHash: "hash:alpha@example.test",
		channel: "email",
		purpose: null,
		reason: "unsubscribe",
		source: "preferences-page",
		createdAt: BASE_TIME,
		...overrides,
	};
}

export function auditLogInput(
	overrides: Partial<Omit<AuditLog, "id" | "createdAt">> = {},
): Omit<AuditLog, "id" | "createdAt"> {
	return {
		userId: USERS.alpha,
		action: "notification.accepted",
		eventType: "order.completed",
		deliveryId: null,
		metadata: { source: "conformance" },
		...overrides,
	};
}
