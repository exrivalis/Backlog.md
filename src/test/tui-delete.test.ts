import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import type { ScreenInterface } from "neo-neo-bblessed";
import { Core } from "../core/backlog.ts";
import type { Task } from "../types/index.ts";
import { getHelpShortcuts } from "../ui/components/help-popup.ts";
import { deletionEntityTypeForTask, documentDeleteViewerAction, runTuiDeletion } from "../ui/deletion.ts";
import { getBoardFooterContent, getTaskListFooterContent } from "../ui/footer-content.ts";
import { createScreen } from "../ui/tui.ts";
import { initializeFilesystemTestProject, initializeTestProject, withTimeout } from "./test-utils.ts";

type EmittingWidget = { emit: (event: string, ch?: string, key?: { name: string; full: string }) => boolean };
type TreeWidget = { content?: string; children?: TreeWidget[] };

const STATUSES = ["To Do", "In Progress", "Done"];

const cleanups: Array<() => void> = [];

afterAll(() => {
	for (const cleanup of cleanups) cleanup();
});

function pressKey(widget: EmittingWidget | undefined, name: string, ch = ""): void {
	const key = { name, full: name };
	widget?.emit?.("keypress", ch, key);
	widget?.emit?.(`key ${name}`, ch, key);
}

function typeText(widget: EmittingWidget | undefined, value: string): void {
	for (const character of value) {
		pressKey(widget, character, character);
	}
}

function focusedWidget(screen: ScreenInterface): EmittingWidget | undefined {
	return (screen as unknown as { focused?: EmittingWidget }).focused;
}

/** First widget content on the screen containing `needle`, for asserting dialog text. */
function findContent(root: unknown, needle: string): string | null {
	const node = root as TreeWidget;
	if (typeof node.content === "string" && node.content.includes(needle)) return node.content;
	for (const child of node.children ?? []) {
		const found = findContent(child, needle);
		if (found) return found;
	}
	return null;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
	for (let attempt = 0; attempt < 300; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(10);
	}
	throw new Error(`Timed out waiting for ${label}`);
}

async function waitForAsync(predicate: () => Promise<boolean>, label: string): Promise<void> {
	for (let attempt = 0; attempt < 300; attempt += 1) {
		if (await predicate()) return;
		await Bun.sleep(10);
	}
	throw new Error(`Timed out waiting for ${label}`);
}

async function settleFocus(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
	await new Promise<void>((resolve) => setImmediate(resolve));
}

function withTty<T>(run: (screen: ScreenInterface & EmittingWidget) => Promise<T> | T): Promise<T> {
	return (async () => {
		const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
		const screen = createScreen({ smartCSR: false }) as ScreenInterface & EmittingWidget;
		try {
			return await run(screen);
		} finally {
			screen.destroy();
			if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
			else Reflect.deleteProperty(process.stdout, "isTTY");
		}
	})();
}

interface TestProject {
	dir: string;
	core: Core;
}

async function makeProject(name: string, options: { git?: boolean } = {}): Promise<TestProject> {
	const dir = mkdtempSync(join(tmpdir(), `tui-delete-${name}-`));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	if (options.git !== false) {
		await $`git init -b main`.cwd(dir).quiet();
	}
	const core = new Core(dir);
	if (options.git === false) {
		await initializeFilesystemTestProject(core, name);
	} else {
		await initializeTestProject(core, name);
	}
	return { dir, core };
}

function makeTask(id: string, title: string, fields: Partial<Task> = {}): Task {
	return {
		id,
		title,
		status: "To Do",
		assignee: [],
		createdDate: "2024-01-01",
		labels: [],
		dependencies: [],
		...fields,
	};
}

async function createTasks(core: Core, tasks: Task[]): Promise<void> {
	for (const task of tasks) {
		await core.createTask(task, false);
	}
}

/** Drives runTuiDeletion to completion for an unreferenced record: D, then confirm. */
async function confirmDelete(screen: ScreenInterface & EmittingWidget): Promise<void> {
	await waitFor(() => findContent(screen, "Nothing has been deleted or modified.") !== null, "delete preview dialog");
	await settleFocus();
	pressKey(focusedWidget(screen), "d", "d");
	await waitFor(() => findContent(screen, "Permanently delete") !== null, "delete confirmation dialog");
	await settleFocus();
	pressKey(focusedWidget(screen), "y", "y");
}

describe("TUI explicit delete", () => {
	it("deletes an unreferenced task after the preview and an explicit confirmation", async () => {
		const { core } = await makeProject("task-simple");
		await createTasks(core, [makeTask("TASK-1", "Doomed task")]);

		await withTty(async (screen) => {
			const outcome = runTuiDeletion({ screen, core, entityType: "task", entityId: "TASK-1" });
			await confirmDelete(screen);
			expect(await withTimeout(outcome, "task delete", 5000)).toEqual({
				status: "deleted",
				message: expect.stringContaining("Deleted task TASK-1 ("),
			});
		});

		expect(await core.fs.listTasks()).toHaveLength(0);
		expect(await core.fs.listArchivedTasks()).toHaveLength(0);
	});

	it("cancels from the preview without touching the file", async () => {
		const { core } = await makeProject("task-cancel");
		await createTasks(core, [makeTask("TASK-1", "Surviving task")]);

		await withTty(async (screen) => {
			const outcome = runTuiDeletion({ screen, core, entityType: "task", entityId: "TASK-1" });
			await waitFor(
				() => findContent(screen, "Nothing has been deleted or modified.") !== null,
				"delete preview dialog",
			);
			await settleFocus();
			pressKey(focusedWidget(screen), "escape");
			expect(await withTimeout(outcome, "task delete cancel", 5000)).toEqual({ status: "canceled" });
		});

		expect((await core.fs.listTasks()).map((task) => task.id)).toEqual(["TASK-1"]);
	});

	it("returns to the preview when the confirmation is declined, and cancel keeps the file", async () => {
		const { core } = await makeProject("task-decline");
		await createTasks(core, [makeTask("TASK-1", "Declined once")]);

		await withTty(async (screen) => {
			const outcome = runTuiDeletion({ screen, core, entityType: "task", entityId: "TASK-1" });
			await confirmDeleteDeclineThenCancel(screen);
			expect(await withTimeout(outcome, "task delete decline", 5000)).toEqual({ status: "canceled" });
		});

		expect((await core.fs.listTasks()).map((task) => task.id)).toEqual(["TASK-1"]);
	});

	it("unlinks an active dependency after showing it in the preview", async () => {
		const { core } = await makeProject("task-unlink");
		await createTasks(core, [
			makeTask("TASK-1", "Doomed dependency"),
			makeTask("TASK-2", "Dependent task", { dependencies: ["TASK-1"] }),
		]);

		await withTty(async (screen) => {
			const outcome = runTuiDeletion({ screen, core, entityType: "task", entityId: "TASK-1" });
			await waitFor(
				() => findContent(screen, "Active structured references (1)") !== null,
				"delete preview with references",
			);
			await settleFocus();
			pressKey(focusedWidget(screen), "u", "u");
			await waitFor(() => findContent(screen, "Permanently delete") !== null, "delete confirmation dialog");
			await settleFocus();
			pressKey(focusedWidget(screen), "y", "y");
			expect(await withTimeout(outcome, "task unlink delete", 5000)).toEqual({
				status: "deleted",
				message: expect.stringContaining("updated TASK-2"),
			});
		});

		expect(await core.fs.listTasks()).toHaveLength(1);
		const dependent = await core.fs.loadTask("TASK-2");
		expect(dependent?.dependencies ?? []).toEqual([]);
	});

	it("reassigns an active dependency to a replacement ID", async () => {
		const { core } = await makeProject("task-reassign");
		await createTasks(core, [
			makeTask("TASK-1", "Doomed dependency"),
			makeTask("TASK-2", "Dependent task", { dependencies: ["TASK-1"] }),
			makeTask("TASK-3", "Replacement task"),
		]);

		await withTty(async (screen) => {
			const outcome = runTuiDeletion({ screen, core, entityType: "task", entityId: "TASK-1" });
			await waitFor(
				() => findContent(screen, "Active structured references (1)") !== null,
				"delete preview with references",
			);
			await settleFocus();
			pressKey(focusedWidget(screen), "r", "r");
			await waitFor(() => findContent(screen, "Point every reference to") !== null, "reassign input dialog");
			await settleFocus();
			typeText(focusedWidget(screen), "TASK-3");
			pressKey(focusedWidget(screen), "enter");
			await waitFor(() => findContent(screen, "Permanently delete") !== null, "delete confirmation dialog");
			await settleFocus();
			pressKey(focusedWidget(screen), "y", "y");
			expect(await withTimeout(outcome, "task reassign delete", 5000)).toEqual({
				status: "deleted",
				message: expect.stringContaining("updated TASK-2"),
			});
		});

		const dependent = await core.fs.loadTask("TASK-2");
		expect(dependent?.dependencies ?? []).toEqual(["TASK-3"]);
		expect(await core.fs.listTasks()).toHaveLength(2);
	});

	it("rejects a reassignment that does not resolve, without deleting anything", async () => {
		const { core } = await makeProject("task-reassign-invalid");
		await createTasks(core, [
			makeTask("TASK-1", "Doomed dependency"),
			makeTask("TASK-2", "Dependent task", { dependencies: ["TASK-1"] }),
		]);

		await withTty(async (screen) => {
			const outcome = runTuiDeletion({ screen, core, entityType: "task", entityId: "TASK-1" });
			await waitFor(
				() => findContent(screen, "Active structured references (1)") !== null,
				"delete preview with references",
			);
			await settleFocus();
			pressKey(focusedWidget(screen), "r", "r");
			await waitFor(() => findContent(screen, "Point every reference to") !== null, "reassign input dialog");
			await settleFocus();
			typeText(focusedWidget(screen), "TASK-1");
			pressKey(focusedWidget(screen), "enter");
			// The canonical validation error surfaces in the dialog and nothing is deleted.
			await waitFor(() => findContent(screen, "it is the record being deleted") !== null, "reassign validation error");
			pressKey(focusedWidget(screen), "escape");
			await waitFor(
				() => findContent(screen, "Nothing has been deleted or modified.") !== null,
				"back at the preview dialog",
			);
			await settleFocus();
			pressKey(focusedWidget(screen), "escape");
			expect(await withTimeout(outcome, "reassign rejection cancel", 5000)).toEqual({ status: "canceled" });
		});

		expect((await core.fs.listTasks()).map((task) => task.id)).toEqual(["TASK-1", "TASK-2"]);
		expect((await core.fs.loadTask("TASK-2"))?.dependencies).toEqual(["TASK-1"]);
	});

	it("reports a missing target with the canonical CLI message and deletes nothing", async () => {
		const { core } = await makeProject("task-missing");
		await withTty(async (screen) => {
			const outcome = runTuiDeletion({ screen, core, entityType: "task", entityId: "TASK-404" });
			expect(await withTimeout(outcome, "missing task delete", 5000)).toEqual({
				status: "error",
				message: "Task TASK-404 not found. Nothing would be deleted.",
			});
		});
	});

	it("shows the no-Git recovery warning in the preview and still deletes", async () => {
		const { core } = await makeProject("task-nogit", { git: false });
		await createTasks(core, [makeTask("TASK-1", "No git here")]);

		await withTty(async (screen) => {
			const outcome = runTuiDeletion({ screen, core, entityType: "task", entityId: "TASK-1" });
			await waitFor(() => findContent(screen, "no Git repository") !== null, "no-Git recovery warning");
			await settleFocus();
			pressKey(focusedWidget(screen), "d", "d");
			await waitFor(() => findContent(screen, "Permanently delete") !== null, "delete confirmation dialog");
			await settleFocus();
			pressKey(focusedWidget(screen), "y", "y");
			expect(await withTimeout(outcome, "no-git task delete", 5000)).toEqual({
				status: "deleted",
				message: expect.stringContaining("Deleted task TASK-1 ("),
			});
		});

		expect(await core.fs.listTasks()).toHaveLength(0);
	});

	it("deletes a draft when the record carries the draft status", async () => {
		const { core } = await makeProject("draft-delete");
		const { task } = await core.createTaskFromInput({ title: "Draft thing", status: "Draft" }, false);

		await withTty(async (screen) => {
			const outcome = runTuiDeletion({ screen, core, entityType: "draft", entityId: task.id });
			await confirmDelete(screen);
			expect(await withTimeout(outcome, "draft delete", 5000)).toEqual({
				status: "deleted",
				message: expect.stringContaining(`Deleted draft ${task.id} (`),
			});
		});

		expect(await core.fs.listDrafts()).toHaveLength(0);
	});

	it("deletes a document after the preview and confirmation", async () => {
		const { core } = await makeProject("doc-delete");
		const document = await core.createDocumentFromInput({ title: "Guide", content: "doc body" });

		await withTty(async (screen) => {
			const outcome = runTuiDeletion({ screen, core, entityType: "document", entityId: document.id });
			await confirmDelete(screen);
			expect(await withTimeout(outcome, "document delete", 5000)).toEqual({
				status: "deleted",
				message: expect.stringContaining(`Deleted document ${document.id} (`),
			});
		});

		expect(await core.fs.listDocuments()).toHaveLength(0);
	});
});

async function confirmDeleteDeclineThenCancel(screen: ScreenInterface & EmittingWidget): Promise<void> {
	await waitFor(() => findContent(screen, "Nothing has been deleted or modified.") !== null, "delete preview dialog");
	await settleFocus();
	pressKey(focusedWidget(screen), "d", "d");
	await waitFor(() => findContent(screen, "Permanently delete") !== null, "delete confirmation dialog");
	await settleFocus();
	pressKey(focusedWidget(screen), "n", "n");
	// Declining the confirmation returns to the preview; only Esc there cancels the flow.
	await waitFor(() => findContent(screen, "Nothing has been deleted or modified.") !== null, "reopened preview dialog");
	await settleFocus();
	pressKey(focusedWidget(screen), "escape");
}

describe("TUI board delete key", () => {
	it("runs the explicit delete flow from the board with D", async () => {
		const { core } = await makeProject("board-delete");
		await createTasks(core, [makeTask("TASK-1", "Board doomed"), makeTask("TASK-2", "Board survivor")]);

		const { renderBoardTui } = await import("../ui/board.ts");
		await withTty(async (screen) => {
			const board = renderBoardTui(
				[makeTask("TASK-1", "Board doomed"), makeTask("TASK-2", "Board survivor")],
				STATUSES,
				"horizontal",
				20,
				{ screen, core },
			);
			await Bun.sleep(50);

			pressKey(screen, "d", "d");
			await confirmDelete(screen);
			await waitForAsync(async () => (await core.fs.listTasks()).length === 1, "board task file removal");

			pressKey(screen, "q");
			await withTimeout(board, "board close", 5000);
		});

		expect((await core.fs.listTasks()).map((task) => task.id)).toEqual(["TASK-2"]);
		expect(await core.fs.listArchivedTasks()).toHaveLength(0);
	});

	it("keeps A as the archive shortcut with its archive wording", async () => {
		const { core } = await makeProject("board-archive-intact");
		await createTasks(core, [makeTask("TASK-1", "Archived via A")]);

		const { renderBoardTui } = await import("../ui/board.ts");
		await withTty(async (screen) => {
			const board = renderBoardTui([makeTask("TASK-1", "Archived via A")], STATUSES, "horizontal", 20, {
				screen,
				core,
			});
			await Bun.sleep(50);

			pressKey(screen, "a", "a");
			await waitFor(() => findContent(screen, "Archive {bold}TASK-1{/bold}?") !== null, "archive confirmation");
			await settleFocus();
			pressKey(focusedWidget(screen), "y", "y");
			await waitForAsync(async () => (await core.fs.listArchivedTasks()).length === 1, "archive move");

			pressKey(screen, "q");
			await withTimeout(board, "board close", 5000);
		});

		expect((await core.fs.listTasks()).length).toBe(0);
		expect((await core.fs.listArchivedTasks()).map((task) => task.id)).toEqual(["TASK-1"]);
	});
});

describe("TUI delete discoverability and eligibility", () => {
	it("maps task statuses onto the eligible deletion entity types", () => {
		expect(deletionEntityTypeForTask({ status: "To Do" })).toBe("task");
		expect(deletionEntityTypeForTask({ status: "Done" })).toBe("task");
		expect(deletionEntityTypeForTask({ status: "Draft" })).toBe("draft");
		expect(deletionEntityTypeForTask({ status: "draft " })).toBe("draft");
	});

	it("lists the delete shortcut next to the untouched archive entries", () => {
		for (const context of ["board", "task-list"] as const) {
			const shortcuts = getHelpShortcuts(context);
			expect(shortcuts).toContainEqual({ key: "A", desc: "Archive task" });
			expect(shortcuts).toContainEqual({ key: "C", desc: "Complete task" });
			expect(shortcuts).toContainEqual({ key: "D", desc: "Delete task file" });
		}
		expect(getBoardFooterContent()).toContain("[E/M/C/A/D]");
		expect(getBoardFooterContent()).toContain("Arch/Del");
		expect(getTaskListFooterContent()).toContain("[E/C/A/D]");
		expect(getTaskListFooterContent()).toContain("Arch/Del");
	});

	it("binds the document viewer delete action and closes only after a successful delete", async () => {
		const { core } = await makeProject("doc-viewer-action");
		const document = await core.createDocumentFromInput({ title: "Viewer doc", content: "body" });
		const action = documentDeleteViewerAction(core, document.id);

		// Cancel path: Esc at the preview leaves the viewer open.
		await withTty(async (screen) => {
			let refocusCount = 0;
			const runPromise = action.run(screen, () => {
				refocusCount += 1;
			});
			await waitFor(() => findContent(screen, "Nothing has been deleted or modified.") !== null, "delete preview");
			await settleFocus();
			pressKey(focusedWidget(screen), "escape");
			expect(await withTimeout(runPromise, "doc viewer cancel", 5000)).toEqual({});
			expect(refocusCount).toBe(1);
			expect(existsSync(join(core.fs.docsDir))).toBe(true);
		});
		expect(await core.fs.listDocuments()).toHaveLength(1);

		// Delete path: D through the dialogs closes the viewer.
		await withTty(async (screen) => {
			const runPromise = action.run(screen, () => {});
			await confirmDelete(screen);
			expect(await withTimeout(runPromise, "doc viewer delete", 5000)).toEqual({ close: true });
		});
		expect(await core.fs.listDocuments()).toHaveLength(0);
	});
});
