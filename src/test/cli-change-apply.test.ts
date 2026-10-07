import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
const CLI_PATH = getTestCliPath();

const SESSION_SPEC = `# Session behavior

### Requirement: Sessions expire [SES-1]

The system SHALL expire sessions after 30 days.

#### Scenario: Expired session

- WHEN a client presents an expired token
- THEN the request is rejected with 401

### Requirement: Expiry emails [SES-2]

The system SHALL email users when a session expires.
`;

const FILE_SPEC = `# File naming

### Requirement: Kebab file names [FIL-1]

The system SHALL name files in kebab-case.
`;

// One affected spec: modify SES-1 and remove SES-2.
const SINGLE_SPEC_CHANGE = `# Change: Tighten session expiry

## Affected specs

- doc-1

## Linked tasks

- task-1

## Modified requirements

### Requirement: Sessions expire after 14 days [SES-1]

The system SHALL expire sessions after 14 days.

## Removed requirements

### Requirement: Expiry emails [SES-2]`;

// Two affected specs, one modified requirement in each, so a mid-apply failure leaves two written files.
const MULTI_SPEC_CHANGE = `# Change: Tighten specs across stores

## Affected specs

- doc-1
- doc-2

## Linked tasks

- task-1

## Modified requirements

### Requirement: Sessions expire after 14 days [SES-1]

The system SHALL expire sessions after 14 days.

### Requirement: Lowercase file names [FIL-1]

The system SHALL name files in lowercase.`;

// Two affected specs but only one delta: doc-2 stays byte-identical and is reported unchanged.
const ONE_DELTA_TWO_AFFECTED_CHANGE = `# Change: Tighten session expiry only

## Affected specs

- doc-1
- doc-2

## Modified requirements

### Requirement: Sessions expire after 14 days [SES-1]

The system SHALL expire sessions after 14 days.`;

interface ProjectFixture {
	core: Core;
	specPaths: { doc1: string; doc2: string };
}

async function absoluteDocPath(core: Core, id: string): Promise<string> {
	const doc = (await core.filesystem.listDocuments()).find((candidate) => candidate.id === id);
	if (!doc?.path) throw new Error(`Document ${id} not found on disk`);
	return join(core.filesystem.docsDir, ...doc.path.split("/"));
}

async function readDocFile(core: Core, id: string): Promise<string> {
	return await Bun.file(await absoluteDocPath(core, id)).text();
}

/** Creates doc-1 (session spec), doc-2 (file spec), and task-1; the change is created per test. */
async function setupProject(withGit = true, autoCommit = false): Promise<ProjectFixture> {
	await mkdir(TEST_DIR, { recursive: true });
	if (withGit) {
		await $`git init -b main`.cwd(TEST_DIR).quiet();
	}
	const core = new Core(TEST_DIR);
	await initializeTestProject(core, "Change Apply Project", autoCommit && withGit);
	if (autoCommit) {
		const config = await core.filesystem.loadConfig();
		if (config) {
			config.autoCommit = true;
			await core.filesystem.saveConfig(config);
		}
	}

	await $`bun ${CLI_PATH} doc create "Session behavior" -t specification -p specifications`.cwd(TEST_DIR).quiet();
	await $`bun ${CLI_PATH} doc update doc-1 --content ${SESSION_SPEC}`.cwd(TEST_DIR).quiet();
	await $`bun ${CLI_PATH} doc create "File naming" -t specification -p specifications`.cwd(TEST_DIR).quiet();
	await $`bun ${CLI_PATH} doc update doc-2 --content ${FILE_SPEC}`.cwd(TEST_DIR).quiet();
	await $`bun ${CLI_PATH} task create "Implement session tightening"`.cwd(TEST_DIR).quiet();

	return {
		core: new Core(TEST_DIR),
		specPaths: {
			doc1: await absoluteDocPath(new Core(TEST_DIR), "doc-1"),
			doc2: await absoluteDocPath(new Core(TEST_DIR), "doc-2"),
		},
	};
}

async function createChange(content: string, id: string, title = "Tighten behavior"): Promise<void> {
	await $`bun ${CLI_PATH} doc create ${title} -t change`.cwd(TEST_DIR).quiet();
	await $`bun ${CLI_PATH} doc update ${id} --content ${content}`.cwd(TEST_DIR).quiet();
}

describe("CLI change apply", () => {
	beforeEach(() => {
		TEST_DIR = createUniqueTestDir("test-cli-change-apply");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("refuses to apply an unreviewed change even when its linked task is Done", async () => {
		const { core, specPaths } = await setupProject();
		await createChange(SINGLE_SPEC_CHANGE, "doc-3");
		await $`bun ${CLI_PATH} task edit task-1 -s Done`.cwd(TEST_DIR).quiet();
		const before = await Bun.file(specPaths.doc1).text();

		const result = await $`bun ${CLI_PATH} doc apply doc-3`.cwd(TEST_DIR).quiet().nothrow();
		expect(result.exitCode).toBe(1);
		const stderr = result.stderr.toString();
		expect(stderr).toContain("Change doc-3 has not been reviewed.");
		expect(stderr).toContain("'backlog doc approve doc-3'");

		// Nothing was written: the spec, the change location, and the task status are untouched.
		expect(await Bun.file(specPaths.doc1).text()).toBe(before);
		const change = await core.getDocument("doc-3");
		expect(change?.path).toBe("changes/doc-3 - Tighten-behavior.md");
		expect(change?.rawContent).not.toContain("## Integrated");
		expect((await core.getTask("task-1"))?.status).toBe("Done");
	});

	it("applies an approved multi-spec change, archives it by ID, and leaves linked tasks untouched", async () => {
		const { core, specPaths } = await setupProject();
		await createChange(MULTI_SPEC_CHANGE, "doc-3");

		const approved = await $`bun ${CLI_PATH} doc approve doc-3 --by @alex`.cwd(TEST_DIR).quiet().nothrow();
		expect(approved.exitCode).toBe(0);
		expect(approved.stdout.toString()).toContain("Approved change doc-3");
		const approvedContent = await readDocFile(core, "doc-3");
		expect(approvedContent).toContain("## Review");
		expect(approvedContent).toMatch(/Approved by @alex on \d{4}-\d{2}-\d{2} \d{2}:\d{2}\./);

		const applied = await $`bun ${CLI_PATH} doc apply doc-3`.cwd(TEST_DIR).quiet().nothrow();
		expect(applied.exitCode).toBe(0);
		const output = applied.stdout.toString();
		expect(output).toContain("Applied change doc-3:");
		expect(output).toContain("- updated doc-1 (backlog/docs/specifications/doc-1 - Session-behavior.md)");
		expect(output).toContain("- updated doc-2 (backlog/docs/specifications/doc-2 - File-naming.md)");
		expect(output).toContain("Archived as history: backlog/docs/changes/archive/doc-3 - Tighten-behavior.md");

		// Both specs now carry the resulting content, with frontmatter identity intact.
		const session = await Bun.file(specPaths.doc1).text();
		expect(session).toContain("The system SHALL expire sessions after 14 days.");
		expect(session).not.toContain("The system SHALL expire sessions after 30 days.");
		// This change does not remove SES-2, so the untouched requirement must survive exactly.
		expect(session).toContain("### Requirement: Expiry emails [SES-2]");
		expect(session).toContain("id: doc-1");
		expect(session).toContain("type: specification");
		const naming = await Bun.file(specPaths.doc2).text();
		expect(naming).toContain("### Requirement: Lowercase file names [FIL-1]");
		expect(naming).not.toContain("kebab-case");

		// The change is archived under its own ID with its full history, and exact-ID lookup still works.
		expect(await Bun.file(join(core.filesystem.docsDir, "changes", "doc-3 - Tighten-behavior.md")).exists()).toBe(
			false,
		);
		const archivedPath = join(core.filesystem.docsDir, "changes", "archive", "doc-3 - Tighten-behavior.md");
		const archived = await Bun.file(archivedPath).text();
		expect(archived).toContain("id: doc-3");
		expect(archived).toContain("## Baselines");
		expect(archived).toMatch(/Approved by @alex on /);
		expect(archived).toMatch(/## Integrated\n\nIntegrated on \d{4}-\d{2}-\d{2} \d{2}:\d{2} into doc-1, doc-2\./);
		expect(archived).toContain("### Requirement: Sessions expire after 14 days [SES-1]");

		const viewed = await $`bun ${CLI_PATH} doc view doc-3 --plain`.cwd(TEST_DIR).quiet().nothrow();
		expect(viewed.exitCode).toBe(0);
		expect(viewed.stdout.toString()).toContain("Integrated on");

		// A linked task is never marked Done by apply.
		expect((await core.getTask("task-1"))?.status).toBe("To Do");
	});

	it("refuses a second apply of an integrated change", async () => {
		const { core, specPaths } = await setupProject();
		await createChange(SINGLE_SPEC_CHANGE, "doc-3");
		await $`bun ${CLI_PATH} doc approve doc-3`.cwd(TEST_DIR).quiet();
		await $`bun ${CLI_PATH} doc apply doc-3`.cwd(TEST_DIR).quiet();

		const afterFirstApply = await Bun.file(specPaths.doc1).text();
		const result = await $`bun ${CLI_PATH} doc apply doc-3`.cwd(TEST_DIR).quiet().nothrow();
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toMatch(/Change doc-3 was already integrated on \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);

		expect(await Bun.file(specPaths.doc1).text()).toBe(afterFirstApply);
		const archived = await core.getDocument("doc-3");
		expect(archived?.path).toBe("changes/archive/doc-3 - Tighten-behavior.md");
	});

	it("refuses a stale baseline and modifies nothing", async () => {
		const { core, specPaths } = await setupProject();
		await createChange(SINGLE_SPEC_CHANGE, "doc-3");
		await $`bun ${CLI_PATH} doc approve doc-3`.cwd(TEST_DIR).quiet();

		// The specification moves after the change was written.
		await $`bun ${CLI_PATH} doc update doc-1 --content ${SESSION_SPEC.replace("after 30 days", "after 7 days")}`
			.cwd(TEST_DIR)
			.quiet();
		const moved = await Bun.file(specPaths.doc1).text();

		const result = await $`bun ${CLI_PATH} doc apply doc-3`.cwd(TEST_DIR).quiet().nothrow();
		expect(result.exitCode).toBe(1);
		const stderr = result.stderr.toString();
		expect(stderr).toContain("Change doc-3 cannot be applied: it is not valid against the current specifications.");
		expect(stderr).toContain("Recorded baseline for doc-1 is stale");

		expect(await Bun.file(specPaths.doc1).text()).toBe(moved);
		const change = await core.getDocument("doc-3");
		expect(change?.path).toBe("changes/doc-3 - Tighten-behavior.md");
		expect(change?.rawContent).not.toContain("## Integrated");
	});

	it("rolls back every written spec when one spec write fails mid-apply", async () => {
		const { core, specPaths } = await setupProject();
		await createChange(MULTI_SPEC_CHANGE, "doc-3");
		await $`bun ${CLI_PATH} doc approve doc-3`.cwd(TEST_DIR).quiet();
		const beforeDoc1 = await Bun.file(specPaths.doc1).text();
		const beforeDoc2 = await Bun.file(specPaths.doc2).text();

		// doc-1 is written first; making doc-2 unwritable interrupts the apply after that write.
		await chmod(specPaths.doc2, 0o444);
		let stderr = "";
		try {
			const result = await $`bun ${CLI_PATH} doc apply doc-3`.cwd(TEST_DIR).quiet().nothrow();
			expect(result.exitCode).toBe(1);
			stderr = result.stderr.toString();
		} finally {
			await chmod(specPaths.doc2, 0o644);
		}

		expect(stderr).toContain("Change doc-3 could not be applied:");
		expect(stderr).toContain("Rolled back doc-1 to their exact content from before this apply.");
		expect(stderr).toContain("doc-3 was not marked integrated or archived");

		expect(await Bun.file(specPaths.doc1).text()).toBe(beforeDoc1);
		expect(await Bun.file(specPaths.doc2).text()).toBe(beforeDoc2);
		const change = await core.getDocument("doc-3");
		expect(change?.path).toBe("changes/doc-3 - Tighten-behavior.md");
		expect(change?.rawContent).not.toContain("## Integrated");
	});

	it("applies and archives without a Git repository", async () => {
		// A no-Git fixture must sit outside any repository: inside one, the shared create
		// lock would target the surrounding repo's git directory instead of the project.
		TEST_DIR = await mkdtemp(join(tmpdir(), "fork16-change-apply-nogit-"));
		const { core, specPaths } = await setupProject(false);
		await createChange(ONE_DELTA_TWO_AFFECTED_CHANGE, "doc-3");
		await $`bun ${CLI_PATH} doc approve doc-3`.cwd(TEST_DIR).quiet();
		const beforeDoc2 = await Bun.file(specPaths.doc2).text();

		const applied = await $`bun ${CLI_PATH} doc apply doc-3`.cwd(TEST_DIR).quiet().nothrow();
		expect(applied.exitCode).toBe(0);
		const output = applied.stdout.toString();
		expect(output).toContain("- updated doc-1 (");
		expect(output).toContain("- unchanged doc-2 (");

		expect(await Bun.file(specPaths.doc1).text()).toContain("The system SHALL expire sessions after 14 days.");
		expect(await Bun.file(specPaths.doc2).text()).toBe(beforeDoc2);
		const archived = await core.getDocument("doc-3");
		expect(archived?.path).toBe("changes/archive/doc-3 - Tighten-behavior.md");
		expect(archived?.rawContent).toMatch(/## Integrated\n\nIntegrated on /);
	});

	it("rolls back the specs and the integration record when the archive move collides", async () => {
		const { core, specPaths } = await setupProject();
		await createChange(SINGLE_SPEC_CHANGE, "doc-3");
		await $`bun ${CLI_PATH} doc approve doc-3`.cwd(TEST_DIR).quiet();
		const beforeDoc1 = await Bun.file(specPaths.doc1).text();

		// A directory at the archive target makes the final archive move fail after the
		// specs were written and the Integrated record was recorded. (A plain file would
		// be removed first by the document store's duplicate-ID cleanup.)
		const archiveDir = join(core.filesystem.docsDir, "changes", "archive");
		const collisionDir = join(archiveDir, "doc-3 - Tighten-behavior.md");
		await mkdir(collisionDir, { recursive: true });

		const result = await $`bun ${CLI_PATH} doc apply doc-3`.cwd(TEST_DIR).quiet().nothrow();
		expect(result.exitCode).toBe(1);
		const stderr = result.stderr.toString();
		expect(stderr).toContain("Change doc-3 could not be applied:");
		expect(stderr).toContain("already exists in docs/changes/archive");
		expect(stderr).toContain("Rolled back doc-1 to their exact content from before this apply.");

		// The full apply is undone: spec content, the integration record, and the change location.
		expect(await Bun.file(specPaths.doc1).text()).toBe(beforeDoc1);
		const change = await core.getDocument("doc-3");
		expect(change?.path).toBe("changes/doc-3 - Tighten-behavior.md");
		expect(change?.rawContent).not.toContain("## Integrated");
		expect(change?.rawContent).toMatch(/Approved on /);
	});

	it("commits approval and apply as reviewable Git history when auto-commit is enabled", async () => {
		await setupProject(true, true);
		await createChange(SINGLE_SPEC_CHANGE, "doc-3");

		const approved = await $`bun ${CLI_PATH} doc approve doc-3 --by @alex`.cwd(TEST_DIR).quiet().nothrow();
		expect(approved.exitCode).toBe(0);
		const applied = await $`bun ${CLI_PATH} doc apply doc-3`.cwd(TEST_DIR).quiet().nothrow();
		expect(applied.exitCode).toBe(0);

		const log = await $`git log --oneline`.cwd(TEST_DIR).quiet();
		const logLines = log.stdout.toString().trim().split("\n");
		const approveLine = logLines.find((line) => line.includes("backlog: Approve change doc-3"));
		const applyLine = logLines.find((line) => line.includes("backlog: Apply change doc-3"));
		expect(approveLine).toBeDefined();
		expect(applyLine).toBeDefined();

		const applySha = (applyLine ?? "").split(/\s+/)[0] ?? "";
		const show = await $`git show --name-only --pretty=format: ${applySha}`.cwd(TEST_DIR).quiet();
		const changedFiles = show.stdout
			.toString()
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		// Git may record the archive move as a rename, so the pre-archive path can appear
		// as its rename source instead of a standalone deletion; check the tracked outcome.
		expect(changedFiles).toContain("backlog/docs/specifications/doc-1 - Session-behavior.md");
		expect(changedFiles).toContain("backlog/docs/changes/archive/doc-3 - Tighten-behavior.md");
		const trackedChanges = await $`git ls-files -- backlog/docs/changes`.cwd(TEST_DIR).quiet();
		expect(trackedChanges.stdout.toString()).toContain("backlog/docs/changes/archive/doc-3 - Tighten-behavior.md");
		expect(trackedChanges.stdout.toString()).not.toContain("\nbacklog/docs/changes/doc-3");

		// Everything apply touched is committed; only the fixture's own config edit may stay dirty.
		const status = await $`git status --porcelain -- backlog/docs`.cwd(TEST_DIR).quiet();
		expect(status.stdout.toString().trim()).toBe("");
	});

	it("gates approve and apply targets", async () => {
		const { core } = await setupProject();
		await createChange(SINGLE_SPEC_CHANGE, "doc-3");

		const notChange = await $`bun ${CLI_PATH} doc approve doc-1`.cwd(TEST_DIR).quiet().nothrow();
		expect(notChange.exitCode).toBe(1);
		expect(notChange.stderr.toString()).toContain(
			"Document doc-1 is a specification document. Only change documents can be approved and applied.",
		);

		const missing = await $`bun ${CLI_PATH} doc apply doc-99`.cwd(TEST_DIR).quiet().nothrow();
		expect(missing.exitCode).toBe(1);
		expect(missing.stderr.toString()).toContain("Document not found: doc-99");

		// Re-approving a not-yet-integrated change replaces the review record.
		await $`bun ${CLI_PATH} doc approve doc-3 --by @first`.cwd(TEST_DIR).quiet();
		await $`bun ${CLI_PATH} doc approve doc-3 --by @second`.cwd(TEST_DIR).quiet();
		const reApproved = await readDocFile(core, "doc-3");
		expect(reApproved.match(/## Review/g)).toHaveLength(1);
		expect(reApproved).toContain("Approved by @second on");
		expect(reApproved).not.toContain("@first");

		// An integrated change is history: its review record no longer changes.
		await $`bun ${CLI_PATH} doc apply doc-3`.cwd(TEST_DIR).quiet();
		const integrated = await $`bun ${CLI_PATH} doc approve doc-3`.cwd(TEST_DIR).quiet().nothrow();
		expect(integrated.exitCode).toBe(1);
		expect(integrated.stderr.toString()).toContain("Change doc-3 was already integrated on");
	});
});
