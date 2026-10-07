/**
 * Optional change documents: proposed behavior deltas linked to specifications,
 * tasks, and decisions.
 *
 * A change is a document of type "change" in the regular document namespace. Its body
 * may record the proposal with these `##` sections (all optional, human-readable):
 *
 *   ## Why
 *
 *   Sessions expire silently today.
 *
 *   ## Scope
 *
 *   The session library and its specification.
 *
 *   ## Affected specs
 *
 *   - doc-12
 *
 *   ## Linked tasks
 *
 *   - task-3
 *
 *   ## Related decisions
 *
 *   - decision-2
 *
 *   ## Added requirements
 *
 *   ### Requirement: Warn before expiry [SES-3]
 *
 *   The system SHALL warn before a session expires.
 *
 *   #### Scenario: Expiring soon
 *
 *   - WHEN a session is one day from expiry
 *   - THEN the client receives a warning
 *
 *   ## Modified requirements
 *
 *   ### Requirement: Sessions expire after 14 days [SES-1]
 *
 *   ## Removed requirements
 *
 *   ### Requirement: Legacy expiry email [SES-2]
 *
 * Delta requirements reuse the specification convention from spec-requirements.ts
 * (`### Requirement: Title [REQ-ID]` with `#### Scenario:` blocks). The requirement ID
 * is the stable target: every modified or removed delta must name an existing
 * requirement ID of exactly one listed affected specification, and an added delta must
 * not reuse an ID that already exists there. The change only records the proposal —
 * current specifications and linked tasks stay the source of truth, so a change never
 * duplicates task plans or statuses and never edits a spec on its own.
 */

import type { Document } from "../types/index.ts";
import {
	type ParsedSpecification,
	parseSpecificationRequirements,
	type SpecificationIssue,
	type SpecRequirement,
} from "./spec-requirements.ts";

export interface ChangeLinkEntry {
	id: string;
	line: number;
}

export interface ParsedChangeDocument {
	affectedSpecs: ChangeLinkEntry[];
	linkedTasks: ChangeLinkEntry[];
	relatedDecisions: ChangeLinkEntry[];
	added: SpecRequirement[];
	modified: SpecRequirement[];
	removed: SpecRequirement[];
	issues: SpecificationIssue[];
}

const LINK_SECTION_TITLES = {
	"affected specs": "affectedSpecs",
	"linked tasks": "linkedTasks",
	"related decisions": "relatedDecisions",
} as const;

const DELTA_SECTION_TITLES = {
	"added requirements": "added",
	"modified requirements": "modified",
	"removed requirements": "removed",
} as const;

type LinkSection = (typeof LINK_SECTION_TITLES)[keyof typeof LINK_SECTION_TITLES];
type DeltaSection = (typeof DELTA_SECTION_TITLES)[keyof typeof DELTA_SECTION_TITLES];

type ParsedSectionKey = LinkSection | DeltaSection;

const LINK_SECTION_KEYS: readonly string[] = Object.values(LINK_SECTION_TITLES);
const DELTA_SECTION_KEYS: readonly string[] = Object.values(DELTA_SECTION_TITLES);

function isLinkSection(key: ParsedSectionKey | undefined): key is LinkSection {
	return key !== undefined && LINK_SECTION_KEYS.includes(key);
}

function isDeltaSection(key: ParsedSectionKey | undefined): key is DeltaSection {
	return key !== undefined && DELTA_SECTION_KEYS.includes(key);
}

const SECTION_HEADING = /^##\s+(.*)$/;
const LIST_ENTRY = /^\s*[-*]\s+(\S.*)$/;
const FENCE = /^\s*(```|~~~)/;

function resolveSectionKey(title: string): ParsedSectionKey | undefined {
	const key = title.trim().toLowerCase();
	return (
		(LINK_SECTION_TITLES as Record<string, ParsedSectionKey>)[key] ??
		(DELTA_SECTION_TITLES as Record<string, ParsedSectionKey>)[key]
	);
}

/** Parses a change document body into its link lists and requirement deltas. */
export function parseChangeDocument(content: string): ParsedChangeDocument {
	const result: ParsedChangeDocument = {
		affectedSpecs: [],
		linkedTasks: [],
		relatedDecisions: [],
		added: [],
		modified: [],
		removed: [],
		issues: [],
	};

	const lines = content.replace(/\r\n/g, "\n").split("\n");
	let current: ParsedSectionKey | undefined;
	let deltaLines: string[] = [];
	let deltaStartLine: number | undefined;
	let inFence = false;

	// Delta sections reuse the specification requirement parser. Padding the section with
	// blank lines keeps reported line numbers absolute, and duplicate-ID issues are dropped
	// here because validateChangeContent re-checks ID uniqueness across the whole change.
	const flushDeltaSection = () => {
		if (!isDeltaSection(current) || deltaStartLine === undefined) return;
		const padded = `${"\n".repeat(deltaStartLine - 1)}${deltaLines.join("\n")}`;
		const parsed = parseSpecificationRequirements(padded);
		result[current].push(...parsed.requirements);
		result.issues.push(...parsed.issues.filter((issue) => !issue.message.startsWith("Duplicate requirement ID")));
	};

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const lineNumber = index + 1;

		if (FENCE.test(line)) {
			inFence = !inFence;
			if (deltaStartLine !== undefined) deltaLines.push(line);
			continue;
		}
		if (inFence) {
			if (deltaStartLine !== undefined) deltaLines.push(line);
			continue;
		}

		const heading = line.match(SECTION_HEADING);
		if (heading) {
			flushDeltaSection();
			current = resolveSectionKey(heading[1] ?? "");
			deltaLines = [];
			deltaStartLine = isDeltaSection(current) ? lineNumber + 1 : undefined;
			continue;
		}

		if (isLinkSection(current)) {
			const entry = line.match(LIST_ENTRY);
			if (entry) {
				result[current].push({ id: (entry[1] ?? "").trim(), line: lineNumber });
			}
		} else if (deltaStartLine !== undefined) {
			deltaLines.push(line);
		}
	}
	flushDeltaSection();

	return result;
}

/** Resolves the structured links a change document references. */
export interface ChangeLinkResolver {
	/** Returns the document for a doc ID, or null when no document matches. */
	getDocument(id: string): Promise<Document | null>;
	/** Returns whether a task ID resolves to an existing task. */
	hasTask(id: string): Promise<boolean>;
	/** Returns whether a decision ID resolves to an existing decision. */
	hasDecision(id: string): Promise<boolean>;
}

/** Throws one actionable, multi-line error when a change document breaks the convention. */
export async function validateChangeContent(content: string, resolver: ChangeLinkResolver): Promise<void> {
	const parsed = parseChangeDocument(content);
	const issues: SpecificationIssue[] = [...parsed.issues];

	const affectedSpecs = new Map<string, ParsedSpecification>();
	for (const link of parsed.affectedSpecs) {
		const document = await resolver.getDocument(link.id);
		if (!document) {
			issues.push({ line: link.line, message: `Affected spec "${link.id}" does not match any document.` });
			continue;
		}
		if (document.type !== "specification") {
			issues.push({
				line: link.line,
				message: `Affected spec "${link.id}" is a ${document.type} document, not a specification.`,
			});
			continue;
		}
		// Key by the document's own ID so spelling variants of one ID cannot double-count.
		if (!affectedSpecs.has(document.id)) {
			affectedSpecs.set(document.id, parseSpecificationRequirements(document.rawContent));
		}
	}

	for (const link of parsed.linkedTasks) {
		if (!(await resolver.hasTask(link.id))) {
			issues.push({ line: link.line, message: `Linked task "${link.id}" does not exist.` });
		}
	}

	for (const link of parsed.relatedDecisions) {
		if (!(await resolver.hasDecision(link.id))) {
			issues.push({ line: link.line, message: `Related decision "${link.id}" does not exist.` });
		}
	}

	// Requirement IDs must be unique across all delta sections of the change so each
	// added/modified/removed entry targets exactly one proposal.
	const firstLineById = new Map<string, number>();
	for (const requirement of [...parsed.added, ...parsed.modified, ...parsed.removed]) {
		if (!requirement.id) continue;
		const key = requirement.id.toLowerCase();
		const firstLine = firstLineById.get(key);
		if (firstLine === undefined) {
			firstLineById.set(key, requirement.line);
		} else {
			issues.push({
				line: requirement.line,
				message: `Duplicate requirement ID "${requirement.id}" (first used on line ${firstLine}). List each requirement ID in only one delta section.`,
			});
		}
	}

	for (const requirement of parsed.added) {
		if (!requirement.id) continue;
		const holders = findSpecsHoldingRequirement(affectedSpecs, requirement.id);
		if (holders.length > 0) {
			issues.push({
				line: requirement.line,
				message: `Added requirement ID "${requirement.id}" already exists in affected spec ${holders.join(", ")}. Use "Modified requirements" to change it.`,
			});
		}
	}

	for (const [label, deltas] of [
		["Modified requirements", parsed.modified],
		["Removed requirements", parsed.removed],
	] as const) {
		for (const requirement of deltas) {
			if (!requirement.id) {
				issues.push({
					line: requirement.line,
					message: `${label === "Modified requirements" ? "Modified" : "Removed"} requirement has no ID. Use "### Requirement: <title> [REQ-ID]" to name the existing requirement.`,
				});
				continue;
			}
			const holders = findSpecsHoldingRequirement(affectedSpecs, requirement.id);
			if (holders.length === 0) {
				issues.push({
					line: requirement.line,
					message: `Requirement "${requirement.id}" does not exist in the affected specs. Add its specification to "Affected specs" or correct the ID.`,
				});
			} else if (holders.length > 1) {
				issues.push({
					line: requirement.line,
					message: `Requirement "${requirement.id}" is ambiguous: it exists in ${holders.join(" and ")}. Each ${label === "Modified requirements" ? "modified" : "removed"} requirement must name exactly one existing requirement.`,
				});
			}
		}
	}

	if (issues.length === 0) return;
	throw new Error(
		[
			"Change document is invalid:",
			...issues.sort((left, right) => left.line - right.line).map((issue) => `- line ${issue.line}: ${issue.message}`),
		].join("\n"),
	);
}

/** Returns the affected spec IDs whose requirements contain the given requirement ID. */
function findSpecsHoldingRequirement(affectedSpecs: Map<string, ParsedSpecification>, requirementId: string): string[] {
	const holders: string[] = [];
	for (const [specId, spec] of affectedSpecs) {
		if (spec.requirements.some((requirement) => requirement.id.toLowerCase() === requirementId.toLowerCase())) {
			holders.push(specId);
		}
	}
	return holders;
}
