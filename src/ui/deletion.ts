/**
 * The TUI half of an explicit delete. Every dialog here presents the same preview the CLI
 * would (core/deletion-preview.ts builds and validates it; this module only renders it and
 * collects a cancel/unlink/reassign choice), then requires a separate confirmation before
 * calling the same destructive Core operations the CLI uses. Archiving stays the default
 * lifecycle action on every surface; deletion only happens through this flow.
 */

import type { BoxInterface, ScreenInterface } from "neo-neo-bblessed";
import { box, textbox } from "neo-neo-bblessed";
import type { Core } from "../core/backlog.ts";
import {
	buildDeletionPreview,
	DELETION_FREE_TEXT_LIMIT,
	type DeletionEntityType,
	type DeletionPreview,
	type DeletionResolution,
	deletionEntityLabel,
	deletionRecoveryWarning,
	deletionUnresolvedReason,
	deletionRelationLabel as relationLabel,
	validateDeletionResolution,
} from "../core/deletion-preview.ts";
import type { Task } from "../types/index.ts";
import { openConfirmPopup } from "./components/confirm-popup.ts";
import { createPopupChrome, createScrollableViewport, type ScrollableViewport } from "./components/filter-popup.ts";
import type { ScrollableViewerAction } from "./tui.ts";

/**
 * The record a task view shows is a draft exactly when it carries the draft status - the same
 * signal the board and the unified view already use, because Core keeps drafts on status Draft.
 */
export function deletionEntityTypeForTask(task: Pick<Task, "status">): DeletionEntityType {
	return task.status.trim().toLowerCase() === "draft" ? "draft" : "task";
}

export type TuiDeletionOutcome =
	| { status: "deleted"; message: string }
	| { status: "canceled" }
	| { status: "error"; message: string };

export interface TuiDeletionOptions {
	screen: ScreenInterface;
	core: Core;
	entityType: DeletionEntityType;
	entityId: string;
	/** Runs when the flow ends either way, so the caller can restore keyboard focus. */
	onDone?: () => void;
}

/**
 * Run the explicit delete flow for one record: preview dialog, resolution choice, separate
 * confirmation, then the Core delete. Cancellation and every failure leave the record untouched
 * and report the same message the CLI would print.
 */
export async function runTuiDeletion(options: TuiDeletionOptions): Promise<TuiDeletionOutcome> {
	try {
		const preview = await buildDeletionPreview(options.core, options.entityType, options.entityId);
		if (preview.status !== "found") {
			return { status: "error", message: preview.message };
		}
		const recoveryWarning = await deletionRecoveryWarning(options.core);
		for (;;) {
			const resolution = await openDeletionPreviewDialog(options.screen, options.core, preview, recoveryWarning);
			if (!resolution) {
				return { status: "canceled" };
			}
			const confirmed = await openConfirmPopup({
				screen: options.screen,
				title: `Delete ${deletionEntityLabel(preview.entityType)}`,
				message: `Permanently delete {bold}${preview.targetId}{/bold}?\nThe file is removed, not archived.`,
			});
			if (confirmed) {
				return await executeDeletion(options.core, preview, resolution);
			}
		}
	} finally {
		options.onDone?.();
	}
}

async function executeDeletion(
	core: Core,
	preview: DeletionPreview,
	resolution: DeletionResolution,
): Promise<TuiDeletionOutcome> {
	try {
		if (preview.entityType === "document") {
			const result = await core.deleteDocument(preview.targetId ?? "", resolution);
			return {
				status: "deleted",
				message: deletionSuccessMessage(
					"document",
					result.id,
					result.path,
					result.updates.map((update) => update.sourceId),
				),
			};
		}
		const result = await core.deleteEntity(preview, resolution);
		return {
			status: "deleted",
			message: deletionSuccessMessage(
				preview.entityType,
				preview.targetId ?? "",
				result.deletedPath,
				result.updatedSources.map((source) => source.id),
			),
		};
	} catch (error) {
		return { status: "error", message: error instanceof Error ? error.message : String(error) };
	}
}

/** One transient line: what was removed, plus the records whose references were rewritten. */
export function deletionSuccessMessage(
	entityType: DeletionEntityType,
	id: string,
	path: string,
	updatedSourceIds: readonly string[],
): string {
	const updated = updatedSourceIds.length > 0 ? `; updated ${updatedSourceIds.join(", ")}` : "";
	return `Deleted ${entityType} ${id} (${path})${updated}`;
}

/**
 * Preview dialog: what would be removed, which active references would break, the recovery
 * warning, and the cancel/unlink/reassign keys. Returns the validated resolution, or null when
 * the user canceled.
 */
function openDeletionPreviewDialog(
	screen: ScreenInterface,
	core: Core,
	preview: DeletionPreview,
	recoveryWarning: string,
): Promise<DeletionResolution | null> {
	const label = deletionEntityLabel(preview.entityType);
	const hasReferences = preview.references.length > 0;
	const helpText = hasReferences
		? " {cyan-fg}[U]{/} Unlink refs | {cyan-fg}[R]{/} Reassign | {cyan-fg}[↑↓]{/} Scroll | {cyan-fg}[Esc]{/} Cancel"
		: " {cyan-fg}[Enter/D]{/} Delete file | {cyan-fg}[↑↓]{/} Scroll | {cyan-fg}[Esc]{/} Cancel";
	const { popup, close } = createPopupChrome({
		screen,
		title: `Delete ${label}`,
		helpText,
		width: 70,
		height: 18,
	});
	const content: ScrollableViewport = createScrollableViewport({
		parent: popup,
		top: 1,
		left: 2,
		right: 2,
		bottom: 1,
		tags: true,
		content: renderDeletionPreview(preview, recoveryWarning),
	});

	return new Promise<DeletionResolution | null>((resolve) => {
		let settled = false;
		let busy = false;
		const finish = (value: DeletionResolution | null) => {
			if (settled) return;
			settled = true;
			close();
			screen.render();
			resolve(value);
		};
		const showErrors = (errors: string[]) => {
			content.setContent(renderDeletionPreview(preview, recoveryWarning, errors));
			content.childBase = 0;
			screen.render();
		};
		const choose = async (resolution: DeletionResolution) => {
			if (busy) return;
			busy = true;
			try {
				const validation = await validateDeletionResolution(core, preview, resolution);
				if (validation.ok) finish(resolution);
				else showErrors(validation.errors);
			} finally {
				busy = false;
			}
		};

		popup.key(["enter", "d", "D"], () => {
			if (!hasReferences) void choose({ action: "cancel" });
			return false;
		});
		popup.key(["u", "U"], () => {
			void choose({ action: "unlink" });
			return false;
		});
		popup.key(["r", "R"], () => {
			if (busy) return false;
			void (async () => {
				const replacementId = await openReassignInputDialog(screen, core, preview);
				if (replacementId !== null) finish({ action: "reassign", replacementId });
				else {
					popup.focus();
					screen.render();
				}
			})();
			return false;
		});
		popup.key(["escape", "n", "N"], () => {
			finish(null);
			return false;
		});
		popup.key(["up"], () => {
			content.childBase = Math.max(0, content.childBase - 1);
			screen.render();
			return false;
		});
		popup.key(["down"], () => {
			content.childBase += 1;
			screen.render();
			return false;
		});

		setImmediate(() => {
			popup.focus();
			screen.render();
		});
	});
}

/**
 * Replacement-ID input for the reassign resolution. The choice validates before the dialog
 * closes, so a rejected replacement never reaches the confirmation step; Esc returns to the
 * preview dialog.
 */
function openReassignInputDialog(
	screen: ScreenInterface,
	core: Core,
	preview: DeletionPreview,
): Promise<string | null> {
	const { popup, close } = createPopupChrome({
		screen,
		title: "Reassign References",
		helpText: " {cyan-fg}[Enter]{/} Validate | {cyan-fg}[Esc]{/} Back",
		width: 56,
		height: 11,
	});
	box({
		parent: popup,
		top: 1,
		left: 2,
		right: 2,
		height: 1,
		tags: true,
		content: `Point every reference to {bold}${preview.targetId}{/bold} at a replacement ID.`,
	});
	const errorBox: BoxInterface = box({
		parent: popup,
		bottom: 1,
		left: 2,
		right: 2,
		height: 3,
		tags: true,
		content: "",
	});
	const input = textbox({
		parent: popup,
		top: 3,
		left: 2,
		width: 30,
		height: 3,
		border: { type: "line" },
		label: " Replacement ID ",
		keys: true,
		mouse: true,
		inputOnFocus: false,
		style: { border: { fg: "yellow" } },
	});

	return new Promise<string | null>((resolve) => {
		let settled = false;
		const finish = (value: string | null) => {
			if (settled) return;
			settled = true;
			close();
			screen.render();
			resolve(value);
		};
		const showError = (message: string) => {
			errorBox.setContent(`{red-fg}${message}{/}`);
			screen.render();
		};

		input.on("submit", (value: unknown) => {
			void (async () => {
				const replacementId = String(value ?? "").trim();
				if (!replacementId) {
					showError("A replacement ID is required.");
					input.readInput();
					return;
				}
				const validation = await validateDeletionResolution(core, preview, {
					action: "reassign",
					replacementId,
				});
				if (validation.ok) finish(replacementId);
				else {
					showError(validation.errors.join("\n"));
					input.readInput();
				}
			})();
		});
		input.on("cancel", () => {
			finish(null);
		});

		setImmediate(() => {
			input.focus();
			input.readInput();
			screen.render();
		});
	});
}

/** TUI rendering of the preview the CLI's formatDeletionPreview describes in flag language. */
function renderDeletionPreview(preview: DeletionPreview, recoveryWarning: string, errors?: string[]): string {
	const lines: string[] = [];
	lines.push(`{bold}${deletionEntityLabel(preview.entityType)} ${preview.targetId} - ${preview.title}{/bold}`);
	lines.push(`File: ${preview.targetPath}`);
	lines.push("");
	if (preview.references.length === 0) {
		lines.push("No active structured references.");
	} else {
		lines.push(`Active structured references (${preview.references.length}):`);
		for (const reference of preview.references) {
			lines.push(
				`  ${relationLabel(reference.relation)} from ${reference.sourceId} - ${reference.sourceTitle} (${reference.sourcePath})`,
			);
		}
	}
	if (preview.unresolvedLinks.length > 0) {
		lines.push("");
		lines.push("Unresolved links in this record:");
		for (const link of preview.unresolvedLinks) {
			lines.push(`  ${relationLabel(link.relation)} "${link.value}" ${deletionUnresolvedReason(link)}`);
		}
	}
	lines.push("");
	lines.push(`{gray-fg}${DELETION_FREE_TEXT_LIMIT}{/}`);
	lines.push(`{yellow-fg}${recoveryWarning}{/}`);
	lines.push("{gray-fg}Nothing has been deleted or modified.{/}");
	if (errors && errors.length > 0) {
		lines.push("");
		for (const error of errors) {
			lines.push(`{red-fg}${error}{/}`);
		}
	}
	return lines.join("\n");
}

/**
 * The delete action the document viewer binds to D. Resolves with close after a successful
 * delete (the document is gone, so the viewer has nothing left to show), or with a note so the
 * viewer can surface a failure the way the CLI printed it.
 */
export function documentDeleteViewerAction(core: Core, docId: string): ScrollableViewerAction {
	return {
		hint: "{cyan-fg}[D]{/} Delete",
		run: async (screen, refocus) => {
			const outcome = await runTuiDeletion({
				screen,
				core,
				entityType: "document",
				entityId: docId,
				onDone: refocus,
			});
			if (outcome.status === "deleted") return { close: true };
			if (outcome.status === "error") return { note: outcome.message };
			return {};
		},
	};
}
