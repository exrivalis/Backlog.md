import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import {
	buildDeletionPreview,
	DELETION_FREE_TEXT_LIMIT,
	DELETION_GIT_RECOVERY_WARNING,
	DELETION_NO_GIT_WARNING,
	type DeletionPreview,
	type DeletionReferenceRelation,
	deletionRecoveryWarning,
	formatDeletionPreview,
	validateDeletionResolution,
} from "../core/deletion-preview.ts";
import { serializeTask } from "../markdown/serializer.ts";
import type { Task } from "../types/index.ts";
import { initializeFilesystemTestProject, initializeTestProject } from "./test-utils.ts";

function makeTask(id: string, title: string, fields: Partial<Task> = {}): Task {
	return {
		id,
		title,
		status: "To Do",
		assignee: [],
		createdDate: "2024-01-01",
		labels: [],
		dependencies: [],
		...fields,
	};
}

interface Fixture {
	core: Core;
	rootDir: string;
}

async function seedLinkedProject(core: Core): Promise<void> {
	await core.createTask(makeTask("task-1", "Target"), false);
	await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);
	await core.createTask(makeTask("task-3", "Referencing", { references: ["TASK-1"] }), false);
	await core.createTask(makeTask("task-4", "Child", { parentTaskId: "task-1" }), false);
	await core.createTask(makeTask("task-5", "Unrelated"), false);
	await core.createTask(
		makeTask("task-6", "Dangling", {
			dependencies: ["junk", "TASK-99"],
			references: ["https://example.com", "TASK-97"],
			documentation: ["doc-99", "backlog/docs/notes.md"],
		}),
		false,
	);
	await core.createDocumentFromInput({ title: "Guide", content: "guide body" });
	await core.createDocumentFromInput({ title: "Other Guide", content: "other body" });
}

describe("deletion preview (Git project)", () => {
	const cleanups: Array<() => void> = [];

	async function makeGitFixture(): Promise<Fixture> {
		const tempDir = mkdtempSync(join(tmpdir(), "backlog-deletion-preview-"));
		cleanups.push(() => rmSync(tempDir, { recursive: true, force: true }));
		await $`git init -b main`.cwd(tempDir).quiet();
		const core = new Core(tempDir);
		return { core, rootDir: tempDir };
	}

	afterAll(() => {
		for (const cleanup of cleanups) cleanup();
	});

	test("an unlinked task previews with no references and the Git recovery warning", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-unlinked");
		await seedLinkedProject(core);

		const preview = await buildDeletionPreview(core, "task", "task-5");
		expect(preview.status).toBe("found");
		expect(preview.targetId).toBe("TASK-5");
		expect(preview.references).toEqual([]);
		expect(preview.unresolvedLinks).toEqual([]);
		expect(preview.targetPath).toContain("backlog/tasks/");

		const warning = await deletionRecoveryWarning(core);
		expect(warning).toBe(DELETION_GIT_RECOVERY_WARNING);
	});

	test("a linked task lists every inbound relation with file locations", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-linked");
		await seedLinkedProject(core);

		const preview = await buildDeletionPreview(core, "task", "task-1");
		expect(preview.status).toBe("found");
		const relations = preview.references.map((reference) => [reference.sourceId, reference.relation] as const);
		expect(relations).toContainEqual(["TASK-2", "dependency"]);
		expect(relations).toContainEqual(["TASK-3", "reference"]);
		expect(relations).toContainEqual(["TASK-4", "parent"]);
		expect(preview.references.every((reference) => reference.sourcePath.startsWith("backlog/tasks/"))).toBe(true);
		const dependency = preview.references.find((reference) => reference.relation === "dependency");
		expect(dependency?.value).toBe("task-1");
	});

	test("a completed record still counts as an active inbound reference", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-completed");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(
			makeTask("task-2", "Finished dependent", { status: "Done", dependencies: ["task-1"] }),
			false,
		);
		await core.completeTask("task-2", false, { includeCrossBranch: false });

		const preview = await buildDeletionPreview(core, "task", "task-1");
		expect(preview.references.map((reference) => reference.sourceId)).toEqual(["TASK-2"]);
		expect(preview.references[0]?.sourcePath).toContain("completed/");
	});

	test("a draft target resolves draft identity and its inbound task references", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-draft");
		await core.createTaskFromInput({ title: "Idea", status: "Draft" });
		await core.createTask(makeTask("task-1", "Blocking", { dependencies: ["DRAFT-1"] }), false);

		const preview = await buildDeletionPreview(core, "draft", "draft-1");
		expect(preview.status).toBe("found");
		expect(preview.targetId).toBe("DRAFT-1");
		expect(preview.references).toHaveLength(1);
		expect(preview.references[0]?.relation).toBe("dependency");
		expect(preview.references[0]?.value).toBe("DRAFT-1");

		const taskSpaceLookup = await buildDeletionPreview(core, "task", "draft-1");
		expect(taskSpaceLookup.status).toBe("not-found");
	});

	test("a document target lists documentation links that spell its ID", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-doc");
		await seedLinkedProject(core);
		await core.createTask(makeTask("task-7", "Doc user", { documentation: ["doc-1"] }), false);

		const preview = await buildDeletionPreview(core, "document", "doc-1");
		expect(preview.status).toBe("found");
		expect(preview.references).toHaveLength(1);
		expect(preview.references[0]?.relation).toBe("documentation");
		expect(preview.references[0]?.sourceId).toBe("TASK-7");
		expect(preview.targetPath).toContain("backlog/docs/");
		// Path-style and free-text documentation entries are not structured ID links.
		const otherDoc = await buildDeletionPreview(core, "document", "doc-2");
		expect(otherDoc.references).toEqual([]);
	});

	test("the target's own unresolved links are reported with reasons", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-unresolved");
		await seedLinkedProject(core);

		const preview = await buildDeletionPreview(core, "task", "task-6");
		const byRelation = (relation: DeletionReferenceRelation) =>
			preview.unresolvedLinks.filter((link) => link.relation === relation);
		expect(byRelation("dependency").map((link) => [link.value, link.reason])).toEqual([
			["junk", "invalid"],
			["TASK-99", "missing"],
		]);
		expect(byRelation("reference").map((link) => link.value)).toEqual(["TASK-97"]);
		expect(byRelation("documentation").map((link) => link.value)).toEqual(["doc-99"]);
		// The path-style documentation entry is not an ID link, so it is not reported.
		expect(preview.unresolvedLinks.some((link) => link.value.includes("backlog/docs/notes.md"))).toBe(false);
	});

	test("invalid, missing, and ambiguous target identities fail closed without deletion", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-invalid");
		await seedLinkedProject(core);

		const invalid = await buildDeletionPreview(core, "task", "TASK-");
		expect(invalid.status).toBe("invalid");
		expect(invalid.references).toEqual([]);

		const empty = await buildDeletionPreview(core, "draft", "  ");
		expect(empty.status).toBe("invalid");

		const missing = await buildDeletionPreview(core, "task", "TASK-99");
		expect(missing.status).toBe("not-found");

		const tasksDir = core.fs.tasksDir;
		const duplicate = makeTask("task-5", "Duplicate", { status: "To Do" });
		await Bun.write(join(tasksDir, "task-05 - Duplicate.md"), serializeTask(duplicate));
		const ambiguous = await buildDeletionPreview(core, "task", "task-5");
		expect(ambiguous.status).toBe("ambiguous");
		expect(ambiguous.references).toEqual([]);
		expect(ambiguous.message).toContain("ambiguous");
	});

	test("cancel always validates and produces no updates", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-cancel");
		await seedLinkedProject(core);
		const preview = await buildDeletionPreview(core, "task", "task-1");

		const validation = await validateDeletionResolution(core, preview, { action: "cancel" });
		expect(validation.ok).toBe(true);
		expect(validation.updates).toEqual([]);
	});

	test("unlink validates with one removal per reference and rejects when unlinked", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-unlink");
		await seedLinkedProject(core);
		const linked = await buildDeletionPreview(core, "task", "task-1");
		const unlinked = await buildDeletionPreview(core, "task", "task-5");

		const validation = await validateDeletionResolution(core, linked, { action: "unlink" });
		expect(validation.ok).toBe(true);
		expect(validation.updates).toHaveLength(linked.references.length);
		expect(validation.updates.every((update) => update.replacement === null)).toBe(true);

		const nothingToUnlink = await validateDeletionResolution(core, unlinked, { action: "unlink" });
		expect(nothingToUnlink.ok).toBe(false);
		expect(nothingToUnlink.errors[0]).toContain("no active structured references");
	});

	test("reassign validates the complete update set for a same-corpus replacement", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-reassign");
		await seedLinkedProject(core);
		const preview = await buildDeletionPreview(core, "task", "task-1");

		const validation = await validateDeletionResolution(core, preview, {
			action: "reassign",
			replacementId: "TASK-05",
		});
		expect(validation.ok).toBe(true);
		expect(validation.updates).toHaveLength(preview.references.length);
		expect(validation.updates.every((update) => update.replacement === "TASK-5")).toBe(true);
	});

	test("reassign rejects missing, self, ambiguous, and invalid replacement identities", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-reassign-invalid");
		await seedLinkedProject(core);
		const preview = await buildDeletionPreview(core, "task", "task-1");

		const missing = await validateDeletionResolution(core, preview, { action: "reassign", replacementId: "TASK-99" });
		expect(missing.ok).toBe(false);
		expect(missing.errors[0]).toContain("TASK-99");
		expect(missing.updates).toEqual([]);

		const self = await validateDeletionResolution(core, preview, { action: "reassign", replacementId: "task-1" });
		expect(self.ok).toBe(false);
		expect(self.errors[0]).toContain("record being deleted");

		const tasksDir = core.fs.tasksDir;
		await Bun.write(join(tasksDir, "task-42 - First.md"), serializeTask(makeTask("task-42", "First")));
		await Bun.write(join(tasksDir, "task-042 - Second.md"), serializeTask(makeTask("task-42", "Second")));
		const ambiguous = await validateDeletionResolution(core, preview, { action: "reassign", replacementId: "TASK-42" });
		expect(ambiguous.ok).toBe(false);
		expect(ambiguous.errors[0]).toContain("ambiguous");

		const noReplacement = await validateDeletionResolution(core, preview, { action: "reassign", replacementId: "  " });
		expect(noReplacement.ok).toBe(false);
	});

	test("reassign rejects dependency cycles and self-dependencies it would create", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-cycle");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);
		await core.createTask(makeTask("task-3", "Replacement", { dependencies: ["task-2"] }), false);
		const preview = await buildDeletionPreview(core, "task", "task-1");

		const cycle = await validateDeletionResolution(core, preview, { action: "reassign", replacementId: "task-3" });
		expect(cycle.ok).toBe(false);
		expect(cycle.errors[0]).toContain("cycle");

		const selfDependency = await validateDeletionResolution(core, preview, {
			action: "reassign",
			replacementId: "task-2",
		});
		expect(selfDependency.ok).toBe(false);
		expect(selfDependency.errors[0]).toContain("cannot depend on itself");
	});

	test("reassign rejects parent cycles and non-task parents", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-parent");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Child", { parentTaskId: "task-1" }), false);
		await core.createTask(makeTask("task-3", "Grandchild", { parentTaskId: "task-2" }), false);
		await core.createTaskFromInput({ title: "Idea", status: "Draft" });
		const preview = await buildDeletionPreview(core, "task", "task-1");

		const cycle = await validateDeletionResolution(core, preview, { action: "reassign", replacementId: "task-3" });
		expect(cycle.ok).toBe(false);
		expect(cycle.errors[0]).toContain("parent cycle");

		const draftParent = await validateDeletionResolution(core, preview, {
			action: "reassign",
			replacementId: "draft-1",
		});
		expect(draftParent.ok).toBe(false);
		expect(draftParent.errors[0]).toContain("Parent references must be reassigned to a task");
	});

	test("reassign keeps references inside their ID namespace while dependencies may name drafts", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-namespace-ref");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Referencing", { references: ["TASK-1"] }), false);
		await core.createTaskFromInput({ title: "Idea", status: "Draft" });
		const preview = await buildDeletionPreview(core, "task", "task-1");

		const referenceReassign = await validateDeletionResolution(core, preview, {
			action: "reassign",
			replacementId: "draft-1",
		});
		expect(referenceReassign.ok).toBe(false);
		expect(referenceReassign.errors[0]).toContain("namespace");
	});

	test("dependencies may be reassigned to a draft", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-namespace-dep");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-3", "Depending", { dependencies: ["task-1"] }), false);
		await core.createTaskFromInput({ title: "Idea", status: "Draft" });
		const preview = await buildDeletionPreview(core, "task", "task-1");

		const dependencyReassign = await validateDeletionResolution(core, preview, {
			action: "reassign",
			replacementId: "draft-1",
		});
		expect(dependencyReassign.ok).toBe(true);
		expect(dependencyReassign.updates).toHaveLength(1);
		expect(dependencyReassign.updates[0]?.replacement).toBe("DRAFT-1");
	});

	test("document reassign validates the replacement document identity", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-doc-reassign");
		await seedLinkedProject(core);
		await core.createTask(makeTask("task-7", "Doc user", { documentation: ["doc-1"] }), false);
		const preview = await buildDeletionPreview(core, "document", "doc-1");

		const valid = await validateDeletionResolution(core, preview, { action: "reassign", replacementId: "doc-2" });
		expect(valid.ok).toBe(true);
		expect(valid.updates).toHaveLength(1);
		expect(valid.updates[0]?.replacement).toBe("doc-2");

		const self = await validateDeletionResolution(core, preview, { action: "reassign", replacementId: "doc-1" });
		expect(self.ok).toBe(false);

		const missing = await validateDeletionResolution(core, preview, { action: "reassign", replacementId: "doc-99" });
		expect(missing.ok).toBe(false);
		expect(missing.errors[0]).toContain("doc-99");
	});

	test("the rendered report discloses free-text limits, recovery limits, and the update set", async () => {
		const { core } = await makeGitFixture();
		await initializeTestProject(core, "preview-format");
		await seedLinkedProject(core);
		const preview: DeletionPreview = await buildDeletionPreview(core, "task", "task-1");
		const recoveryWarning = await deletionRecoveryWarning(core);

		const canceled = formatDeletionPreview(preview, undefined, { recoveryWarning });
		expect(canceled).toContain("TASK-1 - Target");
		expect(canceled).toContain("Deletion would be canceled");
		expect(canceled).toContain(DELETION_FREE_TEXT_LIMIT);
		expect(canceled).toContain(DELETION_GIT_RECOVERY_WARNING);
		expect(canceled).toContain("Nothing has been deleted or modified.");

		const validation = await validateDeletionResolution(core, preview, { action: "reassign", replacementId: "task-5" });
		const reassigned = formatDeletionPreview(preview, validation, { recoveryWarning });
		expect(reassigned).toContain("Resolution: reassign to TASK-5");
		expect(reassigned).toContain('"task-1" -> "TASK-5"');

		const rejected = formatDeletionPreview(
			preview,
			await validateDeletionResolution(core, preview, { action: "reassign", replacementId: "TASK-99" }),
			{ recoveryWarning },
		);
		expect(rejected).toContain("Resolution rejected:");
		expect(rejected).toContain("TASK-99");
	});
});

describe("deletion preview (filesystem-only project)", () => {
	let tempDir: string;
	let core: Core;

	beforeAll(async () => {
		tempDir = mkdtempSync(join(tmpdir(), "backlog-deletion-preview-nogit-"));
		core = new Core(tempDir);
		await initializeFilesystemTestProject(core, "no-git preview");
		await seedLinkedProject(core);
	});

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("linked and unlinked entities preview identically without Git", async () => {
		const linked = await buildDeletionPreview(core, "task", "task-1");
		expect(linked.references.map((reference) => reference.relation)).toEqual(["dependency", "reference", "parent"]);

		const unlinked = await buildDeletionPreview(core, "task", "task-5");
		expect(unlinked.references).toEqual([]);

		const draft = await buildDeletionPreview(core, "document", "doc-1");
		expect(draft.status).toBe("found");
		expect(draft.references).toEqual([]);
	});

	test("the recovery warning reports the missing Git repository", async () => {
		expect(await deletionRecoveryWarning(core)).toBe(DELETION_NO_GIT_WARNING);
		const preview = await buildDeletionPreview(core, "task", "task-1");
		const report = formatDeletionPreview(preview, undefined, {
			recoveryWarning: await deletionRecoveryWarning(core),
		});
		expect(report).toContain(DELETION_NO_GIT_WARNING);
	});

	test("invalid replacements still fail closed without Git", async () => {
		const preview = await buildDeletionPreview(core, "task", "task-1");
		const validation = await validateDeletionResolution(core, preview, {
			action: "reassign",
			replacementId: "TASK-99",
		});
		expect(validation.ok).toBe(false);
		expect(validation.updates).toEqual([]);
	});
});

describe("deletion preview for unlinked drafts and documents", () => {
	let tempDir: string;
	let core: Core;

	beforeAll(async () => {
		tempDir = mkdtempSync(join(tmpdir(), "backlog-deletion-preview-clean-"));
		core = new Core(tempDir);
		await initializeTestProject(core, "preview-clean");
	});

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("an unlinked draft previews with no references", async () => {
		await core.createTaskFromInput({ title: "Unlinked idea", status: "Draft" });
		const preview = await buildDeletionPreview(core, "draft", "DRAFT-1");
		expect(preview.status).toBe("found");
		expect(preview.references).toEqual([]);
		expect(preview.unresolvedLinks).toEqual([]);
	});

	test("an unlinked document previews with no references", async () => {
		await core.createDocumentFromInput({ title: "Unlinked spec", content: "", type: "specification" });
		const preview = await buildDeletionPreview(core, "document", "doc-1");
		expect(preview.status).toBe("found");
		expect(preview.references).toEqual([]);
	});
});
