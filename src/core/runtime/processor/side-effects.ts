import { createHash } from "node:crypto";
import type { Delivery, HeraldDatabaseAdapter } from "../../../types/index.js";
import type {
	RuntimeChannels,
	RuntimeEventDef,
	RuntimeTemplateDef,
} from "../types.js";
import type { DeliveryChannelPlan } from "./templates.js";

// Only persistedFields are persisted — everything else stays in memory.
// Paths are selected from the validated payload, never from template-produced data.
function pickPersistedPayloadFields(
	payload: Record<string, unknown>,
	persistedFields?: string[],
): Record<string, unknown> | null {
	if (!persistedFields || persistedFields.length === 0) return null;

	const picked: Record<string, unknown> = {};
	for (const path of persistedFields) {
		const segments = path.split(".");
		let source: unknown = payload;
		for (const segment of segments) {
			if (
				source === null ||
				typeof source !== "object" ||
				Array.isArray(source) ||
				!(segment in source)
			) {
				source = undefined;
				break;
			}
			source = (source as Record<string, unknown>)[segment];
		}

		if (source === undefined) continue;

		let target = picked;
		for (const [index, segment] of segments.entries()) {
			if (index === segments.length - 1) {
				target[segment] = source;
				break;
			}

			const next = target[segment];
			if (next === null || typeof next !== "object" || Array.isArray(next)) {
				target[segment] = {};
			}
			target = target[segment] as Record<string, unknown>;
		}
	}

	return Object.keys(picked).length > 0 ? picked : null;
}

export type DeliverySideEffectsResult =
	| { ok: true; externalId: string | null }
	| { ok: false; message: string };

export async function runDeliverySideEffects({
	db,
	delivery,
	payload,
	template,
	plan,
	runtimeChannels,
	defaultFrom,
	eventMap,
	externalId,
}: {
	db: HeraldDatabaseAdapter;
	delivery: Delivery;
	payload: Record<string, unknown>;
	template: RuntimeTemplateDef;
	plan: DeliveryChannelPlan;
	runtimeChannels: RuntimeChannels;
	defaultFrom: string;
	eventMap: Map<string, RuntimeEventDef>;
	externalId: string | null;
}): Promise<DeliverySideEffectsResult> {
	let localExternalId = externalId;

	// ── Email — idempotent via localExternalId guard ──────
	if (
		plan.sendEmail &&
		runtimeChannels.email &&
		template.email &&
		!localExternalId
	) {
		const userEmail = await db.getUserEmail(delivery.userId);
		if (!userEmail) {
			return {
				ok: false,
				message: `No email address for user "${delivery.userId}". Make sure getUserEmail is configured in your DB adapter.`,
			};
		}

		const rendered = template.email(payload);
		const renderedHash = createHash("sha256")
			.update(rendered.subject + "\0" + rendered.html, "utf8")
			.digest("hex");
		const result = await runtimeChannels.email.send({
			to: userEmail,
			from: rendered.from ?? defaultFrom,
			subject: rendered.subject,
			html: rendered.html,
			text: rendered.text,
		});

		if (result.error) throw new Error(result.error);
		localExternalId = result.id ?? "__no_provider_id__";
		await db.updateDelivery(delivery.id, {
			externalId: localExternalId,
			renderedHash,
		});
	}

	// ── In-app — idempotent via deliveryId lookup ─────────
	if (plan.sendInApp && template.inApp) {
		const existing = await db.getNotificationByDeliveryId(delivery.id);
		if (!existing) {
			const rendered = template.inApp(payload);
			const eventDef = eventMap.get(delivery.eventType);
			await db.createNotification({
				userId: delivery.userId,
				eventType: delivery.eventType,
				templateName: delivery.templateName,
				deliveryId: delivery.id,
				title: rendered.title,
				body: rendered.body ?? null,
				href: rendered.href ?? null,
				data: pickPersistedPayloadFields(payload, eventDef?.persistedFields),
				readAt: null,
			});
		}
	}

	await db.updateDelivery(delivery.id, {
		sideEffectsCompletedAt: new Date(),
	});

	return { ok: true, externalId: localExternalId };
}
