import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { FileSystem } from "../file-system/operations.ts";
import { serializeDecision } from "../markdown/serializer.ts";
import { BacklogServer } from "../server/index.ts";
import type { Decision, SearchResult } from "../types/index.ts";
import { createUniqueTestDir, retry, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let server: BacklogServer | null = null;
let serverPort = 0;

function adr(overrides: Partial<Decision> & Pick<Decision, "id" | "title" | "status">): Decision {
	return {
		date: "2026-01-02 03:04",
		context: "We need durable storage.",
		decision: "Pick one engine.",
		consequences: "Migrations hurt.",
		scope: "Storage engine",
		kind: "architecture",
		rawContent: "",
		...overrides,
	};
}

async function writeDecision(decision: Decision): Promise<void> {
	const filesystem = new FileSystem(TEST_DIR);
	const archived = decision.archived ? join(filesystem.archiveDecisionsDir, `${decision.id} - File.md`) : undefined;
	if (archived) {
		await Bun.write(archived, serializeDecision(decision));
		return;
	}
	await Bun.write(join(filesystem.decisionsDir, `${decision.id} - File.md`), serializeDecision(decision));
}

async function startServer(): Promise<void> {
	TEST_DIR = createUniqueTestDir("server-guidance");
	const filesystem = new FileSystem(TEST_DIR);
	await filesystem.ensureBacklogStructure();
	await filesystem.saveConfig({
		projectName: "Server Guidance",
		statuses: ["To Do", "In Progress", "Done"],
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		remoteOperations: false,
	});
	await writeDecision(
		adr({
			id: "decision-1",
			title: "Use Postgres storage",
			status: "superseded",
			supersededBy: "decision-2",
		}),
	);
	await writeDecision(
		adr({
			id: "decision-2",
			title: "Use SQLite storage",
			status: "accepted",
			supersedes: "decision-1",
		}),
	);
	await writeDecision(adr({ id: "decision-3", title: "Try MongoDB cache", status: "rejected", scope: "Cache layer" }));
	await writeDecision({
		id: "decision-4",
		title: "Team rituals",
		date: "2026-01-02 03:04",
		status: "accepted",
		context: "Rituals matter.",
		decision: "Keep them.",
		consequences: "Time is spent.",
		rawContent: "",
	});
	await writeDecision(
		adr({
			id: "decision-5",
			title: "Broken chain",
			status: "superseded",
			supersededBy: "decision-99",
		}),
	);

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

describe("BacklogServer decision guidance endpoint", () => {
	beforeEach(startServer);
	afterEach(stopServer);

	it("resolves a retired ADR to its accepted replacement", async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/decision/decision-1/guidance`);
		expect(response.status).toBe(200);
		const resolution = (await response.json()) as {
			decision: Decision;
			retired?: { state: string; archived: boolean; replacement: Decision | null };
		};
		expect(resolution.decision.id).toBe("decision-1");
		expect(resolution.retired?.state).toBe("superseded");
		expect(resolution.retired?.archived).toBe(false);
		expect(resolution.retired?.replacement?.id).toBe("decision-2");
		expect(resolution.retired?.replacement?.status).toBe("accepted");
	});

	it("returns an applicable ADR without retired state", async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/decision/decision-2/guidance`);
		expect(response.status).toBe(200);
		const resolution = (await response.json()) as { decision: Decision; retired?: unknown };
		expect(resolution.decision.id).toBe("decision-2");
		expect(resolution.retired).toBeUndefined();
	});

	it("reports a rejected ADR as retired with no replacement", async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/decision/decision-3/guidance`);
		expect(response.status).toBe(200);
		const resolution = (await response.json()) as {
			retired?: { state: string; replacement: Decision | null };
		};
		expect(resolution.retired?.state).toBe("rejected");
		expect(resolution.retired?.replacement).toBeNull();
	});

	it("answers 404 for an unknown decision", async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/decision/decision-404/guidance`);
		expect(response.status).toBe(404);
	});

	it("reports a broken replacement link instead of pretending guidance exists", async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/decision/decision-5/guidance`);
		expect(response.status).toBe(409);
		const body = (await response.json()) as { error: string };
		expect(body.error).toContain("decision-99");
	});

	it("marks an archived retired ADR without hiding its replacement", async () => {
		const core = new Core(TEST_DIR);
		await core.archiveDecision("decision-3", false);

		const response = await fetch(`http://127.0.0.1:${serverPort}/api/decision/decision-3/guidance`);
		expect(response.status).toBe(200);
		const resolution = (await response.json()) as {
			decision: Decision;
			retired?: { state: string; archived: boolean };
		};
		expect(resolution.decision.archived).toBe(true);
		expect(resolution.retired?.archived).toBe(true);
	});

	it("keeps retired ADRs out of the default guidance corpus", async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/search?query=storage`);
		expect(response.status).toBe(200);
		const results = (await response.json()) as SearchResult[];
		const decisionIds = results.filter((result) => result.type === "decision").map((result) => result.decision.id);
		expect(decisionIds).toContain("decision-2");
		expect(decisionIds).not.toContain("decision-1");
		expect(decisionIds).not.toContain("decision-5");
	});
});
