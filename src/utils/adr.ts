import type { Decision } from "../types/index.ts";

/** The only supported decision kind discriminant; "architecture" marks an ADR. */
export const ADR_KIND = "architecture";

export const ADR_STATUSES = ["proposed", "accepted", "rejected", "superseded"] as const;
export type AdrStatus = (typeof ADR_STATUSES)[number];

/** An applicable ADR still governs current work; anything else (rejected, deprecated, superseded) is retired. */
export function isRetiredAdrStatus(status: string): boolean {
	return status !== "proposed" && status !== "accepted";
}

/** Terminal states: a rejected or superseded ADR no longer accepts status changes. */
const ADR_TRANSITIONS: Record<AdrStatus, readonly AdrStatus[]> = {
	proposed: ["accepted", "rejected"],
	accepted: [],
	rejected: [],
	superseded: [],
};

export function isAdr(decision: Pick<Decision, "kind">): boolean {
	return decision.kind === ADR_KIND;
}

/** Splits a scope statement into trimmed, non-empty items. */
export function parseScopeItems(scope: string | undefined): string[] {
	if (!scope) return [];
	return scope
		.split(/[\n,;]+/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function normalizeScopeItem(item: string): string {
	return item.toLowerCase().replace(/\s+/g, " ");
}

/** Returns the previous ADR's scope items the replacement does not cover, quoting the original text. */
export function scopeCoverageGaps(previousScope: string | undefined, replacementScope: string | undefined): string[] {
	const covered = new Set(parseScopeItems(replacementScope).map(normalizeScopeItem));
	return parseScopeItems(previousScope).filter((item) => !covered.has(normalizeScopeItem(item)));
}

/** Validates an explicit ADR status value, refusing anything outside the lifecycle. */
export function assertAdrStatusValue(decisionId: string, status: string): void {
	if (!(ADR_STATUSES as readonly string[]).includes(status)) {
		throw new Error(
			`Invalid status '${status}' for architecture decision ${decisionId}. ADR statuses are: ${ADR_STATUSES.join(", ")}.`,
		);
	}
}

/** Validates an ADR status change; accepted, rejected, and superseded ADRs only leave their state via supersession. */
export function assertAdrTransition(decisionId: string, from: string, to: string): void {
	if (from === to) return;
	if (!(ADR_STATUSES as readonly string[]).includes(from)) {
		throw new Error(
			`Architecture decision ${decisionId} has unrecognized status '${from}'. ADR statuses are: ${ADR_STATUSES.join(", ")}.`,
		);
	}
	const allowed = ADR_TRANSITIONS[from as AdrStatus];
	if (allowed && !allowed.includes(to as AdrStatus)) {
		const hint =
			from === "accepted"
				? "An accepted ADR is retired only by superseding it with a replacement that covers its full scope."
				: from === "proposed"
					? "Only an accepted ADR can be superseded; reject a proposal instead."
					: "A rejected or superseded ADR keeps its state.";
		throw new Error(`Cannot change architecture decision ${decisionId} from ${from} to ${to}. ${hint}`);
	}
}

/** An accepted ADR must state what it governs and what was decided, so supersession can be checked later. */
export function assertAdrAcceptableFields(decision: Decision): void {
	if (!decision.scope?.trim()) {
		throw new Error(
			`Architecture decision ${decision.id} cannot be accepted without a scope stating what it governs. Add a '## Scope' section.`,
		);
	}
	if (!decision.decision.trim()) {
		throw new Error(
			`Architecture decision ${decision.id} cannot be accepted without a decision. Add a '## Decision' section.`,
		);
	}
}
