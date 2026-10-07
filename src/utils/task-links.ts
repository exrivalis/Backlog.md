import type { Task } from "../types/index.ts";
import { extractAnyPrefix } from "./prefix-config.ts";
import { stringArraysEqual } from "./task-builders.ts";
import { taskIdsEqual } from "./task-id.ts";

/**
 * True when the reference names exactly this task rather than merely containing its ID: a URL or a
 * file path that mentions TASK-1 is not a reference to TASK-1.
 *
 * Both sides must carry a prefix, and the same one, so a bare number or a doc, draft or decision ID
 * never matches a task. Past that guard the comparison is the project's task-ID identity, not the
 * spelling: TASK-01 and TASK-1 are one task everywhere else, so a reference written either way is a
 * reference to the same record.
 */
export function isExactTaskReference(reference: string, taskId: string): boolean {
	const trimmed = reference.trim();
	if (!trimmed) {
		return false;
	}
	const taskPrefix = extractAnyPrefix(taskId);
	const referencePrefix = extractAnyPrefix(trimmed);
	if (!taskPrefix || !referencePrefix) {
		return false;
	}
	if (taskPrefix.toLowerCase() !== referencePrefix.toLowerCase()) {
		return false;
	}
	return taskIdsEqual(trimmed, taskId);
}

/**
 * The task with every dependency and reference naming `vacatedTaskId` removed, or `null` when it
 * named the ID nowhere.
 *
 * Archiving and demoting hand the ID back to the allocator, so a reference kept anywhere - on
 * another task, or on the demoted record itself, which keeps its old links under a new identity -
 * rebinds to whatever task is created next.
 */
export function withoutVacatedTaskLinks(task: Task, vacatedTaskId: string): Task | null {
	const dependencies = task.dependencies ?? [];
	const references = task.references ?? [];

	const sanitizedDependencies = dependencies.filter((dependency) => !taskIdsEqual(dependency, vacatedTaskId));
	const sanitizedReferences = references.filter((reference) => !isExactTaskReference(reference, vacatedTaskId));

	if (stringArraysEqual(dependencies, sanitizedDependencies) && stringArraysEqual(references, sanitizedReferences)) {
		return null;
	}

	return { ...task, dependencies: sanitizedDependencies, references: sanitizedReferences };
}

/**
 * The task with every dependency, reference, and parent link naming `targetId` repointed to
 * `replacementId`, or removed when it is `null`. Returns `null` when the task does not name the
 * ID anywhere, so callers write only records that actually change.
 *
 * Unlike {@link withoutVacatedTaskLinks} this covers parent links: deleting a record must not
 * leave a child whose `parent_task_id` rebinds to whatever record is allocated the ID next.
 * The matchers are the deletion preview's, so the validated update set and the applied edit
 * always describe the same references.
 */
export function repointTaskLinks(task: Task, targetId: string, replacementId: string | null): Task | null {
	const dependencies = task.dependencies ?? [];
	const references = task.references ?? [];
	const parentTaskId = task.parentTaskId;

	const updatedDependencies = replacementId
		? dependencies.map((dependency) => (taskIdsEqual(dependency, targetId) ? replacementId : dependency))
		: dependencies.filter((dependency) => !taskIdsEqual(dependency, targetId));
	const updatedReferences = replacementId
		? references.map((reference) => (isExactTaskReference(reference, targetId) ? replacementId : reference))
		: references.filter((reference) => !isExactTaskReference(reference, targetId));
	const parentMatches = parentTaskId !== undefined && taskIdsEqual(parentTaskId, targetId);
	const updatedParent = parentMatches ? (replacementId ?? undefined) : parentTaskId;

	const unchanged =
		stringArraysEqual(dependencies, updatedDependencies) &&
		stringArraysEqual(references, updatedReferences) &&
		parentTaskId === updatedParent;
	if (unchanged) return null;

	return {
		...task,
		dependencies: updatedDependencies,
		references: updatedReferences,
		parentTaskId: updatedParent,
	};
}
