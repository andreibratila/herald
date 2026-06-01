import {
	validateCompliancePolicy,
	type LegalBasisRegistry,
} from "../../compliance/index.js";
import type { EventRefMap } from "../../types/index.js";
import type {
	RuntimeEventDef,
	RuntimeTemplateDef,
	RuntimeTemplateMap,
} from "./types.js";

export function validateEventRefs(
	eventRefs: Array<EventRefMap[keyof EventRefMap]>,
	legalBasisRegistry: LegalBasisRegistry,
	requireExplicitEventCompliance?: boolean,
): void {
	const seen = new Set<string>();

	for (const ref of eventRefs) {
		if (seen.has(ref.name)) {
			throw new Error(
				`[herald] Duplicate event name: "${ref.name}". Each event name must be unique within a herald instance.`,
			);
		}

		if (!ref.definition.compliance) {
			if (requireExplicitEventCompliance) {
				throw new Error(
					`[herald] Event "${ref.name}" is missing required compliance policy.`,
				);
			}
		} else {
			validateCompliancePolicy(
				ref.name,
				ref.definition.compliance,
				legalBasisRegistry,
			);
		}

		seen.add(ref.name);
	}
}

export function createRuntimeEventMap(
	eventRefs: Array<EventRefMap[keyof EventRefMap]>,
): Map<string, RuntimeEventDef> {
	return new Map(
		eventRefs.map((r) => [r.name, r.definition as unknown as RuntimeEventDef]),
	);
}

export function createRuntimeTemplateMap(
	eventRefs: Array<EventRefMap[keyof EventRefMap]>,
): RuntimeTemplateMap {
	const templateMap: RuntimeTemplateMap = new Map();

	for (const eventRef of eventRefs) {
		const eventTemplates = new Map<string, RuntimeTemplateDef>();
		for (const [tplName, tplDef] of Object.entries(
			eventRef.definition.templates,
		)) {
			eventTemplates.set(tplName, tplDef as unknown as RuntimeTemplateDef);
		}
		templateMap.set(eventRef.name, eventTemplates);
	}

	return templateMap;
}
