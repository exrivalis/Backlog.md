import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import {
	DELETION_FREE_TEXT_LIMIT,
	DELETION_GIT_RECOVERY_WARNING,
	DELETION_NO_GIT_WARNING,
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
	const dir = mkdtempSync(join(tmpdir(), `backlog-cli-delete-preview-${name}-`));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	await $`git init -b main`.cwd(dir).quiet();
	const core = new Core(dir);
	await initializeTestProject(core, name);
	return { dir, core };
}

async function makeFilesystemProject(name: string): Promise<{ dir: string; core: Core }> {
	const dir = mkdtempSync(join(tmpdir(), `backlog-cli-delete-preview-nogit-${name}-`));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	const core = new Core(dir);
	await initializeFilesystemTestProject(core, name);
	return { dir, core };
}

function runCli(dir: string, ...args: string[]) {
	return $`bun ${CLI_PATH} ${args}`.cwd(dir).quiet().nothrow();
}

async function expectActiveTask(dir: string, id: string): Promise<void> {
	// A fresh Core: the fixture's instance may hold a stale parsed-task cache once the CLI
	// subprocess has written files behind it.
	const core = new Core(dir);
	const tasks = await core.fs.listTasks();
	expect(tasks.some((task) => task.id.toLowerCase() === id.toLowerCase())).toBe(true);
}

describe("CLI delete preview help", () => {
	test("task, draft, and doc delete help disclose free-text and recovery limits", async () => {
		for (const args of [
			["task", "delete", "--help"],
			["draft", "delete", "--help"],
			["doc", "delete", "--help"],
		]) {
			const result = await runCli(process.cwd(), ...args);
			expect(result.exitCode).toBe(0);
			const help = result.stdout.toString();
			expect(help).toContain(DELETION_FREE_TEXT_LIMIT);
			expect(help).toContain(DELETION_GIT_RECOVERY_WARNING);
		}
	});
});

describe("CLI delete preview in a Git project", () => {
	test("a bare delete request is refused without deleting anything", async () => {
		const { dir, core } = await makeGitProject("refuse");
		await core.createTask(makeTask("task-1", "Target"), false);

		const result = await runCli(dir, "task", "delete", "task-1");
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("Nothing was deleted");
		await expectActiveTask(dir, "task-1");
	});

	test("a linked task preview lists references, cancels by default, and deletes nothing", async () => {
		const { dir, core } = await makeGitProject("linked");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--preview");
		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();
		expect(output).toContain("dependency from TASK-2");
		expect(output).toContain("Deletion would be canceled");
		expect(output).toContain(DELETION_GIT_RECOVERY_WARNING);
		expect(output).toContain("Nothing has been deleted or modified.");
		await expectActiveTask(dir, "task-1");
		await expectActiveTask(dir, "task-2");
	});

	test("an unlinked task preview reports no references", async () => {
		const { dir, core } = await makeGitProject("unlinked");
		await core.createTask(makeTask("task-1", "Target"), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--preview");
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain("No active structured references.");
		await expectActiveTask(dir, "task-1");
	});

	test("an invalid reassignment exits 1 and leaves every record untouched", async () => {
		const { dir, core } = await makeGitProject("invalid-reassign");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--preview", "--reassign-to", "TASK-99");
		expect(result.exitCode).toBe(1);
		const output = result.stdout.toString();
		expect(output).toContain("Resolution rejected:");
		expect(output).toContain("TASK-99");
		expect(output).toContain("Nothing has been deleted or modified.");
		await expectActiveTask(dir, "task-1");
		await expectActiveTask(dir, "task-2");
	});

	test("a valid reassignment preview lists the complete update set without changing files", async () => {
		const { dir, core } = await makeGitProject("valid-reassign");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);
		await core.createTask(makeTask("task-3", "Replacement"), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--preview", "--reassign-to", "task-3");
		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();
		expect(output).toContain("Resolution: reassign to TASK-3");
		expect(output).toContain('"task-1" -> "TASK-3"');
		await expectActiveTask(dir, "task-1");
		await expectActiveTask(dir, "task-2");
		await expectActiveTask(dir, "task-3");
	});

	test("missing and ambiguous targets exit 1 without deleting", async () => {
		const { dir, core } = await makeGitProject("missing-target");
		await core.createTask(makeTask("task-1", "Target"), false);
		await Bun.write(
			join(core.fs.tasksDir, "task-01 - Duplicate.md"),
			`${["---", "id: task-01", "title: Duplicate", "status: To Do", "---", ""].join("\n")}duplicate body\n`,
		);

		const missing = await runCli(dir, "task", "delete", "task-99", "--preview");
		expect(missing.exitCode).toBe(1);
		expect(missing.stderr.toString()).toContain("not found");

		const ambiguous = await runCli(dir, "task", "delete", "task-1", "--preview");
		expect(ambiguous.exitCode).toBe(1);
		expect(ambiguous.stderr.toString()).toContain("ambiguous");
		await expectActiveTask(dir, "task-1");
	});

	test("document and draft previews run through the CLI", async () => {
		const { dir, core } = await makeGitProject("docs-drafts");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });
		await core.createTask(makeTask("task-1", "Doc user", { documentation: ["doc-1"] }), false);
		await core.createTaskFromInput({ title: "Idea", status: "Draft" });

		const docPreview = await runCli(dir, "doc", "delete", "doc-1", "--preview");
		expect(docPreview.exitCode).toBe(0);
		const docOutput = docPreview.stdout.toString();
		expect(docOutput).toContain("documentation link from TASK-1");

		const draftPreview = await runCli(dir, "draft", "delete", "DRAFT-1", "--preview");
		expect(draftPreview.exitCode).toBe(0);
		expect(draftPreview.stdout.toString()).toContain("No active structured references.");

		const docs = await new Core(dir).fs.listDocuments();
		expect(docs.some((document) => document.id === "doc-1")).toBe(true);
	});
});

describe("CLI delete preview in a filesystem-only project", () => {
	test("the preview warns that a deleted file may not be recoverable without Git", async () => {
		const { dir, core } = await makeFilesystemProject("nogit");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);

		const result = await runCli(dir, "task", "delete", "task-1", "--preview");
		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();
		expect(output).toContain(DELETION_NO_GIT_WARNING);
		expect(output).toContain("dependency from TASK-2");
		await expectActiveTask(dir, "task-1");
	});

	test("unlinked draft and doc previews work without Git", async () => {
		const { dir, core } = await makeFilesystemProject("nogit-unlinked");
		await core.createTaskFromInput({ title: "Idea", status: "Draft" });
		await core.createDocumentFromInput({ title: "Notes", content: "body" });

		const draftPreview = await runCli(dir, "draft", "delete", "draft-1", "--preview");
		expect(draftPreview.exitCode).toBe(0);
		expect(draftPreview.stdout.toString()).toContain("DRAFT-1");

		const docPreview = await runCli(dir, "doc", "delete", "doc-1", "--preview");
		expect(docPreview.exitCode).toBe(0);
		expect(docPreview.stdout.toString()).toContain("No active structured references.");
	});
});
