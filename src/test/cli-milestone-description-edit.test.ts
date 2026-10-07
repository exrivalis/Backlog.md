import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

const cliPath = getTestCliPath();

let TEST_DIR: string;
let cleanupDirs: string[];

async function setupProject(dir: string, projectName: string): Promise<Core> {
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	await $`git init -b main`.cwd(dir).quiet();

	const core = new Core(dir);
	await initializeTestProject(core, projectName);
	return core;
}

async function loadMilestoneFile(core: Core, id: string): Promise<string> {
	const filepath = await core.filesystem.getMilestoneFilePath(id);
	if (!filepath) {
		throw new Error(`Expected milestone file for ${id}`);
	}
	return await Bun.file(filepath).text();
}

function serializeMilestoneFile(id: string, title: string): string {
	return `---
id: ${id}
title: "${title}"
---

## Description

Milestone: ${title}
`;
}

describe("CLI milestone description edit", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-milestone-description-edit");
		cleanupDirs = [TEST_DIR];
		await setupProject(TEST_DIR, "Milestone Description Edit Project");
	});

	afterEach(async () => {
		for (const dir of cleanupDirs) {
			await safeCleanup(dir);
		}
	});

	it("replaces a milestone description and leaves ID, title, due date, and linked tasks unchanged", async () => {
		const core = new Core(TEST_DIR);

		await $`bun ${cliPath} milestone add "Release CLI" --description "Old scope" --due-date 2026-12-01`
			.cwd(TEST_DIR)
			.quiet();
		await $`bun ${cliPath} task create "Task A" --milestone "Release CLI" --plain`.cwd(TEST_DIR).quiet();
		const taskBefore = await core.filesystem.loadTask("task-1");

		const edit = await $`bun ${cliPath} milestone edit "Release CLI" --description "New scope"`.cwd(TEST_DIR).quiet();

		expect(edit.exitCode).toBe(0);
		expect(edit.stdout.toString()).toContain('Updated description for milestone "Release CLI" (m-0).');

		const milestones = await core.filesystem.listMilestones();
		expect(milestones).toHaveLength(1);
		expect(milestones[0]?.id).toBe("m-0");
		expect(milestones[0]?.title).toBe("Release CLI");
		expect(milestones[0]?.dueDate).toBe("2026-12-01");
		expect(milestones[0]?.description).toBe("New scope");

		const taskAfter = await core.filesystem.loadTask("task-1");
		expect(taskAfter?.milestone).toBe(taskBefore?.milestone);
		expect(taskAfter?.milestone).toBeTruthy();
		expect(taskAfter?.title).toBe(taskBefore?.title);
	});

	it("clears a milestone description back to the create default", async () => {
		const core = new Core(TEST_DIR);

		await $`bun ${cliPath} milestone add "Release CLI" --description "Old scope"`.cwd(TEST_DIR).quiet();
		await $`bun ${cliPath} milestone add "Fresh Milestone"`.cwd(TEST_DIR).quiet();

		const edit = await $`bun ${cliPath} milestone edit m-0 --clear-description`.cwd(TEST_DIR).quiet();

		expect(edit.exitCode).toBe(0);
		expect(edit.stdout.toString()).toContain('Cleared description for milestone "Release CLI" (m-0).');

		const milestones = await core.filesystem.listMilestones();
		const cleared = milestones.find((milestone) => milestone.id === "m-0");
		const fresh = milestones.find((milestone) => milestone.id === "m-1");
		expect(cleared?.title).toBe("Release CLI");
		expect(cleared?.description).toBe("Milestone: Release CLI");
		expect(fresh?.description).toBe("Milestone: Fresh Milestone");
	});

	it("reports no changes when the description already matches", async () => {
		const core = new Core(TEST_DIR);

		await $`bun ${cliPath} milestone add "Release CLI" --description "Same scope"`.cwd(TEST_DIR).quiet();
		const before = await loadMilestoneFile(core, "m-0");

		const edit = await $`bun ${cliPath} milestone edit m-0 --description "Same scope"`.cwd(TEST_DIR).quiet();

		expect(edit.exitCode).toBe(0);
		expect(edit.stdout.toString()).toContain("No changes made");
		expect(await loadMilestoneFile(core, "m-0")).toBe(before);
	});

	it("fails for an unknown milestone without writing", async () => {
		const core = new Core(TEST_DIR);

		await $`bun ${cliPath} milestone add "Release CLI" --description "Existing scope"`.cwd(TEST_DIR).quiet();
		const before = await loadMilestoneFile(core, "m-0");

		const edit = await $`bun ${cliPath} milestone edit "Ghost" --description "New scope"`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();

		expect(edit.exitCode).toBe(1);
		const output = edit.stdout.toString() + edit.stderr.toString();
		expect(output).toContain('Milestone not found: "Ghost"');
		expect(await loadMilestoneFile(core, "m-0")).toBe(before);
		expect((await core.filesystem.listMilestones())[0]?.description).toBe("Existing scope");
	});

	it("fails closed when a title matches multiple active milestones", async () => {
		const core = new Core(TEST_DIR);

		// Duplicate active titles cannot be created through the CLI (add and rename
		// reject alias conflicts), so write the ambiguous files directly.
		await mkdir(core.filesystem.milestonesDir, { recursive: true });
		await Bun.write(join(core.filesystem.milestonesDir, "m-0 - sprint.md"), serializeMilestoneFile("m-0", "Sprint"));
		await Bun.write(join(core.filesystem.milestonesDir, "m-1 - sprint.md"), serializeMilestoneFile("m-1", "Sprint"));

		const edit = await $`bun ${cliPath} milestone edit "Sprint" --description "New scope"`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();

		expect(edit.exitCode).toBe(1);
		const output = edit.stdout.toString() + edit.stderr.toString();
		expect(output).toContain('Milestone not found: "Sprint"');
		expect(await loadMilestoneFile(core, "m-0")).toBe(serializeMilestoneFile("m-0", "Sprint"));
		expect(await loadMilestoneFile(core, "m-1")).toBe(serializeMilestoneFile("m-1", "Sprint"));
	});

	it("rejects using --description and --clear-description together", async () => {
		await $`bun ${cliPath} milestone add "Release CLI"`.cwd(TEST_DIR).quiet();

		const edit = await $`bun ${cliPath} milestone edit m-0 --description "New scope" --clear-description`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();

		expect(edit.exitCode).toBe(1);
		const output = edit.stdout.toString() + edit.stderr.toString();
		expect(output).toContain("Cannot use --description and --clear-description together.");
	});

	it("requires --description or --clear-description", async () => {
		await $`bun ${cliPath} milestone add "Release CLI"`.cwd(TEST_DIR).quiet();

		const edit = await $`bun ${cliPath} milestone edit m-0`.cwd(TEST_DIR).quiet().nothrow();

		expect(edit.exitCode).toBe(1);
		const output = edit.stdout.toString() + edit.stderr.toString();
		expect(output).toContain("Nothing to edit: pass --description <text> or --clear-description.");
	});

	it("documents the operation in milestone edit help", async () => {
		const help = await $`bun ${cliPath} milestone edit --help`.cwd(TEST_DIR).quiet();

		expect(help.exitCode).toBe(0);
		const output = help.stdout.toString();
		expect(output).toContain("--description");
		expect(output).toContain("--clear-description");
	});

	it("auto-commits description edits when autoCommit is enabled", async () => {
		const core = new Core(TEST_DIR);
		const config = await core.filesystem.loadConfig();
		if (!config) {
			throw new Error("Expected test project config to exist");
		}
		config.autoCommit = true;
		await core.filesystem.saveConfig(config);
		await core.ensureConfigLoaded();

		await $`git add .`.cwd(TEST_DIR).quiet();
		await $`git commit -m "baseline"`.cwd(TEST_DIR).quiet();

		await $`bun ${cliPath} milestone add "Committed Release"`.cwd(TEST_DIR).quiet();
		const edit = await $`bun ${cliPath} milestone edit "Committed Release" --description "Shipped scope"`
			.cwd(TEST_DIR)
			.quiet();

		expect(edit.exitCode).toBe(0);
		expect((await core.git.getStatus()).trim()).toBe("");
		expect(await core.git.getLastCommitMessage()).toContain("backlog: Edit milestone description m-0");
	});
});
