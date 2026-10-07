import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import {
	DELETION_FREE_TEXT_LIMIT,
	DELETION_GIT_RECOVERY_WARNING,
	DELETION_NO_GIT_WARNING,
} from "../core/deletion-preview.ts";
import { serializeTask } from "../markdown/serializer.ts";
import { BacklogServer } from "../server/index.ts";
import type { Task } from "../types/index.ts";
import type { EntityDeletionPreview, EntityDeletionResult } from "../web/lib/api.ts";
import { retry } from "./test-utils.ts";

// Outside any enclosing Git repository, so `deletionRecoveryWarning` sees a filesystem-only
// project and the no-Git warning is deterministic.
let testDir: string;
let server: BacklogServer | null = null;
let serverPort = 0;
let core: Core;

function task(overrides: Partial<Task> = {}): Task {
	return {
		id: "TASK-1",
		title: "Delete me",
		status: "To Do",
		assignee: [],
		labels: [],
		dependencies: [],
		createdDate: "2026-01-01",
		...overrides,
	};
}

async function saveTask(overrides: Partial<Task>): Promise<void> {
	await core.filesystem.saveTask(task(overrides));
}

function previewUrl(endpoint: "tasks" | "docs", id: string): string {
	return `http://127.0.0.1:${serverPort}/api/${endpoint}/${encodeURIComponent(id)}/delete`;
}

beforeEach(async () => {
	testDir = mkdtempSync(join(tmpdir(), "backlog-server-delete-"));
	core = new Core(testDir);
	await core.filesystem.ensureBacklogStructure();
	await core.filesystem.saveConfig({
		projectName: "Server delete",
		statuses: ["To Do", "In Progress", "Done"],
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		remoteOperations: false,
		checkActiveBranches: false,
		autoCommit: false,
	});
	await core.createTask(task(), false);

	server = new BacklogServer(testDir);
	await server.start(0, false);
	serverPort = server.getPort() ?? 0;
	await retry(async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/status`);
		if (!response.ok) throw new Error("Server is not ready");
	});
});

afterEach(async () => {
	await server?.stop();
	server = null;
	rmSync(testDir, { recursive: true, force: true });
});

describe("BacklogServer explicit delete endpoints", () => {
	it("previews an unlinked task with the no-Git recovery warning", async () => {
		const response = await fetch(previewUrl("tasks", "TASK-1"));

		expect(response.status).toBe(200);
		const preview = (await response.json()) as EntityDeletionPreview;
		expect(preview.status).toBe("found");
		expect(preview.targetId).toBe("TASK-1");
		expect(preview.targetPath).toContain("task-1");
		expect(preview.references).toEqual([]);
		expect(preview.freeTextLimit).toBe(DELETION_FREE_TEXT_LIMIT);
		expect(preview.recoveryWarning).toBe(DELETION_NO_GIT_WARNING);
	});

	it("deletes an unlinked task without moving it to the archive", async () => {
		const response = await fetch(previewUrl("tasks", "TASK-1"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "cancel" }),
		});

		expect(response.status).toBe(200);
		const result = (await response.json()) as EntityDeletionResult;
		expect(result).toEqual({
			success: true,
			deletedId: "TASK-1",
			deletedPath: expect.stringContaining("task-1"),
			updatedIds: [],
			recoveryWarning: DELETION_NO_GIT_WARNING,
		});
		expect(await core.filesystem.listTasks()).toEqual([]);
		expect(await core.filesystem.listArchivedTasks()).toEqual([]);
	});

	it("keeps the existing DELETE /api/tasks/:id route archiving", async () => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/api/tasks/TASK-1`, { method: "DELETE" });

		expect(response.status).toBe(200);
		expect(await core.filesystem.listTasks()).toEqual([]);
		const archived = await core.filesystem.listArchivedTasks();
		expect(archived.map((entry) => entry.id)).toEqual(["TASK-1"]);
	});

	it("previews the inbound references of a linked task", async () => {
		await saveTask({ id: "TASK-2", title: "Dependent", dependencies: ["TASK-1"] });

		const response = await fetch(previewUrl("tasks", "TASK-1"));

		expect(response.status).toBe(200);
		const preview = (await response.json()) as EntityDeletionPreview;
		expect(preview.references).toHaveLength(1);
		expect(preview.references[0]).toMatchObject({
			relation: "dependency",
			sourceId: "TASK-2",
			value: "TASK-1",
		});
		expect(preview.references[0]?.sourcePath).toContain("task-2");
	});

	it("rejects cancel for a linked task without deleting", async () => {
		await saveTask({ id: "TASK-2", title: "Dependent", dependencies: ["TASK-1"] });

		const response = await fetch(previewUrl("tasks", "TASK-1"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "cancel" }),
		});

		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toContain("requires an unlink or reassign choice");
		expect((await core.filesystem.listTasks()).map((entry) => entry.id)).toContain("TASK-1");
	});

	it("rejects an invalid replacement with the CLI's message", async () => {
		await saveTask({ id: "TASK-2", title: "Dependent", dependencies: ["TASK-1"] });

		const response = await fetch(previewUrl("tasks", "TASK-1"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "reassign", replacementId: "TASK-99" }),
		});

		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toContain("TASK-99 does not match exactly one task or draft.");
		expect((await core.filesystem.listTasks()).map((entry) => entry.id)).toContain("TASK-1");
		const dependent = (await core.filesystem.listTasks()).find((entry) => entry.id === "TASK-2");
		expect(dependent?.dependencies).toEqual(["TASK-1"]);
	});

	it("rejects reassigning references to the record being deleted", async () => {
		await saveTask({ id: "TASK-2", title: "Dependent", dependencies: ["TASK-1"] });

		const response = await fetch(previewUrl("tasks", "TASK-1"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "reassign", replacementId: "TASK-1" }),
		});

		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toContain("it is the record being deleted");
		expect((await core.filesystem.listTasks()).map((entry) => entry.id)).toContain("TASK-1");
	});

	it("unlinks references added after the browser preview was loaded", async () => {
		// The preview runs before the dependent exists; the confirm-time POST rebuilds the
		// reference set, so the newer dependency is resolved too instead of being left dangling.
		const previewResponse = await fetch(previewUrl("tasks", "TASK-1"));
		expect(((await previewResponse.json()) as EntityDeletionPreview).references).toEqual([]);
		await saveTask({ id: "TASK-2", title: "Late dependent", dependencies: ["TASK-1"] });

		const response = await fetch(previewUrl("tasks", "TASK-1"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "unlink" }),
		});

		expect(response.status).toBe(200);
		const result = (await response.json()) as EntityDeletionResult;
		expect(result.updatedIds).toEqual(["TASK-2"]);
		expect((await core.filesystem.listTasks()).map((entry) => entry.id)).toEqual(["TASK-2"]);
		const dependent = (await core.filesystem.listTasks()).find((entry) => entry.id === "TASK-2");
		expect(dependent?.dependencies).toEqual([]);
	});

	it("reassigns references to another task", async () => {
		await saveTask({ id: "TASK-2", title: "Dependent", dependencies: ["TASK-1"] });
		await saveTask({ id: "TASK-3", title: "Replacement" });

		const response = await fetch(previewUrl("tasks", "TASK-1"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "reassign", replacementId: "TASK-3" }),
		});

		expect(response.status).toBe(200);
		const result = (await response.json()) as EntityDeletionResult;
		expect(result.updatedIds).toEqual(["TASK-2"]);
		expect((await core.filesystem.listTasks()).map((entry) => entry.id)).toEqual(["TASK-2", "TASK-3"]);
		const dependent = (await core.filesystem.listTasks()).find((entry) => entry.id === "TASK-2");
		expect(dependent?.dependencies).toEqual(["TASK-3"]);
	});

	it("previews and deletes a draft through the same route", async () => {
		await saveTask({ id: "TASK-9", title: "Draft me" });
		expect(await core.demoteTask("TASK-9")).toMatchObject({ success: true });
		expect((await core.filesystem.listDrafts()).map((entry) => entry.id)).toEqual(["DRAFT-1"]);

		const previewResponse = await fetch(previewUrl("tasks", "DRAFT-1"));
		expect(previewResponse.status).toBe(200);
		const preview = (await previewResponse.json()) as EntityDeletionPreview;
		expect(preview.entityType).toBe("draft");
		expect(preview.targetId).toBe("DRAFT-1");

		const response = await fetch(previewUrl("tasks", "DRAFT-1"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "cancel" }),
		});
		expect(response.status).toBe(200);
		expect(await core.filesystem.listDrafts()).toEqual([]);
	});

	it("answers 404 for a missing target and 409 for an ambiguous ID", async () => {
		const missingPreview = await fetch(previewUrl("tasks", "TASK-999"));
		expect(missingPreview.status).toBe(404);
		const missingDelete = await fetch(previewUrl("tasks", "TASK-999"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "cancel" }),
		});
		expect(missingDelete.status).toBe(404);

		const duplicatePath = join(core.filesystem.tasksDir, "task-01 - Duplicate.md");
		await Bun.write(duplicatePath, serializeTask(task({ id: "TASK-01", title: "Duplicate" })));
		const ambiguousPreview = await fetch(previewUrl("tasks", "TASK-1"));
		expect(ambiguousPreview.status).toBe(409);
		const ambiguousBody = (await ambiguousPreview.json()) as { error: string };
		expect(ambiguousBody.error).toContain("ambiguous");
		expect((await core.filesystem.listTasks()).map((entry) => entry.title).sort()).toEqual(["Delete me", "Duplicate"]);
	});

	it("reports the Git-committed recovery warning in a Git repository", async () => {
		await $`git init -b main`.cwd(testDir).quiet();
		expect(existsSync(join(testDir, ".git"))).toBe(true);

		const response = await fetch(previewUrl("tasks", "TASK-1"));

		expect(response.status).toBe(200);
		expect(((await response.json()) as EntityDeletionPreview).recoveryWarning).toBe(DELETION_GIT_RECOVERY_WARNING);
	});

	it("rejects a malformed resolution without deleting", async () => {
		const unknownAction = await fetch(previewUrl("tasks", "TASK-1"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "purge" }),
		});
		expect(unknownAction.status).toBe(400);
		expect(((await unknownAction.json()) as { error: string }).error).toContain(
			"action must be cancel, unlink, or reassign",
		);

		const malformed = await fetch(previewUrl("tasks", "TASK-1"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});
		expect(malformed.status).toBe(400);
		expect(((await malformed.json()) as { error: string }).error).toContain("valid JSON");
		expect((await core.filesystem.listTasks()).map((entry) => entry.id)).toEqual(["TASK-1"]);
	});

	it("previews and deletes a document with reassignment", async () => {
		await core.createDocumentFromInput({ title: "Guide", content: "guide body" });
		await core.createDocumentFromInput({ title: "Other Guide", content: "other body" });
		await saveTask({ title: "Documented", documentation: ["doc-1"] });

		const previewResponse = await fetch(previewUrl("docs", "doc-1"));
		expect(previewResponse.status).toBe(200);
		const preview = (await previewResponse.json()) as EntityDeletionPreview;
		expect(preview.entityType).toBe("document");
		expect(preview.references).toHaveLength(1);
		expect(preview.references[0]).toMatchObject({ relation: "documentation", sourceId: "TASK-1", value: "doc-1" });

		const invalidReplacement = await fetch(previewUrl("docs", "doc-1"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "reassign", replacementId: "doc-99" }),
		});
		expect(invalidReplacement.status).toBe(400);
		expect(((await invalidReplacement.json()) as { error: string }).error).toContain("doc-99 not found");
		expect((await core.filesystem.listDocuments()).map((entry) => entry.id)).toEqual(["doc-1", "doc-2"]);

		const reassign = await fetch(previewUrl("docs", "doc-1"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "reassign", replacementId: "doc-2" }),
		});
		expect(reassign.status).toBe(200);
		const result = (await reassign.json()) as EntityDeletionResult;
		expect(result.deletedId).toBe("doc-1");
		expect(result.updatedIds).toEqual(["TASK-1"]);
		expect((await core.filesystem.listDocuments()).map((entry) => entry.id)).toEqual(["doc-2"]);
		const documented = (await core.filesystem.listTasks()).find((entry) => entry.id === "TASK-1");
		expect(documented?.documentation).toEqual(["doc-2"]);

		const unlink = await fetch(previewUrl("docs", "doc-2"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "unlink" }),
		});
		expect(unlink.status).toBe(200);
		expect(await core.filesystem.listDocuments()).toEqual([]);
		const unlinked = (await core.filesystem.listTasks()).find((entry) => entry.id === "TASK-1");
		expect(unlinked?.documentation).toEqual([]);
	});
});
