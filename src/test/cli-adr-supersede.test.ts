import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
const CLI_PATH = getTestCliPath();

function decisionsDir(): string {
	return join(TEST_DIR, "backlog", "decisions");
}

/** Mirrors the store's "decision-<id> - <sanitized title>.md" naming. */
function decisionFile(id: string, title: string): string {
	return join(decisionsDir(), `${id} - ${title.replace(/\s+/g, "-")}.md`);
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

describe("CLI architecture decision records (ADRs)", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-adr-supersede");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();
		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "ADR Project");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("records an ADR as a discoverable decision with kind and scope while legacy decisions stay untyped", async () => {
		const adrId = await createAdrViaCli("Use SQLite for sessions", "session storage");

		const core = new Core(TEST_DIR);
		const adr = await core.filesystem.loadDecision(adrId);
		expect(adr?.kind).toBe("architecture");
		expect(adr?.scope).toBe("session storage");
		expect(adr?.status).toBe("proposed");
		expect(adr?.title).toBe("Use SQLite for sessions");

		const view = await $`bun ${CLI_PATH} decision view ${adrId} --plain`.cwd(TEST_DIR).quiet();
		expect(view.stdout.toString()).toContain("kind: architecture");
		expect(view.stdout.toString()).toContain("## Scope");

		// Default discovery returns applicable guidance only, so a proposed ADR needs --all.
		const list = await $`bun ${CLI_PATH} decision list --json`.cwd(TEST_DIR).quiet();
		const parsed = JSON.parse(list.stdout.toString());
		expect(parsed.decisions).toHaveLength(0);
		const listAll = await $`bun ${CLI_PATH} decision list --all --json`.cwd(TEST_DIR).quiet();
		const parsedAll = JSON.parse(listAll.stdout.toString());
		expect(parsedAll.decisions).toHaveLength(1);
		expect(parsedAll.decisions[0].kind).toBe("architecture");

		const legacy = await $`bun ${CLI_PATH} decision create "Team offsite schedule"`.cwd(TEST_DIR).quiet();
		expect(legacy.exitCode).toBe(0);
		const legacyDecision = await new Core(TEST_DIR).filesystem.loadDecision("decision-2");
		expect(legacyDecision?.kind).toBeUndefined();
		expect(await Bun.file(decisionFile("decision-2", "Team offsite schedule")).text()).not.toContain("kind:");
	});

	it("refuses an unsupported record kind", async () => {
		const result = await $`bun ${CLI_PATH} decision create "Weird" --kind plugin`.cwd(TEST_DIR).quiet().nothrow();
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("Unsupported decision kind 'plugin'");
	});

	it("validates explicit lifecycle transitions for ADRs", async () => {
		const id = await createAdrViaCli("Use SQLite for sessions", "session storage");

		// Accepting requires the ADR to state what was decided.
		const acceptEmpty = await $`bun ${CLI_PATH} decision edit ${id} -s accepted`.cwd(TEST_DIR).quiet().nothrow();
		expect(acceptEmpty.exitCode).not.toBe(0);
		expect(acceptEmpty.stderr.toString()).toContain("cannot be accepted without a decision");

		await fillAdrBodyViaCli(id, "session storage");
		const accepted = await $`bun ${CLI_PATH} decision edit ${id} -s accepted`.cwd(TEST_DIR).quiet();
		expect(accepted.exitCode).toBe(0);

		// An accepted ADR leaves its state only through supersession.
		const unaccept = await $`bun ${CLI_PATH} decision edit ${id} -s rejected`.cwd(TEST_DIR).quiet().nothrow();
		expect(unaccept.exitCode).not.toBe(0);
		expect(unaccept.stderr.toString()).toContain("An accepted ADR is retired by superseding it");

		const reopen = await $`bun ${CLI_PATH} decision edit ${id} -s proposed`.cwd(TEST_DIR).quiet().nothrow();
		expect(reopen.exitCode).not.toBe(0);
		expect(reopen.stderr.toString()).toContain("An accepted ADR is retired by superseding it");

		const invalid = await $`bun ${CLI_PATH} decision edit ${id} -s banana`.cwd(TEST_DIR).quiet().nothrow();
		expect(invalid.exitCode).not.toBe(0);
		expect(invalid.stderr.toString()).toContain("Invalid status 'banana'");
	});

	it("lets a proposed ADR be rejected, and rejection is terminal", async () => {
		const id = await createAdrViaCli("Use Mongo for sessions");
		const rejected = await $`bun ${CLI_PATH} decision edit ${id} -s rejected`.cwd(TEST_DIR).quiet();
		expect(rejected.exitCode).toBe(0);

		const revive = await $`bun ${CLI_PATH} decision edit ${id} -s accepted`.cwd(TEST_DIR).quiet().nothrow();
		expect(revive.exitCode).not.toBe(0);
		expect(revive.stderr.toString()).toContain("A deprecated, rejected, or superseded ADR keeps its state.");

		// Superseding a proposal is refused; rejection is the way out.
		const replacement = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");
		const proposed = await createAdrViaCli("Keep Mongo for sessions");
		const supersede = await $`bun ${CLI_PATH} decision supersede ${proposed} ${replacement}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(supersede.exitCode).not.toBe(0);
		expect(supersede.stderr.toString()).toContain("Only an accepted ADR can be superseded");
		expect(supersede.stderr.toString()).toContain("reject it instead");

		// A rejected ADR is already retired.
		const retiredAttempt = await $`bun ${CLI_PATH} decision supersede ${id} ${replacement}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(retiredAttempt.exitCode).not.toBe(0);
		expect(retiredAttempt.stderr.toString()).toContain("already retired");
	});

	it("fully supersedes an accepted ADR and keeps bidirectional history and the older text", async () => {
		const oldId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage, expiry warnings");
		const newId = await createAcceptedAdrViaCli("Use Postgres for sessions", "Session storage,  expiry warnings");

		const result = await $`bun ${CLI_PATH} decision supersede ${oldId} ${newId}`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toBe(`Superseded ${oldId} with ${newId}\n`);

		const core = new Core(TEST_DIR);
		const retired = await core.filesystem.loadDecision(oldId);
		const replacement = await core.filesystem.loadDecision(newId);
		expect(retired?.status).toBe("superseded");
		expect(retired?.supersededBy).toBe(newId);
		expect(retired?.decision).toBe("Use SQLite."); // Older ADR keeps its text.
		expect(replacement?.status).toBe("accepted");
		expect(replacement?.supersedes).toBe(oldId);

		const retiredFile = await Bun.file(decisionFile(oldId, "Use SQLite for sessions")).text();
		expect(retiredFile).toContain(`superseded_by: ${newId}`);
		expect(retiredFile).toContain("## Decision");
		const replacementFile = await Bun.file(decisionFile(newId, "Use Postgres for sessions")).text();
		expect(replacementFile).toContain(`supersedes: ${oldId}`);

		// The retired ADR is no longer editable back into authority.
		const revive = await $`bun ${CLI_PATH} decision edit ${oldId} -s accepted`.cwd(TEST_DIR).quiet().nothrow();
		expect(revive.exitCode).not.toBe(0);
		expect(revive.stderr.toString()).toContain("A deprecated, rejected, or superseded ADR keeps its state.");
	});

	it("refuses partial supersession and leaves the old ADR authoritative", async () => {
		const oldId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage, expiry warnings");
		const newId = await createAcceptedAdrViaCli("Use Postgres for sessions", "session storage");

		const result = await $`bun ${CLI_PATH} decision supersede ${oldId} ${newId}`.cwd(TEST_DIR).quiet().nothrow();
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("does not cover its full scope");
		expect(result.stderr.toString()).toContain("expiry warnings");

		const core = new Core(TEST_DIR);
		const retired = await core.filesystem.loadDecision(oldId);
		const replacement = await core.filesystem.loadDecision(newId);
		expect(retired?.status).toBe("accepted");
		expect(retired?.supersededBy).toBeUndefined();
		expect(replacement?.supersedes).toBeUndefined();
	});

	it("refuses superseding with a replacement that is not an accepted ADR", async () => {
		const oldId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");

		const proposed = await createAdrViaCli("Use Postgres for sessions", "session storage");
		const proposedAttempt = await $`bun ${CLI_PATH} decision supersede ${oldId} ${proposed}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(proposedAttempt.exitCode).not.toBe(0);
		expect(proposedAttempt.stderr.toString()).toContain(`The replacement ${proposed} must be accepted`);
		expect(proposedAttempt.stderr.toString()).toContain("it is proposed");

		const legacy = await $`bun ${CLI_PATH} decision create "Just a note"`.cwd(TEST_DIR).quiet();
		expect(legacy.exitCode).toBe(0);
		const legacyAttempt = await $`bun ${CLI_PATH} decision supersede ${oldId} decision-3`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(legacyAttempt.exitCode).not.toBe(0);
		expect(legacyAttempt.stderr.toString()).toContain("is not an architecture decision record");

		const fileBefore = await Bun.file(decisionFile(oldId, "Use SQLite for sessions")).text();
		expect(fileBefore).not.toContain("superseded_by");
	});

	it("refuses self, duplicate-ID, already-linked, and cyclic supersession", async () => {
		const oldId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");

		const self = await $`bun ${CLI_PATH} decision supersede ${oldId} ${oldId}`.cwd(TEST_DIR).quiet().nothrow();
		expect(self.exitCode).not.toBe(0);
		expect(self.stderr.toString()).toContain("cannot supersede itself");

		// A second file claiming the same ID makes the lookup fail closed.
		const original = await Bun.file(decisionFile(oldId, "Use SQLite for sessions")).text();
		await Bun.write(decisionFile(oldId, "Use SQLite Copy"), original);
		const ambiguous = await $`bun ${CLI_PATH} decision supersede ${oldId} ${oldId}`.cwd(TEST_DIR).quiet().nothrow();
		expect(ambiguous.exitCode).not.toBe(0);
		expect(ambiguous.stderr.toString()).toContain(`Decision ID ${oldId} is ambiguous`);
		await unlink(decisionFile(oldId, "Use SQLite Copy"));

		// A replacement may only supersede one record.
		const first = await createAcceptedAdrViaCli("Use Postgres for sessions", "session storage");
		const firstSupersede = await $`bun ${CLI_PATH} decision supersede ${oldId} ${first}`.cwd(TEST_DIR).quiet();
		expect(firstSupersede.exitCode).toBe(0);

		const secondOld = await createAcceptedAdrViaCli("Use files for sessions", "session storage");
		const reuse = await $`bun ${CLI_PATH} decision supersede ${secondOld} ${first}`.cwd(TEST_DIR).quiet().nothrow();
		expect(reuse.exitCode).not.toBe(0);
		expect(reuse.stderr.toString()).toContain(`The replacement ${first} already records a supersession link`);

		// A hand-edited supersedes link pointing at the replacement closes a cycle; refuse it.
		const thirdOld = await createAcceptedAdrViaCli("Use bun sqlite for sessions", "session storage");
		const cycleTarget = await createAcceptedAdrViaCli("Use libsql for sessions", "session storage");
		const thirdFile = decisionFile(thirdOld, "Use bun sqlite for sessions");
		const thirdText = await Bun.file(thirdFile).text();
		await Bun.write(thirdFile, thirdText.replace("status: accepted", `status: accepted\nsupersedes: ${cycleTarget}`));
		const cycle = await $`bun ${CLI_PATH} decision supersede ${thirdOld} ${cycleTarget}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(cycle.exitCode).not.toBe(0);
		expect(cycle.stderr.toString()).toContain("supersession cycle");
	});

	it("commits a full supersession as one commit when auto-commit is on", async () => {
		const enable = await $`bun ${CLI_PATH} config set autoCommit true`.cwd(TEST_DIR).quiet();
		expect(enable.exitCode).toBe(0);
		await $`git add .`.cwd(TEST_DIR).quiet();
		await $`git commit -m "Enable auto-commit"`.cwd(TEST_DIR).quiet();
		const oldId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");
		const newId = await createAcceptedAdrViaCli("Use Postgres for sessions", "session storage");

		const result = await $`bun ${CLI_PATH} decision supersede ${oldId} ${newId}`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);

		const log = await $`git log --format=%s -n 1`.cwd(TEST_DIR).quiet();
		expect(log.stdout.toString().trim()).toBe(`backlog: Supersede ${oldId} with ${newId}`);
		const status = await $`git status --porcelain`.cwd(TEST_DIR).quiet();
		expect(status.stdout.toString().trim()).toBe("");
	});
});
