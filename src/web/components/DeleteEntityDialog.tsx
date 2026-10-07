import React, { useCallback, useEffect, useState } from "react";
import Modal from "./Modal";
import {
	ApiError,
	apiClient,
	type DeletionEndpoint,
	type DeletionResolutionRequest,
	type EntityDeletionPreview,
	type EntityDeletionResult,
} from "../lib/api";

interface Props {
	endpoint: DeletionEndpoint;
	id: string;
	title: string;
	onClose: () => void;
	onDeleted: (result: EntityDeletionResult) => void;
}

const RELATION_LABELS: Record<string, string> = {
	parent: "parent link",
	dependency: "dependency",
	reference: "reference",
	documentation: "documentation link",
};

const UNRESOLVED_REASONS: Record<string, string> = {
	missing: "resolves to no record",
	ambiguous: "matches several records",
	invalid: "is not a valid ID",
};

/** The server reports "the delete ran, a later step failed" with this marker: the file is gone. */
function isMovedDeletion(error: unknown): error is ApiError {
	return (
		error instanceof ApiError &&
		typeof error.data === "object" &&
		error.data !== null &&
		(error.data as Record<string, unknown>).deletionState === "moved"
	);
}

/**
 * Confirmation for an explicit delete. The preview and the mutation go through the same core
 * validations the CLI uses, so the references, choices, and warnings shown here are the ones the
 * server enforces. Focus starts on the dialog itself, Escape and Cancel close without touching
 * anything, and the destructive button never activates accidentally.
 */
export const DeleteEntityDialog: React.FC<Props> = ({ endpoint, id, title, onClose, onDeleted }) => {
	const [preview, setPreview] = useState<EntityDeletionPreview | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [resolutionChoice, setResolutionChoice] = useState<"unlink" | "reassign">("unlink");
	const [replacementId, setReplacementId] = useState("");
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const loadPreview = useCallback(async () => {
		setPreview(null);
		setLoadError(null);
		setDeleteError(null);
		try {
			setPreview(await apiClient.fetchDeletionPreview(endpoint, id));
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : String(error));
		}
	}, [endpoint, id]);

	useEffect(() => {
		void loadPreview();
	}, [loadPreview]);

	// Escape cancels this dialog only, and runs before the task modal behind it can react.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || deleting) return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [onClose, deleting]);

	const handleDelete = async () => {
		if (!preview || deleting) return;
		const resolution: DeletionResolutionRequest =
			preview.references.length === 0
				? { action: "cancel" }
				: resolutionChoice === "unlink"
					? { action: "unlink" }
					: { action: "reassign", replacementId: replacementId.trim() };
		setDeleting(true);
		setDeleteError(null);
		try {
			onDeleted(await apiClient.deleteEntity(endpoint, preview.targetId, resolution));
		} catch (error) {
			if (isMovedDeletion(error)) {
				onDeleted({
					success: true,
					deletedId: preview.targetId,
					deletedPath: "",
					updatedIds: [],
					recoveryWarning: error.message,
				});
				return;
			}
			setDeleteError(error instanceof Error ? error.message : String(error));
			setDeleting(false);
		}
	};

	const reassignIncomplete =
		preview !== null && preview.references.length > 0 && resolutionChoice === "reassign" && replacementId.trim() === "";

	return (
		<Modal
			isOpen
			onClose={onClose}
			title={`Delete ${id} permanently`}
			maxWidthClass="max-w-xl"
			disableEscapeClose={deleting}
		>
			{loadError !== null ? (
				<div className="space-y-4">
					<p role="alert" className="text-sm text-red-600 dark:text-red-400">
						{loadError}
					</p>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors duration-200"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => void loadPreview()}
							className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 dark:bg-blue-700 hover:bg-blue-700 dark:hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors duration-200"
						>
							Retry
						</button>
					</div>
				</div>
			) : preview === null ? (
				<p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
			) : (
				<div className="space-y-4">
					<div className="min-w-0">
						<p className="text-sm font-semibold break-words text-gray-900 dark:text-gray-100">
							{preview.targetId} — {preview.title || title}
						</p>
						<p className="mt-0.5 break-all font-mono text-xs text-gray-500 dark:text-gray-400">{preview.targetPath}</p>
					</div>

					{preview.references.length === 0 ? (
						<p className="text-sm text-gray-700 dark:text-gray-300">No other record links to {preview.targetId}.</p>
					) : (
						<fieldset className="space-y-2" disabled={deleting}>
							<legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">
								{preview.references.length} active {preview.references.length === 1 ? "reference" : "references"}{" "}
								would break:
							</legend>
							<ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-gray-200 p-2 dark:border-gray-700">
								{preview.references.map((reference) => (
									<li
										key={`${reference.sourceId}|${reference.relation}|${reference.value}`}
										className="text-sm text-gray-700 dark:text-gray-300"
									>
										{RELATION_LABELS[reference.relation] ?? reference.relation} from{" "}
										<code className="font-mono text-xs">{reference.sourceId}</code> — {reference.sourceTitle}
										<span className="block break-all font-mono text-xs text-gray-500 dark:text-gray-400">
											{reference.sourcePath}
										</span>
									</li>
								))}
							</ul>
							<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
								<input
									type="radio"
									name="deletion-resolution"
									checked={resolutionChoice === "unlink"}
									onChange={() => setResolutionChoice("unlink")}
									disabled={deleting}
								/>
								Remove the references
							</label>
							<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
								<input
									type="radio"
									name="deletion-resolution"
									checked={resolutionChoice === "reassign"}
									onChange={() => setResolutionChoice("reassign")}
									disabled={deleting}
								/>
								Point them at another record instead
							</label>
							{resolutionChoice === "reassign" && (
								<input
									type="text"
									value={replacementId}
									onChange={(event) => setReplacementId(event.target.value)}
									disabled={deleting}
									aria-label="Replacement record ID"
									placeholder={preview.entityType === "document" ? "doc-2" : "TASK-12"}
									className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
								/>
							)}
						</fieldset>
					)}

					{preview.unresolvedLinks.length > 0 && (
						<div className="text-xs text-gray-500 dark:text-gray-400">
							<p className="font-semibold text-gray-700 dark:text-gray-300">Unresolved links in this record:</p>
							<ul className="mt-1 space-y-0.5">
								{preview.unresolvedLinks.map((link) => (
									<li key={`${link.relation}|${link.value}`}>
										{RELATION_LABELS[link.relation] ?? link.relation} “{link.value}”{" "}
										{UNRESOLVED_REASONS[link.reason] ?? link.reason}
									</li>
								))}
							</ul>
						</div>
					)}

					<div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
						<p>{preview.recoveryWarning}</p>
						<p className="mt-1">{preview.freeTextLimit}</p>
					</div>

					{deleteError !== null && (
						<p role="alert" className="text-sm text-red-600 dark:text-red-400">
							{deleteError}
						</p>
					)}

					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							disabled={deleting}
							className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => void handleDelete()}
							disabled={deleting || reassignIncomplete}
							className="inline-flex items-center px-4 py-2 border border-red-300 dark:border-red-700 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-500 dark:focus:ring-red-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{deleting ? "Deleting…" : "Delete permanently"}
						</button>
					</div>
				</div>
			)}
		</Modal>
	);
};

export default DeleteEntityDialog;
