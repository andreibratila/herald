// ─── Mail Adapter contract ───────────────────────────────────

export interface SendEmailInput {
	to: string;
	from: string;
	subject: string;
	html: string;
	text?: string;
	tags?: Record<string, string>;
}

export interface SendEmailResult {
	id?: string;
	error?: string;
}

export interface HeraldMailAdapter {
	send(input: SendEmailInput): Promise<SendEmailResult>;
}

export type LazyHeraldAdapter<TAdapter> = () => TAdapter;

export type HeraldMailAdapterInput =
	| HeraldMailAdapter
	| LazyHeraldAdapter<HeraldMailAdapter>;
