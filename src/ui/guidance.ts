/**
 * The TUI half of decision guidance and change/spec viewing. Everything shown here is
 * derived from the shared model — Core's guidance resolution and the change-document
 * parser — so the terminal never re-parses Markdown into a second truth.
 *
 * Labels exist to keep records from being mistaken for what they are not: a retired or
 * archived ADR is history with a navigable replacement, a change document is a proposal
 * until its Integrated record exists, and a specification is current required behavior.
 * Every affordance here is read-only; nothing implies approval, apply, or task completion.
 */

import type { ScreenInterface } from "neo-neo-bblessed";
import type { Core } from "../core/backlog.ts";
import {
	type ChangePreview,
	formatChangePreview,
	parseChangeDocument,
	parseChangeIntegration,
	parseChangeReview,
} from "../markdown/change-document.ts";
import type { AdrGuidanceResolution, Decision, Document } from "../types/index.ts";
import { isAdr, isRetiredAdr } from "../utils/adr.ts";
import { createPopupChrome, createScrollableViewport } from "./components/filter-popup.ts";
import { type ScrollableViewerAction, scrollableViewer } from "./tui.ts";

/** One-line status for the decision viewer: what governs current work versus what is history. */
function decisionStatusLine(decision: Decision, resolution: AdrGuidanceResolution): string {
	const parts: string[] = [];
	if (isAdr(decision)) {
		if (decision.status === "accepted" && !decision.archived) {
			parts.push("accepted - applies to current work");
		} else if (decision.status === "proposed") {
			parts.push("proposed - not yet guidance");
		} else if (resolution.retired?.replacement) {
			parts.push(`superseded by ${resolution.retired.replacement.id} - historical`);
		} else {
			parts.push(`${decision.status} - historical, not applicable`);
		}
	} else {
		parts.push(decision.status || "unknown status");
	}
	if (decision.archived || resolution.retired?.archived) parts.push("archived");
	return `Status: ${parts.join(", ")}`;
}

/**
 * Viewer display for one decision: a guidance banner built from the resolution, then the
 * body. Banner text is plain — the scrollable viewer box renders untagged content.
 */
export function formatDecisionViewerDisplay(resolution: AdrGuidanceResolution, content: string): string {
	const decision = resolution.decision;
	const banner = [`${decision.id} - ${decision.title}`, decisionStatusLine(decision, resolution), ""];
	return `${banner.join("\n")}${content}`;
}

/**
 * List label for decision selection. Retired and archived records render grayed out so
 * history is marked before it is opened; legacy decisions are never retired by status.
 */
export function formatDecisionListItem(decision: Decision): string {
	const markers = [decision.status, decision.archived ? "archived" : ""].filter(Boolean).join(", ");
	const label = `${decision.id} - ${decision.title}${markers ? ` (${markers})` : ""}`;
	return isRetiredAdr(decision) || decision.archived ? `{gray-fg}${label}{/}` : label;
}

/**
 * Opens the guidance viewer for one decision and follows replacement navigation: a retired
 * ADR offers [V] View replacement, which closes this viewer and opens the authoritative
 * replacement's own viewer. Reading history, not endorsing it — no action mutates anything.
 */
export async function openDecisionViewer(core: Core, decisionId: string): Promise<void> {
	let currentId = decisionId;
	for (;;) {
		const resolution = await core.resolveAdrGuidance(currentId);
		const content = await core.getDecisionContent(currentId);
		if (!resolution || content === null) {
			console.error(`Decision ${currentId} not found.`);
			process.exitCode = 1;
			return;
		}
		const replacementId = resolution.retired?.replacement?.id ?? null;
		let navigated = false;
		const actions: ScrollableViewerAction[] =
			replacementId !== null
				? [
						{
							key: "v",
							hint: "{cyan-fg}[V]{/} View replacement",
							run: async () => {
								navigated = true;
								return { close: true };
							},
						},
					]
				: [];
		await scrollableViewer(formatDecisionViewerDisplay(resolution, content), { actions });
		if (!navigated || replacementId === null) return;
		currentId = replacementId;
	}
}

/**
 * Viewer display for one document. Change documents get a proposal/history banner that
 * separates their delta text from the current specifications they affect; specifications
 * are labeled as current required behavior. Other document types render unchanged.
 * `content` is the full file text the viewer shows; records are parsed with the shared
 * change-document parser.
 */
export function formatDocumentViewerDisplay(document: Document, content: string): string {
	if (document.type === "specification") {
		return `Specification ${document.id} - current required behavior\n\n${content}`;
	}
	if (document.type !== "change") {
		return content;
	}

	const parsed = parseChangeDocument(content);
	const integration = parseChangeIntegration(content);
	const lines: string[] = [];
	if (integration.integrated) {
		lines.push(`Integrated change ${document.id} - ${document.title} (history)`);
		const into = integration.specIds.length > 0 ? ` into ${integration.specIds.join(", ")}` : "";
		lines.push(`Integrated on ${integration.integratedDate ?? "unknown date"}${into}.`);
		lines.push("Retained as history; current behavior lives in the affected specifications.");
	} else {
		const review = parseChangeReview(content);
		lines.push(`Change proposal ${document.id} - ${document.title}`);
		lines.push("This document proposes behavior changes; it is not the current specification.");
		if (review.approved) {
			lines.push(
				`Approved${review.approvedBy ? ` by ${review.approvedBy}` : ""} on ${review.approvedDate ?? "unknown date"} - not yet integrated.`,
			);
		}
		if (parsed.affectedSpecs.length > 0) {
			lines.push(`Affected specs (current): ${parsed.affectedSpecs.map((link) => link.id).join(", ")}`);
		}
		const links: string[] = [];
		if (parsed.linkedTasks.length > 0) links.push(`tasks ${parsed.linkedTasks.map((link) => link.id).join(", ")}`);
		if (parsed.relatedDecisions.length > 0) {
			links.push(`decisions ${parsed.relatedDecisions.map((link) => link.id).join(", ")}`);
		}
		if (links.length > 0) lines.push(`Links: ${links.join("; ")}`);
	}
	return `${lines.join("\n")}\n\n${content}`;
}

/**
 * Read-only preview popup for a change document: the same validated projection
 * `backlog doc preview` prints, opened from the document viewer. Nothing is written.
 */
function openChangePreviewPopup(screen: ScreenInterface, preview: ChangePreview, onDone: () => void): void {
	const { popup, close } = createPopupChrome({
		screen,
		title: "Change Preview",
		helpText: " {cyan-fg}[↑↓]{/} Scroll | {cyan-fg}[B]{/} Back",
		width: 90,
		height: 28,
	});
	const viewport = createScrollableViewport({
		parent: popup,
		top: 1,
		left: 2,
		right: 2,
		bottom: 1,
		tags: true,
		content: formatChangePreview(preview),
	});

	const finish = () => {
		close();
		onDone();
		screen.render();
		return false;
	};
	// Not q/Esc: the underlying viewer binds those at screen level, so they would close the
	// whole viewer instead of returning to it. [B] Back is the popup's own close key.
	popup.key(["b", "B"], finish);
	popup.key(["up"], () => {
		viewport.childBase = Math.max(0, viewport.childBase - 1);
		screen.render();
		return false;
	});
	popup.key(["down"], () => {
		viewport.childBase += 1;
		screen.render();
		return false;
	});

	setImmediate(() => {
		popup.focus();
		screen.render();
	});
}

/**
 * The [P] action for a change document's viewer. Validation failures print as the viewer
 * note exactly like the CLI reports them; the preview itself is always read-only.
 */
export function changePreviewViewerAction(core: Core, docId: string): ScrollableViewerAction {
	return {
		key: "p",
		hint: "{cyan-fg}[P]{/} Preview",
		run: async (screen, refocus) => {
			let preview: ChangePreview;
			try {
				preview = await core.buildChangePreview(docId);
			} catch (error) {
				return { note: error instanceof Error ? error.message : String(error) };
			}
			openChangePreviewPopup(screen, preview, refocus);
			return {};
		},
	};
}
