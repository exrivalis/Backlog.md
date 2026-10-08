import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChangePreviewModal } from "../web/components/ChangePreviewModal.tsx";
import DecisionDetail from "../web/components/DecisionDetail.tsx";
import DocumentationDetail from "../web/components/DocumentationDetail.tsx";
import { apiClient } from "../web/lib/api.ts";
import { ThemeProvider } from "../web/contexts/ThemeContext.tsx";
import type { ChangePreview } from "../markdown/change-document.ts";
import type { AdrGuidanceResolution, Decision, Document as BacklogDocument } from "../types/index.ts";

let root: Root | null = null;
let dom: JSDOM | null = null;

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

const retiredAdr: Decision = {
	id: "decision-1",
	title: "Use Postgres",
	date: "2026-01-02 03:04",
	status: "superseded",
	context: "c",
	decision: "d",
	consequences: "c",
	kind: "architecture",
	supersededBy: "decision-2",
	rawContent: "## Decision\n\nPostgres.",
	archived: true,
};

const replacementAdr: Decision = {
	id: "decision-2",
	title: "Use SQLite",
	date: "2026-02-02 03:04",
	status: "accepted",
	context: "c",
	decision: "d",
	consequences: "c",
	kind: "architecture",
	supersedes: "decision-1",
	rawContent: "## Decision\n\nSQLite.",
};

const retiredResolution: AdrGuidanceResolution = {
	decision: retiredAdr,
	retired: { state: "superseded", archived: true, replacement: replacementAdr },
};

async function renderDecision(id: string): Promise<{ container: HTMLElement }> {
	const container = setupDom();
	await render(
		<MemoryRouter initialEntries={[`/decisions/${id}`]}>
			<ThemeProvider>
				<Routes>
					<Route path="/decisions/:id" element={<DecisionDetail decisions={[]} onRefreshData={async () => {}} />} />
				</Routes>
			</ThemeProvider>
		</MemoryRouter>,
	);
	return { container };
}

describe("Web decision guidance view", () => {
	it("marks a retired ADR as history and links its accepted replacement", async () => {
		const originalFetch = apiClient.fetchDecision;
		const originalGuidance = apiClient.fetchDecisionGuidance;
		apiClient.fetchDecision = async () => retiredAdr;
		apiClient.fetchDecisionGuidance = async (id) => {
			expect(id).toBe("decision-1");
			return retiredResolution;
		};
		const { container } = await renderDecision("1");

		try {
			await waitFor(() => container.textContent?.includes("historical record, not current guidance") ?? false);
			const text = container.textContent ?? "";
			expect(text).toContain("Retired (superseded)");
			const replacementLink = container.querySelector('a[href="/decisions/2/use-sqlite"]');
			expect(replacementLink).toBeTruthy();
			expect(replacementLink?.textContent).toContain("decision-2 — Use SQLite");
			expect(text).toContain("Archived");
		} finally {
			apiClient.fetchDecision = originalFetch;
			apiClient.fetchDecisionGuidance = originalGuidance;
		}
	});

	it("shows no retired banner for an applicable ADR", async () => {
		const originalFetch = apiClient.fetchDecision;
		const originalGuidance = apiClient.fetchDecisionGuidance;
		apiClient.fetchDecision = async () => replacementAdr;
		apiClient.fetchDecisionGuidance = async () => ({ decision: replacementAdr });
		const { container } = await renderDecision("2");

		try {
			await waitFor(() => container.textContent?.includes("SQLite.") ?? false);
			expect(container.textContent ?? "").not.toContain("not current guidance");
			expect(container.querySelector("[role='note']")).toBeNull();
		} finally {
			apiClient.fetchDecision = originalFetch;
			apiClient.fetchDecisionGuidance = originalGuidance;
		}
	});

	it("surfaces a broken replacement chain without hiding the record", async () => {
		const originalFetch = apiClient.fetchDecision;
		const originalGuidance = apiClient.fetchDecisionGuidance;
		apiClient.fetchDecision = async () => retiredAdr;
		apiClient.fetchDecisionGuidance = async () => {
			throw new Error("Architecture decision decision-1 records replacement decision-9, which does not exist.");
		};
		const { container } = await renderDecision("5");

		try {
			await waitFor(() => container.querySelector("[role='alert']") !== null);
			expect(container.querySelector("[role='alert']")?.textContent).toContain("decision-9");
			expect(container.textContent ?? "").toContain("Postgres.");
		} finally {
			apiClient.fetchDecision = originalFetch;
			apiClient.fetchDecisionGuidance = originalGuidance;
		}
	});
});

const SPEC_DOC: BacklogDocument = {
	id: "doc-12",
	title: "Session behavior",
	type: "specification",
	createdDate: "2026-01-01",
	rawContent: "# Session behavior\n\nCurrent required behavior.",
	path: "specifications/doc-12 - Session-behavior.md",
};

const CHANGE_BODY = `# Change: Warn before expiry

## Why

Sessions expire silently today.

## Affected specs

- doc-12

## Linked tasks

- task-3

## Related decisions

- decision-2

## Modified requirements

### Requirement: Sessions expire after 14 days [SES-1]
`;

const PROPOSED_CHANGE: BacklogDocument = {
	id: "doc-18",
	title: "Warn before expiry",
	type: "change",
	createdDate: "2026-01-01",
	rawContent: CHANGE_BODY,
	path: "changes/doc-18 - Warn-before-expiry.md",
};

const INTEGRATED_BODY = `${CHANGE_BODY}
## Review

Approved by @alex on 2026-10-07 09:00.

## Integrated

Integrated on 2026-10-07 09:05 into doc-12.
`;

const INTEGRATED_CHANGE: BacklogDocument = {
	...PROPOSED_CHANGE,
	rawContent: INTEGRATED_BODY,
	path: "changes/archive/doc-18 - Warn-before-expiry.md",
};

async function renderDoc(doc: BacklogDocument, id = "18"): Promise<{ container: HTMLElement }> {
	const container = setupDom();
	await render(
		<MemoryRouter initialEntries={[`/documentation/${id}`]}>
			<ThemeProvider>
				<Routes>
					<Route
						path="/documentation/:id"
						element={<DocumentationDetail docs={[SPEC_DOC, doc]} onRefreshData={async () => {}} />}
					/>
				</Routes>
			</ThemeProvider>
		</MemoryRouter>,
	);
	return { container };
}

describe("Web documentation change view", () => {
	it("labels a current specification as a Specification without change affordances", async () => {
		const originalFetch = apiClient.fetchDoc;
		apiClient.fetchDoc = async (id) => {
			expect(id).toBe("doc-12");
			return SPEC_DOC;
		};
		const { container } = await renderDoc(SPEC_DOC, "12");

		try {
			await waitFor(() => container.textContent?.includes("Current required behavior.") ?? false);
			expect(container.textContent ?? "").toContain("Specification");
			expect(findButton(container, "Preview")).toBeUndefined();
			expect(container.textContent ?? "").not.toContain("Affected specs");
		} finally {
			apiClient.fetchDoc = originalFetch;
		}
	});

	it("separates a proposal's current specs, tasks, and decisions from its delta body", async () => {
		const originalFetch = apiClient.fetchDoc;
		apiClient.fetchDoc = async () => PROPOSED_CHANGE;
		const { container } = await renderDoc(PROPOSED_CHANGE);

		try {
			await waitFor(() => findButton(container, "Preview") !== undefined);
			expect(container.textContent ?? "").toContain("Proposed");
			expect(container.textContent ?? "").toContain("Affected specs");
			const specLink = container.querySelector('a[href="/documentation/12/session-behavior"]');
			expect(specLink?.textContent).toContain("doc-12 — Session behavior");
			expect(container.querySelector('a[href="/tasks/task-3"]')).toBeTruthy();
			expect(container.querySelector('a[href="/decisions/decision-2"]')).toBeTruthy();
			// The delta sections stay in the rendered body; the links panel names the current specs.
			expect(container.textContent ?? "").toContain("Modified requirements");
		} finally {
			apiClient.fetchDoc = originalFetch;
		}
	});

	it("marks an integrated change as history and hides its preview affordance", async () => {
		const originalFetch = apiClient.fetchDoc;
		apiClient.fetchDoc = async () => INTEGRATED_CHANGE;
		const { container } = await renderDoc(INTEGRATED_CHANGE);

		try {
			await waitFor(() => container.textContent?.includes("Integrated") ?? false);
			expect(container.textContent ?? "").toContain("Approved by @alex on 2026-10-07 09:00.");
			expect(container.textContent ?? "").toContain("Integrated on 2026-10-07 09:05 into doc-12.");
			expect(findButton(container, "Preview")).toBeUndefined();
		} finally {
			apiClient.fetchDoc = originalFetch;
		}
	});
});

const validPreview: ChangePreview = {
	documentId: "doc-18",
	changeTitle: "Warn before expiry",
	valid: true,
	issues: [],
	specs: [
		{
			specId: "doc-12",
			title: "Session behavior",
			diff: [
				{ kind: "removed", text: "The system SHALL expire sessions after 30 days." },
				{ kind: "added", text: "The system SHALL warn one day before expiry." },
			],
			resultingContent: "# Session behavior\n\nThe system SHALL warn one day before expiry.\n",
		},
	],
};

const invalidPreview: ChangePreview = {
	documentId: "doc-18",
	changeTitle: "Warn before expiry",
	valid: false,
	issues: [{ line: 9, message: 'Linked task "task-404" does not exist.' }],
	specs: [],
};

describe("Web change preview modal", () => {
	it("shows the per-spec diff and resulting spec without any apply control", async () => {
		const container = setupDom();
		const originalPreview = apiClient.fetchChangePreview;
		apiClient.fetchChangePreview = async (id) => {
			expect(id).toBe("doc-18");
			return validPreview;
		};

		try {
			await render(<ChangePreviewModal id="doc-18" title="Warn before expiry" onClose={() => {}} />);
			await waitFor(() => container.textContent?.includes("doc-12 — Session behavior") ?? false);

			const text = container.textContent ?? "";
			expect(text).toContain("+ The system SHALL warn one day before expiry.");
			expect(text).toContain("- The system SHALL expire sessions after 30 days.");
			expect(text).toContain("Resulting doc-12");
			expect(text).toContain("Previewing does not modify any files.");
			for (const label of ["Apply", "Approve", "Complete"]) {
				expect(findButton(container, label)).toBeUndefined();
			}
		} finally {
			apiClient.fetchChangePreview = originalPreview;
		}
	});

	it("reports validation issues instead of a projection", async () => {
		const container = setupDom();
		const originalPreview = apiClient.fetchChangePreview;
		apiClient.fetchChangePreview = async () => invalidPreview;

		try {
			await render(<ChangePreviewModal id="doc-18" title="Warn before expiry" onClose={() => {}} />);
			await waitFor(() => container.querySelector("[role='alert']") !== null);
			expect(container.querySelector("[role='alert']")?.textContent).toContain("line 9");
			expect(container.querySelector("[role='alert']")?.textContent).toContain("task-404");
		} finally {
			apiClient.fetchChangePreview = originalPreview;
		}
	});

	it("stays read-only when the preview fails to load", async () => {
		const container = setupDom();
		const originalPreview = apiClient.fetchChangePreview;
		apiClient.fetchChangePreview = async () => {
			throw new Error("Document doc-99 not found: doc-99");
		};
		let closeCalls = 0;

		try {
			await render(<ChangePreviewModal id="doc-99" title="Missing" onClose={() => closeCalls++} />);
			await waitFor(() => container.querySelector("[role='alert']") !== null);
			await click(findButton(container, "Cancel") as HTMLButtonElement);
			expect(closeCalls).toBe(1);
		} finally {
			apiClient.fetchChangePreview = originalPreview;
		}
	});
});
