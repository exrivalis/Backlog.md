import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir } from "./test-utils.ts";

/**
 * Old-data compatibility fixtures. Every file under tests/fixtures/upstream-1.53.0/project is a
 * byte-identical copy of an upstream Backlog.md 1.53.0 project record (upstream MrLesk/Backlog.md
 * main at 69e7b153), covering every entity type in its shipped pre-fork shape: active task
 * (back-200), completed tasks (back-353/356/367/421), archived task (back-37), draft (draft-1),
 * archived draft (draft-41), legacy document (doc-001), legacy decision (decision-1), milestone
 * (m-6), archived milestone (m-2), and the upstream config.yml with its back task prefix.
 *
 * The tests copy this project into isolated directories and run the current CLI against it to
 * prove the fork's new features (explicit deletion, ADR lifecycle, spec changes) never turn old
 * Markdown into a migration: old files load as before and unrelated records keep their bytes.
 */
const FIXTURE_PROJECT = join(import.meta.dir, "..", "..", "tests", "fixtures", "upstream-1.53.0", "project");

const CLI_PATH = getTestCliPath();

const OLD_DOC = "docs/doc-001 - Testing-Style-Guide.md";
const OLD_DECISION = "decisions/decision-1 - Use-Tailwind-CSS-v4-for-web-UI-development.md";
const OLD_DRAFT = "drafts/draft-1 - Agents-add-board-export-step-to-agent-DoD.md";
const OLD_MILESTONE = "milestones/m-6 - new-milestones-ui.md";
const OLD_TASK = "tasks/back-200 - Add-Claude-Code-integration-with-workflow-commands-during-init.md";
const OLD_COMPLETED = "completed/back-421 - Resolve-dateFormat-config-behavior.md";
const OLD_ARCHIVED_TASK = "archive/tasks/back-37 - cli-board-view-open-tasks-in-ide.md";

const cleanups: Array<() => void> = [];

afterAll(() => {
	for (const cleanup of cleanups) cleanup();
});

let TEST_DIR: string;

/**
 * Copies the versioned old-format project into a fresh isolated directory. The filesystem-only
 * variant lives under the OS temp dir so Git detection cannot see a parent repository (a path
 * under this repository's tmp/ would count as "in Git").
 */
async function copyOldProject(name: string, withGit: boolean): Promise<string> {
	const dir = withGit ? createUniqueTestDir(`old-data-${name}`) : mkdtempSync(join(tmpdir(), `old-data-${name}-`));
	await mkdir(dir, { recursive: true });
	cpSync(FIXTURE_PROJECT, dir, { recursive: true });
	if (withGit) {
		await $`git init -q -b main`.cwd(dir).quiet();
		await $`git add .`.cwd(dir).quiet();
		await $`git -c user.email=agent@example.com -c user.name=agent commit -qm seed`.cwd(dir).quiet();
	}
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function runCli(dir: string, ...args: string[]) {
	return $`bun ${CLI_PATH} ${args}`.cwd(dir).quiet().nothrow();
}

/** Snapshots every file under backlog/ so tests can prove unrelated records keep their bytes. */
async function snapshotBacklog(dir: string): Promise<Map<string, string>> {
	const root = join(dir, "backlog");
	const files = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true }));
	const snapshot = new Map<string, string>();
	for (const file of files) {
		snapshot.set(file, await Bun.file(join(root, file)).text());
	}
	return snapshot;
}

/** Fails when any snapshotted path is missing or no longer byte-identical. */
function expectUnchanged(before: Map<string, string>, after: Map<string, string>, paths: string[]): void {
	for (const path of paths) {
		expect(after.get(path), `${path} disappeared`).toBeDefined();
		expect(after.get(path), `${path} was rewritten`).toBe(before.get(path));
	}
}

describe("Old Backlog data compatibility (upstream 1.53.0 project fixture)", () => {
	describe("loading old records", () => {
		beforeEach(async () => {
			TEST_DIR = await copyOldProject("load", true);
		});

		test("lists and views every old record type without rewriting any file", async () => {
			const before = await snapshotBacklog(TEST_DIR);

			const tasks = await runCli(TEST_DIR, "task", "list", "--plain");
			expect(tasks.exitCode).toBe(0);
			expect(tasks.stdout.toString()).toContain("BACK-200 - Add Claude Code integration with workflow commands");

			const task = await runCli(TEST_DIR, "task", "view", "back-200", "--plain");
			expect(task.exitCode).toBe(0);
			expect(task.stdout.toString()).toContain("Add Claude Code integration with workflow commands during init");

			const completed = await runCli(TEST_DIR, "task", "view", "back-421", "--plain");
			expect(completed.exitCode).toBe(0);
			expect(completed.stdout.toString()).toContain("Resolve dateFormat config behavior");

			const docs = await runCli(TEST_DIR, "doc", "list", "--plain");
			expect(docs.exitCode).toBe(0);
			expect(docs.stdout.toString()).toContain("doc-001 - Testing Style Guide");

			const doc = await runCli(TEST_DIR, "doc", "view", "doc-001", "--plain");
			expect(doc.exitCode).toBe(0);
			expect(doc.stdout.toString()).toContain("Tests protect shipped behavior");

			const decisions = await runCli(TEST_DIR, "decision", "list", "--plain");
			expect(decisions.exitCode).toBe(0);
			expect(decisions.stdout.toString()).toContain("decision-1 - Use Tailwind CSS v4 for web UI development");

			const decision = await runCli(TEST_DIR, "decision", "view", "decision-1", "--plain");
			expect(decision.exitCode).toBe(0);
			expect(decision.stdout.toString()).toContain("status: proposed");
			expect(decision.stdout.toString()).not.toContain("kind: architecture");

			const drafts = await runCli(TEST_DIR, "draft", "list", "--plain");
			expect(drafts.exitCode).toBe(0);
			expect(drafts.stdout.toString()).toContain("DRAFT-1 - Agents: add board export step to agent DoD");

			const milestones = await runCli(TEST_DIR, "milestone", "list", "--plain");
			expect(milestones.exitCode).toBe(0);
			expect(milestones.stdout.toString()).toContain("m-6");

			expectUnchanged(before, await snapshotBacklog(TEST_DIR), [
				"config.yml",
				OLD_TASK,
				OLD_COMPLETED,
				OLD_ARCHIVED_TASK,
				OLD_DOC,
				OLD_DECISION,
				OLD_DRAFT,
				OLD_MILESTONE,
				"archive/drafts/draft-41 - temporary-test-task.md",
				"archive/milestones/m-2 - cli-kanban.md",
			]);
		});

		test("a legacy decision keeps free-form semantics and is never treated as an ADR", async () => {
			const created = await runCli(TEST_DIR, "decision", "create", "Use files for state", "--kind", "architecture");
			expect(created.exitCode).toBe(0);
			const before = await snapshotBacklog(TEST_DIR);

			const archive = await runCli(TEST_DIR, "decision", "archive", "decision-1");
			expect(archive.exitCode).not.toBe(0);
			expect(archive.stderr.toString()).toContain("is not an architecture decision record");

			const supersede = await runCli(TEST_DIR, "decision", "supersede", "decision-1", "decision-2");
			expect(supersede.exitCode).not.toBe(0);
			expect(supersede.stderr.toString()).toContain("is not an architecture decision record");

			expectUnchanged(before, await snapshotBacklog(TEST_DIR), [OLD_DECISION]);
		});

		test("a new task ID continues the old prefix sequence without touching old records", async () => {
			const before = await snapshotBacklog(TEST_DIR);

			const created = await runCli(TEST_DIR, "task", "create", "Compat probe");
			expect(created.exitCode).toBe(0);
			// The allocator counts the old completed records, so the next ID follows back-421.
			expect(created.stdout.toString()).toContain("Created task BACK-422");

			expectUnchanged(before, await snapshotBacklog(TEST_DIR), [
				OLD_TASK,
				OLD_COMPLETED,
				OLD_DOC,
				OLD_DECISION,
				OLD_MILESTONE,
			]);
		});
	});

	describe("default archive and complete semantics", () => {
		beforeEach(async () => {
			TEST_DIR = await copyOldProject("archive", true);
		});

		test("complete moves an old task to completed and rewrites only that task", async () => {
			await runCli(TEST_DIR, "task", "edit", "back-200", "-s", "Done");
			const before = await snapshotBacklog(TEST_DIR);
			const editedBytes = before.get(OLD_TASK);

			const completed = await runCli(TEST_DIR, "task", "complete", "back-200");
			expect(completed.exitCode).toBe(0);
			expect(completed.stdout.toString()).toContain("Completed task BACK-200");

			const after = await snapshotBacklog(TEST_DIR);
			expect(after.has(OLD_TASK)).toBe(false);
			const completedPath = OLD_TASK.replace("tasks/", "completed/");
			expect(after.get(completedPath)).toBe(editedBytes);

			expectUnchanged(before, after, [OLD_COMPLETED, OLD_DOC, OLD_DECISION, OLD_DRAFT, OLD_MILESTONE]);
		});

		test("archive moves an old task to archive/tasks with unchanged bytes", async () => {
			const before = await snapshotBacklog(TEST_DIR);
			const taskBytes = before.get(OLD_TASK);

			const archived = await runCli(TEST_DIR, "task", "archive", "back-200");
			expect(archived.exitCode).toBe(0);
			expect(archived.stdout.toString()).toContain("Archived task BACK-200");

			const after = await snapshotBacklog(TEST_DIR);
			expect(after.has(OLD_TASK)).toBe(false);
			expect(after.get(OLD_TASK.replace("tasks/", "archive/tasks/"))).toBe(taskBytes);
			expectUnchanged(before, after, [OLD_COMPLETED, OLD_DOC, OLD_DECISION, OLD_DRAFT, OLD_MILESTONE]);
		});

		test("draft archive and milestone archive move bytes unchanged", async () => {
			const before = await snapshotBacklog(TEST_DIR);

			const draftArchived = await runCli(TEST_DIR, "draft", "archive", "draft-1");
			expect(draftArchived.exitCode).toBe(0);
			const milestoneArchived = await runCli(TEST_DIR, "milestone", "archive", "m-6");
			expect(milestoneArchived.exitCode).toBe(0);

			const after = await snapshotBacklog(TEST_DIR);
			expect(after.get(OLD_DRAFT.replace("drafts/", "archive/drafts/"))).toBe(before.get(OLD_DRAFT));
			expect(after.get(OLD_MILESTONE.replace("milestones/", "archive/milestones/"))).toBe(before.get(OLD_MILESTONE));
			expect(after.has(OLD_DRAFT)).toBe(false);
			expect(after.has(OLD_MILESTONE)).toBe(false);
			expectUnchanged(before, after, [OLD_TASK, OLD_COMPLETED, OLD_DOC, OLD_DECISION]);
		});
	});

	describe("explicit deletion with link resolution in a Git project", () => {
		beforeEach(async () => {
			TEST_DIR = await copyOldProject("delete", true);
		});

		test("a linked old task refuses deletion until resolved, then unlink deletes without archiving", async () => {
			const created = await runCli(TEST_DIR, "task", "create", "Dependent work");
			expect(created.exitCode).toBe(0);
			const linked = await runCli(TEST_DIR, "task", "edit", "back-422", "--depends-on", "back-200");
			expect(linked.exitCode).toBe(0);
			const before = await snapshotBacklog(TEST_DIR);

			const refused = await runCli(TEST_DIR, "task", "delete", "back-200", "--confirm");
			expect(refused.exitCode).toBe(1);
			expect(refused.stderr.toString()).toContain("--unlink");

			const deleted = await runCli(TEST_DIR, "task", "delete", "back-200", "--confirm", "--unlink");
			expect(deleted.exitCode).toBe(0);
			expect(deleted.stdout.toString()).toContain("Deleted task BACK-200");

			const after = await snapshotBacklog(TEST_DIR);
			expect(after.has(OLD_TASK)).toBe(false);
			expect(after.has(OLD_TASK.replace("tasks/", "archive/tasks/"))).toBe(false);

			const dependent = await new Core(TEST_DIR).fs.loadTask("back-422");
			expect(dependent?.dependencies ?? []).toEqual([]);

			expectUnchanged(before, after, [OLD_COMPLETED, OLD_DOC, OLD_DECISION, OLD_DRAFT, OLD_MILESTONE]);
		});

		test("a documentation link to an old zero-padded document resolves on doc delete", async () => {
			const created = await runCli(TEST_DIR, "task", "create", "Doc reader");
			expect(created.exitCode).toBe(0);
			const linked = await runCli(TEST_DIR, "task", "edit", "back-422", "--doc", "doc-001");
			expect(linked.exitCode).toBe(0);
			const before = await snapshotBacklog(TEST_DIR);

			const refused = await runCli(TEST_DIR, "doc", "delete", "doc-001", "--confirm");
			expect(refused.exitCode).toBe(1);

			const deleted = await runCli(TEST_DIR, "doc", "delete", "doc-001", "--confirm", "--unlink");
			expect(deleted.exitCode).toBe(0);
			expect(deleted.stdout.toString()).toContain("Deleted document doc-001");

			const after = await snapshotBacklog(TEST_DIR);
			expect(after.has(OLD_DOC)).toBe(false);
			const reader = await new Core(TEST_DIR).fs.loadTask("back-422");
			expect(reader?.documentation ?? []).toEqual([]);
			expectUnchanged(before, after, [OLD_TASK, OLD_COMPLETED, OLD_DECISION, OLD_DRAFT, OLD_MILESTONE]);
		});
	});

	describe("ADR lookup and retirement in an old project", () => {
		beforeEach(async () => {
			TEST_DIR = await copyOldProject("adr", true);
		});

		test("new ADR allocation continues after the legacy decision and archived exact-ID lookup resolves", async () => {
			const created = await runCli(TEST_DIR, "decision", "create", "Use files for state", "--kind", "architecture");
			expect(created.exitCode).toBe(0);
			expect(created.stdout.toString()).toContain("Created decision decision-2");

			const replacement = await runCli(
				TEST_DIR,
				"decision",
				"create",
				"Use SQLite for state",
				"--kind",
				"architecture",
			);
			expect(replacement.exitCode).toBe(0);
			expect(replacement.stdout.toString()).toContain("Created decision decision-3");

			const filled = await runCli(
				TEST_DIR,
				"decision",
				"edit",
				"decision-2",
				"--content",
				"## Context\n\nState must persist.\n\n## Decision\n\nUse files.\n\n## Scope\n\nsession storage\n",
			);
			expect(filled.exitCode).toBe(0);
			const filledReplacement = await runCli(
				TEST_DIR,
				"decision",
				"edit",
				"decision-3",
				"--content",
				"## Context\n\nState must persist.\n\n## Decision\n\nUse SQLite.\n\n## Scope\n\nSession storage, expiry warnings\n",
			);
			expect(filledReplacement.exitCode).toBe(0);
			const accepted = await runCli(TEST_DIR, "decision", "edit", "decision-2", "-s", "accepted");
			expect(accepted.exitCode).toBe(0);
			const acceptedReplacement = await runCli(TEST_DIR, "decision", "edit", "decision-3", "-s", "accepted");
			expect(acceptedReplacement.exitCode).toBe(0);

			const superseded = await runCli(TEST_DIR, "decision", "supersede", "decision-2", "decision-3");
			expect(superseded.exitCode).toBe(0);
			const before = await snapshotBacklog(TEST_DIR);

			const archived = await runCli(TEST_DIR, "decision", "archive", "decision-2");
			expect(archived.exitCode).toBe(0);

			const after = await snapshotBacklog(TEST_DIR);
			// Supersession alone never moves the file; the explicit archive does.
			expect(after.has("decisions/decision-2 - Use-files-for-state.md")).toBe(false);
			expect(
				after.get("archive/decisions/decision-2 - Use-files-for-state.md"),
				"archive must move the ADR bytes unchanged",
			).toBe(before.get("decisions/decision-2 - Use-files-for-state.md"));
			expectUnchanged(before, after, [OLD_DECISION]);

			// Archived exact-ID lookup identifies the retired state and its replacement.
			const view = await runCli(TEST_DIR, "decision", "view", "decision-2", "--plain");
			expect(view.exitCode).toBe(0);
			expect(view.stdout.toString()).toContain("decision-2 is archived (superseded by decision-3).");

			const all = await runCli(TEST_DIR, "decision", "list", "--all", "--plain");
			expect(all.exitCode).toBe(0);
			expect(all.stdout.toString()).toContain("decision-2");

			const core = new Core(TEST_DIR);
			const legacy = await core.filesystem.loadDecision("decision-1");
			expect(legacy?.archived).toBeUndefined();
			expect(legacy?.kind).toBeUndefined();
			const retired = await core.filesystem.loadDecision("decision-2");
			expect(retired?.archived).toBe(true);
			expect(retired?.supersededBy).toBe("decision-3");
		});
	});

	describe("spec-change integration in an old project", () => {
		beforeEach(async () => {
			TEST_DIR = await copyOldProject("change", true);
		});

		test("a new specification continues the old document IDs and an approved change integrates cleanly", async () => {
			const spec = await runCli(
				TEST_DIR,
				"doc",
				"create",
				"Session behavior",
				"-t",
				"specification",
				"-p",
				"specifications",
			);
			expect(spec.exitCode).toBe(0);
			// The allocator understood the old zero-padded doc-001 as taken.
			expect(spec.stdout.toString()).toContain("Created document doc-2");
			const content = await runCli(
				TEST_DIR,
				"doc",
				"update",
				"doc-2",
				"--content",
				"# Session behavior\n\n### Requirement: Sessions expire [SES-1]\n\nThe system SHALL expire sessions after 30 days.\n",
			);
			expect(content.exitCode).toBe(0);

			const change = await runCli(TEST_DIR, "doc", "create", "Tighten expiry", "-t", "change");
			expect(change.exitCode).toBe(0);
			expect(change.stdout.toString()).toContain("Created document doc-3");
			const delta = await runCli(
				TEST_DIR,
				"doc",
				"update",
				"doc-3",
				"--content",
				"# Change: Tighten expiry\n\n## Affected specs\n\n- doc-2\n\n## Modified requirements\n\n### Requirement: Sessions expire after 14 days [SES-1]\n\nThe system SHALL expire sessions after 14 days.\n",
			);
			expect(delta.exitCode).toBe(0);
			const before = await snapshotBacklog(TEST_DIR);

			const validated = await runCli(TEST_DIR, "doc", "validate", "doc-3");
			expect(validated.exitCode).toBe(0);
			const previewed = await runCli(TEST_DIR, "doc", "preview", "doc-3");
			expect(previewed.exitCode).toBe(0);

			const approved = await runCli(TEST_DIR, "doc", "approve", "doc-3", "--by", "@alex");
			expect(approved.exitCode).toBe(0);
			const applied = await runCli(TEST_DIR, "doc", "apply", "doc-3");
			expect(applied.exitCode).toBe(0);
			expect(applied.stdout.toString()).toContain("Applied change doc-3");

			const after = await snapshotBacklog(TEST_DIR);
			const specText = after.get("docs/specifications/doc-2 - Session-behavior.md") ?? "";
			expect(specText).toContain("SHALL expire sessions after 14 days");
			expect(after.has("docs/changes/doc-3 - Tighten-expiry.md")).toBe(false);
			expect(after.get("docs/changes/archive/doc-3 - Tighten-expiry.md")).toContain("id: doc-3");
			// Integration only touches the affected spec and the change record.
			expectUnchanged(before, after, [OLD_DOC, OLD_DECISION, OLD_TASK, OLD_COMPLETED, OLD_DRAFT, OLD_MILESTONE]);
		});

		test("an old ordinary document is not treated as a specification and needs no migration", async () => {
			const stored = await new Core(TEST_DIR).getDocument("doc-001");
			expect(stored?.type).toBe("guide");
			expect(stored?.rawContent).toContain("Tests protect shipped behavior");

			const change = await runCli(TEST_DIR, "doc", "create", "Legacy probe", "-t", "change");
			expect(change.exitCode).toBe(0);
			const invalid = await runCli(TEST_DIR, "doc", "update", "doc-2", "--content", "## Affected specs\n\n- doc-001\n");
			expect(invalid.exitCode).not.toBe(0);
			expect(invalid.stderr.toString()).toContain('Affected spec "doc-001" is a guide document, not a specification.');
		});
	});

	describe("filesystem-only old project", () => {
		beforeEach(async () => {
			TEST_DIR = await copyOldProject("fs-only", false);
		});

		test("deletion, ADR lookup, and change validation work without Git and without corrupting records", async () => {
			const before = await snapshotBacklog(TEST_DIR);

			const deleted = await runCli(TEST_DIR, "task", "delete", "back-200", "--confirm");
			expect(deleted.exitCode).toBe(0);
			expect(deleted.stdout.toString()).toContain("This project has no Git repository");

			const decision = await runCli(TEST_DIR, "decision", "view", "decision-1", "--plain");
			expect(decision.exitCode).toBe(0);

			const spec = await runCli(
				TEST_DIR,
				"doc",
				"create",
				"Session behavior",
				"-t",
				"specification",
				"-p",
				"specifications",
			);
			expect(spec.exitCode).toBe(0);
			const change = await runCli(TEST_DIR, "doc", "create", "Tighten expiry", "-t", "change");
			expect(change.exitCode).toBe(0);

			const afterDeletes = await snapshotBacklog(TEST_DIR);
			expect(afterDeletes.has(OLD_TASK)).toBe(false);
			expectUnchanged(before, afterDeletes, [
				OLD_COMPLETED,
				OLD_DOC,
				OLD_DECISION,
				OLD_DRAFT,
				OLD_MILESTONE,
				OLD_ARCHIVED_TASK,
			]);
		});
	});
});
