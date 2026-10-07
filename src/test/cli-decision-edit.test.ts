import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
const CLI_PATH = getTestCliPath();

/** Mirrors the store's "<id> - <sanitized title>.md" naming for the titles used below. */
function decisionFile(title: string): string {
	return join(TEST_DIR, "backlog", "decisions", `decision-1 - ${title.replace(/\s+/g, "-")}.md`);
}

describe("CLI decision view and edit commands", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-decision-edit");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();

		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "Decision Edit Project");
		await core.createDecision(
			{
				id: "decision-1",
				title: "Use Postgres",
				date: "2026-01-02 03:04",
				status: "proposed",
				context: "We need durable storage.",
				decision: "Adopt PostgreSQL.",
				consequences: "One more managed service.",
				alternatives: "SQLite.",
				rawContent: "",
			},
			false,
		);
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("views a decision with --plain and without a TTY", async () => {
		const plain = await $`bun ${CLI_PATH} decision view decision-1 --plain`.cwd(TEST_DIR).quiet();
		expect(plain.exitCode).toBe(0);
		const stdout = plain.stdout.toString();
		expect(stdout).toContain("title: Use Postgres");
		expect(stdout).toContain("## Context");
		expect(stdout).toContain("We need durable storage.");
		expect(stdout).toContain("## Alternatives");

		const noTty = await $`bun ${CLI_PATH} decision view decision-1`.cwd(TEST_DIR).quiet();
		expect(noTty.exitCode).toBe(0);
		expect(noTty.stdout.toString()).toContain("Adopt PostgreSQL.");
		expect(noTty.stdout.toString()).not.toContain("[");
	});

	it("fails for unknown and ambiguous decision IDs when viewing", async () => {
		const missing = await $`bun ${CLI_PATH} decision view decision-9 --plain`.cwd(TEST_DIR).quiet().nothrow();
		expect(missing.exitCode).not.toBe(0);
		expect(missing.stderr.toString()).toContain("Decision decision-9 not found.");

		// A second file claiming the same frontmatter ID makes the lookup fail closed.
		const original = await Bun.file(decisionFile("Use Postgres")).text();
		await Bun.write(decisionFile("Use Postgres Copy"), original);

		const ambiguous = await $`bun ${CLI_PATH} decision view decision-1 --plain`.cwd(TEST_DIR).quiet().nothrow();
		expect(ambiguous.exitCode).not.toBe(0);
		expect(ambiguous.stderr.toString()).toContain("Decision ID decision-1 is ambiguous");
	});

	it("updates title, status, and body while preserving identity and untouched fields", async () => {
		const result = await $`bun ${CLI_PATH} decision edit decision-1 --title "Use PostgreSQL" -s accepted`
			.cwd(TEST_DIR)
			.quiet();
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain("Updated decision decision-1");

		const core = new Core(TEST_DIR);
		const updated = await core.filesystem.loadDecision("decision-1");
		expect(updated?.title).toBe("Use PostgreSQL");
		expect(updated?.status).toBe("accepted");
		expect(updated?.date).toBe("2026-01-02 03:04");
		expect(updated?.context).toBe("We need durable storage.");
		expect(updated?.decision).toBe("Adopt PostgreSQL.");
		expect(updated?.consequences).toBe("One more managed service.");
		expect(updated?.alternatives).toBe("SQLite.");

		// The file is renamed to match the new title; the old one is gone.
		const files = await Array.fromAsync(
			new Bun.Glob("decision-*.md").scan({ cwd: join(TEST_DIR, "backlog", "decisions") }),
		);
		expect(files).toHaveLength(1);
		expect(files[0]).toContain("Use-PostgreSQL");
	});

	it("replaces body sections from --content and keeps omitted sections", async () => {
		const content = "## Context\n\nA different context.\n";
		const result = await $`bun ${CLI_PATH} decision edit decision-1 --content ${content}`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);

		const core = new Core(TEST_DIR);
		const updated = await core.filesystem.loadDecision("decision-1");
		expect(updated?.context).toBe("A different context.");
		expect(updated?.decision).toBe("Adopt PostgreSQL.");
		expect(updated?.consequences).toBe("One more managed service.");
		expect(updated?.alternatives).toBe("SQLite.");
	});

	it("ignores frontmatter inside --content", async () => {
		const content =
			"---\nid: decision-9\ntitle: Hijacked\nstatus: rejected\ndate: '1999-01-01'\n---\n## Decision\n\nBody only.\n";
		const result = await $`bun ${CLI_PATH} decision edit decision-1 --content ${content}`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);

		const core = new Core(TEST_DIR);
		const updated = await core.filesystem.loadDecision("decision-1");
		expect(updated?.id).toBe("decision-1");
		expect(updated?.title).toBe("Use Postgres");
		expect(updated?.status).toBe("proposed");
		expect(updated?.date).toBe("2026-01-02 03:04");
		expect(updated?.decision).toBe("Body only.");
	});

	it("fails invalid or unknown updates and leaves the original file intact", async () => {
		const file = decisionFile("Use Postgres");
		const before = await Bun.file(file).text();

		const missing = await $`bun ${CLI_PATH} decision edit decision-9 -s accepted`.cwd(TEST_DIR).quiet().nothrow();
		expect(missing.exitCode).not.toBe(0);
		expect(missing.stderr.toString()).toContain("Decision not found: decision-9");

		const emptyTitle = await $`bun ${CLI_PATH} decision edit decision-1 --title "   "`.cwd(TEST_DIR).quiet().nothrow();
		expect(emptyTitle.exitCode).not.toBe(0);
		expect(emptyTitle.stderr.toString()).toContain("Decision title cannot be empty.");

		const emptyStatus = await $`bun ${CLI_PATH} decision edit decision-1 -s ""`.cwd(TEST_DIR).quiet().nothrow();
		expect(emptyStatus.exitCode).not.toBe(0);
		expect(emptyStatus.stderr.toString()).toContain("Decision status cannot be empty.");

		// A second file claiming the same frontmatter ID makes the update fail closed.
		await Bun.write(decisionFile("Use Postgres Copy"), before);
		const ambiguousEdit = await $`bun ${CLI_PATH} decision edit decision-1 -s accepted`.cwd(TEST_DIR).quiet().nothrow();
		expect(ambiguousEdit.exitCode).not.toBe(0);
		expect(ambiguousEdit.stderr.toString()).toContain("Decision ID decision-1 is ambiguous");

		expect(await Bun.file(file).text()).toBe(before);
		expect(await Bun.file(decisionFile("Use Postgres Copy")).text()).toBe(before);
	});
});
