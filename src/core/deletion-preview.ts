/**
 * Non-mutating preview for an explicit delete of a task, draft, or document.
 *
 * Deletion is never implicit: before any file is removed, the requester must see which active
 * structured references would break and choose cancel, unlink, or reassign. This module resolves
 * the target identity, enumerates the resolvable inbound references with their file locations,
 * reports the target's own links that go nowhere, and validates a chosen resolution down to the
 * complete reference-update set. It never writes; the destructive consumers re-validate under
 * their own locks before mutating anything.
 */

import { join, relative, sep } from "node:path";
import type { Document, Task } from "../types/index.ts";
import { buildDependencyGraph, findCycleThroughRoot } from "../utils/dependency-graph.ts";
import { documentIdsEqual, findDocumentById } from "../utils/document-id.ts";
import { isAmbiguousIdError } from "../utils/entity-id.ts";
import { extractAnyPrefix } from "../utils/prefix-config.ts";
import { canonicalTaskId, isValidTaskId, taskIdsEqual } from "../utils/task-id.ts";
import { isExactTaskReference } from "../utils/task-links.ts";
import type { Core } from "./backlog.ts";

export type DeletionEntityType = "task" | "draft" | "document";

export type DeletionReferenceRelation = "parent" | "dependency" | "reference" | "documentation";

export type DeletionResolutionAction = "cancel" | "unlink" | "reassign";

/** Disclosed with every preview: structured links are enumerable, prose is not. */
export const DELETION_FREE_TEXT_LIMIT =
	"Only structured references are listed; free-text mentions in descriptions, comments, and notes cannot be guaranteed discoverable.";

/** Recovery warning for projects where Git can restore a deleted file's committed versions. */
export const DELETION_GIT_RECOVERY_WARNING =
	"Git recovery applies only to committed files; an uncommitted deleted file may not be recoverable.";

/** Recovery warning for projects without a Git repository. */
export const DELETION_NO_GIT_WARNING =
	"This project has no Git repository; a deleted file may not be recoverable without a backup.";

const ENTITY_LABELS: Record<DeletionEntityType, string> = { task: "Task", draft: "Draft", document: "Document" };

/** One resolvable inbound structured reference that deletion would break. */
export interface DeletionPreviewReference {
	relation: DeletionReferenceRelation;
	/** The referencing record's ID. */
	sourceId: string;
	sourceTitle: string;
	/** Project-relative file that would need updating. */
	sourcePath: string;
	/** The stored spelling naming the target. */
	value: string;
}

/** A structured link recorded in the target itself that does not resolve to exactly one record. */
export interface DeletionUnresolvedLink {
	relation: DeletionReferenceRelation;
	value: string;
	reason: "missing" | "ambiguous" | "invalid";
}

export interface DeletionPreview {
	entityType: DeletionEntityType;
	requestedId: string;
	status: "found" | "invalid" | "ambiguous" | "not-found";
	/** One-line human explanation of the status, including what would be deleted. */
	message: string;
	/** Canonical ID of the resolved record; present only when status is "found". */
	targetId?: string;
	title?: string;
	/** Project-relative file deletion would remove; present only when status is "found". */
	targetPath?: string;
	references: DeletionPreviewReference[];
	unresolvedLinks: DeletionUnresolvedLink[];
}

/** One edit a validated unlink/reassign would make to a referencing record. */
export interface DeletionReferenceUpdate {
	relation: DeletionReferenceRelation;
	sourceId: string;
	sourceTitle: string;
	sourcePath: string;
	/** The stored spelling that would change. */
	value: string;
	/** The replacement spelling, or null when the reference is removed. */
	replacement: string | null;
}

export interface DeletionResolution {
	action: DeletionResolutionAction;
	replacementId?: string;
}

export interface DeletionResolutionValidation {
	action: DeletionResolutionAction;
	ok: boolean;
	errors: string[];
	/** The complete reference-update set; empty unless the resolution validates. */
	updates: DeletionReferenceUpdate[];
}

interface DeletionCorpus {
	active: Task[];
	completed: Task[];
	drafts: Task[];
	archived: Task[];
	documents: Document[];
}

/**
 * Raised when the reference scan inside the mutation locks no longer matches the preview the
 * requester approved. The destructive caller must abort: applying the approved resolution to a
 * changed reference set would touch references nobody validated.
 */
export class DeletionPreviewChangedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DeletionPreviewChangedError";
	}
}

interface ResolvedDeletionTarget {
	entityType: DeletionEntityType;
	id: string;
	title: string;
	path: string;
}

type TargetResolution =
	| { status: "found"; target: ResolvedDeletionTarget }
	| { status: "invalid" | "ambiguous" | "not-found"; message: string };

const RELATION_ORDER: Record<DeletionReferenceRelation, number> = {
	parent: 0,
	dependency: 1,
	reference: 2,
	documentation: 3,
};

/**
 * A documentation entry counts as a structured document link only when it is spelled as a
 * document ID. `documentIdKey` accepts any non-empty string, so a path or prose entry must be
 * filtered out here or it would be reported as a broken link.
 */
const DOCUMENT_ID_REFERENCE_PATTERN = /^doc-\d+(?:\.\d+)*$/i;

export function isDocumentIdReference(entry: string): boolean {
	return DOCUMENT_ID_REFERENCE_PATTERN.test(entry.trim());
}

/** Project-relative rendering of a file a delete would remove or rewrite. */
export function displayDeletionPath(core: Core, absolutePath: string): string {
	if (!absolutePath) return "(unreadable location)";
	return relative(core.fs.rootDir, absolutePath).split(sep).join("/");
}

export function documentAbsolutePath(core: Core, docsRelativePath: string): string {
	return join(core.fs.docsDir, ...docsRelativePath.split("/"));
}

export interface DeletionScanTarget {
	entityType: DeletionEntityType;
	id: string;
}

/**
 * Load every record that could reference a deletion target in any direction. The destructive
 * consumers reload this inside their locks: the preview's corpus is an unlocked point-in-time read.
 */
export async function loadDeletionCorpus(core: Core): Promise<DeletionCorpus> {
	const [active, completed, drafts, archived, documents] = await Promise.all([
		core.fs.listTasks(),
		core.fs.listCompletedTasks(),
		core.fs.listDrafts(),
		core.fs.listArchivedTasks(),
		core.fs.listDocuments(),
	]);
	return { active, completed, drafts, archived, documents };
}

async function resolveDeletionTarget(
	core: Core,
	entityType: DeletionEntityType,
	requestedId: string,
): Promise<TargetResolution> {
	const trimmed = requestedId.trim();
	if (!trimmed) {
		return { status: "invalid", message: `${ENTITY_LABELS[entityType]} ID is empty. Nothing would be deleted.` };
	}
	try {
		if (entityType === "document") {
			const document = await findDocumentById(await core.fs.listDocuments(), trimmed);
			return document
				? {
						status: "found",
						target: {
							entityType,
							id: document.id,
							title: document.title,
							path: documentAbsolutePath(core, document.path ?? `${document.id}.md`),
						},
					}
				: { status: "not-found", message: `Document ${trimmed} not found. Nothing would be deleted.` };
		}
		if (entityType === "draft") {
			const draft = await core.fs.loadDraft(trimmed);
			return draft
				? { status: "found", target: { entityType, id: draft.id, title: draft.title, path: draft.filePath ?? "" } }
				: { status: "not-found", message: `Draft ${trimmed} not found. Nothing would be deleted.` };
		}
		if (!isValidTaskId(trimmed)) {
			return {
				status: "invalid",
				message: `Task ID "${trimmed}" is not a valid task ID. Nothing would be deleted.`,
			};
		}
		const task = await core.loadTaskById(trimmed, { includeCrossBranch: false });
		return task
			? { status: "found", target: { entityType, id: task.id, title: task.title, path: task.filePath ?? "" } }
			: { status: "not-found", message: `Task ${trimmed} not found. Nothing would be deleted.` };
	} catch (error) {
		if (isAmbiguousIdError(error)) {
			return { status: "ambiguous", message: `${error.message} Nothing would be deleted.` };
		}
		throw error;
	}
}

/**
 * Every resolvable inbound structured reference to `target` in the given corpus. The preview and
 * the destructive consumers share this one scan so the validated update set and the applied edit
 * always describe the same references.
 */
export function scanDeletionReferences(
	corpus: DeletionCorpus,
	target: DeletionScanTarget,
	core: Core,
): DeletionPreviewReference[] {
	const references: DeletionPreviewReference[] = [];
	const push = (relation: DeletionReferenceRelation, record: Task, value: string, filePath: string | undefined) => {
		references.push({
			relation,
			sourceId: record.id,
			sourceTitle: record.title,
			sourcePath: displayDeletionPath(core, filePath ?? ""),
			value,
		});
	};

	if (target.entityType === "document") {
		for (const record of [...corpus.active, ...corpus.completed, ...corpus.drafts]) {
			for (const entry of record.documentation ?? []) {
				if (!isDocumentIdReference(entry)) continue;
				if (documentIdsEqual(entry, target.id)) push("documentation", record, entry, record.filePath);
			}
		}
		return sortReferences(references);
	}

	for (const record of [...corpus.active, ...corpus.completed, ...corpus.drafts]) {
		if (taskIdsEqual(record.id, target.id)) continue;
		if (record.parentTaskId && taskIdsEqual(record.parentTaskId, target.id)) {
			push("parent", record, record.parentTaskId, record.filePath);
		}
		for (const dependency of record.dependencies ?? []) {
			if (taskIdsEqual(dependency, target.id)) push("dependency", record, dependency, record.filePath);
		}
		for (const reference of record.references ?? []) {
			if (isExactTaskReference(reference, target.id)) push("reference", record, reference, record.filePath);
		}
	}
	return sortReferences(references);
}

function sortReferences(references: DeletionPreviewReference[]): DeletionPreviewReference[] {
	const seen = new Set<string>();
	const deduplicated = references.filter((reference) => {
		const key = `${reference.sourceId}|${reference.relation}|${reference.value}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return deduplicated.sort(
		(left, right) =>
			left.sourcePath.localeCompare(right.sourcePath) ||
			RELATION_ORDER[left.relation] - RELATION_ORDER[right.relation] ||
			left.value.localeCompare(right.value),
	);
}

function unresolvedLinksInTarget(corpus: DeletionCorpus, target: ResolvedDeletionTarget): DeletionUnresolvedLink[] {
	if (target.entityType === "document") return [];
	const record = [...corpus.active, ...corpus.completed, ...corpus.drafts].find((candidate) =>
		taskIdsEqual(candidate.id, target.id),
	);
	if (!record) return [];

	const unresolved: DeletionUnresolvedLink[] = [];
	const taskCorpus = [...corpus.active, ...corpus.completed, ...corpus.drafts, ...corpus.archived];
	const taskMatchCount = (entry: string) => taskCorpus.filter((candidate) => taskIdsEqual(entry, candidate.id)).length;
	const report = (relation: DeletionReferenceRelation, value: string, count: number) => {
		if (count === 1) return;
		unresolved.push({ relation, value, reason: count > 1 ? "ambiguous" : "missing" });
	};

	if (record.parentTaskId) {
		report(
			"parent",
			record.parentTaskId,
			[...corpus.active, ...corpus.completed].filter((candidate) =>
				taskIdsEqual(record.parentTaskId ?? "", candidate.id),
			).length,
		);
	}
	for (const dependency of record.dependencies ?? []) {
		const trimmed = dependency.trim();
		if (!trimmed || !isValidTaskId(trimmed)) {
			unresolved.push({ relation: "dependency", value: dependency, reason: "invalid" });
			continue;
		}
		report("dependency", dependency, taskMatchCount(trimmed));
	}
	const targetPrefix = extractAnyPrefix(target.id)?.toLowerCase();
	if (targetPrefix) {
		for (const reference of record.references ?? []) {
			const trimmed = reference.trim();
			if (extractAnyPrefix(trimmed)?.toLowerCase() !== targetPrefix || !isValidTaskId(trimmed)) continue;
			report("reference", reference, taskMatchCount(trimmed));
		}
	}
	for (const entry of record.documentation ?? []) {
		if (!isDocumentIdReference(entry)) continue;
		report("documentation", entry, corpus.documents.filter((document) => documentIdsEqual(entry, document.id)).length);
	}
	return unresolved.sort(
		(left, right) =>
			RELATION_ORDER[left.relation] - RELATION_ORDER[right.relation] || left.value.localeCompare(right.value),
	);
}

/**
 * Resolve the deletion preview for one entity ID without reading or writing anything the preview
 * does not report.
 */
export async function buildDeletionPreview(
	core: Core,
	entityType: DeletionEntityType,
	requestedId: string,
): Promise<DeletionPreview> {
	const trimmedId = requestedId.trim();
	const resolution = await resolveDeletionTarget(core, entityType, trimmedId);
	if (resolution.status !== "found") {
		return {
			entityType,
			requestedId: trimmedId,
			status: resolution.status,
			message: resolution.message,
			references: [],
			unresolvedLinks: [],
		};
	}
	const corpus = await loadDeletionCorpus(core);
	return {
		entityType,
		requestedId: trimmedId,
		status: "found",
		message: `${ENTITY_LABELS[entityType]} ${resolution.target.id} would be deleted.`,
		targetId: resolution.target.id,
		title: resolution.target.title,
		targetPath: displayDeletionPath(core, resolution.target.path),
		references: scanDeletionReferences(corpus, resolution.target, core),
		unresolvedLinks: unresolvedLinksInTarget(corpus, resolution.target),
	};
}

/** The recovery warning that matches the project: Git restores only committed files. */
export async function deletionRecoveryWarning(core: Core): Promise<string> {
	return (await core.git.isRepository()) ? DELETION_GIT_RECOVERY_WARNING : DELETION_NO_GIT_WARNING;
}

type ResolvedReplacement =
	| { kind: "task"; id: string; corpus: "active" | "completed" | "drafts" | "archived" }
	| { kind: "document"; id: string };

function resolveReplacement(
	corpus: DeletionCorpus,
	entityType: DeletionEntityType,
	replacementId: string,
): ResolvedReplacement | { error: string } {
	if (entityType === "document") {
		const matches = corpus.documents.filter((document) => documentIdsEqual(replacementId, document.id));
		if (matches.length === 0) return { error: `Document ${replacementId} not found.` };
		if (matches.length > 1) {
			return {
				error: `Document ID ${replacementId} is ambiguous; ${matches.length} files match: ${matches
					.map((document) => document.path ?? document.title)
					.join(", ")}. Run 'backlog doctor' to review the conflicting files.`,
			};
		}
		const document = matches[0];
		return document ? { kind: "document", id: document.id } : { error: `Document ${replacementId} not found.` };
	}
	type TaskCorpus = Extract<ResolvedReplacement, { kind: "task" }>["corpus"];
	const located: Array<{ id: string; corpus: TaskCorpus }> = [];
	for (const [records, corpusName] of [
		[corpus.active, "active"],
		[corpus.completed, "completed"],
		[corpus.drafts, "drafts"],
		[corpus.archived, "archived"],
	] as const) {
		for (const record of records) {
			if (taskIdsEqual(replacementId, record.id)) located.push({ id: record.id, corpus: corpusName });
		}
	}
	if (located.length === 0) {
		return { error: `${replacementId} does not match exactly one task or draft.` };
	}
	if (located.length > 1) {
		return {
			error: `${replacementId} is ambiguous; ${located.length} records claim it. Run 'backlog doctor' to review the conflicting files.`,
		};
	}
	const found = located[0];
	return found ? { kind: "task", id: found.id, corpus: found.corpus } : { error: `${replacementId} not found.` };
}

function replacementErrorsForRelations(
	corpus: DeletionCorpus,
	preview: DeletionPreview,
	replacement: Extract<ResolvedReplacement, { kind: "task" }>,
): string[] {
	const errors: string[] = [];
	const targetId = preview.targetId ?? "";
	const sources = new Map<string, DeletionPreviewReference[]>();
	for (const reference of preview.references) {
		const group = sources.get(reference.sourceId);
		if (group) group.push(reference);
		else sources.set(reference.sourceId, [reference]);
	}

	for (const [sourceId, references] of sources) {
		const sourceRecord = [...corpus.active, ...corpus.completed, ...corpus.drafts].find((candidate) =>
			taskIdsEqual(candidate.id, sourceId),
		);
		if (!sourceRecord) continue;
		for (const reference of references) {
			if (reference.relation === "dependency") {
				if (taskIdsEqual(replacement.id, sourceId)) {
					errors.push(`${sourceId} cannot depend on itself ("${reference.value}" names this task).`);
				}
				continue;
			}
			if (reference.relation === "parent") {
				if (replacement.corpus === "drafts" || replacement.corpus === "archived") {
					errors.push(
						`Parent references must be reassigned to a task; ${replacement.id} is ${replacement.corpus === "drafts" ? "a draft" : "archived"}.`,
					);
					continue;
				}
				if (taskIdsEqual(replacement.id, sourceId)) {
					errors.push(`${sourceId} cannot be its own parent.`);
					continue;
				}
				const cycle = findParentCycle(corpus, sourceId, replacement.id);
				if (cycle) {
					errors.push(
						`Reassigning the parent of ${sourceId} to ${replacement.id} would create a parent cycle: ${cycle.join(" -> ")}`,
					);
				}
				continue;
			}
			if (reference.relation === "reference") {
				const targetPrefix = extractAnyPrefix(targetId)?.toLowerCase();
				if (targetPrefix && extractAnyPrefix(replacement.id)?.toLowerCase() !== targetPrefix) {
					errors.push(
						`References must be reassigned within the ${targetPrefix}- namespace; ${replacement.id} names a different record type.`,
					);
				}
			}
		}
		if (references.some((reference) => reference.relation === "dependency")) {
			const cycleError = dependencyCycleError(corpus, sourceRecord, targetId, replacement.id);
			if (cycleError) errors.push(cycleError);
		}
	}
	return errors;
}

function dependencyCycleError(
	corpus: DeletionCorpus,
	sourceRecord: Task,
	targetId: string,
	replacementId: string,
): string | null {
	const replacedDependencies = (sourceRecord.dependencies ?? []).map((dependency) =>
		taskIdsEqual(dependency, targetId) ? replacementId : dependency,
	);
	const withoutSource = (records: Task[]) => records.filter((record) => !taskIdsEqual(record.id, sourceRecord.id));
	const graph = buildDependencyGraph(
		{ ...sourceRecord, dependencies: replacedDependencies },
		{
			tasks: withoutSource([...corpus.active, ...corpus.drafts, ...corpus.archived]),
			completedTasks: withoutSource(corpus.completed),
		},
	);
	const cycle = findCycleThroughRoot(graph);
	if (cycle) {
		return `Reassigning ${sourceRecord.id}'s dependencies would create a cycle: ${cycle.join(" -> ")}`;
	}
	const ambiguous = graph.nodes.find((node) => node.state === "ambiguous" && node.dependencyDepth !== null);
	if (ambiguous) {
		return `Cannot verify the dependencies stay acyclic: more than one record claims ${ambiguous.id}. Run 'backlog doctor' to repair duplicate IDs first.`;
	}
	return null;
}

function findParentCycle(corpus: DeletionCorpus, sourceId: string, replacementId: string): string[] | null {
	const parentsById = new Map(
		[...corpus.active, ...corpus.completed].map((record) => [canonicalTaskId(record.id), record.parentTaskId] as const),
	);
	// Walk the replacement's parent chain; reaching the reassigned child closes a cycle. A cycle
	// elsewhere in the chain (a visited repeat) already exists and is not this reassignment's doing.
	const chain: string[] = [];
	const visited = new Set<string>();
	let cursor: string | undefined = canonicalTaskId(replacementId);
	while (cursor && !visited.has(cursor)) {
		if (taskIdsEqual(cursor, sourceId)) {
			return [...chain, sourceId];
		}
		visited.add(cursor);
		chain.push(cursor);
		const parent = parentsById.get(cursor);
		cursor = parent ? canonicalTaskId(parent) : undefined;
	}
	return null;
}

/**
 * Validate a cancel/unlink/reassign choice against a preview and return the complete
 * reference-update set it would apply. A failed validation returns no updates at all: the
 * destructive consumers must never apply a partial set.
 *
 * The corpus-taking form is the one destructive consumers call inside their locks; the Core-taking
 * form is a convenience for unlocked validation.
 */
export async function validateDeletionResolutionForCorpus(
	corpus: DeletionCorpus,
	preview: DeletionPreview,
	resolution: DeletionResolution,
): Promise<DeletionResolutionValidation> {
	const empty = { action: resolution.action, errors: [], updates: [] as DeletionReferenceUpdate[] };
	if (preview.status !== "found") {
		return { ...empty, ok: false, errors: [preview.message] };
	}
	if (resolution.action === "cancel") {
		return { ...empty, ok: true };
	}
	if (preview.references.length === 0) {
		return {
			...empty,
			ok: false,
			errors: [`${preview.targetId} has no active structured references to ${resolution.action}.`],
		};
	}
	const toUpdate =
		(replacement: string | null) =>
		(reference: DeletionPreviewReference): DeletionReferenceUpdate => ({
			relation: reference.relation,
			sourceId: reference.sourceId,
			sourceTitle: reference.sourceTitle,
			sourcePath: reference.sourcePath,
			value: reference.value,
			replacement,
		});

	if (resolution.action === "unlink") {
		return { ...empty, ok: true, updates: preview.references.map(toUpdate(null)) };
	}

	const replacementId = resolution.replacementId?.trim();
	if (!replacementId) {
		return { ...empty, ok: false, errors: ["A replacement ID is required to reassign references."] };
	}
	const replacement = resolveReplacement(corpus, preview.entityType, replacementId);
	if ("error" in replacement) {
		return { ...empty, ok: false, errors: [replacement.error] };
	}
	const targetId = preview.targetId ?? "";
	const sameIdentity =
		replacement.kind === "document"
			? documentIdsEqual(replacement.id, targetId)
			: taskIdsEqual(replacement.id, targetId);
	if (sameIdentity) {
		return {
			...empty,
			ok: false,
			errors: [`References cannot be reassigned to ${replacement.id}: it is the record being deleted.`],
		};
	}
	if (replacement.kind === "task") {
		const errors = replacementErrorsForRelations(corpus, preview, replacement);
		if (errors.length > 0) {
			return { ...empty, ok: false, errors };
		}
	}
	return { ...empty, ok: true, updates: preview.references.map(toUpdate(replacement.id)) };
}

/** Unlocked validation over a freshly loaded corpus; see {@link validateDeletionResolutionForCorpus}. */
export async function validateDeletionResolution(
	core: Core,
	preview: DeletionPreview,
	resolution: DeletionResolution,
): Promise<DeletionResolutionValidation> {
	return await validateDeletionResolutionForCorpus(await loadDeletionCorpus(core), preview, resolution);
}

const RELATION_LABELS: Record<DeletionReferenceRelation, string> = {
	parent: "parent link",
	dependency: "dependency",
	reference: "reference",
	documentation: "documentation link",
};

const UNRESOLVED_REASONS: Record<DeletionUnresolvedLink["reason"], string> = {
	missing: "resolves to no record",
	ambiguous: "matches several records",
	invalid: "is not a valid ID",
};

export interface FormatDeletionPreviewOptions {
	/** The recovery warning matching the project, from {@link deletionRecoveryWarning}. */
	recoveryWarning?: string;
}

/** Render the preview and an optional validated resolution as plain text. */
export function formatDeletionPreview(
	preview: DeletionPreview,
	validation?: DeletionResolutionValidation,
	options?: FormatDeletionPreviewOptions,
): string {
	if (preview.status !== "found") {
		return preview.message;
	}
	const lines: string[] = [];
	const label = ENTITY_LABELS[preview.entityType];
	lines.push(`${label} ${preview.targetId} - ${preview.title}`);
	lines.push(`File: ${preview.targetPath}`);
	lines.push("");
	if (preview.references.length === 0) {
		lines.push("No active structured references.");
	} else {
		lines.push(`Active structured references (${preview.references.length}):`);
		for (const reference of preview.references) {
			lines.push(
				`  ${RELATION_LABELS[reference.relation]} from ${reference.sourceId} - ${reference.sourceTitle} (${reference.sourcePath})`,
			);
		}
	}
	if (preview.unresolvedLinks.length > 0) {
		lines.push("");
		lines.push("Unresolved links in this record:");
		for (const link of preview.unresolvedLinks) {
			lines.push(`  ${RELATION_LABELS[link.relation]} "${link.value}" ${UNRESOLVED_REASONS[link.reason]}`);
		}
	}

	lines.push("");
	const action = validation?.action ?? "cancel";
	if (action === "cancel") {
		if (preview.references.length > 0) {
			lines.push(
				`Deletion would be canceled: ${preview.references.length} active reference${preview.references.length === 1 ? "" : "s"} require --unlink or --reassign-to.`,
			);
		}
	} else if (validation?.ok) {
		lines.push(
			action === "unlink"
				? `Resolution: unlink ${preview.references.length} reference${preview.references.length === 1 ? "" : "s"}:`
				: `Resolution: reassign to ${validation.updates[0]?.replacement ?? ""}:`,
		);
		for (const update of validation.updates) {
			lines.push(
				`  ${update.sourceId} ${RELATION_LABELS[update.relation]} "${update.value}" -> ${
					update.replacement === null ? "removed" : `"${update.replacement}"`
				} (${update.sourcePath})`,
			);
		}
	} else if (validation && !validation.ok) {
		lines.push("Resolution rejected:");
		for (const error of validation.errors) {
			lines.push(`  - ${error}`);
		}
	}

	lines.push("");
	lines.push(DELETION_FREE_TEXT_LIMIT);
	if (options?.recoveryWarning) {
		lines.push(options.recoveryWarning);
	}
	lines.push("Nothing has been deleted or modified.");
	return lines.join("\n");
}
