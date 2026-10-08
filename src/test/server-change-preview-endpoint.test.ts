import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { FileSystem } from "../file-system/operations.ts";
import type { ChangePreview } from "../markdown/change-document.ts";
import { serializeDocument, serializeTask } from "../markdown/serializer.ts";
import { BacklogServer } from "../server/index.ts";
import type { Document, Task } from "../types/index.ts";
import { createUniqueTestDir, retry, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let server: BacklogServer | null = null;
let serverPort = 0;

const SPEC_CONTENT = `# Session behavior

### Requirement: Sessions expire [SES-1]

The system SHALL expire sessions after 30 days.

#### Scenario: Expired session

- WHEN a client presents an expired token
- THEN the request is rejected
`;

const CHANGE_CONTENT = `# Change: Tighten session expiry

## Affected specs

- doc-1

## Linked tasks

- task-1

## Modified requirements

### Requirement: Sessions expire after 14 days [SES-1]

The system SHALL expire sessions after 14 days.
`;

const INVALID_CHANGE_CONTENT = `# Change: Broken links

## Affected specs

- doc-1

## Linked tasks

- task-404
`;

async function writeProjectFiles(): Promise<void> {
	const filesystem = new FileSystem(TEST_DIR);
	const task: Task = {
		id: "task-1",
		title: "Implement the warning",
		status: "To Do",
		assignee: [],
		labels: [],
		dependencies: [],
		createdDate: "2026-01-01 00:00",
		description: "Delivery work stays a task; reviewing the change never touches it.",
		rawContent: "",
	};
	await Bun.write(join(filesystem.tasksDir, "task-1 - Implement-the-warning.md"), serializeTask(task));
	const writeDocument = (id: string, title: string, type: Document["type"], path: string, content: string) =>
		Bun.write(
			join(filesystem.docsDir, ...path.split("/")),
			serializeDocument({
				id,
				title,
				type,
				createdDate: "2026-01-01 00:00",
				rawContent: content,
			}),
		);
	await writeDocument(
		"doc-1",
		"Session behavior",
		"specification",
		"specifications/doc-1 - Session-behavior.md",
		SPEC_CONTENT,
	);
	await writeDocument(
		"doc-2",
		"Tighten session expiry",
		"change",
		"changes/doc-2 - Tighten-session-expiry.md",
		CHANGE_CONTENT,
	);
	await writeDocument("doc-3", "Broken links", "change", "changes/doc-3 - Broken-links.md", INVALID_CHANGE_CONTENT);
}

async function startServer(): Promise<void> {
	TEST_DIR = createUniqueTestDir("server-change-preview");
	const filesystem = new FileSystem(TEST_DIR);
	await filesystem.ensureBacklogStructure();
	await filesystem.saveConfig({
		projectName: "Server Change Preview",
		statuses: ["To Do", "In Progress", "Done"],
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		remoteOperations: false,
	});
	await writeProjectFiles();

	server = new BacklogServer(TEST_DIR);
	await server.start(0, false);
	const port = server.getPort();
	expect(port).not.toBeNull();
	serverPort = port ?? 0;

	await retry(async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/docs`);
		if (!response.ok) {
			throw new Error("Server not ready");
		}
	});
}

async function stopServer(): Promise<void> {
	if (server) {
		await server.stop();
		server = null;
	}
	await safeCleanup(TEST_DIR);
}

async function readFile(relative: string): Promise<string> {
	return await Bun.file(join(TEST_DIR, "backlog", relative)).text();
}

describe("BacklogServer change preview endpoint", () => {
	beforeEach(startServer);
	afterEach(stopServer);

	it("previews the validated projection without modifying any file", async () => {
		const before = {
			spec: await readFile("docs/specifications/doc-1 - Session-behavior.md"),
			change: await readFile("docs/changes/doc-2 - Tighten-session-expiry.md"),
			task: await readFile("tasks/task-1 - Implement-the-warning.md"),
		};

		const response = await fetch(`http://127.0.0.1:${serverPort}/api/doc/doc-2/preview`);
		expect(response.status).toBe(200);
		const preview = (await response.json()) as ChangePreview;
		expect(preview.documentId).toBe("doc-2");
		expect(preview.valid).toBe(true);
		expect(preview.specs).toHaveLength(1);
		const spec = preview.specs[0] as ChangePreview["specs"][number];
		expect(spec.specId).toBe("doc-1");
		expect(spec.diff.some((line) => line.kind === "removed" && line.text.includes("after 30 days"))).toBe(true);
		expect(spec.diff.some((line) => line.kind === "added" && line.text.includes("after 14 days"))).toBe(true);
		expect(spec.resultingContent).toContain("after 14 days");
		expect(spec.resultingContent).not.toContain("after 30 days");

		// Reviewing is read-only: the current spec, the proposal, and the linked task are untouched.
		expect(await readFile("docs/specifications/doc-1 - Session-behavior.md")).toBe(before.spec);
		expect(await readFile("docs/changes/doc-2 - Tighten-session-expiry.md")).toBe(before.change);
		expect(await readFile("tasks/task-1 - Implement-the-warning.md")).toBe(before.task);
	});

	it("reports an invalid change with actionable issues and no projection", async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/doc/doc-3/preview`);
		expect(response.status).toBe(200);
		const preview = (await response.json()) as ChangePreview;
		expect(preview.valid).toBe(false);
		expect(preview.specs).toHaveLength(0);
		expect(preview.issues.some((issue) => issue.message.includes('Linked task "task-404" does not exist'))).toBe(true);
	});

	it("answers 400 for a document that is not a change", async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/doc/doc-1/preview`);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toContain("change documents only");
	});

	it("answers 404 for an unknown document", async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/doc/doc-99/preview`);
		expect(response.status).toBe(404);
	});
});
