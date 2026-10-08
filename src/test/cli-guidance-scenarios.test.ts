import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import { DELETION_FREE_TEXT_LIMIT, DELETION_GIT_RECOVERY_WARNING } from "../core/deletion-preview.ts";
import type { Task } from "../types/index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { initializeTestProject } from "./test-utils.ts";

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
	const dir = mkdtempSync(join(tmpdir(), `backlog-guidance-scenario-${name}-`));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	await $`git init -b main`.cwd(dir).quiet();
	const core = new Core(dir);
	await initializeTestProject(core, name);
	return { dir, core };
}

function runCli(dir: string, ...args: string[]) {
	return $`bun ${CLI_PATH} ${args}`.cwd(dir).quiet().nothrow();
}

function activeTaskPaths(dir: string): string[] {
	const tasksDir = join(dir, "backlog", "tasks");
	return readdirSync(tasksDir).filter((name) => name.endsWith(".md"));
}

/** Creates and accepts an ADR through the CLI and returns its ID. */
async function createAcceptedAdrViaCli(dir: string, title: string, scope: string): Promise<string> {
	const created = await $`bun ${CLI_PATH} decision create ${title} --kind architecture --scope ${scope}`
		.cwd(dir)
		.quiet();
	const id = created.stdout.toString().match(/Created decision (decision-\d+)/)?.[1];
	if (!id) throw new Error(`Could not parse created ADR ID from: ${created.stdout.toString()}`);
	const content = `## Context\n\nSessions must survive restarts.\n\n## Decision\n\nUse ${title}.\n\n## Scope\n\n${scope}\n`;
	await $`bun ${CLI_PATH} decision edit ${id} --content ${content}`.cwd(dir).quiet();
	await $`bun ${CLI_PATH} decision edit ${id} -s accepted`.cwd(dir).quiet();
	return id;
}

describe("CLI guidance scenarios behind the shipped instructions", () => {
	test("archive is the default removal; an explicit user request deletes instead", async () => {
		const { dir, core } = await makeGitProject("archive-vs-delete");
		await core.createTask(makeTask("task-1", "Cancel me"), false);
		await core.createTask(makeTask("task-2", "Remove me"), false);

		// The help pairing the instructions lean on: archive is the default, delete is on request.
		const archiveHelp = (await runCli(dir, "task", "archive", "--help")).stdout.toString();
		expect(archiveHelp).toContain("archive canceled, duplicate, or invalid work; the default removal");
		const deleteHelp = (await runCli(dir, "task", "delete", "--help")).stdout.toString();
		expect(deleteHelp).toContain("delete a task on explicit request, or preview its active references");

		const archived = await runCli(dir, "task", "archive", "task-1");
		expect(archived.exitCode).toBe(0);
		expect(archived.stdout.toString()).toContain("Archived task TASK-1");
		expect(activeTaskPaths(dir)).toHaveLength(1);

		// The user asked for deletion; the noninteractive --confirm run is authorized and removes the file.
		const deleted = await runCli(dir, "task", "delete", "task-2", "--confirm");
		expect(deleted.exitCode).toBe(0);
		expect(deleted.stdout.toString()).toContain("Deleted task TASK-2");
		expect(deleted.stdout.toString()).toContain(DELETION_GIT_RECOVERY_WARNING);
		expect(activeTaskPaths(dir)).toHaveLength(0);
	});

	test("a linked delete demands a resolution choice before anything is removed", async () => {
		const { dir, core } = await makeGitProject("linked-delete");
		await core.createTask(makeTask("task-1", "Target"), false);
		await core.createTask(makeTask("task-2", "Dependent", { dependencies: ["task-1"] }), false);

		const refused = await runCli(dir, "task", "delete", "task-1", "--confirm");
		expect(refused.exitCode).toBe(1);
		expect(refused.stderr.toString()).toContain("Nothing was deleted");
		expect(refused.stderr.toString()).toContain("pass --unlink to remove them, --reassign-to <id> to repoint them");
		expect(activeTaskPaths(dir)).toHaveLength(2);

		const preview = await runCli(dir, "task", "delete", "task-1", "--preview");
		expect(preview.exitCode).toBe(0);
		expect(preview.stdout.toString()).toContain("dependency from TASK-2");
		expect(preview.stdout.toString()).toContain("Deletion would be canceled");
		expect(preview.stdout.toString()).toContain(DELETION_FREE_TEXT_LIMIT);
		expect(preview.stdout.toString()).toContain(DELETION_GIT_RECOVERY_WARNING);
		expect(activeTaskPaths(dir)).toHaveLength(2);

		const unlinked = await runCli(dir, "task", "delete", "task-1", "--confirm", "--unlink");
		expect(unlinked.exitCode).toBe(0);
		expect(activeTaskPaths(dir)).toHaveLength(1);
		const survivor = await new Core(dir).loadTaskById("task-2", { includeCrossBranch: false });
		expect(survivor?.dependencies ?? []).toEqual([]);
	});

	test("a superseded ADR view names its replacement instead of posing as current guidance", async () => {
		const { dir } = await makeGitProject("superseded-adr");
		const oldId = await createAcceptedAdrViaCli(dir, "Use SQLite", "session storage");
		const newId = await createAcceptedAdrViaCli(dir, "Use Postgres", "session storage");

		const superseded = await runCli(dir, "decision", "supersede", oldId, newId);
		expect(superseded.exitCode).toBe(0);

		// Default discovery hides the retired ADR; the old ID resolves to its replacement.
		const list = await runCli(dir, "decision", "list", "--json");
		const listed = JSON.parse(list.stdout.toString()).decisions.map((decision: { id: string }) => decision.id);
		expect(listed).toEqual([newId]);

		const view = await runCli(dir, "decision", "view", oldId, "--plain");
		expect(view.exitCode).toBe(0);
		expect(view.stdout.toString()).toContain(`${oldId} is retired (superseded by ${newId}).`);
	});
});
