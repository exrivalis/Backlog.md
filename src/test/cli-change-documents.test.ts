import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
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

// Multi-spec change: modified and removed requirements only, so every delta target is unambiguous.
const CHANGE_CONTENT = `# Change: Tighten session expiry

## Why

Sessions end silently and users lose work.

## Scope

The session library and its specifications.

## Affected specs

- doc-1
- doc-2

## Linked tasks

- task-1

## Related decisions

- decision-1

## Modified requirements

### Requirement: Sessions expire after 14 days [SES-1]

The system SHALL expire sessions after 14 days.

## Removed requirements

### Requirement: Expiry emails [SES-2]`;

// Single-spec change with an addition, so the preview can place it.
const ADDITION_CHANGE = `# Change: Warn before expiry

## Affected specs

- doc-1

## Added requirements

### Requirement: Warn before expiry [SES-3]

The system SHALL warn one day before a session expires.

#### Scenario: Expiring soon

- WHEN a session expires within one day
- THEN the client receives a warning`;

async function readDocFile(core: Core, id: string): Promise<string> {
	const doc = (await core.filesystem.listDocuments()).find((candidate) => candidate.id === id);
	if (!doc?.path) throw new Error(`Document ${id} not found on disk`);
	return await Bun.file(`${core.filesystem.docsDir}/${doc.path}`).text();
}

async function createSpecification(title: string, content: string): Promise<void> {
	await $`bun ${CLI_PATH} doc create ${title} -t specification -p specifications`.cwd(TEST_DIR).quiet();
	await $`bun ${CLI_PATH} doc update doc-1 --content ${content}`.cwd(TEST_DIR).quiet();
}

async function createChange(content: string, id: string): Promise<void> {
	await $`bun ${CLI_PATH} doc create "Change doc" -t change`.cwd(TEST_DIR).quiet();
	await $`bun ${CLI_PATH} doc update ${id} --content ${content}`.cwd(TEST_DIR).quiet();
}

describe("CLI change documents", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-change-documents");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();

		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "Change Documents Project");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("creates a change under docs/changes, records baselines, and round-trips links and deltas", async () => {
		await createSpecification("Session behavior", SESSION_SPEC);

		// doc-1 is reused by the helper above, so create the second spec as doc-2.
		await $`bun ${CLI_PATH} doc create "File naming" -t specification -p specifications`.cwd(TEST_DIR).quiet();
		await $`bun ${CLI_PATH} doc update doc-2 --content ${FILE_SPEC}`.cwd(TEST_DIR).quiet();
		await $`bun ${CLI_PATH} task create "Implement session warning"`.cwd(TEST_DIR).quiet();
		await $`bun ${CLI_PATH} decision create "Adopt warning library" -s accepted`.cwd(TEST_DIR).quiet();

		const created = await $`bun ${CLI_PATH} doc create "Tighten session expiry" -t change`.cwd(TEST_DIR).quiet();
		expect(created.exitCode).toBe(0);
		expect(created.stdout.toString()).toContain("Created document doc-3");
		expect(created.stdout.toString()).toContain("Path: backlog/docs/changes/doc-3 - Tighten-session-expiry.md");

		const updated = await $`bun ${CLI_PATH} doc update doc-3 --content ${CHANGE_CONTENT}`.cwd(TEST_DIR).quiet();
		expect(updated.exitCode).toBe(0);

		const viewed = await $`bun ${CLI_PATH} doc view doc-3 --plain`.cwd(TEST_DIR).quiet();
		expect(viewed.exitCode).toBe(0);
		expect(viewed.stdout.toString()).toContain("## Affected specs");
		expect(viewed.stdout.toString()).toContain("- doc-2");
		expect(viewed.stdout.toString()).toContain("### Requirement: Sessions expire after 14 days [SES-1]");
		expect(viewed.stdout.toString()).toContain("### Requirement: Expiry emails [SES-2]");

		const core = new Core(TEST_DIR);
		const stored = await core.getDocument("doc-3");
		expect(stored?.type).toBe("change");
		expect(stored?.path).toBe("changes/doc-3 - Tighten-session-expiry.md");
		// The proposal keeps its content, and saving recorded a baseline per affected spec.
		expect(stored?.rawContent.startsWith(CHANGE_CONTENT)).toBe(true);
		expect(stored?.rawContent).toContain("\n## Baselines\n\n- doc-1: ");
		expect(stored?.rawContent).toContain("\n- doc-2: ");

		// The document keeps its own stable ID on edit.
		const onDisk = await readDocFile(core, "doc-3");
		expect(onDisk).toContain("id: doc-3");
		expect(onDisk).toContain("type: change");
	});

	it("validates and previews a multi-spec change without modifying any spec file", async () => {
		await createSpecification("Session behavior", SESSION_SPEC);
		await $`bun ${CLI_PATH} doc create "File naming" -t specification -p specifications`.cwd(TEST_DIR).quiet();
		await $`bun ${CLI_PATH} doc update doc-2 --content ${FILE_SPEC}`.cwd(TEST_DIR).quiet();
		await $`bun ${CLI_PATH} task create "Implement session warning"`.cwd(TEST_DIR).quiet();
		await $`bun ${CLI_PATH} decision create "Adopt warning library" -s accepted`.cwd(TEST_DIR).quiet();
		await createChange(CHANGE_CONTENT, "doc-3");

		const core = new Core(TEST_DIR);
		const beforeDoc1 = await readDocFile(core, "doc-1");
		const beforeDoc2 = await readDocFile(core, "doc-2");

		const validated = await $`bun ${CLI_PATH} doc validate doc-3`.cwd(TEST_DIR).quiet().nothrow();
		expect(validated.exitCode).toBe(0);
		expect(validated.stdout.toString()).toContain('Change doc-3 "Change doc" is valid.');
		expect(validated.stdout.toString()).toContain("Validation and preview do not modify any files.");

		const previewed = await $`bun ${CLI_PATH} doc preview doc-3`.cwd(TEST_DIR).quiet().nothrow();
		expect(previewed.exitCode).toBe(0);
		const output = previewed.stdout.toString();
		expect(output).toContain("- ### Requirement: Expiry emails [SES-2]");
		expect(output).toContain("- The system SHALL expire sessions after 30 days.");
		expect(output).toContain("+ The system SHALL expire sessions after 14 days.");
		expect(output).toContain("Resulting doc-1 - Session behavior:");
		expect(output).toContain("The system SHALL email users when a session expires.");

		// Validate and preview never modify the current specifications.
		expect(await readDocFile(core, "doc-1")).toBe(beforeDoc1);
		expect(await readDocFile(core, "doc-2")).toBe(beforeDoc2);
	});

	it("previews a single-spec addition with its scenarios", async () => {
		await createSpecification("Session behavior", SESSION_SPEC);
		await createChange(ADDITION_CHANGE, "doc-2");

		const before = await readDocFile(new Core(TEST_DIR), "doc-1");
		const previewed = await $`bun ${CLI_PATH} doc preview doc-2`.cwd(TEST_DIR).quiet().nothrow();
		expect(previewed.exitCode).toBe(0);
		const output = previewed.stdout.toString();
		expect(output).toContain("+ ### Requirement: Warn before expiry [SES-3]");
		expect(output).toContain("+ #### Scenario: Expiring soon");
		expect(output).toContain("The system SHALL warn one day before a session expires.");
		expect(await readDocFile(new Core(TEST_DIR), "doc-1")).toBe(before);
	});

	it("rejects a change whose recorded baseline is stale and still modifies nothing", async () => {
		await createSpecification("Session behavior", SESSION_SPEC);
		await createChange(ADDITION_CHANGE, "doc-2");

		// The specification moves after the change was written.
		await $`bun ${CLI_PATH} doc update doc-1 --content ${SESSION_SPEC.replace("after 30 days", "after 7 days")}`
			.cwd(TEST_DIR)
			.quiet();

		const validated = await $`bun ${CLI_PATH} doc validate doc-2`.cwd(TEST_DIR).quiet().nothrow();
		expect(validated.exitCode).toBe(1);
		expect(validated.stdout.toString()).toContain("Recorded baseline for doc-1 is stale");

		const previewed = await $`bun ${CLI_PATH} doc preview doc-2`.cwd(TEST_DIR).quiet().nothrow();
		expect(previewed.exitCode).toBe(1);
		expect(previewed.stdout.toString()).toContain("Recorded baseline for doc-1 is stale");

		const core = new Core(TEST_DIR);
		const spec = await core.getDocument("doc-1");
		expect(spec?.rawContent).toContain("after 7 days");
	});

	it("documents that validate and preview never modify files", async () => {
		const validateHelp = await $`bun ${CLI_PATH} doc validate --help`.cwd(TEST_DIR).quiet();
		expect(validateHelp.stdout.toString()).toContain("without modifying any file");
		expect(validateHelp.stdout.toString()).toContain("None; validation never modifies any file");

		const previewHelp = await $`bun ${CLI_PATH} doc preview --help`.cwd(TEST_DIR).quiet();
		expect(previewHelp.stdout.toString()).toContain("without modifying any file");
		expect(previewHelp.stdout.toString()).toContain("None; preview never modifies any file");
	});

	it("rejects missing documents and non-change documents", async () => {
		await createSpecification("Session behavior", SESSION_SPEC);

		const missing = await $`bun ${CLI_PATH} doc validate doc-99`.cwd(TEST_DIR).quiet().nothrow();
		expect(missing.exitCode).toBe(1);
		expect(missing.stderr.toString()).toContain("Document not found: doc-99");

		const notChange = await $`bun ${CLI_PATH} doc preview doc-1`.cwd(TEST_DIR).quiet().nothrow();
		expect(notChange.exitCode).toBe(1);
		expect(notChange.stderr.toString()).toContain("Validate and preview apply to change documents only.");
	});

	it("rejects unknown linked documents, tasks, or decisions and leaves the change unchanged", async () => {
		await createSpecification("Session behavior", SESSION_SPEC);
		await $`bun ${CLI_PATH} doc create "Tighten session expiry" -t change`.cwd(TEST_DIR).quiet();
		const before = await readDocFile(new Core(TEST_DIR), "doc-2");

		const invalidContent =
			"# Change: broken links\n\n## Affected specs\n\n- doc-9\n\n## Linked tasks\n\n- task-9\n\n## Related decisions\n\n- decision-9\n";
		const result = await $`bun ${CLI_PATH} doc update doc-2 --content ${invalidContent}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("Change document is invalid:");
		expect(result.stderr.toString()).toContain('Affected spec "doc-9" does not match any document.');
		expect(result.stderr.toString()).toContain('Linked task "task-9" does not exist.');
		expect(result.stderr.toString()).toContain('Related decision "decision-9" does not exist.');

		expect(await readDocFile(new Core(TEST_DIR), "doc-2")).toBe(before);
	});

	it("rejects delta targets that do not resolve in the affected specs", async () => {
		await createSpecification("Session behavior", SESSION_SPEC);
		await $`bun ${CLI_PATH} doc create "Tighten session expiry" -t change`.cwd(TEST_DIR).quiet();

		const unknownTarget =
			"## Affected specs\n\n- doc-1\n\n## Modified requirements\n\n### Requirement: Anything [SES-9]\n";
		const result = await $`bun ${CLI_PATH} doc update doc-2 --content ${unknownTarget}`.cwd(TEST_DIR).quiet().nothrow();

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain('Requirement "SES-9" does not exist in the affected specs.');
	});

	it("rejects a delta whose requirement ID is ambiguous across several affected specs", async () => {
		await createSpecification("Session behavior", SESSION_SPEC);

		// Give doc-2 the same requirement IDs as doc-1 so SES-1 resolves to two specs.
		await $`bun ${CLI_PATH} doc create "Session behavior copy" -t specification -p specifications`
			.cwd(TEST_DIR)
			.quiet();
		await $`bun ${CLI_PATH} doc update doc-2 --content ${SESSION_SPEC}`.cwd(TEST_DIR).quiet();
		await $`bun ${CLI_PATH} doc create "Tighten session expiry" -t change`.cwd(TEST_DIR).quiet();

		const ambiguous =
			"## Affected specs\n\n- doc-1\n- doc-2\n\n## Modified requirements\n\n### Requirement: Sessions expire [SES-1]\n";
		const result = await $`bun ${CLI_PATH} doc update doc-3 --content ${ambiguous}`.cwd(TEST_DIR).quiet().nothrow();

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain('Requirement "SES-1" is ambiguous: it exists in doc-1 and doc-2.');
	});

	it("keeps minimal change documents valid so create-then-update works", async () => {
		await $`bun ${CLI_PATH} doc create "Exploratory change" -t change`.cwd(TEST_DIR).quiet();
		const result =
			await $`bun ${CLI_PATH} doc update doc-1 --content "# Change: rationale only\n\nStop doing the thing.\n"`
				.cwd(TEST_DIR)
				.quiet()
				.nothrow();
		expect(result.exitCode).toBe(0);
		expect((await new Core(TEST_DIR).getDocument("doc-1"))?.rawContent).toContain("Stop doing the thing.");
	});

	it("keeps routine tasks working without any change document", async () => {
		await $`bun ${CLI_PATH} doc create "Tighten session expiry" -t change`.cwd(TEST_DIR).quiet();

		const created = await $`bun ${CLI_PATH} task create "Fix typo in readme"`.cwd(TEST_DIR).quiet().nothrow();
		expect(created.exitCode).toBe(0);

		const viewed = await $`bun ${CLI_PATH} task view task-1 --plain`.cwd(TEST_DIR).quiet().nothrow();
		expect(viewed.exitCode).toBe(0);
		expect(viewed.stdout.toString()).toContain("Fix typo in readme");

		// A task behind a behavior change also works with no automatic coupling to the change.
		const listed = await $`bun ${CLI_PATH} task list --plain`.cwd(TEST_DIR).quiet().nothrow();
		expect(listed.exitCode).toBe(0);
		expect(listed.stdout.toString()).toContain("TASK-1 - Fix typo in readme");
	});
});
