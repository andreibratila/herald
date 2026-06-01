import type { Channel } from "../../types/index.js";
import type { RuntimeChannels } from "./types.js";

export function supportsChannel(
	channel: Channel,
	runtimeChannels: RuntimeChannels,
): boolean {
	if (channel === "email") return !!runtimeChannels.email;
	if (channel === "inApp") return runtimeChannels.inApp === true;
	return false;
}
