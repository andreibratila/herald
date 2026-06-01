import type { HeraldMailAdapter, HeraldMailAdapterInput } from "./mail.js";

// ─── Channels ────────────────────────────────────────────────

export type Channel = "email" | "inApp";

// ─── Channels config ─────────────────────────────────────────

export interface HeraldEmailChannelConfigInput {
	adapter: HeraldMailAdapterInput;
	defaultFrom: string;
}

export interface HeraldEmailChannelConfig {
	adapter: HeraldMailAdapter;
	defaultFrom: string;
}

export interface HeraldChannelsConfigInput {
	email?: HeraldEmailChannelConfigInput;
	inApp?: true;
}

export interface HeraldChannelsConfig {
	email?: HeraldEmailChannelConfig;
	inApp?: boolean;
}
