import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
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
function decisionFile(id: string, title: string, dir = decisionsDir()): string {
	return join(dir, `${id} - ${title.replace(/\s+/g, "-")}.md`);
}

/** Creates an ADR through the CLI and returns its ID. */
async function createAdrViaCli(title: string, scope?: string): Promise<string> {
	const scopeArgs = scope ? ["--scope", scope] : [];
	const result = await $`bun ${CLI_PATH} decision create ${title} --kind architecture ${scopeArgs}`
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
async function createLegacyDecisionViaCli(title: string, status?: string): Promise<string> {
	const statusArgs = status ? ["-s", status] : [];
	const result = await $`bun ${CLI_PATH} decision create ${title} ${statusArgs}`.cwd(TEST_DIR).quiet();
	expect(result.exitCode).toBe(0);
	const match = result.stdout.toString().match(/Created decision (decision-\d+)/);
	if (!match?.[1]) throw new Error(`Could not parse created decision ID from: ${result.stdout.toString()}`);
	return match[1];
}

/** IDs of every decision a --json list returned. */
async function listDecisionIdsJson(all = false): Promise<string[]> {
	const allArgs = all ? ["--all"] : [];
	const list = await $`bun ${CLI_PATH} decision list --json ${allArgs}`.cwd(TEST_DIR).quiet();
	expect(list.exitCode).toBe(0);
	const parsed = JSON.parse(list.stdout.toString());
	return parsed.decisions.map((decision: { id: string }) => decision.id);
}

/** Decision IDs a --json search returned. */
async function searchDecisionIdsJson(query: string): Promise<string[]> {
	const search = await $`bun ${CLI_PATH} search ${query} --type decision --json`.cwd(TEST_DIR).quiet();
	expect(search.exitCode).toBe(0);
	const parsed = JSON.parse(search.stdout.toString());
	return parsed.results
		.filter((result: { type: string }) => result.type === "decision")
		.map((result: { data: { id: string } }) => result.data.id);
}

/** The record ID from the "File: .../<kind>s/<kind>-<id> - <title>.md" line a create command printed. */
function createdRecordId(output: string, kind: "task" | "draft"): string {
	return output.match(new RegExp(`/${kind}s/(${kind}-[\\d.]+) - `))?.[1] ?? "";
}

describe("CLI ADR guidance discovery and references", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-adr-guidance");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();
		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "ADR Guidance Project");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("lists accepted ADRs and legacy decisions by default, hiding retired and proposed ADRs", async () => {
		const acceptedId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");
		const rejectedId = await createAdrViaCli("Use Mongo for sessions", "session storage");
		await fillAdrBodyViaCli(rejectedId, "session storage");
		await $`bun ${CLI_PATH} decision edit ${rejectedId} -s rejected`.cwd(TEST_DIR).quiet();
		const proposedId = await createAdrViaCli("Use Redis for cache", "cache storage");
		const legacyId = await createLegacyDecisionViaCli("Team offsite schedule");
		const legacyRetiredId = await createLegacyDecisionViaCli("Old lunch vendor", "superseded");

		expect(await listDecisionIdsJson()).toEqual([acceptedId, legacyId, legacyRetiredId]);
		expect(await listDecisionIdsJson(true)).toEqual([acceptedId, rejectedId, proposedId, legacyId, legacyRetiredId]);
	});

	it("keeps archived ADRs out of the default list and search while --all still shows them", async () => {
		const activeId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");
		const retiredId = await createAdrViaCli("Use Mongo for sessions", "session storage");
		await fillAdrBodyViaCli(retiredId, "session storage");
		await $`bun ${CLI_PATH} decision edit ${retiredId} -s rejected`.cwd(TEST_DIR).quiet();
		await $`bun ${CLI_PATH} decision archive ${retiredId}`.cwd(TEST_DIR).quiet();

		expect(await listDecisionIdsJson()).toEqual([activeId]);
		const withAll = await listDecisionIdsJson(true);
		expect(withAll).toContain(retiredId);

		expect(await searchDecisionIdsJson("Mongo")).toEqual([]);
		expect(await searchDecisionIdsJson("SQLite")).toEqual([activeId]);
	});

	it("excludes retired ADRs from search while legacy decisions stay searchable", async () => {
		const retiredId = await createAcceptedAdrViaCli("Use Mongo for sessions", "session storage");
		const replacementId = await createAcceptedAdrViaCli("Use Postgres for sessions", "Session storage");
		await $`bun ${CLI_PATH} decision supersede ${retiredId} ${replacementId}`.cwd(TEST_DIR).quiet();
		const legacyId = await createLegacyDecisionViaCli("Mongo lunch vendor", "superseded");

		const foundIds = await searchDecisionIdsJson("Mongo");
		expect(foundIds).toContain(legacyId);
		expect(foundIds).not.toContain(retiredId);
		expect(foundIds).not.toContain(replacementId);
	});

	it("resolves an old ADR ID to its authoritative replacement across a supersession chain and archive", async () => {
		const firstId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");
		const secondId = await createAcceptedAdrViaCli("Use Postgres for sessions", "session storage");
		await $`bun ${CLI_PATH} decision supersede ${firstId} ${secondId}`.cwd(TEST_DIR).quiet();
		const thirdId = await createAcceptedAdrViaCli("Use Spanner for sessions", "session storage");
		await $`bun ${CLI_PATH} decision supersede ${secondId} ${thirdId}`.cwd(TEST_DIR).quiet();
		await $`bun ${CLI_PATH} decision archive ${firstId}`.cwd(TEST_DIR).quiet();

		const view = await $`bun ${CLI_PATH} decision view ${firstId} --plain`.cwd(TEST_DIR).quiet();
		expect(view.exitCode).toBe(0);
		expect(view.stdout.toString()).toContain(`${firstId} is archived (superseded by ${thirdId}).`);
		expect(view.stdout.toString()).not.toContain(`superseded by ${secondId}.`);
		// Historical citations stay readable: the record body is still printed in full.
		expect(view.stdout.toString()).toContain("## Decision");
	});

	it("errors when a retired ADR names a replacement that does not exist", async () => {
		const oldId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");
		const newId = await createAcceptedAdrViaCli("Use Postgres for sessions", "session storage");
		await $`bun ${CLI_PATH} decision supersede ${oldId} ${newId}`.cwd(TEST_DIR).quiet();

		// Simulate a lost replacement: the file leaves the decision tree entirely, so the
		// superseded_by link resolves to nothing.
		const { rename } = await import("node:fs/promises");
		const core = new Core(TEST_DIR);
		const replacement = await core.filesystem.loadDecision(newId);
		await rename(join(decisionsDir(), replacement?.path ?? ""), join(TEST_DIR, "lost-replacement.md"));

		const view = await $`bun ${CLI_PATH} decision view ${oldId} --plain`.cwd(TEST_DIR).quiet().nothrow();
		expect(view.exitCode).not.toBe(0);
		expect(view.stderr.toString()).toContain(`records replacement ${newId}, which does not exist`);
	});

	it("errors when supersession links form a cycle", async () => {
		const firstId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");
		const secondId = await createAcceptedAdrViaCli("Use Postgres for sessions", "session storage");
		await $`bun ${CLI_PATH} decision supersede ${firstId} ${secondId}`.cwd(TEST_DIR).quiet();

		// Hand-edit the replacement so it is also retired and points back at the record it
		// replaced: first -> second -> first closes a cycle no authoritative record can resolve.
		const replacementPath = decisionFile(secondId, "Use Postgres for sessions");
		const body = await Bun.file(replacementPath).text();
		await Bun.write(
			replacementPath,
			body
				.replace("status: accepted", "status: superseded")
				.replace(`supersedes: ${firstId}`, `supersedes: ${firstId}\nsuperseded_by: ${firstId}`),
		);

		const view = await $`bun ${CLI_PATH} decision view ${firstId} --plain`.cwd(TEST_DIR).quiet().nothrow();
		expect(view.exitCode).not.toBe(0);
		expect(view.stderr.toString()).toContain("form a cycle");
	});

	it("blocks new documentation links to a retired ADR while old citations stay readable", async () => {
		const oldId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");
		const newId = await createAcceptedAdrViaCli("Use Postgres for sessions", "session storage");

		// Before retirement the link is valid guidance.
		const taskCreate = await $`bun ${CLI_PATH} task create "Store sessions" --doc ${oldId} --plain`
			.cwd(TEST_DIR)
			.quiet();
		expect(taskCreate.exitCode).toBe(0);
		const taskId = createdRecordId(taskCreate.stdout.toString(), "task");
		expect(taskId).not.toBe("");

		const supersede = await $`bun ${CLI_PATH} decision supersede ${oldId} ${newId}`.cwd(TEST_DIR).quiet();
		expect(supersede.exitCode).toBe(0);
		// The supersession reports the current structured reference left on the retired ADR.
		expect(supersede.stdout.toString()).toContain(`Current structured references to ${oldId}`);
		expect(supersede.stdout.toString().toLowerCase()).toContain(taskId);

		// The pre-existing link is a historical citation: still readable, never rewritten.
		const taskView = await $`bun ${CLI_PATH} task view ${taskId} --plain`.cwd(TEST_DIR).quiet();
		expect(taskView.exitCode).toBe(0);
		expect(taskView.stdout.toString()).toContain(oldId);

		// New records cannot take the retired ADR as governing guidance.
		const blocked = await $`bun ${CLI_PATH} task create "Read sessions" --doc ${oldId} --plain`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(blocked.exitCode).not.toBe(0);
		expect(blocked.stderr.toString()).toContain(`"${oldId}" points to a retired architecture decision`);

		// Editing another field of the historical task leaves its citation untouched.
		const retitled = await $`bun ${CLI_PATH} task edit ${taskId} --title "Store sessions reliably" --plain`
			.cwd(TEST_DIR)
			.quiet();
		expect(retitled.exitCode).toBe(0);
		const afterEdit = await $`bun ${CLI_PATH} task view ${taskId} --plain`.cwd(TEST_DIR).quiet();
		expect(afterEdit.stdout.toString()).toContain(oldId);

		// Repointing the documentation at the accepted replacement is allowed.
		const repointed = await $`bun ${CLI_PATH} task edit ${taskId} --doc ${newId} --plain`.cwd(TEST_DIR).quiet();
		expect(repointed.exitCode).toBe(0);
	});

	it("still accepts documentation links to accepted ADRs, legacy decisions, and unknown IDs", async () => {
		const acceptedId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");
		const legacyId = await createLegacyDecisionViaCli("Team offsite schedule");

		const created =
			await $`bun ${CLI_PATH} task create "Store sessions" --doc ${acceptedId} --doc ${legacyId} --doc decision-99 --plain`
				.cwd(TEST_DIR)
				.quiet();
		expect(created.exitCode).toBe(0);
	});

	it("reports active references to a retired ADR without blocking the supersession", async () => {
		const oldId = await createAcceptedAdrViaCli("Use SQLite for sessions", "session storage");
		const newId = await createAcceptedAdrViaCli("Use Postgres for sessions", "session storage");
		const draftCreate = await $`bun ${CLI_PATH} task create "Draft store" --doc ${oldId} -s Draft --plain`
			.cwd(TEST_DIR)
			.quiet();
		expect(draftCreate.exitCode).toBe(0);
		const draftId = createdRecordId(draftCreate.stdout.toString(), "draft");
		expect(draftId).not.toBe("");

		const supersede = await $`bun ${CLI_PATH} decision supersede ${oldId} ${newId}`.cwd(TEST_DIR).quiet();
		expect(supersede.exitCode).toBe(0);
		expect(supersede.stdout.toString()).toContain(`Superseded ${oldId} with ${newId}`);
		expect(supersede.stdout.toString().toLowerCase()).toContain(draftId);
	});
});

describe("Core ADR guidance resolution", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-core-adr-guidance");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();
		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "ADR Guidance Core Project");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("treats a rejected ADR as retired without a replacement and leaves legacy records unretired", async () => {
		const rejectedId = await createAdrViaCli("Use Mongo for sessions", "session storage");
		await fillAdrBodyViaCli(rejectedId, "session storage");
		await $`bun ${CLI_PATH} decision edit ${rejectedId} -s rejected`.cwd(TEST_DIR).quiet();
		const legacyId = await createLegacyDecisionViaCli("Old lunch vendor", "superseded");

		const core = new Core(TEST_DIR);
		const rejected = await core.resolveAdrGuidance(rejectedId);
		expect(rejected?.retired?.state).toBe("rejected");
		expect(rejected?.retired?.replacement).toBeNull();

		const legacy = await core.resolveAdrGuidance(legacyId);
		expect(legacy?.retired).toBeUndefined();

		expect(await core.resolveAdrGuidance("decision-99")).toBeNull();
	});
});
