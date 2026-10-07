import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DeleteEntityDialog } from "../web/components/DeleteEntityDialog.tsx";
import DocumentationDetail from "../web/components/DocumentationDetail.tsx";
import { TaskDetailsModal } from "../web/components/TaskDetailsModal.tsx";
import { ApiError, apiClient, type EntityDeletionPreview, type EntityDeletionResult } from "../web/lib/api.ts";
import { ThemeProvider } from "../web/contexts/ThemeContext.tsx";
import type { Document as BacklogDocument, Task } from "../types/index.ts";

let root: Root | null = null;
let dom: JSDOM | null = null;

const linkedPreview: EntityDeletionPreview = {
	entityType: "task",
	requestedId: "TASK-1",
	status: "found",
	targetId: "TASK-1",
	title: "Delete me",
	targetPath: "backlog/tasks/task-1 - Delete me.md",
	references: [
		{
			relation: "dependency",
			sourceId: "TASK-2",
			sourceTitle: "Dependent",
			sourcePath: "backlog/tasks/task-2 - Dependent.md",
			value: "TASK-1",
		},
	],
	unresolvedLinks: [],
	freeTextLimit:
		"Only structured references are listed; free-text mentions in descriptions, comments, and notes cannot be guaranteed discoverable.",
	recoveryWarning: "This project has no Git repository; a deleted file may not be recoverable without a backup.",
};

const unlinkedPreview: EntityDeletionPreview = {
	...linkedPreview,
	references: [],
};

const deletionResult: EntityDeletionResult = {
	success: true,
	deletedId: "TASK-1",
	deletedPath: "backlog/tasks/task-1 - Delete me.md",
	updatedIds: ["TASK-2"],
	recoveryWarning: linkedPreview.recoveryWarning,
};

function setupDom(): HTMLElement {
	dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: "http://localhost",
	});
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as Document;
	globalThis.navigator = dom.window.navigator as Navigator;
	globalThis.localStorage = dom.window.localStorage;
	globalThis.Element = dom.window.Element;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.HTMLInputElement = dom.window.HTMLInputElement;
	globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
	globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
	globalThis.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
	window.matchMedia = () =>
		({
			matches: false,
			media: "",
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}) as MediaQueryList;

	const container = document.getElementById("root");
	if (!container) throw new Error("Missing test root");
	root = createRoot(container);
	return container;
}

async function render(element: React.ReactElement): Promise<void> {
	await act(async () => {
		root?.render(element);
		await Promise.resolve();
	});
}

async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await Promise.resolve();
	});
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (predicate()) return;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
	throw new Error("Condition was not met");
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement | undefined {
	return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
}

afterEach(() => {
	if (root) {
		act(() => root?.unmount());
		root = null;
	}
	dom?.window.close();
	dom = null;
});

describe("Web delete confirmation dialog", () => {
	it("shows the target file, references, and both warnings before anything can be deleted", async () => {
		const container = setupDom();
		const originalPreview = apiClient.fetchDeletionPreview;
		apiClient.fetchDeletionPreview = async () => linkedPreview;

		try {
			await render(
				<DeleteEntityDialog endpoint="tasks" id="TASK-1" title="Delete me" onClose={() => {}} onDeleted={() => {}} />,
			);
			await waitFor(() => container.textContent?.includes("TASK-1 — Delete me") ?? false);

			const text = container.textContent ?? "";
			expect(text).toContain("1 active reference would break:");
			expect(text).toContain("dependency from TASK-2 — Dependent");
			expect(text).toContain("backlog/tasks/task-2 - Dependent.md");
			expect(text).toContain(linkedPreview.recoveryWarning);
			expect(text).toContain(linkedPreview.freeTextLimit);
			// The destructive control is present but focus lands on the dialog, not on it.
			expect(findButton(container, "Delete permanently")).toBeTruthy();
			expect(document.activeElement?.getAttribute("role")).toBe("dialog");
		} finally {
			apiClient.fetchDeletionPreview = originalPreview;
		}
	});

	it("closes without calling the API on cancel", async () => {
		const container = setupDom();
		const originalPreview = apiClient.fetchDeletionPreview;
		const originalDelete = apiClient.deleteEntity;
		apiClient.fetchDeletionPreview = async () => linkedPreview;
		let deleteCalls = 0;
		apiClient.deleteEntity = async () => {
			deleteCalls += 1;
			return deletionResult;
		};
		let closeCalls = 0;

		try {
			await render(
				<DeleteEntityDialog
					endpoint="tasks"
					id="TASK-1"
					title="Delete me"
					onClose={() => closeCalls++}
					onDeleted={() => {}}
				/>,
			);
			await waitFor(() => findButton(container, "Cancel") !== undefined);
			await click(findButton(container, "Cancel") as HTMLButtonElement);

			expect(closeCalls).toBe(1);
			expect(deleteCalls).toBe(0);
		} finally {
			apiClient.fetchDeletionPreview = originalPreview;
			apiClient.deleteEntity = originalDelete;
		}
	});

	it("deletes with unlink by default and reports the result", async () => {
		const container = setupDom();
		const originalPreview = apiClient.fetchDeletionPreview;
		const originalDelete = apiClient.deleteEntity;
		apiClient.fetchDeletionPreview = async () => linkedPreview;
		const requests: Array<{ endpoint: string; id: string; resolution: unknown }> = [];
		apiClient.deleteEntity = async (endpoint, id, resolution) => {
			requests.push({ endpoint, id, resolution });
			return deletionResult;
		};
		const deleted: EntityDeletionResult[] = [];

		try {
			await render(
				<DeleteEntityDialog
					endpoint="tasks"
					id="TASK-1"
					title="Delete me"
					onClose={() => {}}
					onDeleted={(result) => deleted.push(result)}
				/>,
			);
			await waitFor(() => findButton(container, "Delete permanently") !== undefined);
			await click(findButton(container, "Delete permanently") as HTMLButtonElement);

			expect(requests).toEqual([
				{ endpoint: "tasks", id: "TASK-1", resolution: { action: "unlink" } },
			]);
			expect(deleted).toEqual([deletionResult]);
		} finally {
			apiClient.fetchDeletionPreview = originalPreview;
			apiClient.deleteEntity = originalDelete;
		}
	});

	it("requires a replacement ID for reassign, then sends it", async () => {
		const container = setupDom();
		const originalPreview = apiClient.fetchDeletionPreview;
		const originalDelete = apiClient.deleteEntity;
		apiClient.fetchDeletionPreview = async () => linkedPreview;
		const requests: Array<unknown> = [];
		apiClient.deleteEntity = async (_endpoint, _id, resolution) => {
			requests.push(resolution);
			return deletionResult;
		};

		try {
			await render(
				<DeleteEntityDialog endpoint="tasks" id="TASK-1" title="Delete me" onClose={() => {}} onDeleted={() => {}} />,
			);
			await waitFor(() => findButton(container, "Delete permanently") !== undefined);

			const reassignRadio = Array.from(container.querySelectorAll("input[type='radio']")).find(
				(input) => (input as HTMLInputElement).checked === false,
			) as HTMLInputElement;
			expect(reassignRadio).toBeTruthy();
			await click(reassignRadio);
			expect(findButton(container, "Delete permanently")?.disabled).toBe(true);

			const input = container.querySelector("input[aria-label='Replacement record ID']") as HTMLInputElement;
			expect(input).toBeTruthy();
			await act(async () => {
				input.focus();
				const valueSetter = Object.getOwnPropertyDescriptor(
					Object.getPrototypeOf(input),
					"value",
				)?.set;
				valueSetter?.call(input, "TASK-9");
				input.dispatchEvent(new window.Event("input", { bubbles: true }));
				await Promise.resolve();
			});

			const deleteButton = findButton(container, "Delete permanently") as HTMLButtonElement;
			expect(deleteButton.disabled).toBe(false);
			await click(deleteButton);

			expect(requests).toEqual([{ action: "reassign", replacementId: "TASK-9" }]);
		} finally {
			apiClient.fetchDeletionPreview = originalPreview;
			apiClient.deleteEntity = originalDelete;
		}
	});

	it("deletes an unlinked record with the cancel resolution", async () => {
		const container = setupDom();
		const originalPreview = apiClient.fetchDeletionPreview;
		const originalDelete = apiClient.deleteEntity;
		apiClient.fetchDeletionPreview = async () => unlinkedPreview;
		const requests: Array<unknown> = [];
		apiClient.deleteEntity = async (_endpoint, _id, resolution) => {
			requests.push(resolution);
			return { ...deletionResult, updatedIds: [] };
		};

		try {
			await render(
				<DeleteEntityDialog endpoint="tasks" id="TASK-1" title="Delete me" onClose={() => {}} onDeleted={() => {}} />,
			);
			await waitFor(() => container.textContent?.includes("No other record links to TASK-1") ?? false);

			const radios = container.querySelectorAll("input[type='radio']");
			expect(radios.length).toBe(0);
			await click(findButton(container, "Delete permanently") as HTMLButtonElement);

			expect(requests).toEqual([{ action: "cancel" }]);
		} finally {
			apiClient.fetchDeletionPreview = originalPreview;
			apiClient.deleteEntity = originalDelete;
		}
	});

	it("stays open and shows a rejected resolution", async () => {
		const container = setupDom();
		const originalPreview = apiClient.fetchDeletionPreview;
		const originalDelete = apiClient.deleteEntity;
		apiClient.fetchDeletionPreview = async () => unlinkedPreview;
		let deletedCount = 0;
		apiClient.deleteEntity = async () => {
			throw new Error("TASK-1 not found. Nothing was deleted.");
		};

		try {
			await render(
				<DeleteEntityDialog
					endpoint="tasks"
					id="TASK-1"
					title="Delete me"
					onClose={() => {}}
					onDeleted={() => deletedCount++}
				/>,
			);
			await waitFor(() => findButton(container, "Delete permanently") !== undefined);
			await click(findButton(container, "Delete permanently") as HTMLButtonElement);
			await waitFor(() => container.querySelector("[role='alert']") !== null);

			expect(container.querySelector("[role='alert']")?.textContent).toContain("Nothing was deleted");
			expect(deletedCount).toBe(0);
			expect(findButton(container, "Delete permanently")?.disabled).toBe(false);
		} finally {
			apiClient.fetchDeletionPreview = originalPreview;
			apiClient.deleteEntity = originalDelete;
		}
	});

	it("treats a delete that lost a later step as done and reports the warning", async () => {
		const container = setupDom();
		const originalPreview = apiClient.fetchDeletionPreview;
		const originalDelete = apiClient.deleteEntity;
		apiClient.fetchDeletionPreview = async () => unlinkedPreview;
		const deleted: EntityDeletionResult[] = [];
		apiClient.deleteEntity = async () => {
			throw new ApiError("Deleted but the Git commit failed: no user configured", 500, "Internal Server Error", {
				deletionState: "moved",
			});
		};

		try {
			await render(
				<DeleteEntityDialog
					endpoint="tasks"
					id="TASK-1"
					title="Delete me"
					onClose={() => {}}
					onDeleted={(result) => deleted.push(result)}
				/>,
			);
			await waitFor(() => findButton(container, "Delete permanently") !== undefined);
			await click(findButton(container, "Delete permanently") as HTMLButtonElement);

			expect(deleted).toHaveLength(1);
			expect(deleted[0]?.success).toBe(true);
			expect(deleted[0]?.recoveryWarning).toContain("Git commit failed");
		} finally {
			apiClient.fetchDeletionPreview = originalPreview;
			apiClient.deleteEntity = originalDelete;
		}
	});
});

const localTask: Task = {
	id: "BACK-419",
	title: "Deletable task",
	status: "To Do",
	assignee: [],
	labels: [],
	dependencies: [],
	createdDate: "2026-01-01",
	source: "local",
};

describe("Web task modal delete action", () => {
	it("opens the confirmation from the sidebar and cancel leaves the task modal open", async () => {
		const container = setupDom();
		const originalPreview = apiClient.fetchDeletionPreview;
		const originalDelete = apiClient.deleteEntity;
		apiClient.fetchDeletionPreview = async () => linkedPreview;
		let deleteCalls = 0;
		apiClient.deleteEntity = async () => {
			deleteCalls += 1;
			return deletionResult;
		};
		let closeCalls = 0;

		try {
			await render(
				<ThemeProvider>
					<TaskDetailsModal
						task={localTask}
						isOpen
						onClose={() => closeCalls++}
						onEntityDeleted={() => {}}
					/>
				</ThemeProvider>,
			);
			const deleteButton = Array.from(container.querySelectorAll("button")).find(
				(button) => button.textContent?.trim() === "Delete Permanently",
			);
			expect(deleteButton).toBeTruthy();
			expect(container.textContent ?? "").not.toContain("Delete TASK-419 permanently");
			await click(deleteButton as HTMLButtonElement);
			await waitFor(() => container.textContent?.includes("Delete BACK-419 permanently") ?? false);

			// Cancel closes only the confirmation; the task modal stays open.
			await click(findButton(container, "Cancel") as HTMLButtonElement);
			expect(container.textContent ?? "").not.toContain("Delete BACK-419 permanently");
			expect(closeCalls).toBe(0);
			expect(deleteCalls).toBe(0);
			expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Edit")).toBe(
				true,
			);
		} finally {
			apiClient.fetchDeletionPreview = originalPreview;
			apiClient.deleteEntity = originalDelete;
		}
	});

	it("hides the action for records the CLI cannot delete", async () => {
		const container = setupDom();
		try {
			await render(
				<ThemeProvider>
					<TaskDetailsModal task={{ ...localTask, source: "completed" }} isOpen onClose={() => {}} />
				</ThemeProvider>,
			);
			expect(
				Array.from(container.querySelectorAll("button")).some(
					(button) => button.textContent?.trim() === "Delete Permanently",
				),
			).toBe(false);

			await render(
				<ThemeProvider>
					<TaskDetailsModal
						task={{ ...localTask, source: "local-branch", branch: "tasks/elsewhere" }}
						isOpen
						onClose={() => {}}
					/>
				</ThemeProvider>,
			);
			expect(
				Array.from(container.querySelectorAll("button")).some(
					(button) => button.textContent?.trim() === "Delete Permanently",
				),
			).toBe(false);
		} finally {
			// nothing stubbed here
		}
	});
});

const docRecord: BacklogDocument = {
	id: "doc-12",
	title: "Session behavior",
	type: "specification",
	rawContent: "# Session behavior",
	createdDate: "2026-01-01",
	path: "specifications/doc-12 - Session-behavior.md",
};

describe("Web documentation delete action", () => {
	it("deletes the document through the docs endpoint and navigates away", async () => {
		const container = setupDom();
		const originalFetchDoc = apiClient.fetchDoc;
		const originalPreview = apiClient.fetchDeletionPreview;
		const originalDelete = apiClient.deleteEntity;
		apiClient.fetchDoc = async () => docRecord;
		apiClient.fetchDeletionPreview = async (endpoint, id) => {
			expect(endpoint).toBe("docs");
			expect(id).toBe("doc-12");
			return {
				...unlinkedPreview,
				entityType: "document",
				requestedId: "doc-12",
				targetId: "doc-12",
				title: "Session behavior",
				targetPath: "backlog/docs/specifications/doc-12 - Session-behavior.md",
			};
		};
		let deleteCalls = 0;
		apiClient.deleteEntity = async () => {
			deleteCalls += 1;
			return {
				success: true,
				deletedId: "doc-12",
				deletedPath: "backlog/docs/specifications/doc-12 - Session-behavior.md",
				updatedIds: [],
				recoveryWarning: unlinkedPreview.recoveryWarning,
			};
		};
		let refreshCalls = 0;

		try {
			await render(
				<MemoryRouter initialEntries={["/documentation/doc-12"]}>
					<ThemeProvider>
						<Routes>
							<Route
								path="/documentation/:id"
								element={<DocumentationDetail
									docs={[docRecord]}
									onRefreshData={async () => {
										refreshCalls++;
									}}
								/>}
							/>
						</Routes>
					</ThemeProvider>
				</MemoryRouter>,
			);
			const hasDeleteButton = () =>
				Array.from(container.querySelectorAll("button")).some(
					(button) => button.textContent?.trim() === "Delete",
				);
			await waitFor(hasDeleteButton);
			await click(
				Array.from(container.querySelectorAll("button")).find(
					(button) => button.textContent?.trim() === "Delete",
				) as HTMLButtonElement,
			);
			await waitFor(() => container.textContent?.includes("Delete doc-12 permanently") ?? false);
			await click(findButton(container, "Delete permanently") as HTMLButtonElement);
			await waitFor(() => deleteCalls === 1);

			expect(refreshCalls).toBe(1);
		} finally {
			apiClient.fetchDoc = originalFetchDoc;
			apiClient.fetchDeletionPreview = originalPreview;
			apiClient.deleteEntity = originalDelete;
		}
	});
});
