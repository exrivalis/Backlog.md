import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { getTestCliPath } from "./test-cli.ts";
import {
	createUniqueTestDir,
	initializeFilesystemTestProject,
	initializeTestProject,
	safeCleanup,
} from "./test-utils.ts";

let TEST_DIR: string;
const CLI_PATH = getTestCliPath();

function decisionsDir(): string {
	return join(TEST_DIR, "backlog", "decisions");
}

function archiveDir(): string {
	return join(TEST_DIR, "backlog", "archive", "decisions");
}

/** Mirrors the store's "decision-<id> - <sanitized title>.md" naming. */
function decisionFile(id: string, title: string, dir = decisionsDir()): string {
	return join(dir, `${id} - ${title.replace(/\s+/g, "-")}.md`);
}

/** Creates an ADR through the CLI and returns its ID. */
async function createAdrViaCli(title: string, scope?: string, status?: string): Promise<string> {
	const scopeArgs = scope ? ["--scope", scope] : [];
	const statusArgs = status ? ["-s", status] : [];
	const result = await $`bun ${CLI_PATH} decision create ${title} --kind architecture ${scopeArgs} ${statusArgs}`
		.cwd(TEST_DIR)
		.quiet();
	expect(result.exitCode).toBe(0);
	const match = result.stdout.toString().match(/Created decision (decision-\d+)/);
	if (!match?.[1]) throw new Error(`Could not parse created ADR ID from: ${result.stdout.toString()}`);
	return match[1];
}

/** Fills an ADR body through the CLI so it states a decision and scope. */
async function fillAdrBodyViaCli(id: string, scope: string): Promise<void> {
	const content = `## Context\n\nSessions must survive restarts.\n\n## Decision\n\nUse SQLite.\n\n## Scope\n\n${scope}\n`;
	const result = await $`bun ${CLI_PATH} decision edit ${id} --content ${content}`.cwd(TEST_DIR).quiet();
	expect(result.exitCode).toBe(0);
}

/** Creates and accepts an ADR through the CLI and returns its ID. */
async function createAcceptedAdrViaCli(title: string, scope: string): Promise<string> {
	const id = await createAdrViaCli(title, scope);
	await fillAdrBodyViaCli(id, scope);
	const accepted = await $`bun ${CLI_PATH} decision edit ${id} -s accepted`.cwd(TEST_DIR).quiet();
	expect(accepted.exitCode).toBe(0);
	return id;
}

/** Creates a free-form (non-ADR) decision through the CLI and returns its ID. */
async function createLegacyDecisionViaCli(title: string): Promise<string> {
	const result = await $`bun ${CLI_PATH} decision create ${title}`.cwd(TEST_DIR).quiet();
	expect(result.exitCode).toBe(0);
	const match = result.stdout.toString().match(/Created decision (decision-\d+)/);
	if (!match?.[1]) throw new Error(`Could not parse created decision ID from: ${result.stdout.toString()}`);
	return match[1];
}

describe("CLI architecture decision record (ADR) archive and restore", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-adr-archive");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();
		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "ADR Archive Project");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("archives a rejected ADR, keeping identity, content, and file bytes", async () => {
		const id = await createAdrViaCli("Use Mongo for sessions");
		await fillAdrBodyViaCli(id, "session storage");
		const reject = await $`bun ${CLI_PATH} decision edit ${id} -s rejected`.cwd(TEST_DIR).quiet();
		expect(reject.exitCode).toBe(0);
		const bytesBefore = await Bun.file(decisionFile(id, "Use Mongo for sessions")).text();

		const result = await $`bun ${CLI_PATH} decision archive ${id}`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toBe(`Archived decision ${id}\n`);

		// The file left the active set whole: same name, same bytes, no rewrite.
		const archivedBytes = await Bun.file(decisionFile(id, "Use Mongo for sessions", archiveDir())).text();
		expect(archivedBytes).toBe(bytesBefore);
		expect(await Bun.file(decisionFile(id, "Use Mongo for sessions")).exists()).toBe(false);

		const core = new Core(TEST_DIR);
		const archived = await core.filesystem.loadDecision(id);
		expect(archived?.archived).toBe(true);
		expect(archived?.status).toBe("rejected");
		expect(archived?.kind).toBe("architecture");
		expect(archived?.decision).toBe("Use SQLite.");
	});

	it("keeps historical supersession links readable across the move", async () => {
		const oldId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage, expiry warnings");
		const newId = await createAcceptedAdrViaCli("Use Postgres for sessions", "Session storage,  expiry warnings");
		const supersede = await $`bun ${CLI_PATH} decision supersede ${oldId} ${newId}`.cwd(TEST_DIR).quiet();
		expect(supersede.exitCode).toBe(0);

		// Supersession alone must not move the retired ADR anywhere.
		expect(await Bun.file(decisionFile(oldId, "Use SQLite for sessions")).exists()).toBe(true);

		const archive = await $`bun ${CLI_PATH} decision archive ${oldId}`.cwd(TEST_DIR).quiet();
		expect(archive.exitCode).toBe(0);
		const archivedFile = await Bun.file(decisionFile(oldId, "Use SQLite for sessions", archiveDir())).text();
		expect(archivedFile).toContain(`superseded_by: ${newId}`);
		expect(archivedFile).toContain("## Decision");

		// The replacement's back-link still resolves even though its target is archived.
		const replacement = await new Core(TEST_DIR).filesystem.loadDecision(newId);
		expect(replacement?.supersedes).toBe(oldId);

		const view = await $`bun ${CLI_PATH} decision view ${oldId} --plain`.cwd(TEST_DIR).quiet();
		expect(view.exitCode).toBe(0);
		expect(view.stdout.toString()).toContain(`${oldId} is archived (superseded by ${newId}).`);
		expect(view.stdout.toString()).toContain(`superseded_by: ${newId}`);

		// An accepted ADR does not claim to be archived or retired.
		const activeView = await $`bun ${CLI_PATH} decision view ${newId} --plain`.cwd(TEST_DIR).quiet();
		expect(activeView.stdout.toString()).not.toContain("is archived");
	});

	it("restores an archived ADR without changing its content", async () => {
		const id = await createAdrViaCli("Use Mongo for sessions");
		await $`bun ${CLI_PATH} decision edit ${id} -s rejected`.cwd(TEST_DIR).quiet();
		const bytesBefore = await Bun.file(decisionFile(id, "Use Mongo for sessions")).text();
		const archive = await $`bun ${CLI_PATH} decision archive ${id}`.cwd(TEST_DIR).quiet();
		expect(archive.exitCode).toBe(0);

		const restore = await $`bun ${CLI_PATH} decision restore ${id}`.cwd(TEST_DIR).quiet();
		expect(restore.exitCode).toBe(0);
		expect(restore.stdout.toString()).toBe(`Restored decision ${id}\n`);

		expect(await Bun.file(decisionFile(id, "Use Mongo for sessions")).exists()).toBe(true);
		expect(await Bun.file(decisionFile(id, "Use Mongo for sessions", archiveDir())).exists()).toBe(false);
		expect(await Bun.file(decisionFile(id, "Use Mongo for sessions")).text()).toBe(bytesBefore);

		const core = new Core(TEST_DIR);
		const restored = await core.filesystem.loadDecision(id);
		expect(restored?.archived).toBeUndefined();
		expect(restored?.status).toBe("rejected");
	});

	it("refuses to archive an applicable accepted ADR before a lifecycle transition", async () => {
		const id = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");

		const result = await $`bun ${CLI_PATH} decision archive ${id}`.cwd(TEST_DIR).quiet().nothrow();
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("only a rejected, deprecated, or superseded ADR can be archived");
		expect(result.stderr.toString()).toContain("supersede it");
		expect(await Bun.file(decisionFile(id, "Use SQLite for sessions")).exists()).toBe(true);

		const core = new Core(TEST_DIR);
		const untouched = await core.filesystem.loadDecision(id);
		expect(untouched?.status).toBe("accepted");
		expect(untouched?.archived).toBeUndefined();
	});

	it("refuses to archive a proposed ADR and a legacy decision", async () => {
		const proposedId = await createAdrViaCli("Use Mongo for sessions");
		const proposed = await $`bun ${CLI_PATH} decision archive ${proposedId}`.cwd(TEST_DIR).quiet().nothrow();
		expect(proposed.exitCode).not.toBe(0);
		expect(proposed.stderr.toString()).toContain("A proposed ADR is not retired; reject it instead.");

		const legacyId = await createLegacyDecisionViaCli("Team offsite schedule");
		const legacy = await $`bun ${CLI_PATH} decision archive ${legacyId}`.cwd(TEST_DIR).quiet().nothrow();
		expect(legacy.exitCode).not.toBe(0);
		expect(legacy.stderr.toString()).toContain("is not an architecture decision record");
	});

	it("refuses archiving twice and restoring a decision that is not archived", async () => {
		const id = await createAdrViaCli("Use Mongo for sessions");
		await $`bun ${CLI_PATH} decision edit ${id} -s rejected`.cwd(TEST_DIR).quiet();
		const first = await $`bun ${CLI_PATH} decision archive ${id}`.cwd(TEST_DIR).quiet();
		expect(first.exitCode).toBe(0);

		const second = await $`bun ${CLI_PATH} decision archive ${id}`.cwd(TEST_DIR).quiet().nothrow();
		expect(second.exitCode).not.toBe(0);
		expect(second.stderr.toString()).toContain("is already archived");

		// A second, active (proposed) decision cannot be "restored".
		await createAdrViaCli("Use SQLite for sessions");
		const restoreActive = await $`bun ${CLI_PATH} decision restore decision-2`.cwd(TEST_DIR).quiet().nothrow();
		expect(restoreActive.exitCode).not.toBe(0);
		expect(restoreActive.stderr.toString()).toContain("is not archived");
	});

	it("refuses collisions on archive and restore instead of overwriting", async () => {
		const id = await createAdrViaCli("Use Mongo for sessions");
		await $`bun ${CLI_PATH} decision edit ${id} -s rejected`.cwd(TEST_DIR).quiet();
		const archivedName = decisionFile(id, "Use Mongo for sessions", archiveDir());
		await Bun.write(archivedName, "stale archive file");

		const collide = await $`bun ${CLI_PATH} decision archive ${id}`.cwd(TEST_DIR).quiet().nothrow();
		expect(collide.exitCode).not.toBe(0);
		expect(collide.stderr.toString()).toContain("already exists in backlog/archive/decisions");
		// The active file is untouched.
		expect(await Bun.file(decisionFile(id, "Use Mongo for sessions")).exists()).toBe(true);
		await unlink(archivedName);

		const archive = await $`bun ${CLI_PATH} decision archive ${id}`.cwd(TEST_DIR).quiet();
		expect(archive.exitCode).toBe(0);
		await Bun.write(decisionFile(id, "Use Mongo for sessions"), "another active file took the name");

		const restore = await $`bun ${CLI_PATH} decision restore ${id}`.cwd(TEST_DIR).quiet().nothrow();
		expect(restore.exitCode).not.toBe(0);
		expect(restore.stderr.toString()).toContain("already exists in backlog/decisions");
		// The archived copy is untouched.
		expect(await Bun.file(archivedName).exists()).toBe(true);
	});

	it("fails closed when one ID exists in both the active set and the archive", async () => {
		const id = await createAdrViaCli("Use Mongo for sessions");
		await $`bun ${CLI_PATH} decision edit ${id} -s rejected`.cwd(TEST_DIR).quiet();
		const original = await Bun.file(decisionFile(id, "Use Mongo for sessions")).text();
		await mkdir(archiveDir(), { recursive: true });
		await Bun.write(decisionFile(id, "Use Mongo Copy", archiveDir()), original);

		const view = await $`bun ${CLI_PATH} decision view ${id} --plain`.cwd(TEST_DIR).quiet().nothrow();
		expect(view.exitCode).not.toBe(0);
		expect(view.stderr.toString()).toContain(`Decision ID ${id} is ambiguous`);

		const archive = await $`bun ${CLI_PATH} decision archive ${id}`.cwd(TEST_DIR).quiet().nothrow();
		expect(archive.exitCode).not.toBe(0);
		expect(archive.stderr.toString()).toContain("is ambiguous");
	});

	it("never reallocates an archived decision ID", async () => {
		const retiredId = await createAdrViaCli("Use Mongo for sessions");
		const keptId = await createAdrViaCli("Use SQLite for sessions");
		await $`bun ${CLI_PATH} decision edit ${retiredId} -s rejected`.cwd(TEST_DIR).quiet();
		const archive = await $`bun ${CLI_PATH} decision archive ${retiredId}`.cwd(TEST_DIR).quiet();
		expect(archive.exitCode).toBe(0);

		const created = await $`bun ${CLI_PATH} decision create "New choice"`.cwd(TEST_DIR).quiet();
		expect(created.stdout.toString()).toContain("Created decision decision-3");
		expect(created.stdout.toString()).not.toContain(retiredId);

		// The archived record is still addressable by its original ID.
		const archived = await new Core(TEST_DIR).filesystem.loadDecision(retiredId);
		expect(archived?.archived).toBe(true);
		expect(keptId).toBe("decision-2");
	});

	it("hides archived ADRs from the active list but keeps them addressable", async () => {
		const activeId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");
		const retiredId = await createAdrViaCli("Use Mongo for sessions");
		await $`bun ${CLI_PATH} decision edit ${retiredId} -s rejected`.cwd(TEST_DIR).quiet();
		const archive = await $`bun ${CLI_PATH} decision archive ${retiredId}`.cwd(TEST_DIR).quiet();
		expect(archive.exitCode).toBe(0);

		const list = await $`bun ${CLI_PATH} decision list --json`.cwd(TEST_DIR).quiet();
		const parsed = JSON.parse(list.stdout.toString());
		expect(parsed.decisions.map((d: { id: string }) => d.id)).toEqual([activeId]);

		const view = await $`bun ${CLI_PATH} decision view ${retiredId} --plain`.cwd(TEST_DIR).quiet();
		expect(view.exitCode).toBe(0);
		expect(view.stdout.toString()).toContain(`${retiredId} is archived (rejected).`);
	});

	it("refuses to edit an archived ADR until it is restored", async () => {
		const id = await createAdrViaCli("Use Mongo for sessions");
		await $`bun ${CLI_PATH} decision edit ${id} -s rejected`.cwd(TEST_DIR).quiet();
		const archive = await $`bun ${CLI_PATH} decision archive ${id}`.cwd(TEST_DIR).quiet();
		expect(archive.exitCode).toBe(0);

		const edit = await $`bun ${CLI_PATH} decision edit ${id} --title "Rewritten"`.cwd(TEST_DIR).quiet().nothrow();
		expect(edit.exitCode).not.toBe(0);
		expect(edit.stderr.toString()).toContain("is archived; restore it");

		const restore = await $`bun ${CLI_PATH} decision restore ${id}`.cwd(TEST_DIR).quiet();
		expect(restore.exitCode).toBe(0);
		const editAfter = await $`bun ${CLI_PATH} decision edit ${id} --title "Rewritten"`.cwd(TEST_DIR).quiet();
		expect(editAfter.exitCode).toBe(0);
	});

	it("refuses archive and restore for unknown IDs", async () => {
		const archive = await $`bun ${CLI_PATH} decision archive decision-99`.cwd(TEST_DIR).quiet().nothrow();
		expect(archive.exitCode).not.toBe(0);
		expect(archive.stderr.toString()).toContain("Decision not found: decision-99");

		const restore = await $`bun ${CLI_PATH} decision restore decision-99`.cwd(TEST_DIR).quiet().nothrow();
		expect(restore.exitCode).not.toBe(0);
		expect(restore.stderr.toString()).toContain("Decision not found: decision-99");
	});

	it("commits each archive and restore as its own move commit with auto-commit on", async () => {
		const enable = await $`bun ${CLI_PATH} config set autoCommit true`.cwd(TEST_DIR).quiet();
		expect(enable.exitCode).toBe(0);
		await $`git add .`.cwd(TEST_DIR).quiet();
		await $`git commit -m "Enable auto-commit"`.cwd(TEST_DIR).quiet();
		const id = await createAdrViaCli("Use Mongo for sessions");
		// Create and reject auto-commit under the enabled config.
		const reject = await $`bun ${CLI_PATH} decision edit ${id} -s rejected`.cwd(TEST_DIR).quiet();
		expect(reject.exitCode).toBe(0);

		const archive = await $`bun ${CLI_PATH} decision archive ${id}`.cwd(TEST_DIR).quiet();
		expect(archive.exitCode).toBe(0);
		const archiveLog = await $`git log --format=%s -n 1`.cwd(TEST_DIR).quiet();
		expect(archiveLog.stdout.toString().trim()).toBe(`backlog: Archive decision ${id}`);
		const status = await $`git status --porcelain`.cwd(TEST_DIR).quiet();
		expect(status.stdout.toString().trim()).toBe("");

		const restore = await $`bun ${CLI_PATH} decision restore ${id}`.cwd(TEST_DIR).quiet();
		expect(restore.exitCode).toBe(0);
		const restoreLog = await $`git log --format=%s -n 1`.cwd(TEST_DIR).quiet();
		expect(restoreLog.stdout.toString().trim()).toBe(`backlog: Restore decision ${id}`);
		const restoreStatus = await $`git status --porcelain`.cwd(TEST_DIR).quiet();
		expect(restoreStatus.stdout.toString().trim()).toBe("");

		// Git sees the round trip as renames, preserving history.
		const renameDetection =
			await $`git log --follow --format=%s -- ${"backlog/decisions/decision-1 - Use-Mongo-for-sessions.md"}`
				.cwd(TEST_DIR)
				.quiet();
		expect(renameDetection.stdout.toString()).toContain("Add decision");
	});
});

describe("ADR archive and restore in a filesystem-only project", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-adr-archive-fs-only");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();
		const core = new Core(TEST_DIR);
		await initializeFilesystemTestProject(core, "ADR FS-only Project");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("moves files without any Git commit", async () => {
		const commitsBefore = await $`git rev-list --count --all`.cwd(TEST_DIR).quiet();
		const id = await createAdrViaCli("Use Mongo for sessions");
		await $`bun ${CLI_PATH} decision edit ${id} -s rejected`.cwd(TEST_DIR).quiet();

		const archive = await $`bun ${CLI_PATH} decision archive ${id}`.cwd(TEST_DIR).quiet();
		expect(archive.exitCode).toBe(0);
		expect(await Bun.file(decisionFile(id, "Use Mongo for sessions", archiveDir())).exists()).toBe(true);
		expect(await Bun.file(decisionFile(id, "Use Mongo for sessions")).exists()).toBe(false);

		const restore = await $`bun ${CLI_PATH} decision restore ${id}`.cwd(TEST_DIR).quiet();
		expect(restore.exitCode).toBe(0);
		expect(await Bun.file(decisionFile(id, "Use Mongo for sessions")).exists()).toBe(true);

		const commitsAfter = await $`git rev-list --count --all`.cwd(TEST_DIR).quiet();
		expect(commitsAfter.stdout.toString().trim()).toBe(commitsBefore.stdout.toString().trim());
	});
});
