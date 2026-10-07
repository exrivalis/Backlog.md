import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
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
// Permission-based failure tests are meaningless (and chmod-immune) for the superuser.
const isRoot = (process.getuid?.() ?? -1) === 0;

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
	const dir = mkdtempSync(join(tmpdir(), `backlog-cli-doc-delete-${name}-`));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	await $`git init -b main`.cwd(dir).quiet();
	const core = new Core(dir);
	await initializeTestProject(core, name);
	return { dir, core };
}

async function makeFilesystemProject(name: string): Promise<{ dir: string; core: Core }> {
	const dir = mkdtempSync(join(tmpdir(), `backlog-cli-doc-delete-nogit-${name}-`));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	const core = new Core(dir);
	await initializeFilesystemTestProject(core, name);
	return { dir, core };
}

function runCli(dir: string, ...args: string[]) {
	return $`bun ${CLI_PATH} ${args}`.cwd(dir).quiet().nothrow();
}

function freshCore(dir: string): Core {
	// A fresh Core: the fixture's instance may hold a stale parsed cache once the CLI
	// subprocess has written files behind it.
	return new Core(dir);
}

async function expectDocumentPresent(dir: string, id: string): Promise<void> {
	const documents = await freshCore(dir).fs.listDocuments();
	expect(documents.some((document) => document.id.toLowerCase() === id.toLowerCase())).toBe(true);
}

async function expectDocumentGone(dir: string, id: string): Promise<void> {
	const documents = await freshCore(dir).fs.listDocuments();
	expect(documents.some((document) => document.id.toLowerCase() === id.toLowerCase())).toBe(false);
}

describe("CLI doc delete help", () => {
	test("help discloses the free-text and recovery limits and the confirm flag", async () => {
		const result = await runCli(process.cwd(), "doc", "delete", "--help");
		expect(result.exitCode).toBe(0);
		const help = result.stdout.toString();
		expect(help).toContain(DELETION_FREE_TEXT_LIMIT);
		expect(help).toContain(DELETION_GIT_RECOVERY_WARNING);
		expect(help).toContain("--confirm");
	});
});

describe("CLI doc delete in a Git project", () => {
	test("a bare delete request is refused without deleting anything", async () => {
		const { dir, core } = await makeGitProject("refuse");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });

		const result = await runCli(dir, "doc", "delete", "doc-1");
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("Nothing was deleted");
		await expectDocumentPresent(dir, "doc-1");
	});

	test("a bare delete request points at --preview and --confirm", async () => {
		const { dir, core } = await makeGitProject("refuse-hint");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });

		const result = await runCli(dir, "doc", "delete", "doc-1");
		expect(result.stderr.toString()).toContain("--preview");
		expect(result.stderr.toString()).toContain("--confirm");
	});

	test("--preview and --confirm are mutually exclusive", async () => {
		const { dir, core } = await makeGitProject("flags-conflict");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });

		const result = await runCli(dir, "doc", "delete", "doc-1", "--preview", "--confirm");
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("Choose one");
		await expectDocumentPresent(dir, "doc-1");
	});

	test("an unlinked ordinary document is deleted and unrelated documents are untouched", async () => {
		const { dir, core } = await makeGitProject("unlinked");
		await core.createDocumentFromInput({ title: "Guide", content: "guide body" });
		await core.createDocumentFromInput({ title: "Other Guide", content: "other body" });

		const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm");
		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();
		expect(output).toContain("Deleted document doc-1");
		expect(output).toContain("backlog/docs/doc-1 - Guide.md");
		expect(output).toContain(DELETION_GIT_RECOVERY_WARNING);
		await expectDocumentGone(dir, "doc-1");
		await expectDocumentPresent(dir, "doc-2");
		expect(existsSync(join(freshCore(dir).fs.docsDir, "doc-1 - Guide.md"))).toBe(false);
	});

	test("a specification document is deleted like any other document", async () => {
		const { dir, core } = await makeGitProject("spec");
		await core.createDocumentFromInput({ title: "Session behavior", content: "", type: "specification" });

		const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm");
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain("Deleted document doc-1");
		await expectDocumentGone(dir, "doc-1");
	});

	test("a document under the changes/ subdirectory is deleted", async () => {
		const { dir, core } = await makeGitProject("change");
		await core.createDocumentFromInput({ title: "Warn before expiry", content: "proposal", path: "changes" });

		const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm");
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain("backlog/docs/changes/doc-1 - Warn-before-expiry.md");
		await expectDocumentGone(dir, "doc-1");
	});

	test("a linked document refuses plain --confirm and keeps every record untouched", async () => {
		const { dir, core } = await makeGitProject("linked-refuse");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });
		await core.createTask(makeTask("task-1", "Reader", { documentation: ["doc-1"] }), false);

		const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm");
		expect(result.exitCode).toBe(1);
		expect(result.stdout.toString()).toContain("Deletion would be canceled");
		expect(result.stderr.toString()).toContain("Nothing was deleted");
		await expectDocumentPresent(dir, "doc-1");
		const tasks = await freshCore(dir).fs.listTasks();
		expect(tasks.find((task) => task.id === "TASK-1")?.documentation).toEqual(["doc-1"]);
	});

	test("--confirm --unlink removes the documentation link, preserves other entries, then deletes", async () => {
		const { dir, core } = await makeGitProject("unlink");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });
		await core.createDocumentFromInput({ title: "Manual", content: "manual body" });
		await core.createTask(makeTask("task-1", "Reader", { documentation: ["doc-1", "guides/api.md", "doc-2"] }), false);

		const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm", "--unlink");
		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();
		expect(output).toContain('TASK-1 documentation link "doc-1" -> removed');
		expect(output).toContain("Deleted document doc-1");
		await expectDocumentGone(dir, "doc-1");
		await expectDocumentPresent(dir, "doc-2");
		const tasks = await freshCore(dir).fs.listTasks();
		expect(tasks.find((task) => task.id === "TASK-1")?.documentation).toEqual(["guides/api.md", "doc-2"]);
	});

	test("--confirm --reassign-to repoints the documentation link", async () => {
		const { dir, core } = await makeGitProject("reassign");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });
		await core.createDocumentFromInput({ title: "Manual", content: "manual body" });
		await core.createTask(makeTask("task-1", "Reader", { documentation: ["doc-1"] }), false);

		const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm", "--reassign-to", "doc-2");
		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();
		expect(output).toContain('TASK-1 documentation link "doc-1" -> "doc-2"');
		expect(output).toContain("Deleted document doc-1");
		await expectDocumentGone(dir, "doc-1");
		await expectDocumentPresent(dir, "doc-2");
		const tasks = await freshCore(dir).fs.listTasks();
		expect(tasks.find((task) => task.id === "TASK-1")?.documentation).toEqual(["doc-2"]);
	});

	test("an invalid replacement ID is rejected without changing anything", async () => {
		const { dir, core } = await makeGitProject("invalid-reassign");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });
		await core.createTask(makeTask("task-1", "Reader", { documentation: ["doc-1"] }), false);

		const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm", "--reassign-to", "doc-99");
		expect(result.exitCode).toBe(1);
		const output = result.stdout.toString();
		expect(output).toContain("Resolution rejected:");
		expect(output).toContain("doc-99");
		expect(output).toContain("Nothing has been deleted or modified.");
		await expectDocumentPresent(dir, "doc-1");
		const tasks = await freshCore(dir).fs.listTasks();
		expect(tasks.find((task) => task.id === "TASK-1")?.documentation).toEqual(["doc-1"]);
	});

	test("reassigning to the deleted document itself is rejected", async () => {
		const { dir, core } = await makeGitProject("self-reassign");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });
		await core.createTask(makeTask("task-1", "Reader", { documentation: ["doc-1"] }), false);

		const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm", "--reassign-to", "doc-1");
		expect(result.exitCode).toBe(1);
		expect(result.stdout.toString()).toContain("it is the record being deleted");
		await expectDocumentPresent(dir, "doc-1");
	});

	test("deleting an already deleted document fails safely", async () => {
		const { dir, core } = await makeGitProject("repeat");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });

		const first = await runCli(dir, "doc", "delete", "doc-1", "--confirm");
		expect(first.exitCode).toBe(0);

		const second = await runCli(dir, "doc", "delete", "doc-1", "--confirm");
		expect(second.exitCode).toBe(1);
		expect(second.stderr.toString()).toContain("not found");
		await expectDocumentGone(dir, "doc-1");
	});

	test("unknown and ambiguous IDs fail safely", async () => {
		const { dir, core } = await makeGitProject("unknown-ambiguous");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });
		await core.createDocumentFromInput({ title: "Other", content: "other body" });
		await Bun.write(
			join(core.fs.docsDir, "doc-02 - Twin.md"),
			["---", "id: doc-2", "title: Twin", "type: other", "---", ""].join("\n"),
		);

		const missing = await runCli(dir, "doc", "delete", "doc-42", "--confirm");
		expect(missing.exitCode).toBe(1);
		expect(missing.stderr.toString()).toContain("not found");

		const ambiguous = await runCli(dir, "doc", "delete", "DOC-2", "--confirm");
		expect(ambiguous.exitCode).toBe(1);
		expect(ambiguous.stderr.toString()).toContain("ambiguous");
		await expectDocumentPresent(dir, "doc-1");
	});

	test("decisions and milestones stay outside the delete command", async () => {
		const { dir, core } = await makeGitProject("decisions-guard");
		await core.createDecision({
			id: "decision-1",
			title: "Storage choice",
			date: "2026-10-07 08:00",
			status: "accepted",
			context: "context",
			decision: "decision",
			consequences: "consequences",
			rawContent: "",
		});

		const decisionAttempt = await runCli(dir, "doc", "delete", "decision-1", "--confirm");
		expect(decisionAttempt.exitCode).toBe(1);
		expect(decisionAttempt.stderr.toString()).toContain("not found");

		const milestoneAttempt = await runCli(dir, "doc", "delete", "m-1", "--confirm");
		expect(milestoneAttempt.exitCode).toBe(1);
		expect(milestoneAttempt.stderr.toString()).toContain("not found");

		const decisions = await freshCore(dir).fs.listDecisions();
		expect(decisions.some((decision) => decision.id === "decision-1")).toBe(true);
	});

	test("active, completed, and draft referencers are all unlinked", async () => {
		const { dir, core } = await makeGitProject("all-stores");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });
		await core.createTask(makeTask("task-1", "Reader", { documentation: ["doc-1"] }), false);
		await core.createTask(makeTask("task-2", "Finished reader", { status: "Done", documentation: ["doc-1"] }), false);
		await core.completeTask("task-2", false, { includeCrossBranch: false });
		await core.createTaskFromInput({ title: "Drafter", status: "Draft", documentation: ["doc-1"] });

		const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm", "--unlink");
		expect(result.exitCode).toBe(0);
		const nextCore = freshCore(dir);
		expect((await nextCore.fs.listTasks()).find((task) => task.id === "TASK-1")?.documentation ?? []).toEqual([]);
		const completed = await nextCore.fs.listCompletedTasks();
		expect(completed.find((task) => task.id === "TASK-2")?.documentation ?? []).toEqual([]);
		const drafts = await nextCore.fs.listDrafts();
		expect(drafts.find((draft) => draft.id === "DRAFT-1")?.documentation ?? []).toEqual([]);
		await expectDocumentGone(dir, "doc-1");
	});

	test.skipIf(isRoot)("a reference-edit failure aborts before the document file is removed", async () => {
		const { dir, core } = await makeGitProject("write-fails");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });
		await core.createTask(makeTask("task-1", "Reader", { documentation: ["doc-1"] }), false);
		const tasks = await core.fs.listTasks();
		const taskPath = tasks.find((task) => task.id === "TASK-1")?.filePath;
		expect(taskPath).toBeDefined();

		chmodSync(taskPath as string, 0o444);
		try {
			const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm", "--unlink");
			expect(result.exitCode).toBe(1);
			await expectDocumentPresent(dir, "doc-1");
		} finally {
			chmodSync(taskPath as string, 0o644);
		}
	});

	test.skipIf(isRoot)("an unlink failure keeps the document file in place", async () => {
		const { dir, core } = await makeGitProject("unlink-fails");
		await core.createDocumentFromInput({ title: "Guide", content: "body" });

		chmodSync(core.fs.docsDir, 0o555);
		try {
			const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm");
			expect(result.exitCode).toBe(1);
			expect(result.stderr.toString()).toContain("Could not delete");
			await expectDocumentPresent(dir, "doc-1");
		} finally {
			chmodSync(core.fs.docsDir, 0o755);
		}
	});

	test("with autoCommit enabled the deletion is committed to Git", async () => {
		const { dir } = await makeGitProject("autocommit");
		await runCli(dir, "config", "set", "autoCommit", "true");
		await $`git add .`.cwd(dir).quiet();
		await $`git commit -m "seed"`.cwd(dir).quiet();
		await runCli(dir, "doc", "create", "Guide");

		const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm");
		expect(result.exitCode).toBe(0);
		await expectDocumentGone(dir, "doc-1");

		const log = await $`git log --oneline -1`.cwd(dir).quiet();
		expect(log.stdout.toString()).toContain("backlog: Delete document doc-1");
		const status = await $`git status --porcelain`.cwd(dir).quiet();
		expect(status.stdout.toString().trim()).toBe("");
	});
});

describe("CLI doc delete in a filesystem-only project", () => {
	test("deletion works without Git and warns that the file may not be recoverable", async () => {
		const { dir, core } = await makeFilesystemProject("nogit");
		await core.createDocumentFromInput({ title: "Notes", content: "body" });

		const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm");
		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();
		expect(output).toContain("Deleted document doc-1");
		expect(output).toContain(DELETION_NO_GIT_WARNING);
		await expectDocumentGone(dir, "doc-1");
	});

	test("a linked document still requires a resolution without Git", async () => {
		const { dir, core } = await makeFilesystemProject("nogit-linked");
		await core.createDocumentFromInput({ title: "Notes", content: "body" });
		await core.createTask(makeTask("task-1", "Reader", { documentation: ["doc-1"] }), false);

		const result = await runCli(dir, "doc", "delete", "doc-1", "--confirm");
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("Nothing was deleted");
		await expectDocumentPresent(dir, "doc-1");
	});
});
