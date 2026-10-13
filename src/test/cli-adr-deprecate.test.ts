import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
const CLI_PATH = getTestCliPath();

function archiveDir(): string {
	return join(TEST_DIR, "backlog", "archive", "decisions");
}

/** Mirrors the store's "decision-<id> - <sanitized title>.md" naming. */
function decisionFile(id: string, title: string, dir = join(TEST_DIR, "backlog", "decisions")): string {
	return join(dir, `${id} - ${title.replace(/\s+/g, "-")}.md`);
}

/** Creates and accepts an ADR through the CLI and returns its ID. */
async function createAcceptedAdrViaCli(title: string, scope: string): Promise<string> {
	const result = await $`bun ${CLI_PATH} decision create ${title} --kind architecture --scope ${scope}`
		.cwd(TEST_DIR)
		.quiet();
	expect(result.exitCode).toBe(0);
	const match = result.stdout.toString().match(/Created decision (decision-\d+)/);
	if (!match?.[1]) throw new Error(`Could not parse created ADR ID from: ${result.stdout.toString()}`);
	const id = match[1];
	const content = `## Context\n\nSessions must survive restarts.\n\n## Decision\n\nUse SQLite.\n\n## Scope\n\n${scope}\n`;
	const filled = await $`bun ${CLI_PATH} decision edit ${id} --content ${content}`.cwd(TEST_DIR).quiet();
	expect(filled.exitCode).toBe(0);
	const accepted = await $`bun ${CLI_PATH} decision edit ${id} -s accepted`.cwd(TEST_DIR).quiet();
	expect(accepted.exitCode).toBe(0);
	return id;
}

describe("CLI architecture decision record (ADR) deprecation", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-adr-deprecate");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();
		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "ADR Deprecate Project");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("retires an accepted ADR by deprecating it without a replacement", async () => {
		const id = await createAcceptedAdrViaCli("Use SQLite storage", "session storage");
		const result = await $`bun ${CLI_PATH} decision edit ${id} -s deprecated`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);
		const core = new Core(TEST_DIR);
		const decision = await core.filesystem.loadDecision(id);
		expect(decision?.status).toBe("deprecated");
		expect(decision?.supersededBy).toBeUndefined();
	});

	it("keeps a deprecated ADR out of applicable guidance while --all still lists it", async () => {
		const id = await createAcceptedAdrViaCli("Use SQLite storage", "session storage");
		await $`bun ${CLI_PATH} decision edit ${id} -s deprecated`.cwd(TEST_DIR).quiet();

		const applicable = await $`bun ${CLI_PATH} decision list --plain`.cwd(TEST_DIR).quiet();
		expect(applicable.stdout.toString()).not.toContain(id);
		const every = await $`bun ${CLI_PATH} decision list --all --plain`.cwd(TEST_DIR).quiet();
		expect(every.stdout.toString()).toContain(`${id} - Use SQLite storage (deprecated)`);
	});

	it("views a deprecated ADR as retired without offering a replacement", async () => {
		const id = await createAcceptedAdrViaCli("Use SQLite storage", "session storage");
		await $`bun ${CLI_PATH} decision edit ${id} -s deprecated`.cwd(TEST_DIR).quiet();
		const result = await $`bun ${CLI_PATH} decision view ${id} --plain`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain(`${id} is retired (deprecated).`);
		expect(result.stdout.toString()).not.toContain("superseded by");
	});

	it("archives and restores a deprecated ADR like other retired states", async () => {
		const id = await createAcceptedAdrViaCli("Use SQLite storage", "session storage");
		await $`bun ${CLI_PATH} decision edit ${id} -s deprecated`.cwd(TEST_DIR).quiet();

		const archived = await $`bun ${CLI_PATH} decision archive ${id}`.cwd(TEST_DIR).quiet();
		expect(archived.exitCode).toBe(0);
		expect(await Bun.file(decisionFile(id, "Use SQLite storage", archiveDir())).exists()).toBe(true);

		const restored = await $`bun ${CLI_PATH} decision restore ${id}`.cwd(TEST_DIR).quiet();
		expect(restored.exitCode).toBe(0);
		expect(await Bun.file(decisionFile(id, "Use SQLite storage")).exists()).toBe(true);
	});

	it("refuses transitions out of deprecated and into deprecated from proposed", async () => {
		const id = await createAcceptedAdrViaCli("Use SQLite storage", "session storage");
		await $`bun ${CLI_PATH} decision edit ${id} -s deprecated`.cwd(TEST_DIR).quiet();

		const backToAccepted = await $`bun ${CLI_PATH} decision edit ${id} -s accepted`.cwd(TEST_DIR).quiet().nothrow();
		expect(backToAccepted.exitCode).toBe(1);
		expect(backToAccepted.stderr.toString()).toContain("Cannot change architecture decision");
		expect(backToAccepted.stderr.toString()).toContain("A deprecated, rejected, or superseded ADR keeps its state");

		const toRejected = await $`bun ${CLI_PATH} decision edit ${id} -s rejected`.cwd(TEST_DIR).quiet().nothrow();
		expect(toRejected.exitCode).toBe(1);

		const proposed = await $`bun ${CLI_PATH} decision create "Draft choice" --kind architecture --scope "cache"`
			.cwd(TEST_DIR)
			.quiet();
		expect(proposed.exitCode).toBe(0);
		const draftId = proposed.stdout.toString().match(/Created decision (decision-\d+)/)?.[1];
		if (!draftId) throw new Error("Could not parse created ADR ID");
		const toDeprecated = await $`bun ${CLI_PATH} decision edit ${draftId} -s deprecated`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(toDeprecated.exitCode).toBe(1);
		expect(toDeprecated.stderr.toString()).toContain("reject a proposal instead");
	});

	it("refuses to supersede a deprecated ADR", async () => {
		const deprecatedId = await createAcceptedAdrViaCli("Use SQLite storage", "session storage");
		await $`bun ${CLI_PATH} decision edit ${deprecatedId} -s deprecated`.cwd(TEST_DIR).quiet();
		const replacementId = await createAcceptedAdrViaCli("Use Postgres storage", "session storage");

		const result = await $`bun ${CLI_PATH} decision supersede ${deprecatedId} ${replacementId}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("Only an accepted ADR can be superseded");
		expect(result.stderr.toString()).toContain(`${deprecatedId} is deprecated (already retired)`);
	});
});
