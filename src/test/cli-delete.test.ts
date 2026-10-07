import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import {
	buildDeletionPreview,
	DELETION_GIT_RECOVERY_WARNING,
	DELETION_NO_GIT_WARNING,
	DeletionPreviewChangedError,
} from "../core/deletion-preview.ts";
import type { Task } from "../types/index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { initializeFilesystemTestProject, initializeTestProject } from "./test-utils.ts";

const CLI_PATH = getTestCliPath();

const cleanups: Array<() => void> = [];

afterAll(() => {
	for (const cleanup of cleanups) cleanup();
});

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

async function makeGitProject(name: string): Promise<{ dir: string; core: Core }> {
	const dir = mkdtempSync(join(tmpdir(), `backlog-cli-delete-${name}-`));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	await $`git init -b main`.cwd(dir).quiet();
	const core = new Core(dir);
	await initializeTestProject(core, name);
	return { dir, core };
}

async function makeFilesystemProject(name: string): Promise<{ dir: string; core: Core }> {
	const dir = mkdtempSync(join(tmpdir(), `backlog-cli-delete-nogit-${name}-`));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	const core = new Core(dir);
	await initializeFilesystemTestProject(core, name);
	return { dir, core };
}

function runCli(dir: string, ...args: string[]) {
	return $`bun ${CLI_PATH} ${args}`.cwd(dir).quiet().nothrow();
}

function taskFileNames(dir: string, folder: "tasks" | "archive/tasks"): string[] {
	try {
		return readdirSync(join(dir, "backlog", folder));
	} catch {
		return [];
	}
}

async function expectActiveTask(dir: string, id: string): Promise<void> {
	// A fresh Core: the fixture's instance may hold a stale parsed-task cache once the CLI
	// subprocess has written files behind it.
	const core = new Core(dir);
	const tasks = await core.fs.listTasks();
	expect(tasks.some((task) => task.id.toLowerCase() === id.toLowerCase())).toBe(true);
}

async function enableAutoCommit(core: Core): Promise<void> {
	const config = await core.filesystem.loadConfig();
	if (config) {
		config.autoCommit = true;
		await core.filesystem.saveConfig(config);
	}
	const git = await core.getGitOps();
	await git.stageBacklogDirectory("backlog");
	await git.commitChanges("Seed backlog state");
}

describe("CLI delete confirmation guards", () => {
	test("a bare delete request refuses and mentions --confirm", async () => {
		const { dir, core } = await makeGitProject("refuse");
		await core.createTask(makeTask("task-1", "Target"), false);

		const result = await runCli(dir, "task", "delete", "task-1");
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("--confirm");
		await expectActiveTask(dir, "task-1");
	});

	test("--preview and --confirm are mutually exclusive", async () => {
		const { dir, core } = await makeGitProject("both");
		await core.createTask(makeTask("task-1", "Target"), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--preview", "--confirm");
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("not both");
		await expectActiveTask(dir, "task-1");
	});

	test("--unlink and --reassign-to are mutually exclusive", async () => {
		const { dir, core } = await makeGitProject("both-resolutions");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--confirm", "--unlink", "--reassign-to", "task-2");
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("Choose one resolution");
		await expectActiveTask(dir, "task-1");
		await expectActiveTask(dir, "task-2");
	});
});

describe("CLI confirmed delete in a Git project", () => {
	test("an unlinked task file is removed, not archived", async () => {
		const { dir, core } = await makeGitProject("unlinked");
		await core.createTask(makeTask("task-1", "Target"), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--confirm");
		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();
		expect(output).toContain("Deleted task TASK-1");
		expect(output).toContain(DELETION_GIT_RECOVERY_WARNING);
		expect(taskFileNames(dir, "tasks")).toHaveLength(0);
		expect(taskFileNames(dir, "archive/tasks")).toHaveLength(0);
	});

	test("archive still moves the file while delete removes it", async () => {
		const { dir, core } = await makeGitProject("archive-vs-delete");
		await core.createTask(makeTask("task-1", "Archived"), false);
		await core.createTask(makeTask("task-2", "Deleted"), false);

		const archived = await runCli(dir, "task", "archive", "task-1");
		expect(archived.exitCode).toBe(0);
		expect(taskFileNames(dir, "archive/tasks").join(" ")).toContain("task-1");

		const deleted = await runCli(dir, "task", "delete", "task-2", "--confirm");
		expect(deleted.exitCode).toBe(0);
		expect(taskFileNames(dir, "tasks")).toHaveLength(0);
		expect(taskFileNames(dir, "archive/tasks").join(" ")).toContain("task-1");
	});

	test("a linked task refuses to delete until a resolution is chosen", async () => {
		const { dir, core } = await makeGitProject("linked-refusal");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--confirm");
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("--unlink to remove them");
		await expectActiveTask(dir, "task-1");
		await expectActiveTask(dir, "task-2");
	});

	test("--unlink removes every listed reference and then the file", async () => {
		const { dir, core } = await makeGitProject("unlink");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);
		await core.createTask(makeTask("task-3", "Referencing", { references: ["TASK-1"] }), false);
		await core.createTask(makeTask("task-4", "Child", { parentTaskId: "task-1" }), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--confirm", "--unlink");
		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();
		expect(output).toContain("Deleted task TASK-1");
		expect(output).toContain("Updated TASK-2");
		expect(output).toContain("Updated TASK-3");
		expect(output).toContain("Updated TASK-4");
		expect(taskFileNames(dir, "tasks").join(" ")).not.toContain("task-1");

		const fresh = new Core(dir);
		const dependent = await fresh.fs.loadTask("task-2");
		expect(dependent?.dependencies ?? []).toEqual([]);
		const referencing = await fresh.fs.loadTask("task-3");
		expect(referencing?.references ?? []).toEqual([]);
		const child = await fresh.fs.loadTask("task-4");
		expect(child?.parentTaskId).toBeUndefined();
	});

	test("--reassign-to repoints every listed reference and then removes the file", async () => {
		const { dir, core } = await makeGitProject("reassign");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);
		await core.createTask(makeTask("task-3", "Referencing", { references: ["TASK-1"] }), false);
		await core.createTask(makeTask("task-4", "Child", { parentTaskId: "task-1" }), false);
		await core.createTask(makeTask("task-5", "Replacement"), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--confirm", "--reassign-to", "task-5");
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain("Deleted task TASK-1");

		const fresh = new Core(dir);
		const dependent = await fresh.fs.loadTask("task-2");
		expect(dependent?.dependencies).toEqual(["TASK-5"]);
		const referencing = await fresh.fs.loadTask("task-3");
		expect(referencing?.references).toEqual(["TASK-5"]);
		const child = await fresh.fs.loadTask("task-4");
		expect(child?.parentTaskId?.toUpperCase()).toBe("TASK-5");
	});

	test("an invalid reassignment target deletes nothing", async () => {
		const { dir, core } = await makeGitProject("invalid-reassign");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--confirm", "--reassign-to", "TASK-99");
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("Resolution rejected");
		await expectActiveTask(dir, "task-1");
		await expectActiveTask(dir, "task-2");
	});

	test("missing and ambiguous targets delete nothing", async () => {
		const { dir, core } = await makeGitProject("missing-target");
		await core.createTask(makeTask("task-1", "Target"), false);
		await Bun.write(
			join(core.fs.tasksDir, "task-01 - Duplicate.md"),
			`${["---", "id: task-01", "title: Duplicate", "status: To Do", "---", ""].join("\n")}duplicate body\n`,
		);

		const missing = await runCli(dir, "task", "delete", "task-99", "--confirm");
		expect(missing.exitCode).toBe(1);
		expect(missing.stderr.toString()).toContain("not found");

		const ambiguous = await runCli(dir, "task", "delete", "task-1", "--confirm");
		expect(ambiguous.exitCode).toBe(1);
		expect(ambiguous.stderr.toString()).toContain("ambiguous");
		await expectActiveTask(dir, "task-1");
	});

	test("a failed reference write leaves the target and the remaining references in place", async () => {
		const { dir, core } = await makeGitProject("failed-write");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);
		const [dependentFile] = taskFileNames(dir, "tasks").filter((name) => name.startsWith("task-2"));
		const dependentPath = join(dir, "backlog", "tasks", dependentFile ?? "");
		chmodSync(dependentPath, 0o444);

		const result = await runCli(dir, "task", "delete", "task-1", "--confirm", "--unlink");
		expect(result.exitCode).toBe(1);
		const error = result.stderr.toString();
		expect(error).toContain("The target file was not deleted");
		expect(error).toContain("TASK-2");
		await expectActiveTask(dir, "task-1");

		chmodSync(dependentPath, 0o644);
		const retry = await runCli(dir, "task", "delete", "task-1", "--confirm", "--unlink");
		expect(retry.exitCode).toBe(0);
		const namesAfterRetry = taskFileNames(dir, "tasks").join(" ");
		expect(namesAfterRetry).not.toContain("task-1");
		expect(namesAfterRetry).toContain("task-2");
	});

	test("a failed unlink reports the applied updates and keeps the target recoverable", async () => {
		const { dir, core } = await makeGitProject("failed-unlink");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);
		const tasksDir = join(dir, "backlog", "tasks");
		chmodSync(tasksDir, 0o555);

		const result = await runCli(dir, "task", "delete", "task-1", "--confirm", "--unlink");
		expect(result.exitCode).toBe(1);
		const error = result.stderr.toString();
		expect(error).toContain("could not be removed");
		expect(error).toContain("task-2");
		await expectActiveTask(dir, "task-1");

		chmodSync(tasksDir, 0o755);
		// The references are already gone, so the plain confirm finishes the deletion.
		const retry = await runCli(dir, "task", "delete", "task-1", "--confirm");
		expect(retry.exitCode).toBe(0);
		const namesAfterRetry = taskFileNames(dir, "tasks").join(" ");
		expect(namesAfterRetry).not.toContain("task-1");
		expect(namesAfterRetry).toContain("task-2");
	});

	test("a confirmed delete commits the removal when autoCommit is enabled", async () => {
		const { dir, core } = await makeGitProject("commit");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);
		await enableAutoCommit(core);

		const result = await runCli(dir, "task", "delete", "task-1", "--confirm", "--unlink");
		expect(result.exitCode).toBe(0);
		const log = await $`git log --pretty=%s`.cwd(dir).quiet();
		expect(log.stdout.toString()).toContain("backlog: Delete task TASK-1");
		const status = await $`git status --short`.cwd(dir).quiet();
		// "## main" is the branch header of a clean tree; anything else is an unstaged change.
		expect(
			status.stdout
				.toString()
				.split("\n")
				.filter((line) => line && !line.startsWith("##")),
		).toEqual([]);
	});

	test("a deleted ID stays unresolvable and is not immediately reused", async () => {
		const { dir, core } = await makeGitProject("id-reuse");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Later"), false);
		await runCli(dir, "task", "delete", "task-1", "--confirm");

		const lookup = await runCli(dir, "task", "view", "task-1");
		expect(lookup.exitCode).toBe(1);
		expect(lookup.stderr.toString()).toContain("not found");

		const created = await runCli(dir, "task", "create", "Next");
		expect(created.exitCode).toBe(0);
		const names = taskFileNames(dir, "tasks").join(" ");
		expect(names).toContain("task-3");
		expect(names).not.toContain("task-1");
	});

	test("a deleted draft linked from a task deletes with unlink and leaves no dependency", async () => {
		const { dir, core } = await makeGitProject("draft-linked");
		await core.createTaskFromInput({ title: "Idea", status: "Draft" });
		await core.createTask(makeTask("task-1", "Draft user", { references: ["DRAFT-1"] }), false);

		const result = await runCli(dir, "draft", "delete", "draft-1", "--confirm", "--unlink");
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain("Deleted draft DRAFT-1");
		expect(readdirSync(join(dir, "backlog", "drafts"))).toHaveLength(0);

		const fresh = new Core(dir);
		const referencing = await fresh.fs.loadTask("task-1");
		expect(referencing?.references ?? []).toEqual([]);
	});
});

describe("CLI confirmed delete in a filesystem-only project", () => {
	test("a confirmed delete works without Git and carries the no-recovery warning", async () => {
		const { dir, core } = await makeFilesystemProject("nogit");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--confirm", "--unlink");
		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();
		expect(output).toContain("Deleted task TASK-1");
		expect(output).toContain(DELETION_NO_GIT_WARNING);
		expect(taskFileNames(dir, "tasks").join(" ")).not.toContain("task-1");
	});

	test("a linked draft deletes without Git", async () => {
		const { dir, core } = await makeFilesystemProject("nogit-draft");
		await core.createTaskFromInput({ title: "Idea", status: "Draft" });

		const result = await runCli(dir, "draft", "delete", "draft-1", "--confirm");
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain(DELETION_NO_GIT_WARNING);
		expect(readdirSync(join(dir, "backlog", "drafts"))).toHaveLength(0);
	});
});

describe("Core deleteEntity guards", () => {
	test("a delete aborts when references changed since the preview was built", async () => {
		const { dir, core } = await makeGitProject("changed");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);
		const preview = await buildDeletionPreview(core, "task", "task-1");
		await core.createTask(makeTask("task-3", "Late dependent", { dependencies: ["TASK-1"] }), false);

		let error: unknown;
		try {
			await core.deleteEntity(preview, { action: "unlink" });
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(DeletionPreviewChangedError);
		await expectActiveTask(dir, "task-1");
		const dependent = await core.fs.loadTask("task-2");
		expect(dependent?.dependencies ?? []).toContain("task-1");
	});

	test("document deletion is not supported by deleteEntity", async () => {
		const { core } = await makeGitProject("document-guard");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });
		const preview = await buildDeletionPreview(core, "document", "doc-1");

		let message = "";
		try {
			await core.deleteEntity(preview, { action: "cancel" });
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("Document deletion is not supported");
	});
});
