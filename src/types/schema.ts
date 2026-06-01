// ─── Schema contract ─────────────────────────────────────────
// Agnostic — works with Zod, Valibot, Arktype, or manual

export interface HeraldSchema<TOutput> {
	parse(input: unknown): TOutput;
}

export type InferSchema<TSchema> =
	TSchema extends HeraldSchema<infer TOutput> ? TOutput : never;
