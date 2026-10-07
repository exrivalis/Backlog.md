import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";
import { FileSystem } from "../file-system/operations.ts";
import { serializeDecision } from "../markdown/serializer.ts";
import { BacklogServer } from "../server/index.ts";
import type { Decision } from "../types/index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, retry, safeCleanup } from "./test-utils.ts";

const CLI_PATH = getTestCliPath();

let TEST_DIR: string;
let server: BacklogServer | null = null;
let serverPort = 0;

async function createServerDecision(): Promise<void> {
	const filesystem = new FileSystem(TEST_DIR);
	const decision: Decision = {
		id: "decision-1",
		title: "Use Postgres",
		date: "2026-01-02 03:04",
		status: "proposed",
		context: "We need durable storage.",
		decision: "Adopt PostgreSQL.",
		consequences: "One more managed service.",
		rawContent: "",
	};
	await Bun.write(join(filesystem.decisionsDir, "decision-1 - Use-Postgres.md"), serializeDecision(decision));
}

async function startServer(): Promise<void> {
	TEST_DIR = createUniqueTestDir("server-decisions");
	const filesystem = new FileSystem(TEST_DIR);
	await filesystem.ensureBacklogStructure();
	await filesystem.saveConfig({
		projectName: "Server Decisions",
		statuses: ["To Do", "In Progress", "Done"],
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		remoteOperations: false,
	});
	await createServerDecision();

	server = new BacklogServer(TEST_DIR);
	await server.start(0, false);
	const port = server.getPort();
	expect(port).not.toBeNull();
	serverPort = port ?? 0;

	await retry(async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/decisions`);
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

describe("BacklogServer decision endpoints", () => {
	beforeEach(startServer);
	afterEach(stopServer);

	it("updates the body from raw markdown while ignoring payload frontmatter", async () => {
		const payload =
			"---\nid: decision-9\ntitle: Hijacked\nstatus: rejected\ndate: '1999-01-01'\n---\n## Context\n\nBrowser context.\n";
		const update = await fetch(`http://127.0.0.1:${serverPort}/api/decisions/decision-1`, {
			method: "PUT",
			headers: { "Content-Type": "text/plain" },
			body: payload,
		});
		expect(update.status).toBe(200);

		const viewed = (await (await fetch(`http://127.0.0.1:${serverPort}/api/decisions/decision-1`)).json()) as Decision;
		expect(viewed.id).toBe("decision-1");
		expect(viewed.title).toBe("Use Postgres");
		expect(viewed.status).toBe("proposed");
		expect(viewed.date).toBe("2026-01-02 03:04");
		expect(viewed.context).toBe("Browser context.");
		// Sections missing from the payload keep their previous content.
		expect(viewed.decision).toBe("Adopt PostgreSQL.");
	});

	it("answers 404 for unknown decisions and 409 for ambiguous ones without writing", async () => {
		const missing = await fetch(`http://127.0.0.1:${serverPort}/api/decisions/decision-9`, {
			method: "PUT",
			headers: { "Content-Type": "text/plain" },
			body: "## Context\n\nNope.\n",
		});
		expect(missing.status).toBe(404);

		const filesystem = new FileSystem(TEST_DIR);
		const decisionPath = join(filesystem.decisionsDir, "decision-1 - Use-Postgres.md");
		const before = await Bun.file(decisionPath).text();
		await Bun.write(join(filesystem.decisionsDir, "decision-01 - Copy.md"), before);

		const ambiguous = await fetch(`http://127.0.0.1:${serverPort}/api/decisions/decision-1`, {
			method: "PUT",
			headers: { "Content-Type": "text/plain" },
			body: "## Context\n\nNope.\n",
		});
		expect(ambiguous.status).toBe(409);
		expect(await ambiguous.text()).toContain("Decision ID decision-1 is ambiguous");
		expect(await Bun.file(decisionPath).text()).toBe(before);
	});

	it("publishes browser updates to the same storage the CLI reads", async () => {
		const payload = "## Context\n\nBrowser context.\n\n## Decision\n\nUse SQLite instead.\n";
		const update = await fetch(`http://127.0.0.1:${serverPort}/api/decisions/decision-1`, {
			method: "PUT",
			headers: { "Content-Type": "text/plain" },
			body: payload,
		});
		expect(update.status).toBe(200);

		const view = await $`bun ${CLI_PATH} decision view decision-1 --plain`.cwd(TEST_DIR).quiet();
		expect(view.exitCode).toBe(0);
		expect(view.stdout.toString()).toContain("Browser context.");
		expect(view.stdout.toString()).toContain("Use SQLite instead.");

		const list = await $`bun ${CLI_PATH} decision list --plain`.cwd(TEST_DIR).quiet();
		expect(list.exitCode).toBe(0);
		expect(list.stdout.toString().trim()).toBe("decision-1 - Use Postgres (proposed)");
	});
});
