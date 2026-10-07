import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { $ } from "bun";
import { Core } from "../index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
const CLI_PATH = getTestCliPath();

const SPEC_CONTENT = `# Session behavior

## Requirements

### Requirement: Sessions expire [SES-1]

The system SHALL expire sessions after 30 days.

#### Scenario: Expired session is rejected

- WHEN a client presents an expired token
- THEN the request is rejected with 401`;

async function readDocFile(core: Core, id: string): Promise<string> {
	const doc = (await core.filesystem.listDocuments()).find((candidate) => candidate.id === id);
	if (!doc?.path) throw new Error(`Document ${id} not found on disk`);
	return await Bun.file(`${core.filesystem.docsDir}/${doc.path}`).text();
}

describe("CLI specification requirements", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-spec-requirements");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();

		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "Spec Requirements Project");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("round-trips a specification with requirement IDs and scenarios through update and view", async () => {
		const created = await $`bun ${CLI_PATH} doc create "Session behavior" -t specification -p specifications`
			.cwd(TEST_DIR)
			.quiet();
		expect(created.exitCode).toBe(0);
		expect(created.stdout.toString()).toContain("Created document doc-1");
		expect(created.stdout.toString()).toContain("Path: backlog/docs/specifications/doc-1 - Session-behavior.md");

		const updated = await $`bun ${CLI_PATH} doc update doc-1 --content ${SPEC_CONTENT}`.cwd(TEST_DIR).quiet();
		expect(updated.exitCode).toBe(0);

		const viewed = await $`bun ${CLI_PATH} doc view doc-1 --plain`.cwd(TEST_DIR).quiet();
		expect(viewed.exitCode).toBe(0);
		expect(viewed.stdout.toString()).toContain("### Requirement: Sessions expire [SES-1]");
		expect(viewed.stdout.toString()).toContain("#### Scenario: Expired session is rejected");
		expect(viewed.stdout.toString()).toContain("- THEN the request is rejected with 401");

		const core = new Core(TEST_DIR);
		const stored = await core.getDocument("doc-1");
		expect(stored?.type).toBe("specification");
		expect(stored?.path).toBe("specifications/doc-1 - Session-behavior.md");
		expect(stored?.rawContent).toBe(SPEC_CONTENT);
	});

	it("rejects duplicate requirement IDs with an actionable error and leaves the document unchanged", async () => {
		await $`bun ${CLI_PATH} doc create "Session behavior" -t specification`.cwd(TEST_DIR).quiet();
		const duplicateContent = "### Requirement: First [REQ-1]\n\nA.\n\n### Requirement: Second [REQ-1]\n\nB.\n";
		const before = await readDocFile(new Core(TEST_DIR), "doc-1");

		const result = await $`bun ${CLI_PATH} doc update doc-1 --content ${duplicateContent}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("Specification requirements are invalid:");
		expect(result.stderr.toString()).toContain('- line 5: Duplicate requirement ID "REQ-1" (first used on line 1)');

		const core = new Core(TEST_DIR);
		const after = await readDocFile(core, "doc-1");
		expect(after).toBe(before);
		expect((await core.getDocument("doc-1"))?.rawContent).not.toBe(duplicateContent);
	});

	it("rejects a scenario outside any requirement and leaves the document unchanged", async () => {
		await $`bun ${CLI_PATH} doc create "Session behavior" -t specification`.cwd(TEST_DIR).quiet();
		const orphanContent = "## Purpose\n\n#### Scenario: Orphaned\n\n- WHEN x\n- THEN y\n";
		const before = await readDocFile(new Core(TEST_DIR), "doc-1");

		const result = await $`bun ${CLI_PATH} doc update doc-1 --content ${orphanContent}`.cwd(TEST_DIR).quiet().nothrow();

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain('line 3: Scenario "Orphaned" is not inside a requirement');

		expect(await readDocFile(new Core(TEST_DIR), "doc-1")).toBe(before);
	});

	it("rejects a scenario heading without a title and leaves the document unchanged", async () => {
		await $`bun ${CLI_PATH} doc create "Session behavior" -t specification`.cwd(TEST_DIR).quiet();
		const malformedContent = "### Requirement: Login [REQ-1]\n\n#### Scenario:\n\n- WHEN x\n";
		const before = await readDocFile(new Core(TEST_DIR), "doc-1");

		const result = await $`bun ${CLI_PATH} doc update doc-1 --content ${malformedContent}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain('line 3: Scenario has no title. Use "#### Scenario: <title>".');

		expect(await readDocFile(new Core(TEST_DIR), "doc-1")).toBe(before);
	});

	it("keeps ordinary documents unvalidated so legacy content stays editable", async () => {
		await $`bun ${CLI_PATH} doc create "Working notes" -t guide`.cwd(TEST_DIR).quiet();
		const ordinaryContent = "### Requirement: Not a spec [REQ-1]\n\nA.\n\n### Requirement: Also not [REQ-1]\n\nB.";

		const result = await $`bun ${CLI_PATH} doc update doc-1 --content ${ordinaryContent}`.cwd(TEST_DIR).quiet();

		expect(result.exitCode).toBe(0);
		const core = new Core(TEST_DIR);
		expect((await core.getDocument("doc-1"))?.rawContent).toBe(ordinaryContent);
	});

	it("keeps old specifications without the convention valid", async () => {
		await $`bun ${CLI_PATH} doc create "Legacy spec" -t specification`.cwd(TEST_DIR).quiet();
		const legacyContent = "# Legacy specification\n\nThe system SHALL do the old thing.";

		const result = await $`bun ${CLI_PATH} doc update doc-1 --content ${legacyContent}`.cwd(TEST_DIR).quiet();

		expect(result.exitCode).toBe(0);
		const core = new Core(TEST_DIR);
		expect((await core.getDocument("doc-1"))?.rawContent).toBe(legacyContent);
	});

	it("keeps routine tasks working alongside specification documents", async () => {
		await $`bun ${CLI_PATH} doc create "Session behavior" -t specification -p specifications`.cwd(TEST_DIR).quiet();
		await $`bun ${CLI_PATH} doc update doc-1 --content ${SPEC_CONTENT}`.cwd(TEST_DIR).quiet();

		const created = await $`bun ${CLI_PATH} task create "Fix login bug"`.cwd(TEST_DIR).quiet().nothrow();
		expect(created.exitCode).toBe(0);

		const viewed = await $`bun ${CLI_PATH} task view task-1 --plain`.cwd(TEST_DIR).quiet().nothrow();
		expect(viewed.exitCode).toBe(0);
		expect(viewed.stdout.toString()).toContain("Fix login bug");

		const listed = await $`bun ${CLI_PATH} doc list --plain`.cwd(TEST_DIR).quiet().nothrow();
		expect(listed.exitCode).toBe(0);
		expect(listed.stdout.toString()).toContain("doc-1 - Session behavior");
	});
});
