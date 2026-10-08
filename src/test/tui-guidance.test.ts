import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScreenInterface } from "neo-neo-bblessed";
import { screen as blessedScreen } from "neo-neo-bblessed";
import { Core } from "../core/backlog.ts";
import type { Decision, Document } from "../types/index.ts";
import {
	changePreviewViewerAction,
	formatDecisionListItem,
	formatDecisionViewerDisplay,
	formatDocumentViewerDisplay,
	openDecisionViewer,
} from "../ui/guidance.ts";
import { createScreen, scrollableViewer } from "../ui/tui.ts";
import { initializeFilesystemTestProject, withTimeout } from "./test-utils.ts";

type TreeWidget = { content?: string; children?: TreeWidget[] };

const cleanups: Array<() => void> = [];

afterAll(() => {
	for (const cleanup of cleanups) cleanup();
});

/** First widget content on a screen tree containing `needle`, for asserting viewer text. */
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

/**
 * The screen the code under test created most recently. blessed keeps a registry of live
 * screens, and scrollableViewer creates its own, so viewer text is asserted through it.
 */
function viewerScreen(): TreeWidget {
	const instances = (blessedScreen as unknown as { instances: unknown[] }).instances ?? [];
	return (instances.at(-1) as TreeWidget | undefined) ?? {};
}

function sendKeys(keys: string): void {
	process.stdin.emit("data", Buffer.from(keys));
}

function withForcedTty<T>(run: () => Promise<T> | T): Promise<T> {
	return (async () => {
		const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
		try {
			return await run();
		} finally {
			if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
			else Reflect.deleteProperty(process.stdout, "isTTY");
		}
	})();
}

/** A dedicated screen for popup tests, mirroring the withTty helper in tui-delete.test.ts. */
function withTty<T>(run: (screen: ScreenInterface & TreeWidget) => Promise<T> | T): Promise<T> {
	return (async () => {
		const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
		const screen = createScreen({ smartCSR: false }) as ScreenInterface & TreeWidget;
		try {
			return await run(screen);
		} finally {
			screen.destroy();
			if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
			else Reflect.deleteProperty(process.stdout, "isTTY");
		}
	})();
}

async function makeProject(name: string): Promise<{ core: Core }> {
	const dir = mkdtempSync(join(tmpdir(), `tui-guidance-${name}-`));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	const core = new Core(dir);
	await initializeFilesystemTestProject(core, name);
	return { core };
}

function makeAdr(id: string, title: string, status: string, extra: Partial<Decision> = {}): Decision {
	return {
		id,
		title,
		date: "2026-01-01 00:00",
		status: status as Decision["status"],
		context: "Context",
		decision: "Decision",
		consequences: "Consequences",
		kind: "architecture",
		scope: "storage",
		rawContent: "",
		...extra,
	};
}

const SESSION_SPEC = `# Session behavior

### Requirement: Sessions expire [SES-1]

The system SHALL expire sessions after 30 days.
`;

const ADDITION_CHANGE = `# Change: Warn before expiry

## Affected specs

- doc-1

## Linked tasks

- TASK-1

## Related decisions

- decision-1

## Added requirements

### Requirement: Warn before expiry [SES-3]

The system SHALL warn one day before a session expires.

#### Scenario: Expiring soon

- WHEN a session is one day from expiry
- THEN the user is warned
`;

describe("decision guidance viewer", () => {
	it("marks an accepted ADR as applicable and offers no replacement navigation", async () => {
		const { core } = await makeProject("accepted");
		await core.createDecision(makeAdr("decision-1", "Storage choice", "accepted"));

		await withForcedTty(async () => {
			const viewer = withTimeout(openDecisionViewer(core, "decision-1"), "accepted ADR viewer", 8000);
			await waitFor(() => findContent(viewerScreen(), "applies to current work") !== null, "accepted banner");
			expect(findContent(viewerScreen(), "decision-1 - Storage choice")).not.toBeNull();
			expect(findContent(viewerScreen(), "View replacement")).toBeNull();
			sendKeys("q");
			await viewer;
		});
	});

	it("marks a proposed ADR as not yet guidance", async () => {
		const { core } = await makeProject("proposed");
		await core.createDecision(makeAdr("decision-1", "Maybe storage", "proposed"));

		await withForcedTty(async () => {
			const viewer = withTimeout(openDecisionViewer(core, "decision-1"), "proposed ADR viewer", 8000);
			await waitFor(() => findContent(viewerScreen(), "proposed - not yet guidance") !== null, "proposed banner");
			expect(findContent(viewerScreen(), "View replacement")).toBeNull();
			sendKeys("q");
			await viewer;
		});
	});

	it("marks a superseded ADR as history and navigates to its replacement with v", async () => {
		const { core } = await makeProject("superseded");
		await core.createDecision(makeAdr("decision-1", "Old storage", "accepted"));
		await core.createDecision(makeAdr("decision-2", "New storage", "accepted"));
		await core.supersedeDecision("decision-1", "decision-2");

		await withForcedTty(async () => {
			const viewer = withTimeout(openDecisionViewer(core, "decision-1"), "superseded ADR viewer", 8000);
			await waitFor(
				() => findContent(viewerScreen(), "superseded by decision-2 - historical") !== null,
				"superseded banner",
			);
			expect(findContent(viewerScreen(), "View replacement")).not.toBeNull();
			sendKeys("v");
			await waitFor(() => findContent(viewerScreen(), "applies to current work") !== null, "replacement banner");
			expect(findContent(viewerScreen(), "decision-2 - New storage")).not.toBeNull();
			expect(findContent(viewerScreen(), "superseded by decision-2")).toBeNull();
			sendKeys("q");
			await viewer;
		});
	});

	it("marks an archived retired ADR as archived history", async () => {
		const { core } = await makeProject("archived");
		await core.createDecision(makeAdr("decision-1", "Old storage", "accepted"));
		await core.createDecision(makeAdr("decision-2", "New storage", "accepted"));
		await core.supersedeDecision("decision-1", "decision-2");
		await core.archiveDecision("decision-1");

		await withForcedTty(async () => {
			const viewer = withTimeout(openDecisionViewer(core, "decision-1"), "archived ADR viewer", 8000);
			await waitFor(
				() => findContent(viewerScreen(), "superseded by decision-2 - historical, archived") !== null,
				"archived banner",
			);
			sendKeys("q");
			await viewer;
		});
	});

	it("marks a rejected ADR as inapplicable history without a replacement", async () => {
		const { core } = await makeProject("rejected");
		await core.createDecision(makeAdr("decision-1", "Turned down", "rejected"));

		await withForcedTty(async () => {
			const viewer = withTimeout(openDecisionViewer(core, "decision-1"), "rejected ADR viewer", 8000);
			await waitFor(
				() => findContent(viewerScreen(), "rejected - historical, not applicable") !== null,
				"rejected banner",
			);
			expect(findContent(viewerScreen(), "View replacement")).toBeNull();
			sendKeys("q");
			await viewer;
		});
	});

	it("shows a legacy decision status without ADR lifecycle phrasing", async () => {
		const { core } = await makeProject("legacy");
		await core.createDecision({
			id: "decision-1",
			title: "Free form",
			date: "2026-01-01 00:00",
			status: "Under Review" as Decision["status"],
			context: "",
			decision: "",
			consequences: "",
			rawContent: "",
		});

		await withForcedTty(async () => {
			const viewer = withTimeout(openDecisionViewer(core, "decision-1"), "legacy decision viewer", 8000);
			await waitFor(() => findContent(viewerScreen(), "Status: Under Review") !== null, "legacy status");
			expect(findContent(viewerScreen(), "applies to current work")).toBeNull();
			sendKeys("q");
			await viewer;
		});
	});
});

describe("decision guidance display and list labels", () => {
	it("formats the viewer banner from the resolution", () => {
		const display = formatDecisionViewerDisplay(
			{ decision: makeAdr("decision-9", "Banner subject", "accepted") },
			"Body text",
		);
		expect(display).toContain("decision-9 - Banner subject");
		expect(display).toContain("Status: accepted - applies to current work");
		expect(display.endsWith("Body text")).toBe(true);
	});

	it("formats a retired resolution with its replacement", () => {
		const retired = makeAdr("decision-1", "Old", "superseded");
		const replacement = makeAdr("decision-2", "New", "accepted");
		const display = formatDecisionViewerDisplay(
			{ decision: retired, retired: { state: "superseded", archived: true, replacement } },
			"Body",
		);
		expect(display).toContain("superseded by decision-2 - historical, archived");
	});

	it("grays retired and archived decisions in the selection list only", () => {
		const retired = formatDecisionListItem(makeAdr("decision-1", "Old", "superseded"));
		const archived = formatDecisionListItem(makeAdr("decision-2", "Stored", "accepted", { archived: true }));
		const applicable = formatDecisionListItem(makeAdr("decision-3", "Current", "accepted"));
		const legacy = formatDecisionListItem({
			id: "decision-4",
			title: "Legacy",
			date: "2026-01-01 00:00",
			status: "Under Review" as Decision["status"],
			context: "",
			decision: "",
			consequences: "",
			rawContent: "",
		});
		expect(retired).toBe("{gray-fg}decision-1 - Old (superseded){/}");
		expect(archived).toBe("{gray-fg}decision-2 - Stored (accepted, archived){/}");
		expect(applicable).toBe("decision-3 - Current (accepted)");
		expect(legacy).toBe("decision-4 - Legacy (Under Review)");
	});
});

describe("document viewer labels", () => {
	function makeSpecDocument(): Document {
		return {
			id: "doc-1",
			title: "Session behavior",
			type: "specification",
			createdDate: "2026-01-01 00:00",
			rawContent: SESSION_SPEC,
		};
	}

	function makeChangeDocument(content: string): Document {
		return {
			id: "doc-2",
			title: "Warn before expiry",
			type: "change",
			createdDate: "2026-01-01 00:00",
			rawContent: content,
		};
	}

	it("labels a specification as current required behavior", () => {
		const display = formatDocumentViewerDisplay(makeSpecDocument(), SESSION_SPEC);
		expect(display).toContain("Specification doc-1 - current required behavior");
		expect(display).toContain("Sessions expire [SES-1]");
		expect(display).not.toContain("Change proposal");
	});

	it("separates a change proposal from the current specification it affects", () => {
		const display = formatDocumentViewerDisplay(makeChangeDocument(ADDITION_CHANGE), ADDITION_CHANGE);
		expect(display).toContain("Change proposal doc-2 - Warn before expiry");
		expect(display).toContain("it is not the current specification");
		expect(display).toContain("Affected specs (current): doc-1");
		expect(display).toContain("Links: tasks TASK-1; decisions decision-1");
		expect(display).toContain("Warn before expiry [SES-3]");
		expect(display).not.toContain("Integrated change");
	});

	it("states approval factually without implying the change was applied", () => {
		const approved = `${ADDITION_CHANGE}\n## Review\n\nApproved by @alex on 2026-10-07.\n`;
		const display = formatDocumentViewerDisplay(makeChangeDocument(approved), approved);
		expect(display).toContain("Approved by @alex on 2026-10-07 - not yet integrated");
	});

	it("presents an integrated change as history, not a proposal", () => {
		const integrated = `${ADDITION_CHANGE}\n## Integrated\n\nIntegrated on 2026-10-07 into doc-1.\n`;
		const display = formatDocumentViewerDisplay(makeChangeDocument(integrated), integrated);
		expect(display).toContain("Integrated change doc-2 - Warn before expiry (history)");
		expect(display).toContain("Integrated on 2026-10-07 into doc-1");
		expect(display).toContain("current behavior lives in the affected specifications");
		expect(display).not.toContain("Change proposal");
		expect(display).not.toContain("Affected specs (current)");
	});
});

describe("change preview action", () => {
	/** The change fixture links TASK-1 and decision-1, so both records must exist first. */
	async function makeProjectWithLinkedRecords(name: string): Promise<{ core: Core }> {
		const { core } = await makeProject(name);
		await core.createTask({
			id: "TASK-1",
			title: "Linked work",
			status: "To Do",
			assignee: [],
			createdDate: "2026-01-01",
			labels: [],
			dependencies: [],
		});
		await core.createDecision(makeAdr("decision-1", "Linked decision", "accepted"));
		return { core };
	}

	it("shows the read-only preview in a popup and modifies nothing", async () => {
		const { core } = await makeProjectWithLinkedRecords("preview");
		await core.createDocumentFromInput({ title: "Session behavior", type: "specification", content: SESSION_SPEC });
		const change = await core.createDocumentFromInput({
			title: "Warn before expiry",
			type: "change",
			content: ADDITION_CHANGE,
		});
		const specBefore = await core.getDocumentContent("doc-1");
		const changeBefore = await core.getDocumentContent(change.id);

		await withTty(async (screen) => {
			const result = await changePreviewViewerAction(core, change.id).run(screen, () => {});
			expect(result.note).toBeUndefined();
			await waitFor(
				() => findContent(screen, "Validation and preview do not modify any files.") !== null,
				"preview popup",
			);
			expect(findContent(screen, "+ The system SHALL warn one day before a session expires.")).not.toBeNull();
			sendKeys("b");
			await waitFor(
				() => findContent(screen, "Validation and preview do not modify any files.") === null,
				"popup close",
			);
		});

		expect(await core.getDocumentContent("doc-1")).toBe(specBefore);
		expect(await core.getDocumentContent(change.id)).toBe(changeBefore);
	});

	it("reports validation errors for a stale change without writing anything", async () => {
		const { core } = await makeProjectWithLinkedRecords("preview-invalid");
		await core.createDocumentFromInput({ title: "Session behavior", type: "specification", content: SESSION_SPEC });
		const staleChange = `# Change: Tighten session expiry

## Affected specs

- doc-1

## Modified requirements

### Requirement: Sessions expire after 14 days [SES-1]

The system SHALL expire sessions after 14 days.
`;
		const change = await core.createDocumentFromInput({ title: "Stale", type: "change", content: staleChange });
		// The requirement the change modifies disappears after creation, so the recorded
		// proposal no longer matches the current specification and the preview reports it.
		await core.updateDocumentFromInput({
			id: "doc-1",
			content: "# Session behavior\n\n### Requirement: Renamed [RENAMED-1]\n\nThe system SHALL rename.\n",
		});
		const changeBefore = await core.getDocumentContent(change.id);

		await withTty(async (screen) => {
			const result = await changePreviewViewerAction(core, change.id).run(screen, () => {});
			expect(result.note).toBeUndefined();
			await waitFor(() => findContent(screen, "Errors:") !== null, "validation errors");
			expect(findContent(screen, "is invalid")).not.toBeNull();
		});

		expect(await core.getDocumentContent(change.id)).toBe(changeBefore);
	});

	it("returns the CLI error as a note for a non-change document", async () => {
		const { core } = await makeProject("preview-spec");
		const spec = await core.createDocumentFromInput({
			title: "Session behavior",
			type: "specification",
			content: SESSION_SPEC,
		});

		await withTty(async (screen) => {
			const result = await changePreviewViewerAction(core, spec.id).run(screen, () => {});
			expect(result.note).toContain("is a specification document");
			expect(result.note).toContain("change documents only");
		});
	});
});

describe("multi-action viewer", () => {
	it("binds every action key and lists every hint in the action bar", async () => {
		await withForcedTty(async () => {
			const ran: string[] = [];
			const viewer = withTimeout(
				scrollableViewer("shared body", {
					actions: [
						{
							key: "d",
							hint: "{cyan-fg}[D]{/} Delete",
							run: async () => {
								ran.push("d");
								return {};
							},
						},
						{
							key: "p",
							hint: "{cyan-fg}[P]{/} Preview",
							run: async () => {
								ran.push("p");
								return { close: true };
							},
						},
					],
				}),
				"multi-action viewer",
				8000,
			);
			await waitFor(() => findContent(viewerScreen(), "shared body") !== null, "viewer content");
			expect(findContent(viewerScreen(), "{/} Delete")).not.toBeNull();
			expect(findContent(viewerScreen(), "{/} Preview")).not.toBeNull();
			sendKeys("d");
			await waitFor(() => ran.includes("d"), "first action");
			expect(findContent(viewerScreen(), "shared body")).not.toBeNull();
			sendKeys("p");
			await viewer;
			expect(ran).toEqual(["d", "p"]);
		});
	});
});
