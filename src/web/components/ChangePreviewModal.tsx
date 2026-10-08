import { useCallback, useEffect, useState } from "react";
import type { ChangePreview, ChangeSpecPreview } from "../../markdown/change-document.ts";
import { apiClient } from "../lib/api";
import Modal from "./Modal";

interface Props {
	id: string;
	title: string;
	onClose: () => void;
}

function SpecPreview({ spec }: { spec: ChangeSpecPreview }) {
	return (
		<section className="space-y-3">
			<h3 className="break-words text-sm font-semibold text-gray-900 dark:text-gray-100">
				{spec.specId} — {spec.title}
			</h3>
			{spec.diff.length === 0 ? (
				<p className="text-sm text-gray-500 dark:text-gray-400">No requirement changes.</p>
			) : (
				<pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-xs dark:border-gray-700 dark:bg-gray-900">
					{spec.diff.map((line, index) => (
						<span
							key={index}
							className={
								line.kind === "added"
									? "block text-green-700 dark:text-green-400"
									: line.kind === "removed"
										? "block text-red-700 dark:text-red-400"
										: "block text-gray-700 dark:text-gray-300"
							}
						>
							{line.kind === "added" ? `+ ${line.text}` : line.kind === "removed" ? `- ${line.text}` : `  ${line.text}`}
						</span>
					))}
				</pre>
			)}
			<div className="space-y-1">
				<h4 className="break-words text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
					Resulting {spec.specId}
				</h4>
				<pre className="max-h-64 overflow-y-auto overflow-x-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-3 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
					{spec.resultingContent.trimEnd()}
				</pre>
			</div>
		</section>
	);
}

/**
 * Read-only view of the validated change projection, the same one `backlog doc preview` prints.
 * There is deliberately no apply or approve control here: integration is an explicit CLI operation
 * gated on a recorded review, and viewing a change must never apply it.
 */
export const ChangePreviewModal: React.FC<Props> = ({ id, title, onClose }) => {
	const [preview, setPreview] = useState<ChangePreview | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	const loadPreview = useCallback(async () => {
		setPreview(null);
		setLoadError(null);
		try {
			setPreview(await apiClient.fetchChangePreview(id));
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : String(error));
		}
	}, [id]);

	useEffect(() => {
		void loadPreview();
	}, [loadPreview]);

	return (
		<Modal isOpen onClose={onClose} title={`Preview ${id} — ${title}`} maxWidthClass="max-w-4xl">
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
					{!preview.valid && (
						<div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
							<p className="text-sm font-semibold text-red-800 dark:text-red-200">
								Change {preview.documentId} is invalid:
							</p>
							<ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-red-700 dark:text-red-300">
								{preview.issues.map((issue) => (
									<li key={`${issue.line}|${issue.message}`}>
										line {issue.line}: {issue.message}
									</li>
								))}
							</ul>
						</div>
					)}
					{preview.valid && preview.specs.length === 0 && (
						<p className="text-sm text-gray-500 dark:text-gray-400">No affected specifications to preview.</p>
					)}
					{preview.specs.length > 0 && (
						<div className="space-y-6">
							{preview.specs.map((spec) => (
								<SpecPreview key={spec.specId} spec={spec} />
							))}
						</div>
					)}
					<p className="text-xs text-gray-500 dark:text-gray-400">
						{preview.valid ? "Valid against the current specifications." : "Fix the errors above to preview the result."}{" "}
						Previewing does not modify any files.
					</p>
				</div>
			)}
		</Modal>
	);
};

export default ChangePreviewModal;
