import type { Channel, HeraldConfig, Recipient } from "../../../types/index.js";
import type { RuntimeChannels } from "../types.js";

export type ChannelSupportDecision =
	| { ok: true }
	| { ok: false; reason: `channel_unavailable:${string}` };

export async function ensureChannelSupported({
	channel,
	recipient,
	eventName,
	runtimeChannels,
	hooks,
	supportsChannel,
	safeHook,
}: {
	channel: Channel;
	recipient: Recipient;
	eventName: string;
	runtimeChannels: RuntimeChannels;
	hooks?: HeraldConfig["hooks"];
	supportsChannel: (
		channel: Channel,
		runtimeChannels: RuntimeChannels,
	) => boolean;
	safeHook: (fn: () => PromiseLike<void> | void) => Promise<void>;
}): Promise<ChannelSupportDecision> {
	if (supportsChannel(channel, runtimeChannels)) return { ok: true };

	await safeHook(() =>
		hooks?.onSkipped?.(
			recipient.to,
			eventName,
			`Channel "${channel}" is not configured or supported`,
		),
	);

	return { ok: false, reason: `channel_unavailable:${channel}` };
}
