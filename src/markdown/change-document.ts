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
 * not reuse an ID that already exists there. An added requirement must also resolve to
 * exactly one affected specification, so `backlog doc preview` can show where it lands;
 * split additions across one change per specification.
 *
 * `backlog doc validate` and `backlog doc preview` are read-only: they never modify a
 * file. Preview projects each affected specification from the same validated deltas and
 * prints per-spec requirement diffs plus the resulting specification text.
 *
 * Each save of a change without a Baselines section records one: the content hash of
 * every affected specification at proposal time, in a managed section the CLI owns:
 *
 *   ## Baselines
 *
 *   - doc-12: 3f7a...
 *
 * Validate compares each recorded baseline against the current specification and
 * rejects the change as stale when the specification moved after the proposal was
 * written. Old specifications stay valid: a change without recorded baselines only
 * skips the staleness check.
 *
 * The change only records the proposal — current specifications and linked tasks stay
 * the source of truth, so a change never duplicates task plans or statuses and never
 * edits a spec on its own.
 */

import { createHash } from "node:crypto";
import type { Document } from "../types/index.ts";
import {
	type ParsedSpecification,
	parseSpecificationRequirements,
	requirementBlockRange,
	type SpecificationIssue,
	type SpecRequirement,
} from "./spec-requirements.ts";

export interface ChangeLinkEntry {
	id: string;
	line: number;
}

/** One recorded per-specification baseline inside the managed Baselines section. */
export interface ChangeBaselineEntry {
	specId: string;
	hash: string;
	line: number;
}

export interface ParsedChangeDocument {
	affectedSpecs: ChangeLinkEntry[];
	linkedTasks: ChangeLinkEntry[];
	relatedDecisions: ChangeLinkEntry[];
	baselines: ChangeBaselineEntry[];
	added: SpecRequirement[];
	modified: SpecRequirement[];
	removed: SpecRequirement[];
	issues: SpecificationIssue[];
}

const LINK_SECTION_TITLES = {
	"affected specs": "affectedSpecs",
	"linked tasks": "linkedTasks",
	"related decisions": "relatedDecisions",
	baselines: "baselines",
} as const;

const DELTA_SECTION_TITLES = {
	"added requirements": "added",
	"modified requirements": "modified",
	"removed requirements": "removed",
} as const;

type LinkSection = Exclude<(typeof LINK_SECTION_TITLES)[keyof typeof LINK_SECTION_TITLES], "baselines">;
type DeltaSection = (typeof DELTA_SECTION_TITLES)[keyof typeof DELTA_SECTION_TITLES];

type ParsedSectionKey = LinkSection | "baselines" | DeltaSection;

const LINK_SECTION_KEYS: readonly string[] = Object.values(LINK_SECTION_TITLES);
const DELTA_SECTION_KEYS: readonly string[] = Object.values(DELTA_SECTION_TITLES);

function isLinkSection(key: ParsedSectionKey | undefined): key is LinkSection {
	return key !== undefined && LINK_SECTION_KEYS.includes(key) && key !== "baselines";
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

/** Parses a change document body into its link lists, baselines, and requirement deltas. */
export function parseChangeDocument(content: string): ParsedChangeDocument {
	const result: ParsedChangeDocument = {
		affectedSpecs: [],
		linkedTasks: [],
		relatedDecisions: [],
		baselines: [],
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

		if (current === "baselines") {
			const entry = line.match(LIST_ENTRY);
			if (entry) {
				const text = (entry[1] ?? "").trim();
				const separator = text.indexOf(":");
				result.baselines.push({
					specId: (separator === -1 ? text : text.slice(0, separator)).trim(),
					hash: separator === -1 ? "" : text.slice(separator + 1).trim(),
					line: lineNumber,
				});
			}
		} else if (isLinkSection(current)) {
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

/** Deterministic baseline fingerprint of specification content. */
export function specBaselineHash(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function trimTrailingBlankLines(lines: string[]): string[] {
	const trimmed = [...lines];
	while (trimmed.length > 0 && (trimmed.at(-1) ?? "").trim() === "") trimmed.pop();
	return trimmed;
}

/**
 * Rewrites the managed Baselines section: strips any existing one, then records one
 * entry per given specification, ordered by spec ID. An empty map only strips.
 */
export function withRecordedBaselines(content: string, baselines: Map<string, string>): string {
	const lines = content.replace(/\r\n/g, "\n").split("\n");
	const kept: string[] = [];
	let skipping = false;
	for (const line of lines) {
		if (skipping) {
			if (SECTION_HEADING.test(line)) {
				skipping = false;
			} else {
				continue;
			}
		}
		const heading = line.match(SECTION_HEADING);
		if (heading && resolveSectionKey(heading[1] ?? "") === "baselines") {
			skipping = true;
			continue;
		}
		kept.push(line);
	}
	const body = trimTrailingBlankLines(kept).join("\n");
	if (baselines.size === 0) {
		return body ? `${body}\n` : content;
	}
	const entries = [...baselines.entries()]
		.sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase()))
		.map(([specId, hash]) => `- ${specId}: ${hash}`);
	return `${body ? `${body}\n\n` : ""}## Baselines\n\n${entries.join("\n")}\n`;
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

export interface ChangeValidationOptions {
	/**
	 * Skip recorded-baseline checks. Saving uses this: it records baselines instead of
	 * enforcing them, and it must not reject a change whose baselines went stale.
	 */
	ignoreRecordedBaselines?: boolean;
}

interface CollectedChangeIssues {
	issues: SpecificationIssue[];
	parsed: ParsedChangeDocument;
	affectedSpecs: Map<string, ParsedSpecification>;
	specDocuments: Map<string, Document>;
}

/** Collects every actionable issue in a change document against the current project state. */
async function collectChangeIssues(
	content: string,
	resolver: ChangeLinkResolver,
	options: ChangeValidationOptions = {},
): Promise<CollectedChangeIssues> {
	const parsed = parseChangeDocument(content);
	const issues: SpecificationIssue[] = [...parsed.issues];

	const affectedSpecs = new Map<string, ParsedSpecification>();
	const specDocuments = new Map<string, Document>();
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
			specDocuments.set(document.id, document);
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

	if (!options.ignoreRecordedBaselines) {
		const recordedBaselines = new Map<string, ChangeBaselineEntry>();
		for (const baseline of parsed.baselines) {
			const specId = [...specDocuments.keys()].find((id) => id.toLowerCase() === baseline.specId.toLowerCase());
			if (!specId) {
				issues.push({
					line: baseline.line,
					message: `Baseline references ${baseline.specId}, which is not listed under "Affected specs".`,
				});
				continue;
			}
			if (!baseline.hash) {
				issues.push({ line: baseline.line, message: `Baseline for ${baseline.specId} has no content hash.` });
				continue;
			}
			const existing = recordedBaselines.get(specId.toLowerCase());
			if (existing) {
				issues.push({
					line: baseline.line,
					message: `Duplicate baseline for ${baseline.specId} (first recorded on line ${existing.line}). Record one baseline per affected specification.`,
				});
				continue;
			}
			recordedBaselines.set(specId.toLowerCase(), baseline);
			const document = specDocuments.get(specId);
			if (document && baseline.hash !== specBaselineHash(document.rawContent)) {
				issues.push({
					line: baseline.line,
					message: `Recorded baseline for ${specId} is stale: the specification changed after this change was written. Save the change content again without its Baselines section to re-record it.`,
				});
			}
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
		if (!requirement.id) {
			issues.push({
				line: requirement.line,
				message: `Added requirement has no ID. Use "### Requirement: <title> [REQ-ID]" so preview can place the addition.`,
			});
			continue;
		}
		const holders = findSpecsHoldingRequirement(affectedSpecs, requirement.id);
		if (holders.length > 0) {
			issues.push({
				line: requirement.line,
				message: `Added requirement ID "${requirement.id}" already exists in affected spec ${holders.join(", ")}. Use "Modified requirements" to change it.`,
			});
		} else if (affectedSpecs.size > 1) {
			issues.push({
				line: requirement.line,
				message: `Added requirement "${requirement.id}" is ambiguous: it could join ${[...affectedSpecs.keys()].join(" or ")}. Keep additions in a change that lists one affected specification.`,
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

	issues.sort((left, right) => left.line - right.line);
	return { issues, parsed, affectedSpecs, specDocuments };
}

/** Throws one actionable, multi-line error when a change document breaks the convention. */
export async function validateChangeContent(
	content: string,
	resolver: ChangeLinkResolver,
	options: ChangeValidationOptions = {},
): Promise<void> {
	const { issues } = await collectChangeIssues(content, resolver, options);
	if (issues.length === 0) return;
	throw new Error(
		["Change document is invalid:", ...issues.map((issue) => `- line ${issue.line}: ${issue.message}`)].join("\n"),
	);
}

export interface ChangePreviewLine {
	kind: "added" | "removed" | "context";
	text: string;
}

export interface ChangeSpecPreview {
	specId: string;
	title: string;
	diff: ChangePreviewLine[];
	resultingContent: string;
}

export interface ChangePreview {
	documentId: string;
	changeTitle: string;
	valid: boolean;
	issues: SpecificationIssue[];
	specs: ChangeSpecPreview[];
}

interface SpecEdit {
	start: number;
	end: number;
	replacement: string[];
}

function joinContentLines(lines: string[]): string {
	const body = trimTrailingBlankLines(lines);
	return body.length > 0 ? `${body.join("\n")}\n` : "";
}

/** Applies block edits inside-out and appends addition blocks with one blank-line separator. */
function projectSpecContent(specLines: string[], edits: SpecEdit[], appendedBlocks: string[][]): string {
	const lines = [...specLines];
	for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
		lines.splice(edit.start, edit.end - edit.start, ...edit.replacement);
	}
	for (const block of appendedBlocks) {
		if (lines.length > 0 && (lines.at(-1) ?? "").trim() !== "") lines.push("");
		lines.push(...block);
	}
	return joinContentLines(lines);
}

/**
 * Renders the structured edits positionally: unchanged context lines, then each edited
 * requirement block as its removed lines followed by its added lines, then appended
 * additions. Because edits are known, no line-guessing diff is needed and blocks stay
 * requirement-aligned.
 */
function blockDiff(specLines: string[], edits: SpecEdit[], appendedBlocks: string[][]): ChangePreviewLine[] {
	const out: ChangePreviewLine[] = [];
	const pushContext = (texts: string[]) => {
		for (const text of texts) {
			if (!text && out.at(-1)?.kind === "context" && out.at(-1)?.text === "") continue;
			out.push({ kind: "context", text });
		}
	};
	const pushLines = (kind: ChangePreviewLine["kind"], texts: string[]) => {
		for (const text of texts) out.push({ kind, text });
	};

	let cursor = 0;
	for (const edit of [...edits].sort((left, right) => left.start - right.start)) {
		pushContext(specLines.slice(cursor, edit.start));
		pushLines("removed", trimTrailingBlankLines(specLines.slice(edit.start, edit.end)));
		const added = trimTrailingBlankLines(edit.replacement);
		if (added.length > 0) {
			pushContext([""]);
			pushLines("added", added);
		}
		pushContext([""]);
		cursor = edit.end;
	}
	pushContext(specLines.slice(cursor));
	for (const block of appendedBlocks) {
		pushContext([""]);
		pushLines("added", block);
	}
	while (out.length > 0 && out.at(-1)?.text === "") out.pop();
	return out;
}

/**
 * Validates a change document and projects every affected specification from the same
 * validated deltas, without touching any file. The returned preview carries every
 * actionable issue when invalid, and per-spec diffs plus the resulting specification
 * text when valid.
 */
export async function buildChangeDocumentPreview(
	document: Document,
	resolver: ChangeLinkResolver,
): Promise<ChangePreview> {
	const { issues, parsed, affectedSpecs, specDocuments } = await collectChangeIssues(document.rawContent, resolver);
	const preview: ChangePreview = {
		documentId: document.id,
		changeTitle: document.title,
		valid: issues.length === 0,
		issues,
		specs: [],
	};
	if (!preview.valid) return preview;

	const changeLines = document.rawContent.replace(/\r\n/g, "\n").split("\n");
	const deltaBlock = (requirement: SpecRequirement): string[] => {
		const range = requirementBlockRange(changeLines, requirement.line - 1);
		return trimTrailingBlankLines(changeLines.slice(range.start, range.end));
	};

	// Validation guarantees a single affected specification once additions resolve.
	const additionsBySpec = new Map<string, SpecRequirement[]>();
	const singleSpecId = [...specDocuments.keys()][0];
	if (specDocuments.size === 1 && singleSpecId) {
		const additions = parsed.added.filter((requirement) => requirement.id);
		if (additions.length > 0) additionsBySpec.set(singleSpecId, additions);
	}

	const editsBySpec = new Map<string, Array<{ kind: "modified" | "removed"; requirement: SpecRequirement }>>();
	for (const [kind, deltas] of [
		["modified", parsed.modified],
		["removed", parsed.removed],
	] as const) {
		for (const requirement of deltas) {
			if (!requirement.id) continue;
			const holders = findSpecsHoldingRequirement(affectedSpecs, requirement.id);
			if (holders.length !== 1 || !holders[0]) continue;
			const list = editsBySpec.get(holders[0]) ?? [];
			list.push({ kind, requirement });
			editsBySpec.set(holders[0], list);
		}
	}

	const byLowerId = new Map([...specDocuments.entries()].map(([id, doc]) => [id.toLowerCase(), doc] as const));
	const seen = new Set<string>();
	for (const link of parsed.affectedSpecs) {
		const spec = byLowerId.get(link.id.toLowerCase());
		if (!spec || seen.has(spec.id)) continue;
		seen.add(spec.id);

		const specParsed = affectedSpecs.get(spec.id);
		const specLines = spec.rawContent.replace(/\r\n/g, "\n").split("\n");
		const edits: SpecEdit[] = [];
		for (const { kind, requirement } of editsBySpec.get(spec.id) ?? []) {
			const target = specParsed?.requirements.find(
				(candidate) => candidate.id.toLowerCase() === (requirement.id ?? "").toLowerCase(),
			);
			if (!target) continue;
			const range = requirementBlockRange(specLines, target.line - 1);
			edits.push({
				start: range.start,
				end: range.end,
				replacement:
					kind === "removed" ? [] : [...deltaBlock(requirement), ...(range.end < specLines.length ? [""] : [])],
			});
		}
		const appended = (additionsBySpec.get(spec.id) ?? []).map(deltaBlock);
		const resulting =
			edits.length === 0 && appended.length === 0 ? spec.rawContent : projectSpecContent(specLines, edits, appended);
		preview.specs.push({
			specId: spec.id,
			title: spec.title,
			diff: blockDiff(specLines, edits, appended),
			resultingContent: resulting,
		});
	}

	return preview;
}

/** Renders a preview as plain text for `backlog doc validate` and `backlog doc preview`. */
export function formatChangePreview(preview: ChangePreview): string {
	const lines: string[] = [
		`Change ${preview.documentId} "${preview.changeTitle}" is ${preview.valid ? "valid" : "invalid"}.`,
	];
	if (!preview.valid) {
		lines.push("", "Errors:");
		for (const issue of preview.issues) {
			lines.push(`- line ${issue.line}: ${issue.message}`);
		}
	} else if (preview.specs.length === 0) {
		lines.push("", "No affected specifications to preview.");
	} else {
		for (const spec of preview.specs) {
			lines.push("", `${spec.specId} - ${spec.title}`, "");
			if (spec.diff.length === 0) {
				lines.push("(no requirement changes)");
			} else {
				for (const line of spec.diff) {
					if (line.kind === "added") lines.push(line.text ? `+ ${line.text}` : "+");
					else if (line.kind === "removed") lines.push(line.text ? `- ${line.text}` : "-");
					else lines.push(line.text ? `  ${line.text}` : "");
				}
			}
			lines.push("", `Resulting ${spec.specId} - ${spec.title}:`, "", spec.resultingContent.trimEnd());
		}
	}
	lines.push("", "Validation and preview do not modify any files.");
	return lines.join("\n");
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
