import { mkdir, rename as moveFile, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { DEFAULT_DIRECTORIES, DEFAULT_STATUSES, FALLBACK_STATUS } from "../constants/index.ts";
import {
	type DraftFileReference,
	DraftIdentityError,
	DraftParseError,
	FileSystem,
	isConfigValueError,
	isCreateLockError,
	newTaskLockError,
} from "../file-system/operations.ts";
import { type GitBranchTip, type GitIndexEntry, GitOperations } from "../git/operations.ts";
import {
	buildChangeDocumentPreview,
	type ChangeLinkResolver,
	type ChangePreview,
	parseChangeDocument,
	parseChangeIntegration,
	parseChangeReview,
	specBaselineHash,
	validateChangeContent,
	withManagedSection,
	withRecordedBaselines,
} from "../markdown/change-document.ts";
import { parseDecision, parseTask } from "../markdown/parser.ts";
import { validateSpecificationContent } from "../markdown/spec-requirements.ts";
import {
	assertSectionInputHasNoMarkerLines,
	assertValidChecklistMarks,
	CommentsManager,
} from "../markdown/structured-sections.ts";
import {
	type AcceptanceCriterion,
	type AdrGuidanceResolution,
	type BacklogConfig,
	type ChangeApplicationResult,
	type Decision,
	type DecisionReference,
	type DecisionUpdateInput,
	DOCUMENT_TYPE_VALUES,
	type Document,
	type DocumentCreateInput,
	type DocumentType,
	type DocumentUpdateInput,
	EntityType,
	isLocalEditableTask,
	type Milestone,
	type SearchFilters,
	type Task,
	type TaskComment,
	type TaskCommentInput,
	type TaskCreateInput,
	type TaskListFilter,
	type TaskUpdateInput,
} from "../types/index.ts";
import {
	ADR_KIND,
	assertAdrAcceptableFields,
	assertAdrStatusValue,
	assertAdrTransition,
	isAdr,
	isApplicableDecision,
	isDecisionIdReference,
	isRetiredAdr,
	isRetiredAdrStatus,
	scopeCoverageGaps,
} from "../utils/adr.ts";
import { normalizeAssignee } from "../utils/assignee.ts";
import { decisionIdKey, decisionIdsEqual, findDecisionById } from "../utils/decision-id.ts";
import { documentIdKey, documentIdsEqual, findDocumentById, normalizeDocumentId } from "../utils/document-id.ts";
import {
	getDocumentSubPathFromRelativePath,
	normalizeDocumentRelativePath,
	normalizeDocumentSubPath,
} from "../utils/document-path.ts";
import { normalizeDueDate } from "../utils/due-date.ts";
import {
	type ContentIdentityReport,
	type DraftIdentityFindings,
	detectContentIdentityIssues,
} from "../utils/duplicate-detection.ts";
import { openInEditor } from "../utils/editor.ts";
import { isAmbiguousIdError } from "../utils/entity-id.ts";
import { findBacklogRoot } from "../utils/find-backlog-root.ts";
import { generateNextDecisionId, generateNextDocId } from "../utils/id-generators.ts";
import { createMilestoneFilterValueResolver } from "../utils/milestone-filter.ts";
import {
	buildGlobPattern,
	buildIdRegex,
	generateNextId as generateNextPrefixedId,
	generateNextSubtaskId,
	getPrefixForType,
	normalizeId,
} from "../utils/prefix-config.ts";
import { formatValidPriorityValues, resolvePriorityValue } from "../utils/priority-config.ts";
import {
	formatValidProjectValues,
	getProjectValues,
	noProjectsConfiguredMessage,
	resolveProjectValue,
} from "../utils/project-config.ts";
import { resolveRuntimeCwd } from "../utils/runtime-cwd.ts";
import {
	getCanonicalStatus as resolveCanonicalStatus,
	getValidStatuses as resolveValidStatuses,
} from "../utils/status.ts";
import { executeStatusCallback } from "../utils/status-callback.ts";
import {
	buildDefinitionOfDoneItems,
	normalizeStringList,
	parseDelimitedStringList,
	stringArraysEqual,
	validateDependencies,
} from "../utils/task-builders.ts";
import { repointTaskLinks, withoutVacatedTaskLinks } from "../utils/task-links.ts";
import {
	AmbiguousTaskIdError,
	canonicalTaskId,
	extractDraftIdFromFilename,
	findDuplicateDraftFilenameGroups,
	getTaskPath,
	LOCAL_TASK_LOOKUP_HINT,
	normalizeTaskId,
	normalizeTaskIdentity,
	taskIdsEqual,
} from "../utils/task-path.ts";
import { applyTaskFilters, createTaskSearchIndex } from "../utils/task-search.ts";
import { sortByOrdinal } from "../utils/task-sorting.ts";
import { attachSubtaskSummaries } from "../utils/task-subtasks.ts";
import { formatValidTaskTypeValues, resolveTaskTypeValue } from "../utils/task-type-config.ts";
import { upsertTaskUpdatedDate } from "../utils/task-updated-date.ts";
import { getTerminalStatus, isTerminalStatus } from "../utils/terminal-status.ts";
import { migrateConfig, needsMigration } from "./config-migration.ts";
import { ContentStore, type TaskCorpusSnapshot } from "./content-store.ts";
import {
	buildDeletionPreview,
	type DeletionPreview,
	DeletionPreviewChangedError,
	type DeletionReferenceUpdate,
	type DeletionResolution,
	type DeletionScanTarget,
	displayDeletionPath,
	documentAbsolutePath,
	isDocumentIdReference,
	loadDeletionCorpus,
	scanDeletionReferences,
	validateDeletionResolution,
	validateDeletionResolutionForCorpus,
} from "./deletion-preview.ts";
import {
	applyDuplicateTaskIdRepair,
	type DuplicateRepairPlan,
	type DuplicateRepairResult,
	previewDuplicateTaskIdRepair,
} from "./duplicate-task-repair.ts";
import { migrateDraftPrefixes, needsDraftPrefixMigration } from "./prefix-migration.ts";
import {
	calculateBlockOrdinals,
	calculateNewOrdinal,
	DEFAULT_ORDINAL_STEP,
	resolveOrdinalConflicts,
} from "./reorder.ts";
import { SearchService } from "./search-service.ts";
import { TaskIdentityIndex, type TaskIdentityRecord } from "./task-identity-index.ts";
import {
	BranchTaskLoader,
	type BranchTaskStateEntry,
	getBranchHistoryCutoff,
	getTaskLoadingMessage,
} from "./task-loader.ts";

interface BlessedScreen {
	program: {
		disableMouse(): void;
		enableMouse(): void;
		hideCursor(): void;
		showCursor(): void;
		input: NodeJS.EventEmitter;
		pause?: () => (() => void) | undefined;
		flush?: () => void;
		put?: {
			keypad_local?: () => void;
			keypad_xmit?: () => void;
		};
	};
	leave(): void;
	enter(): void;
	render(): void;
	clearRegion(x1: number, x2: number, y1: number, y2: number): void;
	width: number;
	height: number;
	emit(event: string): void;
}

interface CreatedTaskWrite {
	filePath: string;
	createdContent: Buffer;
	previousPath: string | null;
	previousContent: Buffer | null;
	previousIndexEntries?: GitIndexEntry[];
	generatedIndexEntries?: GitIndexEntry[];
}

interface CreatedTaskRollbackResult {
	indexRestored: boolean;
	workingPathRestored: boolean;
}

const REMOTE_REF_REFRESH_INTERVAL_MS = 60_000;

interface TaskCorpusLoadOptions {
	progressCallback?: (msg: string) => void;
	abortSignal?: AbortSignal;
	includeCompleted?: boolean;
	visibleCompleted?: boolean;
	/** Set only by the ContentStore corpus loader, whose result becomes the shared cross-branch state. */
	publishSharedState?: boolean;
	/** Set by task ID allocation, which cannot trust the coalesced remote-refresh window. */
	forceRemoteRefresh?: boolean;
}

interface TaskQueryOptions {
	filters?: TaskListFilter;
	query?: string;
	limit?: number;
	includeCrossBranch?: boolean;
	refreshCrossBranch?: boolean;
}

interface TaskReadOptions {
	includeCrossBranch?: boolean;
	refreshCrossBranch?: boolean;
}

interface ActiveBranchSnapshot {
	branchTips: readonly GitBranchTip[];
	currentBranch: string;
	fingerprint: string;
	stabilityFingerprint: string;
	settingsKey: string;
}

export type TuiTaskEditFailureReason =
	| "not_found"
	| "read_only"
	| "editor_failed"
	| "identity_conflict"
	| "unreadable"
	| "ambiguous";

export interface TuiTaskEditResult {
	changed: boolean;
	task?: Task;
	reason?: TuiTaskEditFailureReason;
}

/** Sanitized copies of the records that referenced a task ID being vacated, by corpus. */
type VacatedIdCleanup = {
	active: Task[];
	completed: Task[];
};

/** Records whose structured documentation references a document being deleted, by store. */
interface DocumentReferenceCleanup {
	tasks: Task[];
	drafts: Task[];
}

export interface DocumentDeletionResult {
	id: string;
	title: string;
	/** Project-relative path of the removed file. */
	path: string;
	/** The reference edits that were applied alongside the deletion. */
	updates: DeletionReferenceUpdate[];
}

function vacatedIdCleanupTargets(cleanup: VacatedIdCleanup): Task[] {
	return [...cleanup.active, ...cleanup.completed];
}

function sanitizeVacatedTaskLinks(tasks: Task[], vacatedTaskId: string): Task[] {
	return tasks
		.map((task) => withoutVacatedTaskLinks(task, vacatedTaskId))
		.filter((task): task is Task => task !== null);
}

/** How many times a vacating operation re-takes its locks before giving up on a stable set. */
const VACATED_ID_CLEANUP_LOCK_ATTEMPTS = 5;

/**
 * Tag a failure that happened after the record had already been moved, so callers report the state
 * the project is actually in instead of an error that reads as "nothing happened" and invites a
 * retry of a mutation that already ran.
 */
function markRecordAlreadyMoved(
	error: unknown,
	state: "archiveState" | "demotionState" | "deletionState",
	demotionFailureCause?: "cleanup" | "commit",
): Error {
	const failure = error instanceof Error ? error : new Error(String(error));
	(failure as Error & Record<string, unknown>)[state] = "moved";
	if (state === "demotionState" && demotionFailureCause) {
		(failure as Error & Record<string, unknown>).demotionFailureCause = demotionFailureCause;
	}
	return failure;
}

/**
 * Outcome of an operation that vacates a task ID. `cleanedTaskIds` names the records that lost a
 * stored reference to it, so every surface can report the change instead of making it silently.
 */
export interface VacatedTaskResult {
	success: boolean;
	cleanedTaskIds: string[];
}

/** One record rewritten because it referenced the record an explicit delete removed. */
export interface DeletionSourceUpdate {
	id: string;
	/** Project-relative file that was rewritten. */
	path: string;
}

export interface DeletionExecutionResult {
	/** Project-relative file that was removed. */
	deletedPath: string;
	updatedSources: DeletionSourceUpdate[];
}

interface TaskEditResult {
	task: Task;
	cleanedTaskIds: string[];
}

function buildUpdatedDateComparableTask(task: Task): Record<string, unknown> {
	return {
		id: task.id,
		title: task.title,
		status: task.status,
		assignee: task.assignee ?? [],
		reporter: task.reporter,
		createdDate: task.createdDate,
		dueDate: task.dueDate,
		labels: task.labels ?? [],
		milestone: task.milestone,
		dependencies: task.dependencies ?? [],
		references: task.references ?? [],
		documentation: task.documentation ?? [],
		modifiedFiles: task.modifiedFiles ?? [],
		rawContent: task.rawContent ?? "",
		description: task.description,
		implementationPlan: task.implementationPlan,
		implementationNotes: task.implementationNotes,
		comments: task.comments ?? [],
		finalSummary: task.finalSummary,
		acceptanceCriteriaItems: task.acceptanceCriteriaItems ?? [],
		definitionOfDoneItems: task.definitionOfDoneItems ?? [],
		parentTaskId: task.parentTaskId,
		subtasks: task.subtasks ?? [],
		priority: task.priority,
		type: task.type,
		project: task.project,
		onStatusChange: task.onStatusChange,
	};
}

function hasUpdatedDateRelevantChanges(originalTask: Task | null, nextTask: Task): boolean {
	if (!originalTask) {
		return true;
	}

	return (
		JSON.stringify(buildUpdatedDateComparableTask(originalTask)) !==
		JSON.stringify(buildUpdatedDateComparableTask(nextTask))
	);
}

function normalizeDocumentTypeInput(type: unknown): DocumentType | undefined {
	if (type === undefined) {
		return undefined;
	}
	if (typeof type === "string" && (DOCUMENT_TYPE_VALUES as readonly string[]).includes(type)) {
		return type as DocumentType;
	}
	throw new Error(`Document type must be one of: ${DOCUMENT_TYPE_VALUES.join(", ")}.`);
}

function formatAvailableIndexHint(items: AcceptanceCriterion[], emptyMessage: string): string {
	if (items.length === 0) {
		return emptyMessage;
	}
	const indexes = items.map((item) => item.index).sort((a, b) => a - b);
	const first = indexes[0] ?? 1;
	const last = indexes[indexes.length - 1] ?? first;
	const range = first === last ? `#${first}` : `#${first}-#${last}`;
	return `Available indexes: ${range}.`;
}

/** Dependencies are validated against the working copy on both the create and the edit path. */
function formatMissingDependenciesError(invalid: string[]): Error {
	return new Error(
		`The following dependencies do not exist: ${invalid.join(", ")}. Please create these tasks first or verify the IDs. ${LOCAL_TASK_LOOKUP_HINT}`,
	);
}

/**
 * A board move rewrites the task file, so a task that belongs to another branch can only be moved
 * from that branch. Returns the reason to report, or null when the task is local and writable.
 */
function crossBranchMoveReason(task: Task, verb: "reordered" | "moved"): string | null {
	if (!task.branch) return null;
	return `Task ${task.id} exists in branch "${task.branch}" and cannot be ${verb} from the current branch. Switch to that branch to modify it.`;
}

/**
 * Normalize the milestone a board move targets. A named lane stores its trimmed name, while the
 * board's no-milestone lane arrives as null or a blank string and clears the field.
 */
function normalizeTargetMilestone(targetMilestone: string | null | undefined): string | undefined {
	if (typeof targetMilestone !== "string") return undefined;
	const trimmed = targetMilestone.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Structured-section input that contains its own sentinel marker as a whole
 * line is rejected before any write: wrapping it would nest markers and hide
 * the stored content from every reader (GitHub issue #932).
 */
function assertSectionInputsSafe(input: {
	description?: string;
	implementationPlan?: string;
	implementationNotes?: string;
	finalSummary?: string;
	appendImplementationPlan?: string[];
	appendImplementationNotes?: string[];
	appendFinalSummary?: string[];
}): void {
	assertSectionInputHasNoMarkerLines(input.description, "description");
	assertSectionInputHasNoMarkerLines(input.implementationPlan, "implementationPlan");
	assertSectionInputHasNoMarkerLines(input.implementationNotes, "implementationNotes");
	assertSectionInputHasNoMarkerLines(input.finalSummary, "finalSummary");
	for (const value of input.appendImplementationPlan ?? []) {
		assertSectionInputHasNoMarkerLines(value, "implementationPlan");
	}
	for (const value of input.appendImplementationNotes ?? []) {
		assertSectionInputHasNoMarkerLines(value, "implementationNotes");
	}
	for (const value of input.appendFinalSummary ?? []) {
		assertSectionInputHasNoMarkerLines(value, "finalSummary");
	}
}

export class TaskArchiveStatusError extends Error {
	constructor(taskId: string, terminalStatus: string) {
		super(
			`Task ${taskId} is ${terminalStatus}. Use Complete to move finished work to completed storage and preserve its links. Use: backlog task complete ${taskId}`,
		);
		this.name = "TaskArchiveStatusError";
	}
}

export class Core {
	public fs: FileSystem;
	public git: GitOperations;
	private contentStore?: ContentStore;
	private searchService?: SearchService;
	private readonly enableWatchers: boolean;
	private branchTaskLoader: BranchTaskLoader;
	private projectGeneration = 0;
	private activeBranchFingerprint: string | null = null;
	private activeBranchSnapshotPromise: {
		generation: number;
		settingsKey: string;
		promise: Promise<ActiveBranchSnapshot>;
	} | null = null;
	private activeBranchRefreshPromise: Promise<void> | null = null;
	private remoteRefRefreshPromise: Promise<void> | null = null;
	private lastRemoteRefRefreshAt = 0;

	constructor(projectRoot: string, options?: { enableWatchers?: boolean }) {
		this.fs = new FileSystem(projectRoot);
		this.git = new GitOperations(projectRoot, null, () => this.fs.loadConfig());
		this.branchTaskLoader = new BranchTaskLoader(this.git);
		// Disable watchers by default for CLI commands (non-interactive)
		// Interactive modes (TUI, browser, MCP) should explicitly pass enableWatchers: true
		this.enableWatchers = options?.enableWatchers ?? false;
		// Note: Config is loaded lazily when needed since constructor can't be async
	}

	private async buildTaskIdentityIndex(
		localTasks: Array<Task & { lastModified?: Date }>,
		completedTasks: Task[],
		branchRecords: BranchTaskStateEntry[],
		statuses: string[],
		resolutionStrategy: "most_recent" | "most_progressed",
		repositoryRoot?: string | null,
		filesystem = this.fs,
		git = this.git,
	): Promise<TaskIdentityIndex> {
		const records: TaskIdentityRecord[] = [];
		for (const task of localTasks) {
			records.push({
				id: task.id,
				type: "task",
				branch: "local",
				path: task.filePath ?? join(filesystem.tasksDir, task.id),
				lastModified: task.lastModified ?? (task.updatedDate ? new Date(task.updatedDate) : new Date(0)),
				task: { ...task, source: "local" },
				workingCopy: true,
			});
		}
		for (const task of completedTasks) {
			records.push({
				id: task.id,
				type: "completed",
				branch: "local",
				path: task.filePath ?? join(filesystem.completedDir, task.id),
				lastModified: task.lastModified ?? (task.updatedDate ? new Date(task.updatedDate) : new Date(0)),
				task: { ...task, source: "completed" },
				workingCopy: true,
			});
		}
		records.push(...branchRecords);

		return new TaskIdentityIndex(
			records,
			{
				repositoryRoot: repositoryRoot === undefined ? await git.getRepositoryRoot() : repositoryRoot,
				projectRoot: filesystem.rootDir,
				backlogDirectory: filesystem.backlogDirName,
			},
			statuses,
			resolutionStrategy,
		);
	}

	async withCreateLock<T>(fn: () => Promise<T>): Promise<T> {
		return await this.fs.withCreateLock(fn);
	}

	async previewDuplicateTaskIdRepair(options: { includeBranches?: boolean } = {}): Promise<DuplicateRepairPlan> {
		const storeAlreadyReady = this.contentStore?.isInitialized() ?? false;
		const store = await this.getContentStore();
		if (storeAlreadyReady) {
			if (options.includeBranches) await this.refreshTasksForTaskRead();
			else await store.refreshLocalTaskCorpus();
		}
		return await previewDuplicateTaskIdRepair(this, options, store.getTaskCorpusSnapshot());
	}

	async repairDuplicateTaskIds(expectedFingerprint: string): Promise<DuplicateRepairResult> {
		const result = await applyDuplicateTaskIdRepair(this, expectedFingerprint);
		if (this.contentStore) {
			await this.contentStore.refreshTasks();
		}
		return result;
	}

	/** Reports draft files whose numeric identities collide, whose frontmatter drifted from their filename, or that are unreadable. */
	async diagnoseDraftIdentity(): Promise<DraftIdentityFindings> {
		return this.fs.diagnoseDraftIdentity();
	}

	/** Reports document and decision files whose IDs collide or are missing, so lookups can fail closed. */
	async diagnoseContentIdentity(): Promise<ContentIdentityReport> {
		const unreadableDocuments: string[] = [];
		const unreadableDecisions: string[] = [];
		const [documents, decisions] = await Promise.all([
			this.fs.listDocuments(unreadableDocuments),
			this.fs.listDecisions(unreadableDecisions),
		]);
		// An empty collected path denotes the content directory itself, which the filesystem reports
		// when it could not be scanned at all.
		const locate = (directory: string, path: string) =>
			path ? `${this.fs.backlogDirName}/${directory}/${path}` : `${this.fs.backlogDirName}/${directory}`;
		const describe = (directory: string, item: { path?: string; title: string }) =>
			item.path ? locate(directory, item.path) : item.title;
		return {
			documents: detectContentIdentityIssues(
				documents.map((document) => ({ id: document.id, path: describe(DEFAULT_DIRECTORIES.DOCS, document) })),
				documentIdKey,
				unreadableDocuments.map((path) => locate(DEFAULT_DIRECTORIES.DOCS, path)),
			),
			decisions: detectContentIdentityIssues(
				decisions.map((decision) => ({ id: decision.id, path: describe(DEFAULT_DIRECTORIES.DECISIONS, decision) })),
				decisionIdKey,
				unreadableDecisions.map((path) => locate(DEFAULT_DIRECTORIES.DECISIONS, path)),
			),
		};
	}

	private async resolveCreateOrdinal(inputOrdinal: number | undefined, isDraft: boolean): Promise<number | undefined> {
		if (typeof inputOrdinal === "number") {
			return inputOrdinal;
		}
		if (isDraft) {
			return undefined;
		}

		const tasks = await this.fs.listTasks();
		const ordinals = tasks
			.map((task) => task.ordinal)
			.filter((ordinal): ordinal is number => typeof ordinal === "number" && Number.isFinite(ordinal));

		if (ordinals.length === 0) {
			return tasks.length === 0 ? DEFAULT_ORDINAL_STEP : undefined;
		}

		return Math.max(...ordinals) + DEFAULT_ORDINAL_STEP;
	}

	async getContentStore(progressCallback?: (message: string) => void): Promise<ContentStore> {
		while (true) {
			const generation = this.projectGeneration;
			const filesystem = this.fs;
			const backlogRoot = filesystem.backlogDir;
			let store = this.contentStore;
			if (!store) {
				// Use loadTasks as the task loader to include cross-branch tasks
				store = new ContentStore(
					filesystem,
					(callback, options) => this.loadContentStoreCorpus(callback, options),
					this.enableWatchers,
				);
				this.contentStore = store;
			}

			try {
				await store.ensureInitialized(progressCallback);
			} catch (error) {
				if (
					generation !== this.projectGeneration ||
					filesystem !== this.fs ||
					backlogRoot !== filesystem.backlogDir ||
					store !== this.contentStore
				) {
					continue;
				}
				throw error;
			}
			if (
				generation === this.projectGeneration &&
				filesystem === this.fs &&
				backlogRoot === filesystem.backlogDir &&
				store === this.contentStore
			) {
				return store;
			}
		}
	}

	async getSearchService(): Promise<SearchService> {
		while (true) {
			const generation = this.projectGeneration;
			const filesystem = this.fs;
			const backlogRoot = filesystem.backlogDir;
			const store = await this.getContentStore();
			if (
				generation !== this.projectGeneration ||
				filesystem !== this.fs ||
				backlogRoot !== filesystem.backlogDir ||
				store !== this.contentStore
			) {
				continue;
			}
			let searchService = this.searchService;
			if (!searchService) {
				searchService = new SearchService(store);
				this.searchService = searchService;
			}
			try {
				await searchService.ensureInitialized();
			} catch (error) {
				if (
					generation !== this.projectGeneration ||
					filesystem !== this.fs ||
					backlogRoot !== filesystem.backlogDir ||
					store !== this.contentStore ||
					searchService !== this.searchService
				) {
					continue;
				}
				throw error;
			}
			if (
				generation === this.projectGeneration &&
				filesystem === this.fs &&
				backlogRoot === filesystem.backlogDir &&
				store === this.contentStore &&
				searchService === this.searchService
			) {
				return searchService;
			}
		}
	}

	private async refreshCachedTasksForCrossBranchRead(
		includeCrossBranch: boolean,
		storeAlreadyExisted: boolean,
	): Promise<void> {
		const store = this.contentStore;
		if (!storeAlreadyExisted || !this.enableWatchers || !includeCrossBranch || !store) {
			return;
		}

		await this.refreshTasksForTaskRead();
	}

	private getActiveBranchSettings(config: BacklogConfig | null, filesystem = this.fs) {
		const activeBranchDays = config?.activeBranchDays ?? 30;
		const checkActiveBranches = config?.checkActiveBranches !== false;
		const filesystemOnly = config?.filesystemOnly === true;
		return {
			checkActiveBranches,
			activeBranchDays,
			branchHistoryCutoff:
				checkActiveBranches && !filesystemOnly ? (getBranchHistoryCutoff(activeBranchDays)?.getTime() ?? null) : null,
			remoteOperations: config?.remoteOperations !== false,
			filesystemOnly,
			taskPrefix: config?.prefixes?.task ?? "task",
			taskResolutionStrategy: config?.taskResolutionStrategy ?? "most_progressed",
			statuses: config?.statuses ?? DEFAULT_STATUSES,
			backlogDir: filesystem.backlogDirName,
		};
	}

	private async computeActiveBranchSnapshot(
		config: BacklogConfig | null,
		filesystem = this.fs,
		git = this.git,
	): Promise<ActiveBranchSnapshot> {
		const settings = {
			...this.getActiveBranchSettings(config, filesystem),
		};
		const settingsKey = JSON.stringify(settings);

		git.setConfig(config);
		if (!settings.checkActiveBranches || settings.filesystemOnly) {
			return {
				branchTips: [],
				currentBranch: "",
				fingerprint: settingsKey,
				stabilityFingerprint: settingsKey,
				settingsKey,
			};
		}

		const branchTips = Object.freeze(
			(await git.listRecentBranchTips(settings.activeBranchDays))
				.map((tip) => Object.freeze({ ...tip }))
				.sort(
					(left, right) =>
						left.name.localeCompare(right.name) ||
						left.commit.localeCompare(right.commit) ||
						Number(left.current) - Number(right.current),
				),
		);
		const markedCurrentBranch = branchTips.find((tip) => tip.current && !tip.name.startsWith("origin/"))?.name;
		const currentBranch = markedCurrentBranch ?? (await git.getCurrentBranch()).trim();
		const fingerprintTips = branchTips.map((tip) => (tip.current ? { ...tip, commit: "working-copy" } : tip));
		return {
			branchTips,
			currentBranch,
			fingerprint: JSON.stringify({ ...settings, currentBranch, branchTips: fingerprintTips }),
			stabilityFingerprint: JSON.stringify({ ...settings, currentBranch, branchTips }),
			settingsKey,
		};
	}

	private async getActiveBranchSnapshot(
		config?: BacklogConfig | null,
		generation = this.projectGeneration,
		filesystem = this.fs,
		git = this.git,
	): Promise<ActiveBranchSnapshot> {
		const loadedConfig = config === undefined ? await filesystem.loadConfig() : config;
		const settingsKey = JSON.stringify(this.getActiveBranchSettings(loadedConfig, filesystem));
		if (
			this.activeBranchSnapshotPromise?.generation !== generation ||
			this.activeBranchSnapshotPromise.settingsKey !== settingsKey
		) {
			const snapshotPromise = this.computeActiveBranchSnapshot(loadedConfig, filesystem, git);
			const pending = { generation, settingsKey, promise: snapshotPromise };
			this.activeBranchSnapshotPromise = pending;
			const clearSnapshotPromise = () => {
				if (this.activeBranchSnapshotPromise === pending) this.activeBranchSnapshotPromise = null;
			};
			void snapshotPromise.then(clearSnapshotPromise, clearSnapshotPromise);
		}
		return await this.activeBranchSnapshotPromise.promise;
	}

	private async refreshRemoteRefsForTaskRead(
		config: BacklogConfig | null,
		git = this.git,
		options?: { force?: boolean },
	): Promise<void> {
		if (git !== this.git) return;
		if (
			config?.checkActiveBranches === false ||
			config?.remoteOperations === false ||
			config?.filesystemOnly === true
		) {
			return;
		}
		// Reads may reuse a recent fetch, but task ID allocation may not: an ID that
		// looks free only because remote refs are up to a minute old is an ID another
		// clone has already published.
		const force = options?.force === true;
		if (!force && Date.now() - this.lastRemoteRefRefreshAt < REMOTE_REF_REFRESH_INTERVAL_MS) {
			return;
		}

		// A forced request must observe refs from a fetch that started after the request
		// arrived. Joining a refresh that was already in flight is not enough: it captured
		// remote state before this request, so a push landing while it runs stays invisible
		// and allocation can hand out an ID another clone already published. Waiting that
		// refresh out first leaves the slot empty, so the fetch joined below always starts
		// afterwards. A non-forced request keeps the plain join-or-start behavior.
		if (force && this.remoteRefRefreshPromise) {
			await this.remoteRefRefreshPromise;
			// The project may have been re-pointed while we waited: reinitializeProjectRoot
			// clears this slot and installs a new GitOperations. Starting a fetch for the old
			// project now would publish it into the new project's slot, where a new-project
			// read could join it and skip the refresh it actually needs.
			if (git !== this.git) return;
		}

		if (!this.remoteRefRefreshPromise) {
			const refreshPromise = (async () => {
				git.setConfig(config);
				try {
					await git.fetch();
				} catch (error) {
					console.error("Failed to refresh remote refs:", error);
				} finally {
					if (this.git === git) this.lastRemoteRefRefreshAt = Date.now();
				}
			})();
			this.remoteRefRefreshPromise = refreshPromise;
			const clearRefreshPromise = () => {
				if (this.remoteRefRefreshPromise === refreshPromise) this.remoteRefRefreshPromise = null;
			};
			void refreshPromise.then(clearRefreshPromise, clearRefreshPromise);
		}

		await this.remoteRefRefreshPromise;
	}

	/** Refresh the existing cross-branch store only when relevant config or refs changed. */
	async refreshTasksForTaskRead(): Promise<boolean> {
		while (true) {
			const generation = this.projectGeneration;
			const filesystem = this.fs;
			const git = this.git;
			const backlogRoot = filesystem.backlogDir;
			const projectChanged = () =>
				generation !== this.projectGeneration ||
				filesystem !== this.fs ||
				git !== this.git ||
				backlogRoot !== filesystem.backlogDir;
			const config = await filesystem.loadConfig();
			if (projectChanged()) continue;
			await this.refreshRemoteRefsForTaskRead(config, git);
			if (projectChanged()) continue;
			const snapshot = await this.getActiveBranchSnapshot(config, generation, filesystem, git);
			if (projectChanged()) continue;
			if (snapshot.fingerprint === this.activeBranchFingerprint) {
				const store = this.contentStore;
				if (store?.isInitialized()) await store.refreshLocalTaskCorpus();
				if (projectChanged()) continue;
				return false;
			}

			const joinedExistingRefresh = this.activeBranchRefreshPromise !== null;
			if (!this.activeBranchRefreshPromise) {
				const refreshExistingStore = this.contentStore !== undefined;
				const refreshPromise = (async () => {
					const store = await this.getContentStore();
					if (refreshExistingStore) await store.refreshTasks();
				})();
				this.activeBranchRefreshPromise = refreshPromise;
				const clearRefreshPromise = () => {
					if (this.activeBranchRefreshPromise === refreshPromise) {
						this.activeBranchRefreshPromise = null;
					}
				};
				void refreshPromise.then(clearRefreshPromise, clearRefreshPromise);
			}

			const refreshPromise = this.activeBranchRefreshPromise;
			await refreshPromise;
			if (projectChanged()) continue;
			if (joinedExistingRefresh && this.activeBranchFingerprint !== snapshot.fingerprint) continue;
			return true;
		}
	}

	private filterLocalEditableTasks(tasks: Task[]): Task[] {
		return tasks.filter(isLocalEditableTask);
	}

	private async requireCanonicalStatus(status: string): Promise<string> {
		const canonical = await resolveCanonicalStatus(status, this);
		if (canonical) {
			return canonical;
		}
		const validStatuses = await resolveValidStatuses(this);
		throw new Error(`Invalid status: ${status}. Valid statuses are: ${validStatuses.join(", ")}`);
	}

	private async normalizePriority(value: string | undefined): Promise<string | undefined> {
		if (value === undefined || value.trim() === "") {
			return undefined;
		}
		const config = await this.fs.loadConfig();
		const normalized = resolvePriorityValue(value, config);
		if (!normalized) {
			throw new Error(`Invalid priority: ${value}. Valid values are: ${formatValidPriorityValues(config)}`);
		}
		return normalized;
	}

	private async normalizeTaskType(value: string | undefined): Promise<string | undefined> {
		if (value === undefined || value === "") {
			return undefined;
		}
		const config = await this.fs.loadConfig();
		const canonical = resolveTaskTypeValue(value, config);
		if (!canonical) {
			throw new Error(`Invalid type: ${value}. Valid types are: ${formatValidTaskTypeValues(config)}`);
		}
		return canonical;
	}

	private async normalizeProject(value: string | undefined): Promise<string | undefined> {
		if (value === undefined || value === "") {
			return undefined;
		}
		const config = await this.fs.loadConfig();
		const configuredProjects = getProjectValues(config);
		if (configuredProjects.length === 0) {
			throw new Error(noProjectsConfiguredMessage(this.fs.configFilePath));
		}
		const canonical = resolveProjectValue(value, config);
		if (!canonical) {
			throw new Error(`Invalid project: ${value}. Valid projects are: ${formatValidProjectValues(config)}`);
		}
		return canonical;
	}

	/**
	 * Collect the records that name a task ID which archiving or demoting is about to vacate.
	 *
	 * Both operations free the numeric slot for the allocator, so a reference left behind stops
	 * meaning what it said: once the ID is handed to the next created task, the stale reference
	 * silently resolves to an unrelated task instead of failing closed. The scan covers the active
	 * working copy and the completed corpus, because a completed record is still read by the
	 * dependency graph. Drafts keep their references: they are not part of either corpus, and
	 * archive has never touched them.
	 */
	private async collectVacatedIdCleanup(vacatedTaskId: string): Promise<VacatedIdCleanup> {
		const [activeTasks, completedTasks] = await Promise.all([this.fs.listTasks(), this.fs.listCompletedTasks()]);
		const others = (tasks: Task[]) => tasks.filter((task) => !taskIdsEqual(task.id, vacatedTaskId));
		return {
			active: sanitizeVacatedTaskLinks(others(activeTasks), vacatedTaskId),
			completed: sanitizeVacatedTaskLinks(others(completedTasks), vacatedTaskId),
		};
	}

	/**
	 * Run a vacating operation while holding the record's lock and the lock of every task that
	 * references the ID it is about to free.
	 *
	 * The set cannot be known without reading the corpus, and a set read before the locks are held
	 * is only a guess: a dependent edited in that window would be rewritten from the pre-edit
	 * snapshot, losing that edit, and a task that started referencing the ID in that window would
	 * not be locked and would keep the reference the operation exists to remove. So the scan is
	 * repeated inside the locks, and a scan naming a task the held locks do not cover releases
	 * them and runs again over the wider set. Widening only ever adds tasks, and the locks are
	 * always taken through {@link FileSystem.withTaskLocks}, which sorts them, so retrying
	 * cannot deadlock against another operation. `run` therefore only ever sees a set that was
	 * read, and is locked, as one consistent state.
	 *
	 * What this does not close: a task that starts referencing the ID after that final in-lock
	 * scan cannot be locked, because it was not yet a dependent when the set was fixed, so it
	 * keeps its reference. Locking cannot close that on its own without a corpus-wide write lock,
	 * and vacating before the scan does not close it either: an archived ID still resolves as a
	 * dependency target by design, so the write that adds it is still accepted after the move.
	 * The stale reference that results is not silent - it renders as an unknown task ID until the
	 * allocator hands the number out again.
	 */
	private async withVacatedIdCleanup<T>(
		target: Pick<Task, "id" | "filePath">,
		vacatedTaskId: string,
		run: (cleanup: VacatedIdCleanup) => Promise<T>,
	): Promise<T> {
		let candidates = vacatedIdCleanupTargets(await this.collectVacatedIdCleanup(vacatedTaskId));

		for (let attempt = 0; attempt < VACATED_ID_CLEANUP_LOCK_ATTEMPTS; attempt++) {
			// Use the same identity relation as the corpus scan. In particular, a bare ID and the
			// configured-prefix spelling it resolves against must not cause pointless widening.
			const coversLock = (task: Task) => candidates.some((candidate) => taskIdsEqual(candidate.id, task.id));
			const outcome = await this.fs.withTaskLocks(
				[target, ...candidates],
				async (): Promise<{ value: T } | { widened: Task[] }> => {
					const cleanup = await this.collectVacatedIdCleanup(vacatedTaskId);
					const targets = vacatedIdCleanupTargets(cleanup);
					if (targets.some((task) => !coversLock(task))) {
						return { widened: targets };
					}
					return { value: await run(cleanup) };
				},
			);
			if ("value" in outcome) return outcome.value;
			candidates = outcome.widened;
		}

		throw new Error(
			`Could not take a stable set of task locks to clean references to ${vacatedTaskId}. Retry once the tasks referencing it stop changing.`,
		);
	}

	/**
	 * Write the sanitized records. Callers hold the task locks for every one of them, taken with
	 * the operation's own lock so the mutation is one span.
	 *
	 * Every record is written to the path it was selected from, never through {@link updateTask}:
	 * that path re-resolves the record by ID, which throws on a contested identity and would fail
	 * the cleanup after the target had already been vacated. The scan already chose the exact files,
	 * and a completed record must not go through {@link updateTask} anyway - it would not be found
	 * in the active corpus and the write would look like a brand-new task whose status just changed.
	 */
	private async writeVacatedIdCleanup(cleanup: VacatedIdCleanup): Promise<{
		cleanedTaskIds: string[];
		filePaths: string[];
	}> {
		const filePaths: string[] = [];
		const updatedDate = new Date().toISOString().slice(0, 16).replace("T", " ");
		const writeAll = async () => {
			for (const task of cleanup.active) {
				const updated = { ...task, updatedDate };
				const savedPath = await this.fs.saveTask(updated);
				filePaths.push(savedPath);
				this.contentStore?.upsertTask({ ...updated, filePath: savedPath });
			}
			for (const task of cleanup.completed) {
				const updated = { ...task, updatedDate };
				const savedPath = await this.fs.saveTask(updated);
				filePaths.push(savedPath);
				// The record stays completed, with the reference gone. Refresh exactly this file in any
				// in-process ContentStore: a record elsewhere claiming the same ID is a conflict this
				// cleanup has no business dissolving.
				this.contentStore?.refreshCompletedTask({ ...updated, filePath: savedPath });
			}
		};
		// One notification for the whole cleanup, as the bulk writer does for a batch of edits.
		if (this.contentStore) await this.contentStore.batchTaskUpdates(writeAll);
		else await writeAll();
		return { cleanedTaskIds: vacatedIdCleanupTargets(cleanup).map((task) => task.id), filePaths };
	}

	async queryTasks(options: TaskQueryOptions = {}): Promise<Task[]> {
		while (true) {
			const generation = this.projectGeneration;
			const filesystem = this.fs;
			const backlogRoot = filesystem.backlogDir;
			const projectChanged = () =>
				generation !== this.projectGeneration || filesystem !== this.fs || backlogRoot !== filesystem.backlogDir;
			const { filters, query, limit } = options;
			const trimmedQuery = query?.trim();
			const includeCrossBranch = options.includeCrossBranch ?? true;
			const milestoneResolverPromise = filters?.milestone
				? Promise.all([filesystem.listMilestones(), filesystem.listArchivedMilestones()]).then(
						([activeMilestones, archivedMilestones]) =>
							createMilestoneFilterValueResolver([...activeMilestones, ...archivedMilestones]),
					)
				: undefined;

			const applyFiltersAndLimit = async (collection: Task[]): Promise<Task[]> => {
				const resolveMilestoneLabel = milestoneResolverPromise ? await milestoneResolverPromise : undefined;
				let filtered = filters ? applyTaskFilters(collection, { ...filters, resolveMilestoneLabel }) : [...collection];
				if (!includeCrossBranch) {
					filtered = this.filterLocalEditableTasks(filtered);
				}
				if (typeof limit === "number" && limit >= 0) {
					return filtered.slice(0, limit);
				}
				return filtered;
			};

			if (!includeCrossBranch) {
				const localTasks = await filesystem.listTasks();
				if (projectChanged()) continue;
				const tasks = trimmedQuery ? createTaskSearchIndex(localTasks).search({ query: trimmedQuery }) : localTasks;
				const filteredTasks = await applyFiltersAndLimit(tasks);
				if (projectChanged()) continue;
				return filteredTasks;
			}

			const storeAlreadyReady = this.contentStore?.isInitialized() ?? false;
			const store = await this.getContentStore();
			if (projectChanged() || store !== this.contentStore) continue;
			await this.refreshCachedTasksForCrossBranchRead(
				includeCrossBranch,
				storeAlreadyReady && options.refreshCrossBranch !== false,
			);
			if (projectChanged() || store !== this.contentStore) continue;

			if (!trimmedQuery) {
				const filteredTasks = await applyFiltersAndLimit(store.getTasks());
				if (projectChanged() || store !== this.contentStore) continue;
				return filteredTasks;
			}

			const searchService = await this.getSearchService();
			if (projectChanged() || store !== this.contentStore) continue;
			const searchFilters: SearchFilters = {};
			if (filters?.status) {
				searchFilters.status = filters.status;
			}
			if (filters?.excludeStatus) {
				searchFilters.excludeStatus = filters.excludeStatus;
			}
			if (filters?.type) {
				searchFilters.type = filters.type;
			}
			if (filters?.project) {
				searchFilters.project = filters.project;
			}
			if (filters?.priority) {
				searchFilters.priority = filters.priority;
			}
			if (filters?.assignee) {
				searchFilters.assignee = filters.assignee;
			}
			if (filters?.labels) {
				searchFilters.labels = filters.labels;
				searchFilters.labelMatch = filters.labelMatch;
			}

			const searchResults = searchService.search({
				query: trimmedQuery,
				limit,
				types: ["task"],
				filters: Object.keys(searchFilters).length > 0 ? searchFilters : undefined,
			});

			const seen = new Set<string>();
			const tasks: Task[] = [];
			for (const result of searchResults) {
				if (result.type !== "task") continue;
				const task = result.task;
				if (seen.has(task.id)) continue;
				seen.add(task.id);
				tasks.push(task);
			}

			const filteredTasks = await applyFiltersAndLimit(tasks);
			if (projectChanged() || store !== this.contentStore) continue;
			return filteredTasks;
		}
	}

	async getTask(taskId: string, options: TaskReadOptions = {}): Promise<Task | null> {
		while (true) {
			const generation = this.projectGeneration;
			const filesystem = this.fs;
			const backlogRoot = filesystem.backlogDir;
			const projectChanged = () =>
				generation !== this.projectGeneration || filesystem !== this.fs || backlogRoot !== filesystem.backlogDir;
			const storeAlreadyReady = this.contentStore?.isInitialized() ?? false;
			const store = await this.getContentStore();
			if (projectChanged() || store !== this.contentStore) continue;
			if (storeAlreadyReady && options.refreshCrossBranch !== false) {
				await this.refreshTasksForTaskRead();
			}
			if (projectChanged() || store !== this.contentStore) continue;
			const identityResolution = store.resolveTaskForRead(taskId);
			if (identityResolution.status === "ambiguous") {
				throw new AmbiguousTaskIdError(taskId, identityResolution.candidates);
			}
			if (identityResolution.status === "found") return identityResolution.task;
			// Diagnose a file skipped during loading without bypassing the identity index's result.
			try {
				await filesystem.loadTask(taskId);
			} catch (error) {
				if (projectChanged()) continue;
				throw error;
			}
			if (projectChanged()) continue;
			return null;
		}
	}

	async getTaskWithSubtasks(taskId: string, localTasks?: Task[], options: TaskReadOptions = {}): Promise<Task | null> {
		while (true) {
			const generation = this.projectGeneration;
			const filesystem = this.fs;
			const backlogRoot = filesystem.backlogDir;
			const task =
				options.includeCrossBranch === false
					? await this.loadWorkingCopyTask(taskId, false, localTasks)
					: await this.getTask(taskId, options);
			if (generation !== this.projectGeneration || filesystem !== this.fs || backlogRoot !== filesystem.backlogDir)
				continue;
			if (!task) return null;

			const tasks = localTasks ?? (await filesystem.listTasks());
			if (generation !== this.projectGeneration || filesystem !== this.fs || backlogRoot !== filesystem.backlogDir)
				continue;
			return attachSubtaskSummaries(task, tasks);
		}
	}

	async loadTaskById(taskId: string, options: TaskReadOptions = {}): Promise<Task | null> {
		return options.includeCrossBranch === false
			? await this.loadWorkingCopyTask(taskId, false)
			: await this.getTask(taskId, options);
	}

	private async buildWorkingCopyTaskIndex(activeTasks?: Task[]): Promise<TaskIdentityIndex> {
		let suppliedActiveTasks = activeTasks;
		while (true) {
			const filesystem = this.fs;
			const backlogRoot = filesystem.backlogDir;
			const [localTasks, completedTasks, config] = await Promise.all([
				suppliedActiveTasks ? Promise.resolve(suppliedActiveTasks) : filesystem.listTasks(),
				filesystem.listCompletedTasks(),
				filesystem.loadConfig(),
			]);
			if (this.fs !== filesystem || backlogRoot !== filesystem.backlogDir) {
				suppliedActiveTasks = undefined;
				continue;
			}
			const index = await this.buildTaskIdentityIndex(
				localTasks,
				completedTasks,
				[],
				config?.statuses ?? [...DEFAULT_STATUSES],
				config?.taskResolutionStrategy ?? "most_progressed",
				null,
				filesystem,
			);
			if (this.fs === filesystem && backlogRoot === filesystem.backlogDir) return index;
			suppliedActiveTasks = undefined;
		}
	}

	async loadWorkingCopyTasks(includeCompleted = false): Promise<Task[]> {
		return (await this.buildWorkingCopyTaskIndex()).getTasks(includeCompleted);
	}

	private async loadWorkingCopyTask(taskId: string, forMutation: boolean, activeTasks?: Task[]): Promise<Task | null> {
		const index = await this.buildWorkingCopyTaskIndex(activeTasks);
		const resolution = forMutation ? index.resolveForMutation(taskId) : index.resolveForRead(taskId);
		if (resolution.status === "ambiguous") throw new AmbiguousTaskIdError(taskId, resolution.candidates);
		if (resolution.status === "found") return { ...resolution.task };
		// Lists skip damaged files; an explicit lookup must still report why its task cannot load.
		await this.fs.loadTask(taskId);
		return null;
	}

	private async loadTaskForMutation(taskId: string, options: TaskReadOptions = {}): Promise<Task | null> {
		if (options.includeCrossBranch === false) {
			return await this.loadWorkingCopyTask(taskId, true);
		}
		const store = await this.getContentStore();
		await store.refreshTasks();
		const resolution = store.resolveTaskForMutation(taskId);
		if (resolution.status === "ambiguous") throw new AmbiguousTaskIdError(taskId, resolution.candidates);
		if (resolution.status === "found") return { ...resolution.task };
		await this.fs.loadTask(taskId);
		return null;
	}

	async getTaskContent(taskId: string): Promise<string | null> {
		const task = await this.fs.loadTask(taskId);
		const filePath = task?.filePath ?? null;
		if (!filePath) return null;
		return await Bun.file(filePath).text();
	}

	async getDocument(documentId: string): Promise<Document | null> {
		return findDocumentById(await this.fs.listDocuments(), documentId);
	}

	async getDocumentContent(documentId: string): Promise<string | null> {
		const document = await this.getDocument(documentId);
		if (!document) return null;

		const relativePath = normalizeDocumentRelativePath(document.path ?? `${document.id}.md`);
		const filePath = join(this.fs.docsDir, ...relativePath.split("/"));
		try {
			return await Bun.file(filePath).text();
		} catch {
			return null;
		}
	}

	async getDecisionContent(decisionId: string): Promise<string | null> {
		const decision = await this.fs.loadDecision(decisionId);
		if (!decision?.path) return null;

		const baseDir = decision.archived ? this.fs.archiveDecisionsDir : this.fs.decisionsDir;
		try {
			return await Bun.file(join(baseDir, decision.path)).text();
		} catch {
			return null;
		}
	}

	/**
	 * Re-point this Core instance to a different project root.
	 * Disposes caches and re-creates FileSystem / GitOperations.
	 */
	reinitializeProjectRoot(projectRoot: string): void {
		this.projectGeneration += 1;
		this.disposeSearchService();
		this.disposeContentStore();
		this.fs = new FileSystem(projectRoot);
		this.git = new GitOperations(projectRoot, null, () => this.fs.loadConfig());
		this.branchTaskLoader = new BranchTaskLoader(this.git);
	}

	disposeSearchService(): void {
		if (this.searchService) {
			this.searchService.dispose();
			this.searchService = undefined;
		}
	}

	disposeContentStore(): void {
		if (this.contentStore) {
			this.contentStore.dispose();
			this.contentStore = undefined;
		}
		this.activeBranchFingerprint = null;
		this.activeBranchSnapshotPromise = null;
		this.activeBranchRefreshPromise = null;
		this.remoteRefRefreshPromise = null;
		this.lastRemoteRefRefreshAt = 0;
	}

	// Backward compatibility aliases
	get filesystem() {
		return this.fs;
	}

	get gitOps() {
		return this.git;
	}

	async ensureConfigLoaded(): Promise<void> {
		try {
			const config = await this.fs.loadConfig();
			this.git.setConfig(config);
		} catch (error) {
			// A config value Backlog refuses to read is the user's to fix and must reach the command;
			// only the recoverable git-configuration failures this guard exists for are suppressed.
			if (isConfigValueError(error)) {
				throw error;
			}
			// Config loading failed, git operations will work with null config
			if (process.env.DEBUG) {
				console.warn("Failed to load config for git operations:", error);
			}
		}
	}

	private async getBacklogDirectoryName(): Promise<string> {
		return this.fs.backlogDirName;
	}

	async shouldAutoCommit(overrideValue?: boolean): Promise<boolean> {
		const config = await this.fs.loadConfig();
		this.git.setConfig(config);
		if (config?.filesystemOnly) {
			return false;
		}
		// If override is explicitly provided, use it
		if (overrideValue !== undefined) {
			return overrideValue;
		}
		// Otherwise, check config (default to false for safety)
		return config?.autoCommit ?? false;
	}

	async getGitOps() {
		await this.ensureConfigLoaded();
		return this.git;
	}

	// Config migration
	private parseLegacyInlineArray(value: string): string[] {
		const items: string[] = [];
		let current = "";
		let quote: '"' | "'" | null = null;

		const pushCurrent = () => {
			const normalized = current.trim().replace(/\\(['"])/g, "$1");
			if (normalized) {
				items.push(normalized);
			}
			current = "";
		};

		for (let i = 0; i < value.length; i += 1) {
			const ch = value[i];
			const prev = i > 0 ? value[i - 1] : "";
			if (quote) {
				if (ch === quote && prev !== "\\") {
					quote = null;
					continue;
				}
				current += ch;
				continue;
			}
			if (ch === '"' || ch === "'") {
				quote = ch;
				continue;
			}
			if (ch === ",") {
				pushCurrent();
				continue;
			}
			current += ch;
		}
		pushCurrent();
		return items;
	}

	private stripYamlComment(value: string): string {
		let quote: '"' | "'" | null = null;
		for (let i = 0; i < value.length; i += 1) {
			const ch = value[i];
			const prev = i > 0 ? value[i - 1] : "";
			if (quote) {
				if (ch === quote && prev !== "\\") {
					quote = null;
				}
				continue;
			}
			if (ch === '"' || ch === "'") {
				quote = ch;
				continue;
			}
			if (ch === "#") {
				return value.slice(0, i).trimEnd();
			}
		}
		return value;
	}

	private parseLegacyYamlValue(value: string): string {
		const trimmed = this.stripYamlComment(value).trim();
		const singleQuoted = trimmed.match(/^'(.*)'$/);
		if (singleQuoted?.[1] !== undefined) {
			return singleQuoted[1].replace(/''/g, "'");
		}
		const doubleQuoted = trimmed.match(/^"(.*)"$/);
		if (doubleQuoted?.[1] !== undefined) {
			return doubleQuoted[1].replace(/\\"/g, '"').replace(/\\'/g, "'");
		}
		return trimmed;
	}

	private async extractLegacyConfigMilestones(): Promise<string[]> {
		try {
			const configPath = this.fs.configFilePath;
			const content = await Bun.file(configPath).text();
			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i += 1) {
				const line = lines[i] ?? "";
				const match = line.match(/^(\s*)milestones\s*:\s*(.*)$/);
				if (!match) {
					continue;
				}

				const milestoneIndent = (match[1] ?? "").length;
				const trailing = this.stripYamlComment(match[2] ?? "").trim();
				if (trailing.startsWith("[")) {
					let combined = trailing;
					let closed = trailing.endsWith("]");
					let j = i + 1;
					while (!closed && j < lines.length) {
						const segment = this.stripYamlComment(lines[j] ?? "").trim();
						combined += segment;
						if (segment.includes("]")) {
							closed = true;
							break;
						}
						j += 1;
					}
					if (closed) {
						const openIndex = combined.indexOf("[");
						const closeIndex = combined.lastIndexOf("]");
						if (openIndex !== -1 && closeIndex > openIndex) {
							const parsed = this.parseLegacyInlineArray(combined.slice(openIndex + 1, closeIndex));
							return parsed.map((item) => this.parseLegacyYamlValue(item)).filter(Boolean);
						}
					}
				}
				if (trailing.length > 0) {
					const single = this.parseLegacyYamlValue(trailing);
					return single ? [single] : [];
				}

				const values: string[] = [];
				for (let j = i + 1; j < lines.length; j += 1) {
					const nextLine = lines[j] ?? "";
					if (!nextLine.trim()) {
						continue;
					}
					const nextIndent = nextLine.match(/^\s*/)?.[0].length ?? 0;
					if (nextIndent <= milestoneIndent) {
						break;
					}
					const trimmed = nextLine.trim();
					if (!trimmed.startsWith("-")) {
						continue;
					}
					const itemValue = this.parseLegacyYamlValue(trimmed.slice(1));
					if (itemValue) {
						values.push(itemValue);
					}
				}
				return values;
			}
			return [];
		} catch {
			return [];
		}
	}

	private async migrateLegacyConfigMilestonesToFiles(legacyMilestones: string[]): Promise<void> {
		if (legacyMilestones.length === 0) {
			return;
		}
		const existingMilestones = await this.fs.listMilestones();
		const existingKeys = new Set<string>();
		for (const milestone of existingMilestones) {
			const idKey = milestone.id.trim().toLowerCase();
			const titleKey = milestone.title.trim().toLowerCase();
			if (idKey) {
				existingKeys.add(idKey);
			}
			if (titleKey) {
				existingKeys.add(titleKey);
			}
		}
		for (const name of legacyMilestones) {
			const normalized = name.trim();
			const key = normalized.toLowerCase();
			if (!normalized || existingKeys.has(key)) {
				continue;
			}
			const created = await this.fs.createMilestone(normalized);
			const createdIdKey = created.id.trim().toLowerCase();
			const createdTitleKey = created.title.trim().toLowerCase();
			if (createdIdKey) {
				existingKeys.add(createdIdKey);
			}
			if (createdTitleKey) {
				existingKeys.add(createdTitleKey);
			}
		}
	}

	async ensureConfigMigrated(): Promise<void> {
		await this.ensureConfigLoaded();
		const legacyMilestones = await this.extractLegacyConfigMilestones();
		let config = await this.fs.loadConfig();
		const needsSchemaMigration = !config || needsMigration(config);

		if (needsSchemaMigration) {
			config = migrateConfig(config || {});
		}
		if (legacyMilestones.length > 0) {
			await this.migrateLegacyConfigMilestonesToFiles(legacyMilestones);
		}
		if (config && (needsSchemaMigration || legacyMilestones.length > 0)) {
			// Rewrite config to apply schema defaults and strip legacy milestones key after successful migration.
			await this.fs.saveConfig(config);
		}

		// Run draft prefix migration if needed (one-time migration)
		// This renames task-*.md files in drafts/ to draft-*.md
		if (needsDraftPrefixMigration(config)) {
			await migrateDraftPrefixes(this.fs);
		}
	}

	// ID generation
	/**
	 * Generates the next ID for a given entity type.
	 *
	 * @param type - The entity type (Task, Draft, Document, Decision). Defaults to Task.
	 * @param parent - Optional parent ID for subtask generation (only applicable for tasks).
	 * @returns The next available ID (e.g., "task-42", "draft-5", "doc-3")
	 *
	 * Folder scanning by type:
	 * - Task: /tasks, /completed, cross-branch (if enabled), remote (if enabled)
	 * - Draft: /drafts only
	 * - Document: /documents only
	 * - Decision: /decisions only
	 */
	async generateNextId(type: EntityType = EntityType.Task, parent?: string): Promise<string> {
		const config = await this.fs.loadConfig();
		const prefix = getPrefixForType(type, config ?? undefined);

		// Collect existing IDs based on entity type
		const allIds = await this.getExistingIdsForType(type);

		if (parent) {
			// Subtask generation (only applicable for tasks)
			const normalizedParent = allIds.find((id) => taskIdsEqual(parent, id)) ?? normalizeTaskId(parent);
			return generateNextSubtaskId(allIds, normalizedParent, prefix, config?.zeroPaddedIds);
		}

		return generateNextPrefixedId(allIds, prefix, config?.zeroPaddedIds);
	}

	/**
	 * Gets all task IDs that are in use (active or completed) across all branches.
	 * Respects cross-branch config settings. Archived IDs are excluded (can be reused).
	 *
	 * This is used for ID generation to determine the next available ID.
	 */
	private async loadWorktreeTaskStateEntries(taskPrefix: string): Promise<BranchTaskStateEntry[]> {
		const [repoRoot, worktreeRoots] = await Promise.all([this.git.getRepositoryRoot(), this.git.listWorktreePaths()]);
		if (!repoRoot || worktreeRoots.length === 0) {
			return [];
		}

		const projectRelativePath = relative(repoRoot, this.fs.rootDir);
		if (projectRelativePath.startsWith("..") || isAbsolute(projectRelativePath)) {
			return [];
		}

		const backlogDir = await this.getBacklogDirectoryName();
		const entries: BranchTaskStateEntry[] = [];
		for (const worktreeRoot of worktreeRoots) {
			const projectRoot = projectRelativePath ? join(worktreeRoot, projectRelativePath) : worktreeRoot;
			entries.push(...(await this.loadTaskStateEntriesFromWorktree(projectRoot, backlogDir, taskPrefix, worktreeRoot)));
		}

		return entries;
	}

	private async loadTaskStateEntriesFromWorktree(
		projectRoot: string,
		backlogDir: string,
		taskPrefix: string,
		worktreeRoot: string,
	): Promise<BranchTaskStateEntry[]> {
		const idRegex = buildIdRegex(taskPrefix);
		const globPattern = buildGlobPattern(taskPrefix.toLowerCase());
		const directories: Array<{ path: string; type: "task" | "completed" }> = [
			{ path: join(projectRoot, backlogDir, DEFAULT_DIRECTORIES.TASKS), type: "task" },
			{ path: join(projectRoot, backlogDir, DEFAULT_DIRECTORIES.COMPLETED), type: "completed" },
		];
		const entries: BranchTaskStateEntry[] = [];

		for (const { path, type } of directories) {
			let files: string[];
			try {
				files = await Array.fromAsync(new Bun.Glob(globPattern).scan({ cwd: path, followSymlinks: true }));
			} catch {
				continue;
			}

			for (const file of files) {
				const match = file.match(idRegex);
				if (!match?.[1]) continue;

				const filePath = join(path, file);
				const stats = await stat(filePath).catch(() => null);
				entries.push({
					id: normalizeId(match[1], taskPrefix),
					type,
					branch: `worktree:${worktreeRoot}`,
					path: filePath,
					lastModified: stats?.mtime ?? new Date(0),
				});
			}
		}

		return entries;
	}

	private async getActiveAndCompletedTaskIds(): Promise<string[]> {
		const snapshot = await this.loadTasksWithStableBranchSnapshot({
			includeCompleted: false,
			visibleCompleted: false,
			forceRemoteRefresh: true,
		});
		const completedTasks = snapshot.completedTasks;
		const config = snapshot.config;
		const taskPrefix = config?.prefixes?.task ?? "task";
		if (!snapshot.identityIndex) throw new Error("Task corpus identity index was not initialized");

		// Same-repository worktrees share the task ID namespace even before their
		// task files are committed, so include their filesystem state for allocation.
		const worktreeEntries = await this.loadWorktreeTaskStateEntries(taskPrefix);
		const occupiedIds = new Set(snapshot.identityIndex.getOccupiedIds());
		for (const task of completedTasks) occupiedIds.add(task.id);
		for (const entry of worktreeEntries) {
			if (entry.type === "task" || entry.type === "completed") occupiedIds.add(entry.id);
		}
		return [...occupiedIds];
	}

	/**
	 * Gets all existing IDs for a given entity type.
	 * Used internally by generateNextId to determine the next available ID.
	 *
	 * Note: Archived tasks are intentionally excluded - archived IDs can be reused.
	 * This makes archive act as a soft delete for ID purposes.
	 */
	private async getExistingIdsForType(type: EntityType): Promise<string[]> {
		switch (type) {
			case EntityType.Task: {
				// Get active + completed task IDs from all branches (respects config)
				// Archived IDs are excluded - they can be reused (soft delete behavior)
				return this.getActiveAndCompletedTaskIds();
			}
			case EntityType.Draft: {
				// Occupancy includes filename-derived ids: an unparsable file still reserves its
				// numeric id, so allocation can never reuse what it cannot parse.
				const [drafts, occupiedFileIds] = await Promise.all([this.fs.listDrafts(), this.fs.listOccupiedDraftFileIds()]);
				return [...drafts.map((d) => d.id), ...occupiedFileIds];
			}
			case EntityType.Document: {
				const documents = await this.fs.listDocuments();
				return documents.map((d) => d.id);
			}
			case EntityType.Decision: {
				const decisions = await this.fs.listDecisions();
				return decisions.map((d) => d.id);
			}
			default:
				return [];
		}
	}

	private async writePreparedTask(task: Task, isDraft: boolean): Promise<string> {
		if (isDraft) {
			task.status = "Draft";
			normalizeAssignee(task);
			return await this.fs.saveDraft(task);
		}

		normalizeAssignee(task);
		return await this.fs.saveTask(task);
	}

	private async finalizeCreatedTask(
		task: Task,
		filepath: string,
		isDraft: boolean,
		autoCommit: boolean,
		write?: CreatedTaskWrite,
	): Promise<Task | null> {
		const savedTask = isDraft ? await this.fs.loadDraft(task.id) : await this.fs.loadTask(task.id);

		if (!isDraft && this.contentStore && savedTask) {
			this.contentStore.upsertTask(savedTask);
		}

		if (autoCommit) {
			if (isDraft) {
				await this.git.addFile(filepath);
				if (write) write.generatedIndexEntries = await this.git.getIndexEntries(filepath);
				await this.git.commitTaskChange(task.id, `Create draft ${task.id}`, filepath);
			} else {
				await this.git.addAndCommitTaskFile(task.id, filepath, "create", (entries) => {
					if (write) write.generatedIndexEntries = entries;
				});
			}
		}

		return savedTask;
	}

	private async readFileIfPresent(filePath: string | null): Promise<Buffer | null> {
		if (!filePath) return null;
		try {
			return await readFile(filePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	}

	private async rollbackCreatedTask(write: CreatedTaskWrite): Promise<CreatedTaskRollbackResult> {
		let indexRestored = true;
		if (write.generatedIndexEntries) {
			indexRestored = await this.git.restoreIndexEntriesIfMatches(
				write.filePath,
				write.generatedIndexEntries,
				write.previousIndexEntries ?? [],
			);
		}

		const currentContent = await this.readFileIfPresent(write.filePath);
		const stillOwnsCreatedPath = currentContent?.equals(write.createdContent) ?? false;
		let workingPathRestored = false;
		if (currentContent === null) {
			if (write.previousPath === write.filePath && write.previousContent) {
				try {
					await writeFile(write.filePath, write.previousContent, { flag: "wx" });
					workingPathRestored = true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				}
			} else {
				workingPathRestored = true;
			}
		} else if (stillOwnsCreatedPath && indexRestored) {
			if (write.previousPath === write.filePath && write.previousContent) {
				await writeFile(write.filePath, write.previousContent);
			} else {
				await unlink(write.filePath);
			}
			workingPathRestored = true;
		}

		if (write.previousPath && write.previousPath !== write.filePath && write.previousContent) {
			const currentPreviousContent = await this.readFileIfPresent(write.previousPath);
			if (currentPreviousContent === null) {
				await writeFile(write.previousPath, write.previousContent);
			}
		}

		if (this.contentStore) {
			await this.contentStore.refreshTasks();
		}

		return { indexRestored, workingPathRestored };
	}

	async createTaskFromInput(input: TaskCreateInput, autoCommit?: boolean): Promise<{ task: Task; filePath?: string }> {
		if (!input.title || input.title.trim().length === 0) {
			throw new Error("Title is required to create a task.");
		}
		assertSectionInputsSafe(input);

		// Determine if this is a draft BEFORE generating the ID
		const requestedStatus = input.status?.trim();
		const isDraft = requestedStatus?.toLowerCase() === "draft";
		const requestedParentTaskId = input.parentTaskId?.trim();

		// Generate ID with appropriate entity type - drafts get DRAFT-X, tasks get TASK-X
		const entityType = isDraft ? EntityType.Draft : EntityType.Task;

		const normalizedLabels = normalizeStringList(input.labels) ?? [];
		const normalizedAssignees = normalizeStringList(input.assignee) ?? [];
		const normalizedDependencies = parseDelimitedStringList(input.dependencies) ?? [];
		const normalizedReferences = normalizeStringList(input.references) ?? [];
		const normalizedDocumentation = normalizeStringList(input.documentation) ?? [];
		const normalizedModifiedFiles = normalizeStringList(input.modifiedFiles) ?? [];
		const dueDate = normalizeDueDate(input.dueDate, "Due date");
		// A new record must not take a retired ADR as governing guidance (doc: ADR retrieval).
		await this.assertDocumentationLinksApplicable(normalizedDocumentation);

		let status = "";
		if (requestedStatus) {
			if (isDraft) {
				status = "Draft";
			} else {
				status = await this.requireCanonicalStatus(requestedStatus);
			}
		}

		const priority = await this.normalizePriority(input.priority);
		const type = await this.normalizeTaskType(input.type);
		const project = await this.normalizeProject(input.project);
		const createdDate = new Date().toISOString().slice(0, 16).replace("T", " ");
		if (
			input.ordinal !== undefined &&
			(typeof input.ordinal !== "number" || !Number.isFinite(input.ordinal) || input.ordinal < 0)
		) {
			throw new Error("Ordinal must be a non-negative number.");
		}

		const acceptanceCriteriaItems = Array.isArray(input.acceptanceCriteria)
			? input.acceptanceCriteria
					.map((criterion, index) => ({
						index: index + 1,
						text: String(criterion.text ?? "").trim(),
						checked: Boolean(criterion.checked),
					}))
					.filter((criterion) => criterion.text.length > 0)
			: [];
		const config = await this.fs.loadConfig();
		const definitionOfDoneItems = buildDefinitionOfDoneItems({
			defaults: config?.definitionOfDone,
			add: input.definitionOfDoneAdd,
			disableDefaults: input.disableDefinitionOfDoneDefaults,
		});
		const resolvedStatus = isDraft ? "Draft" : status || config?.defaultStatus || FALLBACK_STATUS;
		// An absent assignee means "no opinion" and takes the configured default; an explicit
		// assignee replaces it entirely, and an explicit empty list means "unassigned".
		const resolvedAssignees =
			input.assignee === undefined ? (normalizeStringList(config?.defaultAssignee) ?? []) : normalizedAssignees;
		const autoCommitEnabled = await this.shouldAutoCommit(autoCommit);

		const { task, write } = await this.withCreateLock(async () => {
			const parentTaskId = requestedParentTaskId
				? await this.resolveParentTaskIdForCreate(requestedParentTaskId)
				: undefined;
			const id = await this.generateNextId(entityType, isDraft ? undefined : parentTaskId);
			// Validated inside the create lock, against the allocated identity: a record can hold a
			// dangling dependency on exactly this not-yet-existing ID, so materializing it with a
			// dependency pointing back would store a cycle that no later edit could have created.
			const { valid: validDependencies, invalid: invalidDependencies } = await validateDependencies(
				normalizedDependencies,
				this,
				{
					id,
					title: input.title.trim(),
					status: resolvedStatus,
					assignee: [],
					createdDate,
					labels: [],
					dependencies: [],
				},
			);
			if (invalidDependencies.length > 0) {
				throw formatMissingDependenciesError(invalidDependencies);
			}
			const ordinal = await this.resolveCreateOrdinal(input.ordinal, isDraft);
			const task: Task = {
				id,
				title: input.title.trim(),
				status: resolvedStatus,
				assignee: resolvedAssignees,
				labels: normalizedLabels,
				dependencies: validDependencies,
				references: normalizedReferences,
				documentation: normalizedDocumentation,
				modifiedFiles: normalizedModifiedFiles,
				rawContent: input.rawContent ?? "",
				createdDate,
				...(dueDate && { dueDate }),
				...(parentTaskId && { parentTaskId }),
				...(priority && { priority }),
				...(type && { type }),
				...(project && { project }),
				...(typeof ordinal === "number" && { ordinal }),
				...(typeof input.milestone === "string" &&
					input.milestone.trim().length > 0 && {
						milestone: input.milestone.trim(),
					}),
				...(typeof input.description === "string" && { description: input.description }),
				...(typeof input.implementationPlan === "string" && { implementationPlan: input.implementationPlan }),
				...(typeof input.implementationNotes === "string" && { implementationNotes: input.implementationNotes }),
				...(typeof input.finalSummary === "string" && { finalSummary: input.finalSummary }),
				...(acceptanceCriteriaItems.length > 0 && { acceptanceCriteriaItems }),
				...(definitionOfDoneItems && definitionOfDoneItems.length > 0 && { definitionOfDoneItems }),
			};

			const resolvedPreviousPath = isDraft
				? await this.fs.resolveDraftFilePath(task.id)
				: await getTaskPath(task.id, this);
			const targetPath = await this.fs.getTaskWritePath(task, isDraft);
			const targetContent = await this.readFileIfPresent(targetPath);
			const previousPath = targetContent ? targetPath : resolvedPreviousPath;
			const previousContent = targetContent ?? (await this.readFileIfPresent(resolvedPreviousPath));
			const previousIndexEntries = autoCommitEnabled ? await this.git.getIndexEntries(targetPath) : undefined;
			const filePath = await this.writePreparedTask(task, isDraft);
			const createdContent = await readFile(filePath);
			const write: CreatedTaskWrite = {
				filePath,
				createdContent,
				previousPath,
				previousContent,
				previousIndexEntries,
			};
			return {
				task,
				write,
			};
		});

		try {
			const savedTask = await this.finalizeCreatedTask(task, write.filePath, isDraft, autoCommitEnabled, write);
			return { task: savedTask ?? task, filePath: write.filePath };
		} catch (error) {
			let rollback: CreatedTaskRollbackResult;
			try {
				rollback = await this.rollbackCreatedTask(write);
			} catch (rollbackError) {
				const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
				throw new Error(`Task creation failed and cleanup also failed: ${message}`, { cause: error });
			}
			if (!rollback.workingPathRestored || !rollback.indexRestored) {
				if (!rollback.indexRestored) {
					throw new Error(
						`Task creation failed, and Backlog no longer owned the staged entry for ${write.filePath}. The task file and staged Git state were preserved, ${task.id} remains in use, and manual Git review is required before retrying.`,
						{ cause: error },
					);
				}
				throw new Error(
					`Task creation failed, and cleanup could not safely remove the changed file at ${write.filePath}. Your changes were preserved. Review or remove the preserved file before retrying because ${task.id} remains in use.`,
					{ cause: error },
				);
			}
			throw error;
		}
	}

	/**
	 * Resolve `--parent` against the working copy, the same corpus the parent filter and task reads
	 * use, so one ID cannot be an acceptable parent for a child that no task command can then show.
	 */
	private async resolveParentTaskIdForCreate(parentTaskId: string): Promise<string> {
		const parentTask = await this.loadTaskById(parentTaskId, { includeCrossBranch: false });
		if (!parentTask) {
			const config = await this.fs.loadConfig();
			const canonicalParent = canonicalTaskId(parentTaskId, config?.prefixes?.task ?? "task");
			throw new Error(
				`Parent task ${canonicalParent} not found. ${LOCAL_TASK_LOOKUP_HINT} Use an existing task ID with --parent; use --milestone to assign a task to a milestone.`,
			);
		}
		return parentTask.id;
	}

	async createTask(task: Task, autoCommit?: boolean): Promise<string> {
		if (!task.status) {
			const config = await this.fs.loadConfig();
			task.status = config?.defaultStatus || FALLBACK_STATUS;
		}

		const autoCommitEnabled = await this.shouldAutoCommit(autoCommit);
		const filepath = await this.writePreparedTask(task, false);
		await this.finalizeCreatedTask(task, filepath, false, autoCommitEnabled);

		return filepath;
	}

	async updateTask(task: Task, autoCommit?: boolean): Promise<string> {
		normalizeAssignee(task);

		// Load original task to detect status changes for callbacks
		const cachedResolution = this.contentStore?.isInitialized()
			? this.contentStore.resolveTaskForMutation(task.id)
			: undefined;
		const originalTask = cachedResolution?.status === "found" ? cachedResolution.task : await this.fs.loadTask(task.id);
		const oldStatus = originalTask?.status ?? "";
		const newStatus = task.status ?? "";
		const statusChanged = oldStatus !== newStatus;

		if (hasUpdatedDateRelevantChanges(originalTask, task)) {
			task.updatedDate = new Date().toISOString().slice(0, 16).replace("T", " ");
		} else if (originalTask?.updatedDate) {
			task.updatedDate = originalTask.updatedDate;
		} else {
			delete task.updatedDate;
		}

		const filePath = await this.fs.saveTask(task);
		// Keep any in-process ContentStore in sync for immediate UI/search freshness.

		if (await this.shouldAutoCommit(autoCommit)) {
			await this.git.addAndCommitTaskFile(task.id, filePath, "update");
		}

		// Fire status change callback if status changed
		if (statusChanged) {
			await this.executeStatusChangeCallback(task, oldStatus, newStatus);
		}

		return filePath;
	}

	private async applyTaskUpdateInput(
		task: Task,
		input: TaskUpdateInput,
		statusResolver: (status: string) => Promise<string>,
	): Promise<{ task: Task; mutated: boolean }> {
		assertSectionInputsSafe(input);
		if (
			input.acceptanceCriteria !== undefined ||
			input.removeAcceptanceCriteria?.length ||
			input.checkAcceptanceCriteria?.length ||
			input.uncheckAcceptanceCriteria?.length
		) {
			assertValidChecklistMarks(task.rawContent ?? "", "AC");
		}
		if (
			input.removeDefinitionOfDone?.length ||
			input.checkDefinitionOfDone?.length ||
			input.uncheckDefinitionOfDone?.length
		) {
			assertValidChecklistMarks(task.rawContent ?? "", "DOD");
		}
		let mutated = false;

		const applyStringField = (
			value: string | undefined,
			current: string | undefined,
			assign: (next: string) => void,
		) => {
			if (typeof value === "string") {
				const next = value;
				if ((current ?? "") !== next) {
					assign(next);
					mutated = true;
				}
			}
		};

		if (input.title !== undefined) {
			const trimmed = input.title.trim();
			if (trimmed.length === 0) {
				throw new Error("Title cannot be empty.");
			}
			if (task.title !== trimmed) {
				task.title = trimmed;
				mutated = true;
			}
		}

		applyStringField(input.description, task.description, (next) => {
			task.description = next;
		});

		if (input.dueDate !== undefined) {
			const dueDate = input.dueDate === null ? undefined : normalizeDueDate(input.dueDate, "Due date");
			if (task.dueDate !== dueDate) {
				if (dueDate) task.dueDate = dueDate;
				else delete task.dueDate;
				mutated = true;
			}
		}

		if (input.status !== undefined) {
			const canonicalStatus = await statusResolver(input.status);
			if ((task.status ?? "") !== canonicalStatus) {
				task.status = canonicalStatus;
				mutated = true;
			}
		}

		if (input.priority !== undefined) {
			const normalizedPriority = await this.normalizePriority(String(input.priority));
			if (task.priority !== normalizedPriority) {
				task.priority = normalizedPriority;
				mutated = true;
			}
		}

		if (input.type !== undefined) {
			const normalizedType = await this.normalizeTaskType(String(input.type));
			if (task.type !== normalizedType) {
				task.type = normalizedType;
				mutated = true;
			}
		}

		if (input.project !== undefined) {
			const normalizedProject = input.project === null ? undefined : await this.normalizeProject(input.project);
			if ((task.project ?? undefined) !== normalizedProject) {
				if (normalizedProject === undefined) {
					delete task.project;
				} else {
					task.project = normalizedProject;
				}
				mutated = true;
			}
		}

		if (input.milestone !== undefined) {
			const normalizedMilestone =
				input.milestone === null ? undefined : input.milestone.trim().length > 0 ? input.milestone.trim() : undefined;
			if ((task.milestone ?? undefined) !== normalizedMilestone) {
				if (normalizedMilestone === undefined) {
					delete task.milestone;
				} else {
					task.milestone = normalizedMilestone;
				}
				mutated = true;
			}
		}

		if (input.ordinal !== undefined) {
			if (typeof input.ordinal !== "number" || !Number.isFinite(input.ordinal) || input.ordinal < 0) {
				throw new Error("Ordinal must be a non-negative number.");
			}
			if (task.ordinal !== input.ordinal) {
				task.ordinal = input.ordinal;
				mutated = true;
			}
		}

		if (input.assignee !== undefined) {
			const sanitizedAssignee = normalizeStringList(input.assignee) ?? [];
			if (!stringArraysEqual(sanitizedAssignee, task.assignee ?? [])) {
				task.assignee = sanitizedAssignee;
				mutated = true;
			}
		}

		const resolveLabelChanges = (): void => {
			let currentLabels = [...(task.labels ?? [])];
			if (input.labels !== undefined) {
				const sanitizedLabels = normalizeStringList(input.labels) ?? [];
				if (!stringArraysEqual(sanitizedLabels, currentLabels)) {
					task.labels = sanitizedLabels;
					mutated = true;
				}
				currentLabels = sanitizedLabels;
			}

			const labelsToAdd = normalizeStringList(input.addLabels) ?? [];
			if (labelsToAdd.length > 0) {
				const labelSet = new Set(currentLabels.map((label) => label.toLowerCase()));
				for (const label of labelsToAdd) {
					if (!labelSet.has(label.toLowerCase())) {
						currentLabels.push(label);
						labelSet.add(label.toLowerCase());
						mutated = true;
					}
				}
				task.labels = currentLabels;
			}

			const labelsToRemove = normalizeStringList(input.removeLabels) ?? [];
			if (labelsToRemove.length > 0) {
				const removalSet = new Set(labelsToRemove.map((label) => label.toLowerCase()));
				const filtered = currentLabels.filter((label) => !removalSet.has(label.toLowerCase()));
				if (!stringArraysEqual(filtered, currentLabels)) {
					task.labels = filtered;
					mutated = true;
				}
			}
		};

		resolveLabelChanges();

		const resolveDependencies = async (): Promise<void> => {
			let currentDependencies = [...(task.dependencies ?? [])];

			if (input.dependencies !== undefined) {
				const normalized = parseDelimitedStringList(input.dependencies) ?? [];
				const { valid, invalid } = await validateDependencies(normalized, this, task);
				if (invalid.length > 0) {
					throw formatMissingDependenciesError(invalid);
				}
				if (!stringArraysEqual(valid, currentDependencies)) {
					currentDependencies = valid;
					mutated = true;
				}
			}

			if (input.addDependencies && input.addDependencies.length > 0) {
				const additions = parseDelimitedStringList(input.addDependencies) ?? [];
				const { valid, invalid } = await validateDependencies(additions, this, task);
				if (invalid.length > 0) {
					throw formatMissingDependenciesError(invalid);
				}
				const depSet = new Set(currentDependencies);
				for (const dep of valid) {
					if (!depSet.has(dep)) {
						currentDependencies.push(dep);
						depSet.add(dep);
						mutated = true;
					}
				}
			}

			if (input.removeDependencies && input.removeDependencies.length > 0) {
				const removals = parseDelimitedStringList(input.removeDependencies) ?? [];
				const filtered = currentDependencies.filter((dep) => !removals.some((removal) => taskIdsEqual(removal, dep)));
				if (!stringArraysEqual(filtered, currentDependencies)) {
					currentDependencies = filtered;
					mutated = true;
				}
			}

			task.dependencies = currentDependencies;
		};

		await resolveDependencies();

		const resolveReferences = (): void => {
			let currentReferences = [...(task.references ?? [])];
			if (input.references !== undefined) {
				const sanitizedReferences = normalizeStringList(input.references) ?? [];
				if (!stringArraysEqual(sanitizedReferences, currentReferences)) {
					task.references = sanitizedReferences;
					mutated = true;
				}
				currentReferences = sanitizedReferences;
			}

			const referencesToAdd = normalizeStringList(input.addReferences) ?? [];
			if (referencesToAdd.length > 0) {
				const refSet = new Set(currentReferences);
				for (const ref of referencesToAdd) {
					if (!refSet.has(ref)) {
						currentReferences.push(ref);
						refSet.add(ref);
						mutated = true;
					}
				}
				task.references = currentReferences;
			}

			const referencesToRemove = normalizeStringList(input.removeReferences) ?? [];
			if (referencesToRemove.length > 0) {
				const removalSet = new Set(referencesToRemove);
				const filtered = currentReferences.filter((ref) => !removalSet.has(ref));
				if (!stringArraysEqual(filtered, currentReferences)) {
					task.references = filtered;
					mutated = true;
				}
			}
		};

		resolveReferences();

		const resolveDocumentation = (): void => {
			let currentDocumentation = [...(task.documentation ?? [])];
			if (input.documentation !== undefined) {
				const sanitizedDocumentation = normalizeStringList(input.documentation) ?? [];
				if (!stringArraysEqual(sanitizedDocumentation, currentDocumentation)) {
					task.documentation = sanitizedDocumentation;
					mutated = true;
				}
				currentDocumentation = sanitizedDocumentation;
			}

			const documentationToAdd = normalizeStringList(input.addDocumentation) ?? [];
			if (documentationToAdd.length > 0) {
				const docSet = new Set(currentDocumentation);
				for (const doc of documentationToAdd) {
					if (!docSet.has(doc)) {
						currentDocumentation.push(doc);
						docSet.add(doc);
						mutated = true;
					}
				}
				task.documentation = currentDocumentation;
			}

			const documentationToRemove = normalizeStringList(input.removeDocumentation) ?? [];
			if (documentationToRemove.length > 0) {
				const removalSet = new Set(documentationToRemove);
				const filtered = currentDocumentation.filter((doc) => !removalSet.has(doc));
				if (!stringArraysEqual(filtered, currentDocumentation)) {
					task.documentation = filtered;
					mutated = true;
				}
			}
		};

		resolveDocumentation();

		// Only edits that change the documentation set are validated: links that predate a
		// retirement are immutable historical citations, not new governing references.
		if (input.documentation !== undefined || input.addDocumentation?.length || input.removeDocumentation?.length) {
			await this.assertDocumentationLinksApplicable(task.documentation ?? []);
		}

		const resolveModifiedFiles = (): void => {
			if (input.modifiedFiles === undefined) {
				return;
			}
			const sanitizedModifiedFiles = normalizeStringList(input.modifiedFiles) ?? [];
			if (!stringArraysEqual(sanitizedModifiedFiles, task.modifiedFiles ?? [])) {
				task.modifiedFiles = sanitizedModifiedFiles;
				mutated = true;
			}
		};

		resolveModifiedFiles();

		const sanitizeAppendInput = (values: string[] | undefined): string[] => {
			if (!values) return [];
			return values.map((value) => String(value).trim()).filter((value) => value.length > 0);
		};

		const appendBlock = (
			existing: string | undefined,
			additions: string[] | undefined,
		): { value?: string; changed: boolean } => {
			const sanitizedAdditions = (additions ?? [])
				.map((value) => String(value).trim())
				.filter((value) => value.length > 0);
			if (sanitizedAdditions.length === 0) {
				return { value: existing, changed: false };
			}
			const current = (existing ?? "").trim();
			const additionBlock = sanitizedAdditions.join("\n\n");
			if (current.length === 0) {
				return { value: additionBlock, changed: true };
			}
			return { value: `${current}\n\n${additionBlock}`, changed: true };
		};

		const containsCommentMarker = (inputValue: string): boolean => /<!--\s*COMMENTS?:/i.test(inputValue);
		const containsCommentDelimiter = (inputValue: string): boolean =>
			/^\s*---\s*$/m.test(inputValue.replace(/\r\n/g, "\n"));

		const sanitizeCommentInput = (value: TaskCommentInput | string): TaskCommentInput | undefined => {
			const rawBody = typeof value === "string" ? value : value.body;
			const body = String(rawBody ?? "")
				.replace(/\r\n/g, "\n")
				.trim();
			if (body.length === 0) return undefined;
			if (containsCommentMarker(body)) {
				throw new Error("Comment body cannot contain Backlog comment markers.");
			}
			if (containsCommentDelimiter(body)) {
				throw new Error("Comment body cannot contain standalone '---' delimiter lines.");
			}
			const author =
				typeof value === "string"
					? undefined
					: String(value.author ?? "")
							.replace(/\s+/g, " ")
							.trim();
			const createdDate = typeof value === "string" ? undefined : String(value.createdDate ?? "").trim();
			if (author && containsCommentMarker(author)) {
				throw new Error("Comment author cannot contain Backlog comment markers.");
			}
			if (author && containsCommentDelimiter(author)) {
				throw new Error("Comment author cannot contain standalone '---' delimiter lines.");
			}
			if (createdDate && containsCommentMarker(createdDate)) {
				throw new Error("Comment created date cannot contain Backlog comment markers.");
			}
			if (createdDate && containsCommentDelimiter(createdDate)) {
				throw new Error("Comment created date cannot contain standalone '---' delimiter lines.");
			}
			return {
				body,
				...(author && { author }),
				...(createdDate && { createdDate }),
			};
		};

		if (input.clearImplementationPlan) {
			if (task.implementationPlan !== undefined) {
				delete task.implementationPlan;
				mutated = true;
			}
		}

		applyStringField(input.implementationPlan, task.implementationPlan, (next) => {
			task.implementationPlan = next;
		});

		const planAppends = sanitizeAppendInput(input.appendImplementationPlan);
		if (planAppends.length > 0) {
			const { value, changed } = appendBlock(task.implementationPlan, planAppends);
			if (changed) {
				task.implementationPlan = value;
				mutated = true;
			}
		}

		if (input.clearImplementationNotes) {
			if (task.implementationNotes !== undefined) {
				delete task.implementationNotes;
				mutated = true;
			}
		}

		applyStringField(input.implementationNotes, task.implementationNotes, (next) => {
			task.implementationNotes = next;
		});

		const notesAppends = sanitizeAppendInput(input.appendImplementationNotes);
		if (notesAppends.length > 0) {
			const { value, changed } = appendBlock(task.implementationNotes, notesAppends);
			if (changed) {
				task.implementationNotes = value;
				mutated = true;
			}
		}

		if (input.editComment && input.redactComment) {
			throw new Error(
				"Correct one comment per command: pass --edit-comment or --redact-comment with its own target, not both.",
			);
		}

		const copyComments = (comments: TaskComment[]): TaskComment[] =>
			comments.map((comment) => ({
				...comment,
				...(comment.history && { history: comment.history.map((entry) => ({ ...entry })) }),
			}));

		const requireCommentEditor = (editor: string, action: string): string => {
			const normalized = String(editor ?? "")
				.replace(/\s+/g, " ")
				.trim();
			if (!normalized) {
				throw new Error(
					`An editor name is required to ${action} a comment. Pass --comment-editor (for example @alex).`,
				);
			}
			if (containsCommentMarker(normalized)) {
				throw new Error("Comment editor cannot contain Backlog comment markers.");
			}
			if (containsCommentDelimiter(normalized)) {
				throw new Error("Comment editor cannot contain standalone '---' delimiter lines.");
			}
			return normalized;
		};

		if (input.editComment) {
			const currentComments = Array.isArray(task.comments) ? copyComments(task.comments) : [];
			const comment = CommentsManager.resolveTargetedComment(currentComments, input.editComment.target, {
				requireFingerprint: true,
			});
			if (CommentsManager.isRedacted(comment)) {
				throw new Error(
					`Comment #${comment.index} was redacted and cannot be edited; the redaction record stays in place.`,
				);
			}
			const sanitized = sanitizeCommentInput(input.editComment.body);
			if (!sanitized) {
				throw new Error("A corrected comment body cannot be empty.");
			}
			if (sanitized.body !== comment.body) {
				comment.history = [
					...(comment.history ?? []),
					{
						action: "edited",
						date: new Date().toISOString().slice(0, 16).replace("T", " "),
						editor: requireCommentEditor(input.editComment.editor, "correct"),
						body: comment.body,
					},
				];
				comment.body = sanitized.body;
				task.comments = currentComments;
				mutated = true;
			}
		}

		if (input.redactComment) {
			const currentComments = Array.isArray(task.comments) ? copyComments(task.comments) : [];
			const comment = CommentsManager.resolveTargetedComment(currentComments, input.redactComment.target, {
				requireFingerprint: true,
			});
			if (CommentsManager.isRedacted(comment)) {
				throw new Error(`Comment #${comment.index} is already redacted; its correction record is preserved as is.`);
			}
			const editor = requireCommentEditor(input.redactComment.editor, "redact");
			const date = new Date().toISOString().slice(0, 16).replace("T", " ");
			comment.history = [...(comment.history ?? []), { action: "redacted", date, editor }];
			comment.body = `[Redacted by ${editor} on ${date}.]`;
			task.comments = currentComments;
			mutated = true;
		}

		if (input.appendComments && input.appendComments.length > 0) {
			const currentComments = Array.isArray(task.comments) ? copyComments(task.comments) : [];
			let nextIndex = currentComments.length > 0 ? Math.max(...currentComments.map((comment) => comment.index)) + 1 : 1;
			const createdDate = new Date().toISOString().slice(0, 16).replace("T", " ");
			for (const value of input.appendComments) {
				const sanitized = sanitizeCommentInput(value);
				if (!sanitized) continue;
				currentComments.push({
					index: nextIndex++,
					body: sanitized.body,
					createdDate: sanitized.createdDate ?? createdDate,
					...(sanitized.author && { author: sanitized.author }),
				});
				mutated = true;
			}
			if (mutated) {
				task.comments = currentComments;
			}
		}

		if (input.clearFinalSummary) {
			if (task.finalSummary !== undefined) {
				task.finalSummary = "";
				mutated = true;
			}
		}

		applyStringField(input.finalSummary, task.finalSummary, (next) => {
			task.finalSummary = next;
		});

		const finalSummaryAppends = sanitizeAppendInput(input.appendFinalSummary);
		if (finalSummaryAppends.length > 0) {
			const { value, changed } = appendBlock(task.finalSummary, finalSummaryAppends);
			if (changed) {
				task.finalSummary = value;
				mutated = true;
			}
		}

		let acceptanceCriteria = Array.isArray(task.acceptanceCriteriaItems)
			? task.acceptanceCriteriaItems.map((criterion) => ({ ...criterion }))
			: [];

		const rebuildIndices = () => {
			acceptanceCriteria = acceptanceCriteria.map((criterion, index) => ({
				...criterion,
				index: index + 1,
			}));
		};

		if (input.acceptanceCriteria !== undefined) {
			const sanitized = input.acceptanceCriteria
				.map((criterion) => ({
					text: String(criterion.text ?? "").trim(),
					checked: Boolean(criterion.checked),
				}))
				.filter((criterion) => criterion.text.length > 0)
				.map((criterion, index) => ({
					index: index + 1,
					text: criterion.text,
					checked: criterion.checked,
				}));
			acceptanceCriteria = sanitized;
			mutated = true;
		}

		if (input.addAcceptanceCriteria && input.addAcceptanceCriteria.length > 0) {
			const additions = input.addAcceptanceCriteria
				.map((criterion) => (typeof criterion === "string" ? criterion.trim() : String(criterion.text ?? "").trim()))
				.filter((text) => text.length > 0);
			let index =
				acceptanceCriteria.length > 0 ? Math.max(...acceptanceCriteria.map((criterion) => criterion.index)) + 1 : 1;
			for (const text of additions) {
				acceptanceCriteria.push({ index: index++, text, checked: false });
				mutated = true;
			}
		}

		if (input.removeAcceptanceCriteria && input.removeAcceptanceCriteria.length > 0) {
			const removalSet = new Set(input.removeAcceptanceCriteria);
			const beforeLength = acceptanceCriteria.length;
			acceptanceCriteria = acceptanceCriteria.filter((criterion) => !removalSet.has(criterion.index));
			if (acceptanceCriteria.length === beforeLength) {
				throw new Error(
					`Acceptance criterion ${Array.from(removalSet)
						.map((index) => `#${index}`)
						.join(", ")} not found. ${formatAvailableIndexHint(
						acceptanceCriteria,
						"No acceptance criteria are defined.",
					)}`,
				);
			}
			mutated = true;
			rebuildIndices();
		}

		const toggleCriteria = (indices: number[] | undefined, checked: boolean) => {
			if (!indices || indices.length === 0) return;
			const missing: number[] = [];
			for (const index of indices) {
				const criterion = acceptanceCriteria.find((item) => item.index === index);
				if (!criterion) {
					missing.push(index);
					continue;
				}
				if (criterion.checked !== checked) {
					criterion.checked = checked;
					mutated = true;
				}
			}
			if (missing.length > 0) {
				const label = missing.map((index) => `#${index}`).join(", ");
				throw new Error(
					`Acceptance criterion ${label} not found. ${formatAvailableIndexHint(
						acceptanceCriteria,
						"No acceptance criteria are defined.",
					)}`,
				);
			}
		};

		toggleCriteria(input.checkAcceptanceCriteria, true);
		toggleCriteria(input.uncheckAcceptanceCriteria, false);

		task.acceptanceCriteriaItems = acceptanceCriteria;

		let definitionOfDone = Array.isArray(task.definitionOfDoneItems)
			? task.definitionOfDoneItems.map((criterion) => ({ ...criterion }))
			: [];

		const rebuildDefinitionIndices = () => {
			definitionOfDone = definitionOfDone.map((criterion, index) => ({
				...criterion,
				index: index + 1,
			}));
		};

		if (input.addDefinitionOfDone && input.addDefinitionOfDone.length > 0) {
			const additions = input.addDefinitionOfDone
				.map((criterion) => (typeof criterion === "string" ? criterion.trim() : String(criterion.text ?? "").trim()))
				.filter((text) => text.length > 0);
			let index =
				definitionOfDone.length > 0 ? Math.max(...definitionOfDone.map((criterion) => criterion.index)) + 1 : 1;
			for (const text of additions) {
				definitionOfDone.push({ index: index++, text, checked: false });
				mutated = true;
			}
		}

		const toggleDefinitionItems = (indices: number[] | undefined, checked: boolean) => {
			if (!indices || indices.length === 0) return;
			const missing: number[] = [];
			for (const index of indices) {
				const criterion = definitionOfDone.find((item) => item.index === index);
				if (!criterion) {
					missing.push(index);
					continue;
				}
				if (criterion.checked !== checked) {
					criterion.checked = checked;
					mutated = true;
				}
			}
			if (missing.length > 0) {
				const label = missing.map((index) => `#${index}`).join(", ");
				throw new Error(
					`Definition of Done item ${label} not found. ${formatAvailableIndexHint(
						definitionOfDone,
						"No Definition of Done items are defined.",
					)}`,
				);
			}
		};

		toggleDefinitionItems(input.checkDefinitionOfDone, true);
		toggleDefinitionItems(input.uncheckDefinitionOfDone, false);

		if (input.removeDefinitionOfDone && input.removeDefinitionOfDone.length > 0) {
			const removalSet = new Set(input.removeDefinitionOfDone);
			const beforeLength = definitionOfDone.length;
			definitionOfDone = definitionOfDone.filter((criterion) => !removalSet.has(criterion.index));
			if (definitionOfDone.length === beforeLength) {
				throw new Error(
					`Definition of Done item ${Array.from(removalSet)
						.map((index) => `#${index}`)
						.join(", ")} not found. ${formatAvailableIndexHint(
						definitionOfDone,
						"No Definition of Done items are defined.",
					)}`,
				);
			}
			mutated = true;
			rebuildDefinitionIndices();
		}

		task.definitionOfDoneItems = definitionOfDone;

		return { task, mutated };
	}

	async updateTaskFromInput(
		taskId: string,
		input: TaskUpdateInput,
		autoCommit?: boolean,
		options: TaskReadOptions = {},
	): Promise<Task> {
		const task = await this.loadTaskForMutation(taskId, options);
		if (!task) {
			throw new Error(`Task not found: ${taskId}`);
		}

		const requestedStatus = input.status?.trim().toLowerCase();
		if (requestedStatus === "draft") {
			// demoteTaskWithUpdates takes the task lock itself, so it must not be nested here.
			return (await this.demoteTaskWithUpdates(task, input, autoCommit, options)).task;
		}

		// Fail fast when another process is mid-edit, and re-read inside the lock so the whole
		// read-modify-write is protected. Locking only the write would still lose an update
		// whenever one writer releases before the next acquires: the second would then apply
		// its changes to a snapshot taken before the first wrote.
		return await this.fs.withTaskLock(task, async () => {
			const current = await this.loadTaskForMutation(taskId, options);
			if (!current) {
				throw new Error(`Task not found: ${taskId}`);
			}

			const { mutated } = await this.applyTaskUpdateInput(current, input, async (status) =>
				this.requireCanonicalStatus(status),
			);

			if (!mutated) {
				return current;
			}

			await this.updateTask(current, autoCommit);
			return current;
		});
	}

	async updateDraft(task: Task, autoCommit?: boolean): Promise<string> {
		// Drafts always keep status Draft
		task.status = "Draft";
		normalizeAssignee(task);
		task.updatedDate = new Date().toISOString().slice(0, 16).replace("T", " ");

		const previousPath = task.filePath;
		const filepath = await this.fs.saveDraft(task);

		if (await this.shouldAutoCommit(autoCommit)) {
			if (previousPath && previousPath !== filepath) {
				// A title rename moved the file: stage the deletion of the old path together with
				// the addition of the new one, mirroring how task moves stage their renames.
				const repoRoot = await this.git.stageFileMove(previousPath, filepath);
				await this.git.commitFiles(`Update draft ${task.id}`, [previousPath, filepath], repoRoot ?? undefined);
			} else {
				await this.git.addFile(filepath);
				await this.git.commitTaskChange(task.id, `Update draft ${task.id}`, filepath);
			}
		}

		return filepath;
	}

	async updateDraftFromInput(
		reference: DraftFileReference,
		input: TaskUpdateInput,
		autoCommit?: boolean,
	): Promise<Task> {
		// Same discipline as task edits: acquire the namespaced per-file lock before the
		// read-modify-write and re-read inside it, so a concurrent editor fails fast instead of
		// losing its update. The reference's own file is the only thing touched; no id is ever
		// re-resolved to a different path.
		return await this.fs.withDraftLock(reference, async () => {
			const current = await this.fs.draftReferenceFromPath(reference.filePath);
			// Bind the mutated record to the selected file's own identity: a padded filename whose
			// frontmatter carries an unpadded id must keep converging onto that one file instead of
			// minting a second spelling of the same numeric id.
			current.task.id = reference.canonicalId;

			const { mutated } = await this.applyTaskUpdateInput(current.task, input, async (status) => {
				if (status.trim().toLowerCase() !== "draft") {
					throw new Error("Drafts must use status Draft.");
				}
				return "Draft";
			});

			if (!mutated) {
				return current.task;
			}

			const savedPath = await this.updateDraft(current.task, autoCommit);
			const refreshed = await this.fs.draftReferenceFromPath(savedPath);
			return refreshed.task;
		});
	}

	async editTaskOrDraft(
		taskId: string,
		input: TaskUpdateInput,
		autoCommit?: boolean,
		options: TaskReadOptions = {},
	): Promise<TaskEditResult> {
		const resolvedDraft = await this.fs.resolveDraftReference(taskId);
		if (resolvedDraft) {
			const requestedStatus = input.status?.trim();
			const wantsDraft = requestedStatus?.toLowerCase() === "draft";
			if (requestedStatus && !wantsDraft) {
				return {
					task: await this.promoteDraftWithUpdates(resolvedDraft, input, autoCommit),
					cleanedTaskIds: [],
				};
			}
			return { task: await this.updateDraftFromInput(resolvedDraft, input, autoCommit), cleanedTaskIds: [] };
		}

		if (input.status?.trim().toLowerCase() === "draft") {
			const task = await this.loadTaskForMutation(taskId, options);
			if (!task) throw new Error(`Task not found: ${taskId}`);
			return await this.demoteTaskWithUpdates(task, input, autoCommit, options);
		}

		return { task: await this.updateTaskFromInput(taskId, input, autoCommit, options), cleanedTaskIds: [] };
	}

	private async promoteDraftWithUpdates(
		reference: DraftFileReference,
		input: TaskUpdateInput,
		autoCommit?: boolean,
	): Promise<Task> {
		const targetStatus = input.status?.trim();
		if (!targetStatus || targetStatus.toLowerCase() === "draft") {
			throw new Error("Promoting a draft requires a non-draft status.");
		}

		const canonicalStatus = await this.requireCanonicalStatus(targetStatus);

		// Same locked read-apply-promote discipline as edit/promote: hold the draft lock across
		// the whole span and re-read inside it, so a concurrent editor cannot be omitted from the
		// promoted task or left behind as a second record.
		return await this.fs.withDraftLock(reference, async () => {
			const current = await this.fs.draftReferenceFromPath(reference.filePath);
			const draft = current.task;
			draft.id = reference.canonicalId;

			const { mutated } = await this.applyTaskUpdateInput(draft, { ...input, status: undefined }, async (status) => {
				if (status.trim().toLowerCase() !== "draft") {
					throw new Error("Drafts must use status Draft.");
				}
				return "Draft";
			});

			const { promotedTask, savedPath } = await this.withCreateLock(async () => {
				const newTaskId = await this.generateNextId(EntityType.Task, draft.parentTaskId);
				// Same guard as creation: a stored dangling reference can name exactly this allocated
				// ID, so the record's dependencies are re-validated against its final identity. Only
				// the self/cycle guard matters here; stored entries that no longer resolve are legacy
				// defects doctor reports, so the stored list itself is written unchanged.
				await validateDependencies(draft.dependencies ?? [], this, { ...draft, id: newTaskId });
				const draftPath = current.filePath;

				const promotedTask: Task = {
					...draft,
					id: newTaskId,
					status: canonicalStatus,
					filePath: undefined,
					...(mutated || draft.status !== canonicalStatus
						? { updatedDate: new Date().toISOString().slice(0, 16).replace("T", " ") }
						: {}),
				};

				normalizeAssignee(promotedTask);
				const savedPath = await this.fs.saveTask(promotedTask);

				if (draftPath) {
					await unlink(draftPath);
				}

				return { promotedTask, savedPath };
			});

			const savedTask = await this.fs.loadTask(promotedTask.id);
			if (this.contentStore && savedTask) {
				this.contentStore.upsertTask(savedTask);
			}

			if (await this.shouldAutoCommit(autoCommit)) {
				await this.commitWrittenFile(
					`backlog: Promote draft ${normalizeId(reference.canonicalId, "draft")}`,
					[reference.filePath],
					savedPath,
				);
			}

			return savedTask ?? { ...promotedTask, filePath: savedPath };
		});
	}

	// Demotion is a read-modify-write of the task file too, reached from both updateTaskFromInput
	// and editTaskOrDraft, so it takes the task lock here rather than at each caller. Waiting on
	// the create lock below happens while the task lock is held; the order is always task lock
	// then create lock, never the reverse, so the two cannot deadlock.
	private async demoteTaskWithUpdates(
		task: Task,
		input: TaskUpdateInput,
		autoCommit?: boolean,
		options: TaskReadOptions = {},
	): Promise<TaskEditResult> {
		// Editing a task into the Draft status vacates its ID just as `task demote` does, so it
		// runs the same cleanup rather than leaving dependents pointing at the freed ID.
		return await this.withVacatedIdCleanup(task, task.id, async (cleanup) => {
			const current = await this.loadTaskForMutation(task.id, options);
			if (!current) {
				throw new Error(`Task not found: ${task.id}`);
			}

			const { mutated } = await this.applyTaskUpdateInput(current, { ...input, status: undefined }, async (status) => {
				if (status.trim().toLowerCase() === "draft") {
					return "Draft";
				}
				return this.requireCanonicalStatus(status);
			});

			// The record keeps its own links under the new draft identity, so a link naming the task
			// ID it is vacating would rebind to whatever task is allocated that ID next.
			const vacating = withoutVacatedTaskLinks(current, current.id) ?? current;

			const { demotedDraft, savedPath } = await this.withCreateLock(async () => {
				const newDraftId = await this.generateNextId(EntityType.Draft);
				// Mirrors promotion: the allocated draft ID can be named by a stored dangling
				// reference, so the demoted record must not materialize a cycle through it.
				await validateDependencies(vacating.dependencies ?? [], this, { ...vacating, id: newDraftId });
				const taskPath = current.filePath;

				const demotedDraft: Task = {
					...vacating,
					id: newDraftId,
					status: "Draft",
					filePath: undefined,
					...(mutated || current.status !== "Draft"
						? { updatedDate: new Date().toISOString().slice(0, 16).replace("T", " ") }
						: {}),
				};

				normalizeAssignee(demotedDraft);
				const savedPath = await this.fs.saveDraft(demotedDraft);

				if (taskPath) {
					await unlink(taskPath);
				}

				return { demotedDraft, savedPath };
			});

			// The draft is written and the task file is gone, so anything failing from here reports
			// the demotion as done, the way the dedicated demote command does.
			let cleanedTaskIds: string[] = [];
			let cleanedPaths: string[] = [];
			try {
				const written = await this.writeVacatedIdCleanup(cleanup);
				cleanedTaskIds = written.cleanedTaskIds;
				cleanedPaths = written.filePaths;
			} catch (error) {
				throw markRecordAlreadyMoved(error, "demotionState", "cleanup");
			}

			try {
				if (await this.shouldAutoCommit(autoCommit)) {
					const previousPaths = current.filePath ? [current.filePath] : [];
					await this.commitWrittenFile(
						`backlog: Demote task ${normalizeTaskId(current.id)}`,
						previousPaths,
						savedPath,
						cleanedPaths,
					);
				}
			} catch (error) {
				throw markRecordAlreadyMoved(error, "demotionState", "commit");
			}

			return {
				task: (await this.fs.loadDraft(demotedDraft.id)) ?? { ...demotedDraft, filePath: savedPath },
				cleanedTaskIds,
			};
		});
	}

	/**
	 * Execute the onStatusChange callback if configured.
	 * Per-task callback takes precedence over global config.
	 * Failures are logged but don't block the status change.
	 */
	private async executeStatusChangeCallback(task: Task, oldStatus: string, newStatus: string): Promise<void> {
		const config = await this.fs.loadConfig();

		// Per-task callback takes precedence over global config
		const callbackCommand = task.onStatusChange ?? config?.onStatusChange;
		if (!callbackCommand) {
			return;
		}

		try {
			const result = await executeStatusCallback({
				command: callbackCommand,
				taskId: task.id,
				oldStatus,
				newStatus,
				taskTitle: task.title,
				cwd: this.fs.rootDir,
			});

			if (!result.success) {
				console.error(`Status change callback failed for ${task.id}: ${result.error ?? "Unknown error"}`);
				if (result.output) {
					console.error(`Callback output: ${result.output}`);
				}
			} else if (process.env.DEBUG && result.output) {
				console.log(`Status change callback output for ${task.id}: ${result.output}`);
			}
		} catch (error) {
			console.error(`Failed to execute status change callback for ${task.id}:`, error);
		}
	}

	async editTask(
		taskId: string,
		input: TaskUpdateInput,
		autoCommit?: boolean,
		options: TaskReadOptions = {},
	): Promise<Task> {
		return await this.updateTaskFromInput(taskId, input, autoCommit, options);
	}

	private async writeTasksBulk(tasks: Task[]): Promise<string[]> {
		const filePaths: string[] = [];
		const updateAll = async () => {
			for (const task of tasks) {
				const filePath = await this.updateTask(task, false);
				filePaths.push(filePath);
				// Keep an in-process ContentStore serving what was just written: without this the
				// server, MCP and TUI keep reading the pre-write copy until a watcher refresh lands.
				this.contentStore?.upsertTask({ ...task, filePath });
			}
		};
		if (this.contentStore) await this.contentStore.batchTaskUpdates(updateAll);
		else await updateAll();
		return filePaths;
	}

	async updateTasksBulk(tasks: Task[], commitMessage?: string, autoCommit?: boolean): Promise<void> {
		const filePaths = await this.fs.withTaskLocks(tasks, async () => await this.writeTasksBulk(tasks));

		// Commit all changes at once if auto-commit is enabled
		if (await this.shouldAutoCommit(autoCommit)) {
			if (filePaths.length > 0) {
				await this.git.addFiles(filePaths);
				await this.git.commitFiles(commitMessage || `Update ${tasks.length} tasks`, filePaths);
			}
		}
	}

	/**
	 * Resolve the task ids of a board move against a freshly refreshed content store.
	 *
	 * Ids are trimmed and de-duplicated by normalized identity while keeping the caller's spelling so
	 * messages echo what was asked for. An identity that matches more than one file fails closed with
	 * the ambiguity error instead of picking a winner. An id the store does not know comes back as
	 * `task: null` with no error, because a gap means different things to different callers.
	 *
	 * The failure semantics stay with the callers on purpose: {@link reorderTask} raises the first
	 * problem and writes all or nothing, while {@link moveTasksToStatus} reports problems per task and
	 * moves the tasks that did resolve.
	 */
	private async resolveTasksForBoardMove(taskIds: readonly string[]): Promise<{
		store: ContentStore;
		resolutions: Array<{ taskId: string; task: Task | null; ambiguity: AmbiguousTaskIdError | null }>;
	}> {
		const requestedIds: string[] = [];
		const seen = new Set<string>();
		for (const rawId of taskIds) {
			const trimmed = String(rawId || "").trim();
			if (!trimmed) continue;
			// Canonical identity collapses cosmetic spellings such as leading zeros, so TASK-1 and
			// TASK-01 cannot both survive and write the same task twice.
			const key = canonicalTaskId(trimmed);
			if (seen.has(key)) continue;
			seen.add(key);
			requestedIds.push(trimmed);
		}

		const store = await this.getContentStore();
		await store.refreshTasks();

		const resolutions = requestedIds.map((taskId) => {
			const resolution = store.resolveTaskForMutation(normalizeTaskId(taskId));
			if (resolution.status === "ambiguous") {
				return { taskId, task: null, ambiguity: new AmbiguousTaskIdError(taskId, resolution.candidates) };
			}
			return { taskId, task: resolution.status === "found" ? resolution.task : null, ambiguity: null };
		});

		return { store, resolutions };
	}

	async reorderTask(params: {
		taskId: string;
		targetStatus: string;
		orderedTaskIds: string[];
		targetMilestone?: string | null;
		commitMessage?: string;
		autoCommit?: boolean;
		defaultStep?: number;
	}): Promise<{ updatedTask: Task; changedTasks: Task[] }> {
		const taskId = normalizeTaskId(String(params.taskId || "").trim());
		const targetStatus = String(params.targetStatus || "").trim();
		const orderedTaskIds = params.orderedTaskIds.map((id) => normalizeTaskId(String(id || "").trim())).filter(Boolean);
		const defaultStep = params.defaultStep ?? DEFAULT_ORDINAL_STEP;

		if (!taskId) throw new Error("taskId is required");
		if (!targetStatus) throw new Error("targetStatus is required");
		if (orderedTaskIds.length === 0) throw new Error("orderedTaskIds must include at least one task");
		if (!orderedTaskIds.includes(taskId)) {
			throw new Error("orderedTaskIds must include the task being moved");
		}

		// A repeated id means the caller sent a corrupt ordering, so reject it rather than let the
		// shared resolver quietly drop it and reorder the column into an order nobody asked for.
		const seen = new Set<string>();
		for (const id of orderedTaskIds) {
			if (seen.has(id)) {
				throw new Error(`Duplicate task id ${id} in orderedTaskIds`);
			}
			seen.add(id);
		}

		const { resolutions } = await this.resolveTasksForBoardMove(orderedTaskIds);
		for (const resolution of resolutions) {
			if (resolution.ambiguity) throw resolution.ambiguity;
		}

		// Tasks that couldn't be loaded (may have been moved/deleted) drop out of the ordering
		const validTasks = resolutions.map((resolution) => resolution.task).filter((t): t is Task => t !== null);

		// Verify the moved task itself exists
		const movedTask = validTasks.find((t) => t.id === taskId);
		if (!movedTask) {
			throw new Error(`Task ${taskId} not found while reordering`);
		}

		// Reject reordering tasks from other branches - they can only be modified in their source branch
		const crossBranchReason = crossBranchMoveReason(movedTask, "reordered");
		if (crossBranchReason) {
			throw new Error(crossBranchReason);
		}

		const hasTargetMilestone = params.targetMilestone !== undefined;
		const normalizedTargetMilestone = normalizeTargetMilestone(params.targetMilestone);

		// Calculate target index within the valid tasks list
		const validOrderedIds = orderedTaskIds.filter((id) => validTasks.some((t) => t.id === id));
		const targetIndex = validOrderedIds.indexOf(taskId);

		if (targetIndex === -1) {
			throw new Error("Implementation error: Task found in validTasks but index missing");
		}

		const previousTask = targetIndex > 0 ? validTasks[targetIndex - 1] : null;
		const nextTask = targetIndex < validTasks.length - 1 ? validTasks[targetIndex + 1] : null;

		const { ordinal: newOrdinal, requiresRebalance } = calculateNewOrdinal({
			previous: previousTask,
			next: nextTask,
			defaultStep,
		});

		const updatedMoved: Task = {
			...movedTask,
			status: targetStatus,
			...(hasTargetMilestone ? { milestone: normalizedTargetMilestone } : {}),
			ordinal: newOrdinal,
		};

		const tasksInOrder: Task[] = validTasks.map((task, index) => (index === targetIndex ? updatedMoved : task));
		const resolutionUpdates = resolveOrdinalConflicts(tasksInOrder, {
			defaultStep,
			startOrdinal: defaultStep,
			forceSequential: requiresRebalance,
		});

		const updatesMap = new Map<string, Task>();
		for (const update of resolutionUpdates) {
			updatesMap.set(update.id, update);
		}
		if (!updatesMap.has(updatedMoved.id)) {
			updatesMap.set(updatedMoved.id, updatedMoved);
		}

		const originalMap = new Map(validTasks.map((task) => [task.id, task]));
		const changedTasks = Array.from(updatesMap.values()).filter((task) => {
			const original = originalMap.get(task.id);
			if (!original) return true;
			return (
				(original.ordinal ?? null) !== (task.ordinal ?? null) ||
				(original.status ?? "") !== (task.status ?? "") ||
				(original.milestone ?? "") !== (task.milestone ?? "")
			);
		});

		if (changedTasks.length > 0) {
			await this.updateTasksBulk(
				changedTasks,
				params.commitMessage ?? `Reorder tasks in ${targetStatus}`,
				params.autoCommit,
			);
		}

		const updatedTask = updatesMap.get(taskId) ?? updatedMoved;
		return { updatedTask, changedTasks };
	}

	/**
	 * Move a set of tasks into a status column, reporting problems per task instead of aborting the
	 * batch. Without `orderedTaskIds` the moved tasks append to the end of the column. With it, the
	 * caller names the column's final order and the moved tasks land exactly there, seeded with
	 * block ordinals the way {@link reorderTask} places a single task.
	 */
	async moveTasksToStatus(params: {
		taskIds: string[];
		targetStatus: string;
		orderedTaskIds?: string[];
		targetMilestone?: string | null;
		commitMessage?: string;
		autoCommit?: boolean;
		defaultStep?: number;
	}): Promise<{ movedTasks: Task[]; changedTasks: Task[]; failures: Array<{ taskId: string; reason: string }> }> {
		const targetStatus = String(params.targetStatus || "").trim();
		if (!targetStatus) throw new Error("targetStatus is required");
		const defaultStep = params.defaultStep ?? DEFAULT_ORDINAL_STEP;

		const { store, resolutions } = await this.resolveTasksForBoardMove(params.taskIds);
		if (resolutions.length === 0) throw new Error("taskIds must include at least one task");

		const failures: Array<{ taskId: string; reason: string }> = [];
		const tasksToMove: Task[] = [];
		for (const { taskId, task, ambiguity } of resolutions) {
			if (ambiguity) {
				failures.push({ taskId, reason: ambiguity.message });
				continue;
			}
			if (!task) {
				failures.push({ taskId, reason: `Task ${taskId} not found.` });
				continue;
			}
			const crossBranchReason = crossBranchMoveReason(task, "moved");
			if (crossBranchReason) {
				failures.push({ taskId, reason: crossBranchReason });
				continue;
			}
			tasksToMove.push(task);
		}

		if (tasksToMove.length === 0) {
			return { movedTasks: [], changedTasks: [], failures };
		}

		// A drop into a milestone lane means the lane as much as the column, so the batch carries the
		// same milestone semantics as a single-task reorder: the field is only touched when the caller
		// names a lane, and the board's no-milestone lane clears it.
		const hasTargetMilestone = params.targetMilestone !== undefined;
		const normalizedTargetMilestone = normalizeTargetMilestone(params.targetMilestone);

		const movedIds = new Set(tasksToMove.map((task) => task.id));
		const applyMove = (task: Task): Task => ({
			...task,
			status: targetStatus,
			...(hasTargetMilestone ? { milestone: normalizedTargetMilestone } : {}),
		});

		let movedTasks: Task[];
		let changedTasks: Task[];

		if (params.orderedTaskIds) {
			// The caller names the target column's final order, so the moved tasks land exactly where
			// the board previewed them instead of appending to the end.
			const seenOrdered = new Set<string>();
			for (const id of params.orderedTaskIds) {
				const key = canonicalTaskId(id);
				if (seenOrdered.has(key)) throw new Error(`Duplicate task ID in orderedTaskIds: ${id}`);
				seenOrdered.add(key);
			}
			for (const task of tasksToMove) {
				if (!seenOrdered.has(canonicalTaskId(task.id))) {
					throw new Error("orderedTaskIds must include every task being moved");
				}
			}

			const movedByKey = new Map(tasksToMove.map((task) => [canonicalTaskId(task.id), task]));
			// A task that failed to resolve is not moving, so it keeps its place and stays out of the
			// target column's ordering.
			const failedKeys = new Set(failures.map((failure) => canonicalTaskId(failure.taskId)));
			const rows: Array<{ task: Task; moved: boolean }> = [];
			for (const id of params.orderedTaskIds) {
				const key = canonicalTaskId(id);
				if (failedKeys.has(key)) continue;
				const movedTask = movedByKey.get(key);
				if (movedTask) {
					rows.push({ task: movedTask, moved: true });
					continue;
				}
				const resolution = store.resolveTaskForMutation(key);
				if (resolution.status === "ambiguous") throw new AmbiguousTaskIdError(id, resolution.candidates);
				// Tasks that couldn't be loaded (may have been moved/deleted) drop out of the ordering
				if (resolution.status === "found") rows.push({ task: resolution.task, moved: false });
			}

			// Seed each run of moved tasks with block ordinals between its unmoved neighbors, exactly
			// as a single-task reorder seeds its midpoint, then let conflict resolution settle the rest.
			let requiresRebalance = false;
			const tasksInOrder: Task[] = [];
			for (let index = 0; index < rows.length; ) {
				const row = rows[index];
				if (!row) break;
				if (!row.moved) {
					tasksInOrder.push(row.task);
					index += 1;
					continue;
				}
				let runEnd = index;
				while (runEnd < rows.length && rows[runEnd]?.moved) runEnd += 1;
				const block = calculateBlockOrdinals({
					previous: index > 0 ? (rows[index - 1]?.task ?? null) : null,
					next: rows[runEnd]?.task ?? null,
					count: runEnd - index,
					defaultStep,
				});
				requiresRebalance = requiresRebalance || block.requiresRebalance;
				for (let offset = index; offset < runEnd; offset += 1) {
					const movedRow = rows[offset];
					if (!movedRow) continue;
					tasksInOrder.push({ ...applyMove(movedRow.task), ordinal: block.ordinals[offset - index] });
				}
				index = runEnd;
			}

			const resolutionUpdates = resolveOrdinalConflicts(tasksInOrder, {
				defaultStep,
				startOrdinal: defaultStep,
				forceSequential: requiresRebalance,
			});
			const updatesMap = new Map(tasksInOrder.map((task) => [task.id, task]));
			for (const update of resolutionUpdates) {
				updatesMap.set(update.id, update);
			}

			const originalMap = new Map([
				...rows.map(({ task }) => [task.id, task] as const),
				...tasksToMove.map((task) => [task.id, task] as const),
			]);
			movedTasks = tasksToMove.map((task) => updatesMap.get(task.id) ?? applyMove(task));
			changedTasks = Array.from(updatesMap.values()).filter((task) => {
				const original = originalMap.get(task.id);
				if (!original) return true;
				return (
					(original.status ?? "") !== (task.status ?? "") ||
					(original.ordinal ?? null) !== (task.ordinal ?? null) ||
					(original.milestone ?? "") !== (task.milestone ?? "")
				);
			});
		} else {
			// A task already in the target column is not moving, so it keeps its place and ordinal;
			// only a named lane still applies to it. Everything else appends after the column as
			// rendered.
			const stayingIds = new Set(tasksToMove.filter((task) => task.status === targetStatus).map((task) => task.id));
			const arriving = tasksToMove.filter((task) => !stayingIds.has(task.id));

			if (arriving.length === 0) {
				movedTasks = tasksToMove.map((task) => applyMove(task));
				changedTasks = movedTasks.filter((task, index) => {
					const original = tasksToMove[index];
					if (!original) return true;
					return original.status !== task.status || (original.milestone ?? "") !== (task.milestone ?? "");
				});
			} else {
				// Ordinal-less column tasks render after ordinal-bearing ones, so they get materialized
				// ordinals rather than letting the appended tasks slot in above them, and a non-finite
				// ordinal from a corrupt file counts as missing instead of poisoning the column.
				// A named lane scopes the ordering to that lane: a drop into Milestone A must not
				// renumber cards that only share the status in other lanes. Staying tasks remain in
				// scope regardless, because a named lane still has to be applied to them.
				const sanitizeOrdinal = (task: Task): Task =>
					task.ordinal === undefined || Number.isFinite(task.ordinal) ? task : { ...task, ordinal: undefined };
				const inTargetLane = (task: Task): boolean =>
					!hasTargetMilestone || (task.milestone?.trim() || "") === (normalizedTargetMilestone ?? "");
				const columnTasks = sortByOrdinal(
					store
						.getTasks({ status: targetStatus })
						.filter((task) => (stayingIds.has(task.id) ? true : !movedIds.has(task.id) && inTargetLane(task)))
						.map(sanitizeOrdinal),
				);
				const tasksInOrder: Task[] = [
					...columnTasks.map((task) => (stayingIds.has(task.id) ? applyMove(task) : task)),
					...arriving.map((task) => ({ ...applyMove(task), ordinal: undefined })),
				];
				const resolutionUpdates = resolveOrdinalConflicts(tasksInOrder, { defaultStep, startOrdinal: defaultStep });
				const updatesMap = new Map(tasksInOrder.map((task) => [task.id, task]));
				for (const update of resolutionUpdates) {
					updatesMap.set(update.id, update);
				}

				const originalMap = new Map([
					...store.getTasks({ status: targetStatus }).map((task) => [task.id, task] as const),
					...tasksToMove.map((task) => [task.id, task] as const),
				]);
				movedTasks = tasksToMove.map((task) => updatesMap.get(task.id) ?? applyMove(task));
				changedTasks = Array.from(updatesMap.values()).filter((task) => {
					const original = originalMap.get(task.id);
					if (!original) return true;
					return (
						(original.status ?? "") !== (task.status ?? "") ||
						(original.ordinal ?? null) !== (task.ordinal ?? null) ||
						(original.milestone ?? "") !== (task.milestone ?? "")
					);
				});
			}
		}

		// A cross-branch card can constrain the ordering, but writing it here would create a local
		// copy of a task the board treats as read-only. It keeps its file untouched on its own branch.
		changedTasks = changedTasks.filter((task) => !task.branch);

		if (changedTasks.length > 0) {
			await this.updateTasksBulk(
				changedTasks,
				params.commitMessage ?? `Move ${changedTasks.length} tasks to ${targetStatus}`,
				params.autoCommit,
			);
		}

		return { movedTasks, changedTasks, failures };
	}

	async archiveTask(taskId: string, autoCommit?: boolean, options: TaskReadOptions = {}): Promise<VacatedTaskResult> {
		const taskToArchive = await this.loadTaskForMutation(taskId, options);
		if (!taskToArchive) {
			return { success: false, cleanedTaskIds: [] };
		}
		const normalizedTaskId = taskToArchive.id;

		return await this.withVacatedIdCleanup(taskToArchive, normalizedTaskId, async (cleanup) => {
			// A concurrent edit may have finished the work before this lock was acquired.
			const current = await this.loadTaskForMutation(normalizedTaskId, options);
			if (!current) return { success: false, cleanedTaskIds: [] };
			const config = await this.fs.loadConfig();
			const statuses = config?.statuses ?? [...DEFAULT_STATUSES];
			if (isTerminalStatus(current.status, statuses)) {
				throw new TaskArchiveStatusError(current.id, getTerminalStatus(statuses) ?? "Done");
			}

			const taskPath = current.filePath ?? (await getTaskPath(normalizedTaskId, this));
			const taskFilename = taskPath ? basename(taskPath) : null;
			if (!taskPath || !taskFilename) return { success: false, cleanedTaskIds: [] };

			const fromPath = taskPath;
			const toPath = join(await this.fs.getArchiveTasksDir(), taskFilename);

			try {
				await mkdir(dirname(toPath), { recursive: true });
				await moveFile(fromPath, toPath);
			} catch {
				return { success: false, cleanedTaskIds: [] };
			}
			this.contentStore?.transitionTask(normalizedTaskId);

			// The file is in the archive from here on. A cleanup write or a commit that fails after
			// this point says so, rather than letting a caller retry an archive that already ran.
			try {
				const { cleanedTaskIds, filePaths } = await this.writeVacatedIdCleanup(cleanup);

				if (await this.shouldAutoCommit(autoCommit)) {
					// Stage the file move for proper Git tracking
					const repoRoot = await this.git.stageFileMove(fromPath, toPath);
					const commitPaths = [fromPath, toPath, ...filePaths];
					for (const cleanedPath of filePaths) {
						await this.git.addFile(cleanedPath);
					}
					await this.git.commitFiles(`backlog: Archive task ${normalizedTaskId}`, commitPaths, repoRoot);
				}

				return { success: true, cleanedTaskIds };
			} catch (error) {
				throw markRecordAlreadyMoved(error, "archiveState");
			}
		});
	}

	async archiveMilestone(
		identifier: string,
		autoCommit?: boolean,
	): Promise<{ success: boolean; sourcePath?: string; targetPath?: string; milestone?: Milestone }> {
		// Read the config before the move, so a config Backlog refuses to read aborts the command
		// while the milestone is still active rather than after it has been archived.
		const autoCommitEnabled = await this.shouldAutoCommit(autoCommit);
		const result = await this.fs.archiveMilestone(identifier);

		if (result.success && result.sourcePath && result.targetPath && autoCommitEnabled) {
			const repoRoot = await this.git.stageFileMove(result.sourcePath, result.targetPath);
			const label = result.milestone?.id ? ` ${result.milestone.id}` : "";
			const commitPaths = [result.sourcePath, result.targetPath];
			try {
				await this.git.commitFiles(`backlog: Archive milestone${label}`, commitPaths, repoRoot);
			} catch (error) {
				await this.git.resetPaths(commitPaths, repoRoot);
				try {
					await moveFile(result.targetPath, result.sourcePath);
				} catch {
					// Ignore rollback failure and propagate original commit error.
				}
				throw error;
			}
		}

		return {
			success: result.success,
			sourcePath: result.sourcePath,
			targetPath: result.targetPath,
			milestone: result.milestone,
		};
	}

	async renameMilestone(
		identifier: string,
		title: string,
		autoCommit?: boolean,
		dueDate?: string | null,
	): Promise<{
		success: boolean;
		sourcePath?: string;
		targetPath?: string;
		milestone?: Milestone;
		previousTitle?: string;
		previousDueDate?: string;
	}> {
		const result = await this.fs.renameMilestone(identifier, title, dueDate);
		if (!result.success) {
			return result;
		}

		if (result.sourcePath && result.targetPath && (await this.shouldAutoCommit(autoCommit))) {
			const repoRoot = await this.git.stageFileMove(result.sourcePath, result.targetPath);
			const label = result.milestone?.id ? ` ${result.milestone.id}` : "";
			const commitPaths = [result.sourcePath, result.targetPath];
			try {
				await this.git.commitFiles(`backlog: Rename milestone${label}`, commitPaths, repoRoot);
			} catch (error) {
				await this.git.resetPaths(commitPaths, repoRoot);
				const rollbackTitle = result.previousTitle ?? title;
				try {
					await this.fs.renameMilestone(
						result.milestone?.id ?? identifier,
						rollbackTitle,
						result.previousDueDate ?? null,
					);
				} catch {
					// Ignore rollback failure and propagate original commit error.
				}
				throw error;
			}
		}

		return result;
	}

	async editMilestoneDescription(
		identifier: string,
		description: string | null,
		autoCommit?: boolean,
	): Promise<{
		success: boolean;
		filepath?: string;
		milestone?: Milestone;
		previousDescription?: string;
	}> {
		const result = await this.fs.updateMilestoneDescription(identifier, description);
		if (!result.success) {
			return result;
		}

		if (result.filepath && (await this.shouldAutoCommit(autoCommit))) {
			const label = result.milestone?.id ? ` ${result.milestone.id}` : "";
			const commitPaths = [result.filepath];
			try {
				await this.git.addFile(result.filepath);
				await this.git.commitFiles(`backlog: Edit milestone description${label}`, commitPaths);
			} catch (error) {
				await this.git.resetPaths(commitPaths);
				try {
					await this.fs.updateMilestoneDescription(
						result.milestone?.id ?? identifier,
						result.previousDescription ?? null,
					);
				} catch {
					// Ignore rollback failure and propagate original commit error.
				}
				throw error;
			}
		}

		return result;
	}

	async completeTask(taskId: string, autoCommit?: boolean, options: TaskReadOptions = {}): Promise<boolean> {
		const task = await this.loadTaskForMutation(taskId, options);
		if (!task) return false;
		// Get paths before moving the file
		const completedDir = this.fs.completedDir;
		const taskPath = task.filePath ?? (await getTaskPath(task.id, this));
		const taskFilename = taskPath ? basename(taskPath) : null;

		if (!taskPath || !taskFilename) return false;

		const fromPath = taskPath;
		const toPath = join(completedDir, taskFilename);

		try {
			await mkdir(dirname(toPath), { recursive: true });
			await moveFile(fromPath, toPath);
		} catch {
			return false;
		}
		this.contentStore?.transitionTask(task.id, { ...task, filePath: toPath, source: "completed" });

		if (await this.shouldAutoCommit(autoCommit)) {
			// Stage the file move for proper Git tracking
			const repoRoot = await this.git.stageFileMove(fromPath, toPath);
			await this.git.commitFiles(`backlog: Complete task ${task.id}`, [fromPath, toPath], repoRoot);
		}

		return true;
	}

	async getTerminalStatusTasksByAge(olderThanDays: number): Promise<Task[]> {
		const tasks = await this.fs.listTasks();
		const config = await this.fs.loadConfig();
		const statuses = config?.statuses ?? [...DEFAULT_STATUSES];
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

		return tasks.filter((task) => {
			if (!isTerminalStatus(task.status, statuses)) return false;

			// Check updatedDate first, then createdDate as fallback
			const taskDate = task.updatedDate || task.createdDate;
			if (!taskDate) return false;

			const date = new Date(taskDate);
			return date < cutoffDate;
		});
	}

	async archiveDraft(draftId: string, autoCommit?: boolean): Promise<boolean> {
		// Read the config before the move: a config Backlog refuses to read must abort the command
		// while the draft is still where the user left it, not after it has been half-archived.
		const autoCommitEnabled = await this.shouldAutoCommit(autoCommit);
		const moved = await this.fs.archiveDraft(draftId);

		if (moved && autoCommitEnabled) {
			await this.commitWrittenFile(
				`backlog: Archive draft ${normalizeId(draftId, "draft")}`,
				[moved.sourcePath],
				moved.targetPath,
			);
		}

		return moved !== null;
	}

	async promoteDraft(draftId: string, autoCommit?: boolean): Promise<boolean> {
		// Whole-file operation: filename binding decides which file is promoted, so resolution
		// goes through the file resolver and frontmatter equivalence is not required.
		const sourcePath = await this.fs.resolveDraftFilePath(draftId);
		if (!sourcePath) return false;
		const canonicalId = extractDraftIdFromFilename(basename(sourcePath));
		if (!canonicalId) return false;

		// Hold the draft lock across the read-unlink span so a concurrent edit cannot be omitted
		// from the promoted task or leave both records on disk. Draft lock first, create lock
		// second: nothing acquires them in the opposite order, so this cannot deadlock.
		return await this.fs.withDraftLock({ filePath: sourcePath, canonicalId }, async () => {
			let moved: { previousPath: string; savedPath: string } | null = null;
			try {
				moved = await this.withCreateLock(async () => {
					const draft = await this.fs.loadDraftFromFile(sourcePath);
					if (!draft) return null;

					const config = await this.fs.loadConfig();
					const newTaskId = await this.generateNextId(EntityType.Task, draft.parentTaskId);
					const promotedStatus =
						!draft.status || draft.status.trim().toLowerCase() === "draft"
							? config?.defaultStatus || FALLBACK_STATUS
							: draft.status;

					const promotedTask: Task = {
						...draft,
						id: newTaskId,
						status: promotedStatus,
						filePath: undefined,
					};

					normalizeAssignee(promotedTask);
					const savedPath = await this.fs.saveTask(promotedTask);
					await unlink(sourcePath);

					const savedTask = await this.fs.loadTask(promotedTask.id);
					if (this.contentStore && savedTask) {
						this.contentStore.upsertTask(savedTask);
					}

					return { previousPath: sourcePath, savedPath };
				});
			} catch (error) {
				// A missing draft is the only thing "false" may mean here; a config value Backlog refuses to
				// read must not be reported as a draft that does not exist.
				if (isCreateLockError(error) || isConfigValueError(error)) {
					throw error;
				}
				return false;
			}

			if (moved && (await this.shouldAutoCommit(autoCommit))) {
				await this.commitWrittenFile(
					`backlog: Promote draft ${normalizeId(draftId, "draft")}`,
					[moved.previousPath],
					moved.savedPath,
				);
			}

			return moved !== null;
		});
	}

	/**
	 * Remove the file behind a deletion preview on explicit request, applying the validated
	 * unlink/reassign choice to every record that references the target.
	 *
	 * The FORK-7 preview is an unlocked point-in-time read, so the mutation re-derives the reference
	 * set inside the locks and refuses when it no longer matches the approved preview: applying the
	 * approved resolution to a changed set would touch references nobody validated. Reference edits
	 * run before the unlink, so a failure never leaves the target gone with its references
	 * unapplied - the only state in which a reallocated ID could silently reidentify the record.
	 */
	async deleteEntity(
		preview: DeletionPreview,
		resolution: DeletionResolution,
		autoCommit?: boolean,
	): Promise<DeletionExecutionResult> {
		if (preview.entityType === "document") {
			throw new Error("Document deletion is not supported by this command.");
		}
		if (preview.status !== "found" || !preview.targetId) {
			throw new Error("Delete requires a found deletion preview; run with --preview first.");
		}
		const label = preview.entityType === "task" ? "Task" : "Draft";
		const targetId = preview.targetId;

		// Resolve the target under the identity rules the preview used; ambiguity throws from the
		// resolvers and never reaches the unlink.
		let targetTask: Task | null = null;
		let targetDraftPath: string | null = null;
		if (preview.entityType === "task") {
			targetTask = await this.loadTaskForMutation(targetId, { includeCrossBranch: false });
			if (!targetTask) throw new Error(`${label} ${targetId} not found. Nothing was deleted.`);
			if (!targetTask.filePath) {
				throw new Error(`${label} ${targetId} has no readable file to remove. Nothing was deleted.`);
			}
		} else {
			targetDraftPath = await this.fs.resolveDraftFilePath(targetId);
			if (!targetDraftPath) throw new Error(`${label} ${targetId} not found. Nothing was deleted.`);
		}
		const targetDraftId = targetDraftPath ? extractDraftIdFromFilename(basename(targetDraftPath)) : null;
		if (targetDraftPath && !targetDraftId) {
			throw new Error(
				`Draft file ${basename(targetDraftPath)} does not carry a draft ID in its filename. Nothing was deleted.`,
			);
		}
		const targetFilePath = targetTask?.filePath ?? targetDraftPath;
		if (!targetFilePath) throw new Error(`${label} ${targetId} has no readable file to remove. Nothing was deleted.`);

		// The lock set is fixed from an unlocked pre-scan: the target plus every record the scan
		// names. Sources without a readable file cannot be locked or rewritten, so they fail closed.
		const scanTarget: DeletionScanTarget = { entityType: preview.entityType, id: targetTask?.id ?? targetId };
		const preScanCorpus = await loadDeletionCorpus(this);
		const preScan = scanDeletionReferences(preScanCorpus, scanTarget, this);
		const sourceIds = new Set(preScan.map((reference) => reference.sourceId));
		const sourceRecords = [...preScanCorpus.active, ...preScanCorpus.completed, ...preScanCorpus.drafts].filter(
			(record) => sourceIds.has(record.id),
		);
		for (const source of sourceRecords) {
			const isDraftSource = preScanCorpus.drafts.includes(source);
			const lockable = source.filePath && (!isDraftSource || extractDraftIdFromFilename(basename(source.filePath)));
			if (!lockable) {
				throw new Error(
					`${isDraftSource ? "Draft" : "Task"} ${source.id} references ${targetId} but has no readable file to update. Nothing was deleted.`,
				);
			}
		}
		const taskSources = sourceRecords.filter((record) => !preScanCorpus.drafts.includes(record));
		const draftSources = sourceRecords
			.filter((record) => preScanCorpus.drafts.includes(record))
			.map((draft) => ({
				filePath: draft.filePath as string,
				canonicalId: extractDraftIdFromFilename(basename(draft.filePath as string)) as string,
			}));

		// Draft locks outermost, then the task locks sorted - the promote/demote order. Task locks
		// sort through withTaskLocks, so concurrent deletes cannot deadlock each other; draft locks
		// fail fast on contention instead.
		const runUnderTaskLocks = async (): Promise<DeletionExecutionResult> => {
			const taskLocks: Array<Pick<Task, "id" | "filePath">> = taskSources.map((record) => ({
				id: record.id,
				filePath: record.filePath as string,
			}));
			if (targetTask) taskLocks.push({ id: targetTask.id, filePath: targetTask.filePath as string });
			return await this.fs.withTaskLocks(
				taskLocks,
				async () =>
					await this.executeDeletionUnderLocks(
						preview,
						resolution,
						scanTarget,
						sourceRecords.map((record) => record.id),
						targetFilePath,
						autoCommit,
					),
			);
		};
		const draftLocks =
			targetDraftPath && targetDraftId
				? [{ filePath: targetDraftPath, canonicalId: targetDraftId }, ...draftSources]
				: draftSources;
		draftLocks.sort((left, right) => left.canonicalId.localeCompare(right.canonicalId));
		const acquireDraftLocks = async (index: number): Promise<DeletionExecutionResult> => {
			const lock = draftLocks[index];
			if (!lock) return await runUnderTaskLocks();
			return await this.fs.withDraftLock(lock, async () => await acquireDraftLocks(index + 1));
		};
		return await acquireDraftLocks(0);
	}

	/**
	 * The mutation half of {@link deleteEntity}, running with the target and every source locked:
	 * re-derive the corpus, compare it with the approved preview, apply the validated resolution to
	 * the fresh source records, then unlink the target and commit.
	 */
	private async executeDeletionUnderLocks(
		preview: DeletionPreview,
		resolution: DeletionResolution,
		scanTarget: DeletionScanTarget,
		sourceIds: string[],
		targetFilePath: string,
		autoCommit?: boolean,
	): Promise<DeletionExecutionResult> {
		const label = preview.entityType === "task" ? "Task" : "Draft";
		const targetId = preview.targetId ?? "";
		const corpus = await loadDeletionCorpus(this);
		const scanned = scanDeletionReferences(corpus, scanTarget, this);
		const scannedKeys = scanned
			.map((reference) => `${reference.sourceId}|${reference.relation}|${reference.value}`)
			.sort();
		const approvedKeys = preview.references
			.map((reference) => `${reference.sourceId}|${reference.relation}|${reference.value}`)
			.sort();
		if (scannedKeys.length !== approvedKeys.length || scannedKeys.some((key, index) => key !== approvedKeys[index])) {
			throw new DeletionPreviewChangedError(
				`The references to ${targetId} changed since the preview was built. Nothing was deleted. Re-run with --preview to review the current references.`,
			);
		}

		let replacementId: string | null = null;
		if (scanned.length > 0) {
			if (resolution.action === "cancel") {
				throw new Error(
					`Deletion of ${targetId} requires an unlink or reassign choice for its ${scanned.length} active reference(s). Nothing was deleted.`,
				);
			}
			const validation = await validateDeletionResolutionForCorpus(corpus, preview, resolution);
			if (!validation.ok) {
				throw new Error(`${validation.errors.join(" ")} Nothing was deleted.`);
			}
			if (resolution.action === "reassign") {
				replacementId = validation.updates[0]?.replacement ?? null;
			}
		}

		// Re-pick the sources from the fresh corpus: a pre-lock edit must not be overwritten from
		// the pre-scan snapshot.
		const lockedIds = new Set(sourceIds);
		const completedSources = new Set(corpus.completed);
		const freshSources = [...corpus.active, ...corpus.completed, ...corpus.drafts]
			.filter((record) => lockedIds.has(record.id))
			.sort((left, right) => left.id.localeCompare(right.id));

		// Reference edits run before the unlink: the unlink is the irreversible step, and a failure
		// here must be recoverable without the target already gone.
		const updatedSources: DeletionSourceUpdate[] = [];
		const writtenAbsolutePaths: string[] = [];
		const applyReferenceUpdates = async () => {
			for (const record of freshSources) {
				const updated = repointTaskLinks(record, scanTarget.id, replacementId);
				if (!updated) continue;
				const isDraftSource = corpus.drafts.includes(record);
				let savedPath: string;
				try {
					savedPath = isDraftSource ? await this.fs.saveDraft(updated) : await this.fs.saveTask(updated);
				} catch (error) {
					const cause = error instanceof Error ? error.message : String(error);
					throw new Error(`could not update ${record.id}: ${cause}`);
				}
				writtenAbsolutePaths.push(savedPath);
				updatedSources.push({ id: record.id, path: displayDeletionPath(this, savedPath) });
				const refreshed = { ...updated, filePath: savedPath };
				if (isDraftSource) continue;
				if (completedSources.has(record)) this.contentStore?.refreshCompletedTask(refreshed);
				else this.contentStore?.upsertTask(refreshed);
			}
		};
		try {
			if (this.contentStore) await this.contentStore.batchTaskUpdates(applyReferenceUpdates);
			else await applyReferenceUpdates();
		} catch (error) {
			const cause = error instanceof Error ? error.message : String(error);
			const touched = updatedSources.map((source) => source.path).join(", ") || "none";
			throw new Error(
				`The target file was not deleted. Reference updates were applied to: ${touched}. ${cause} Re-run with --preview to review the references that remain.`,
			);
		}

		try {
			await unlink(targetFilePath);
		} catch (error) {
			const cause = error instanceof Error ? error.message : String(error);
			const touched = updatedSources.map((source) => source.path).join(", ") || "none";
			throw new Error(
				`Reference updates were applied (${touched}), but the target file could not be removed: ${cause}. Re-run the delete to remove the file itself.`,
			);
		}
		this.contentStore?.transitionTask(targetId);

		// The file is gone from here on: a failure reports the delete as done instead of inviting a
		// retry that would re-apply the resolution.
		if (await this.shouldAutoCommit(autoCommit)) {
			try {
				await this.git.addFile(targetFilePath);
				for (const writtenPath of writtenAbsolutePaths) {
					await this.git.addFile(writtenPath);
				}
				await this.git.commitFiles(`backlog: Delete ${preview.entityType} ${targetId}`, [
					targetFilePath,
					...writtenAbsolutePaths,
				]);
			} catch (error) {
				const cause = error instanceof Error ? error.message : String(error);
				throw markRecordAlreadyMoved(
					new Error(
						`${label} ${targetId} was deleted (${displayDeletionPath(this, targetFilePath)}), but the Git commit failed: ${cause}. The file is removed on disk; Git recovery applies only to committed versions.`,
					),
					"deletionState",
				);
			}
		}

		return { deletedPath: displayDeletionPath(this, targetFilePath), updatedSources };
	}

	async demoteTask(taskId: string, autoCommit?: boolean, options: TaskReadOptions = {}): Promise<VacatedTaskResult> {
		const task = await this.loadTaskForMutation(taskId, options);
		if (!task) return { success: false, cleanedTaskIds: [] };
		// Direct demotion is a read-modify-write too. Hold the task lock across the
		// filesystem read and move so an in-flight task update cannot recreate the
		// active file after this operation has written the draft. The record demoted here also
		// vacates its task ID, so the dependents are locked and cleaned in the same span.
		const demotion = {
			success: false,
			moved: undefined as { previousPath: string; savedPath: string } | undefined,
			cleanedTaskIds: [] as string[],
			cleanedPaths: [] as string[],
		};
		let result: typeof demotion;
		try {
			result = await this.withVacatedIdCleanup(task, task.id, async (cleanup) => {
				const movedPaths: Array<{ previousPath: string; savedPath: string }> = [];
				const success = await this.fs.demoteTask(task.id, (previousPath, savedPath) => {
					movedPaths.push({ previousPath, savedPath });
				});
				// Record the move before anything that can fail after it. A cleanup write that
				// throws must still report the demotion as "moved", or a client is told the task
				// is untouched and retries a demotion that already happened.
				demotion.success = success;
				demotion.moved = movedPaths[0];
				if (success) {
					this.contentStore?.transitionTask(task.id);
					try {
						const written = await this.writeVacatedIdCleanup(cleanup);
						demotion.cleanedTaskIds = written.cleanedTaskIds;
						demotion.cleanedPaths = written.filePaths;
					} catch (error) {
						throw markRecordAlreadyMoved(error, "demotionState", "cleanup");
					}
				}
				return demotion;
			});
		} catch (error) {
			// The lock wrapper can fail while releasing after the move completed. Keep
			// the mutation outcome visible to the Web API and other clients.
			if (demotion.success && demotion.moved) {
				throw markRecordAlreadyMoved(error, "demotionState");
			}
			throw error;
		}
		const { success, moved, cleanedTaskIds, cleanedPaths } = result;

		if (success && moved) {
			try {
				if (await this.shouldAutoCommit(autoCommit)) {
					await this.commitWrittenFile(
						`backlog: Demote task ${task.id}`,
						[moved.previousPath],
						moved.savedPath,
						cleanedPaths,
					);
				}
			} catch (error) {
				throw markRecordAlreadyMoved(error, "demotionState", "commit");
			}
		}

		return { success, cleanedTaskIds };
	}

	/**
	 * Add acceptance criteria to a task
	 */
	async addAcceptanceCriteria(taskId: string, criteria: string[], autoCommit?: boolean): Promise<void> {
		const task = await this.fs.loadTask(taskId);
		if (!task) {
			throw new Error(`Task not found: ${taskId}`);
		}

		// Get existing criteria or initialize empty array
		const current = Array.isArray(task.acceptanceCriteriaItems) ? [...task.acceptanceCriteriaItems] : [];

		// Calculate next index (1-based)
		let nextIndex = current.length > 0 ? Math.max(...current.map((c) => c.index)) + 1 : 1;

		// Append new criteria
		const newCriteria = criteria.map((text) => ({ index: nextIndex++, text, checked: false }));
		task.acceptanceCriteriaItems = [...current, ...newCriteria];

		// Save the task
		await this.updateTask(task, autoCommit);
	}

	/**
	 * Remove acceptance criteria by indices (supports batch operations)
	 * @returns Array of removed indices
	 */
	async removeAcceptanceCriteria(taskId: string, indices: number[], autoCommit?: boolean): Promise<number[]> {
		const task = await this.fs.loadTask(taskId);
		if (!task) {
			throw new Error(`Task not found: ${taskId}`);
		}
		assertValidChecklistMarks(task.rawContent ?? "", "AC");

		let list = Array.isArray(task.acceptanceCriteriaItems) ? [...task.acceptanceCriteriaItems] : [];
		const removed: number[] = [];

		// Sort indices in descending order to avoid index shifting issues
		const sortedIndices = [...indices].sort((a, b) => b - a);

		for (const idx of sortedIndices) {
			const before = list.length;
			list = list.filter((c) => c.index !== idx);
			if (list.length < before) {
				removed.push(idx);
			}
		}

		if (removed.length === 0) {
			throw new Error("No criteria were removed. Check that the specified indices exist.");
		}

		// Re-index remaining items (1-based)
		list = list.map((c, i) => ({ ...c, index: i + 1 }));
		task.acceptanceCriteriaItems = list;

		// Save the task
		await this.updateTask(task, autoCommit);

		return removed.sort((a, b) => a - b); // Return in ascending order
	}

	/**
	 * Check or uncheck acceptance criteria by indices (supports batch operations)
	 * Silently ignores invalid indices and only updates valid ones.
	 * @returns Array of updated indices
	 */
	async checkAcceptanceCriteria(
		taskId: string,
		indices: number[],
		checked: boolean,
		autoCommit?: boolean,
	): Promise<number[]> {
		const task = await this.fs.loadTask(taskId);
		if (!task) {
			throw new Error(`Task not found: ${taskId}`);
		}
		assertValidChecklistMarks(task.rawContent ?? "", "AC");

		let list = Array.isArray(task.acceptanceCriteriaItems) ? [...task.acceptanceCriteriaItems] : [];
		const updated: number[] = [];

		// Filter to only valid indices and update them
		for (const idx of indices) {
			if (list.some((c) => c.index === idx)) {
				list = list.map((c) => {
					if (c.index === idx) {
						updated.push(idx);
						return { ...c, checked };
					}
					return c;
				});
			}
		}

		if (updated.length === 0) {
			throw new Error("No criteria were updated.");
		}

		task.acceptanceCriteriaItems = list;

		// Save the task
		await this.updateTask(task, autoCommit);

		return updated.sort((a, b) => a - b);
	}

	/**
	 * List all acceptance criteria for a task
	 */
	async listAcceptanceCriteria(taskId: string): Promise<AcceptanceCriterion[]> {
		const task = await this.fs.loadTask(taskId);
		if (!task) {
			throw new Error(`Task not found: ${taskId}`);
		}

		return task.acceptanceCriteriaItems || [];
	}

	/**
	 * Stage and commit a single written file, scoped to exactly the paths this write touched
	 * (the new file, plus any previous paths it replaced). Never sweeps in unrelated dirty state.
	 */
	private async commitWrittenFile(
		message: string,
		previousPaths: string[],
		newPath: string,
		alsoWrittenPaths: string[] = [],
	): Promise<void> {
		for (const writtenPath of alsoWrittenPaths) {
			await this.git.addFile(writtenPath);
		}
		if (previousPaths.length > 0) {
			let repoRoot: string | null = null;
			for (const previousPath of previousPaths) {
				repoRoot = await this.git.stageFileMove(previousPath, newPath);
			}
			await this.git.commitFiles(message, [...previousPaths, newPath, ...alsoWrittenPaths], repoRoot);
		} else {
			await this.git.addFile(newPath);
			await this.git.commitFiles(message, [newPath, ...alsoWrittenPaths]);
		}
	}

	async createDecision(
		decision: Decision,
		autoCommit?: boolean,
	): Promise<{ filepath: string; removedFilepaths: string[] }> {
		// Architecture decisions (kind: architecture) carry a validated lifecycle; legacy decisions stay free-form.
		if (decision.kind !== undefined && decision.kind !== ADR_KIND) {
			throw new Error(`Unsupported decision kind '${decision.kind}'. Supported kinds: ${ADR_KIND}.`);
		}
		if (isAdr(decision)) {
			assertAdrStatusValue(decision.id, decision.status);
			if (decision.status === "accepted") {
				assertAdrAcceptableFields(decision);
			}
		}

		const { filepath, removedFilepaths } = await this.fs.saveDecision(decision);

		if (await this.shouldAutoCommit(autoCommit)) {
			await this.commitWrittenFile(`backlog: Add decision ${decision.id}`, removedFilepaths, filepath);
		}

		return { filepath, removedFilepaths };
	}

	/**
	 * Single validated mutation for decision title, status, and body. Only the fields present in
	 * the input change; frontmatter inside a replacement body is ignored so callers can never
	 * rewrite identity or metadata through raw markdown.
	 */
	async updateDecisionFromInput(input: DecisionUpdateInput, autoCommit?: boolean): Promise<Decision> {
		const existingDecision = await this.fs.loadDecision(input.id);
		if (!existingDecision) {
			throw new Error(`Decision not found: ${input.id}`);
		}
		if (existingDecision.archived) {
			throw new Error(
				`Decision ${existingDecision.id} is archived; restore it with 'backlog decision restore' before editing.`,
			);
		}

		const title = input.title?.trim();
		if (input.title !== undefined && !title) {
			throw new Error("Decision title cannot be empty.");
		}
		const status = input.status?.trim();
		if (input.status !== undefined && !status) {
			throw new Error("Decision status cannot be empty.");
		}
		if (isAdr(existingDecision) && status !== undefined) {
			assertAdrStatusValue(existingDecision.id, status);
			assertAdrTransition(existingDecision.id, existingDecision.status, status);
		}

		// Section extraction reuses the decision parser; its frontmatter fields (id, title,
		// status, date) are deliberately not applied.
		const body = input.content !== undefined ? parseDecision(input.content) : null;

		const updatedDecision: Decision = {
			...existingDecision,
			title: title ?? existingDecision.title,
			status: (status ?? existingDecision.status) as Decision["status"],
			context: body?.context || existingDecision.context,
			decision: body?.decision || existingDecision.decision,
			consequences: body?.consequences || existingDecision.consequences,
			alternatives: body?.alternatives || existingDecision.alternatives,
			scope: body?.scope || existingDecision.scope,
			rationale: body?.rationale || existingDecision.rationale,
		};

		await this.createDecision(updatedDecision, autoCommit);
		return (await this.fs.loadDecision(input.id)) ?? updatedDecision;
	}

	async createDecisionWithTitle(title: string, autoCommit?: boolean): Promise<Decision> {
		const id = await generateNextDecisionId(this);

		const decision: Decision = {
			id,
			title,
			date: new Date().toISOString().slice(0, 16).replace("T", " "),
			status: "proposed",
			context: "[Describe the context and problem that needs to be addressed]",
			decision: "[Describe the decision that was made]",
			consequences: "[Describe the consequences of this decision]",
			rawContent: "",
		};

		await this.createDecision(decision, autoCommit);
		return decision;
	}

	/**
	 * Retires an accepted ADR in favor of an accepted replacement in one reviewed operation. The
	 * replacement must be an accepted ADR that has not superseded another record, must cover the
	 * full scope of the ADR it replaces, and must not close a supersession cycle; otherwise the
	 * retirement is refused and still-applicable guidance stays authoritative. The older ADR keeps
	 * its text and gains historical links in both directions.
	 */
	async supersedeDecision(supersededId: string, replacementId: string, autoCommit?: boolean): Promise<Decision> {
		const superseded = await this.fs.loadDecision(supersededId);
		if (!superseded) {
			throw new Error(`Decision not found: ${supersededId}`);
		}
		const replacement = await this.fs.loadDecision(replacementId);
		if (!replacement) {
			throw new Error(`Decision not found: ${replacementId}`);
		}

		if (decisionIdKey(superseded.id) === decisionIdKey(replacement.id)) {
			throw new Error("An architecture decision cannot supersede itself.");
		}
		if (!isAdr(superseded)) {
			throw new Error(
				`Decision ${superseded.id} is not an architecture decision record (kind: ${ADR_KIND}); only ADRs can be superseded.`,
			);
		}
		if (!isAdr(replacement)) {
			throw new Error(
				`Decision ${replacement.id} is not an architecture decision record (kind: ${ADR_KIND}); only ADRs can be the replacement.`,
			);
		}
		if (superseded.status !== "accepted") {
			const reason =
				superseded.status === "proposed"
					? "reject it instead"
					: superseded.status === "superseded" && superseded.supersededBy
						? `already superseded by ${superseded.supersededBy}`
						: "already retired";
			throw new Error(`Only an accepted ADR can be superseded; ${superseded.id} is ${superseded.status} (${reason}).`);
		}
		if (replacement.status !== "accepted") {
			throw new Error(
				`The replacement ${replacement.id} must be accepted before superseding ${superseded.id}; it is ${replacement.status}.`,
			);
		}
		if (replacement.supersedes || replacement.supersededBy) {
			const existingLink = replacement.supersedes ?? replacement.supersededBy;
			throw new Error(
				`The replacement ${replacement.id} already records a supersession link with ${existingLink}; use an accepted ADR that has not superseded another record.`,
			);
		}
		await this.assertNoSupersessionCycle(superseded, replacement);

		const gaps = scopeCoverageGaps(superseded.scope, replacement.scope);
		if (gaps.length > 0) {
			throw new Error(
				`Refusing to supersede ${superseded.id}: ${replacement.id} does not cover its full scope. ` +
					`Unresolved scope: ${gaps.join("; ")}. Resolve the remaining scope before superseding.`,
			);
		}

		// Link the replacement first so an interrupted run never leaves a retired ADR without a replacement.
		const { filepath: replacementFilepath, removedFilepaths: replacementRemoved } = await this.createDecision(
			{ ...replacement, supersedes: superseded.id },
			false,
		);
		const retired: Decision = { ...superseded, status: "superseded", supersededBy: replacement.id };
		const { filepath: retiredFilepath, removedFilepaths: retiredRemoved } = await this.createDecision(retired, false);

		if (await this.shouldAutoCommit(autoCommit)) {
			await this.commitWrittenFile(
				`backlog: Supersede ${superseded.id} with ${replacement.id}`,
				retiredRemoved,
				retiredFilepath,
				[replacementFilepath, ...replacementRemoved],
			);
		}

		return (await this.fs.loadDecision(superseded.id)) ?? retired;
	}

	/**
	 * Default decision discovery for guidance: applicable accepted ADRs plus every legacy
	 * decision. Proposed, rejected, and superseded ADRs are excluded so agents citing default
	 * results never treat a retired record as authoritative; archived ADRs never appear here.
	 */
	async listApplicableDecisions(): Promise<Decision[]> {
		const decisions = await this.fs.listDecisions();
		return decisions.filter(isApplicableDecision);
	}

	/**
	 * Resolves one decision ID against the guidance that currently governs it. A retired ADR is
	 * returned with its retired state and its authoritative replacement — the accepted active ADR
	 * at the end of the supersession chain, across archive moves — so an explicit historical lookup
	 * identifies history instead of presenting it as current guidance. A replacement link that
	 * resolves to nothing, or a supersession chain that cycles, is an error.
	 */
	async resolveAdrGuidance(decisionId: string): Promise<AdrGuidanceResolution | null> {
		const decision = await this.fs.loadDecision(decisionId);
		if (!decision) return null;
		if (!isRetiredAdr(decision)) return { decision };

		const retired = {
			state: decision.status,
			archived: Boolean(decision.archived),
			replacement: null as Decision | null,
		};
		const visited = new Set<string>([decision.id]);
		let current = decision;
		while (isRetiredAdr(current) && current.supersededBy) {
			const next = await this.fs.loadDecision(current.supersededBy);
			if (!next) {
				throw new Error(
					`Architecture decision ${current.id} records replacement ${current.supersededBy}, which does not exist. Fix the superseded_by link or restore the replacement file.`,
				);
			}
			if (visited.has(next.id)) {
				throw new Error(
					`The supersession links from ${decision.id} form a cycle through ${next.id}; no authoritative replacement can be resolved.`,
				);
			}
			visited.add(next.id);
			current = next;
		}
		if (isRetiredAdr(current)) {
			// Retired without a successor link: a rejection or deprecation has no replacement to offer.
			return { decision, retired };
		}
		if (current.status !== "accepted" || current.archived) {
			throw new Error(
				`Architecture decision ${decision.id} resolves to ${current.id}, which is ${
					current.archived ? "archived" : current.status
				} and cannot govern current work. Restore it or complete its lifecycle.`,
			);
		}
		retired.replacement = current;
		return { decision, retired };
	}

	/**
	 * Current structured documentation links to one decision in active tasks and drafts. Prose
	 * citations anywhere, and links inside completed or archived records, are historical evidence
	 * this scan never reports or rewrites.
	 */
	async listActiveDecisionReferences(decisionId: string): Promise<DecisionReference[]> {
		const [tasks, drafts] = await Promise.all([this.fs.listTasks(), this.fs.listDrafts()]);
		const references: DecisionReference[] = [];
		for (const record of [...tasks, ...drafts]) {
			for (const entry of record.documentation ?? []) {
				if (isDecisionIdReference(entry) && decisionIdsEqual(entry, decisionId)) {
					references.push({ sourceId: record.id, sourceTitle: record.title, value: entry });
				}
			}
		}
		return references;
	}

	/**
	 * Validates documentation entries that spell a decision ID: a record taking a new or edited
	 * link must not name a retired ADR as governing guidance. Links that predate a retirement are
	 * immutable historical citations and are never checked or rewritten; entries that are not
	 * decision IDs (paths, URLs) and IDs matching no decision stay tolerated like document links.
	 */
	async assertDocumentationLinksApplicable(entries: readonly string[]): Promise<void> {
		const candidates = entries.filter(isDecisionIdReference);
		if (candidates.length === 0) return;
		const [active, archived] = await Promise.all([this.fs.listDecisions(), this.fs.listArchivedDecisions()]);
		const all = [...active, ...archived];
		for (const entry of candidates) {
			const match = findDecisionById(all, entry);
			if (!match || !isRetiredAdr(match)) continue;
			const why = match.supersededBy ? `, superseded by ${match.supersededBy}` : "";
			throw new Error(
				`Documentation link "${entry}" points to a retired architecture decision (${match.status}${why}); link its accepted replacement instead.`,
			);
		}
	}

	/** Walks the supersedes chain from the ADR being retired; a path back to the replacement would close a cycle. */
	private async assertNoSupersessionCycle(superseded: Decision, replacement: Decision): Promise<void> {
		const visited = new Set<string>([superseded.id]);
		let current: Decision | null = superseded;
		while (current?.supersedes) {
			const nextId = current.supersedes;
			if (decisionIdKey(nextId) === decisionIdKey(replacement.id)) {
				throw new Error(
					`Superseding ${superseded.id} with ${replacement.id} would create a supersession cycle through ${nextId}.`,
				);
			}
			if (visited.has(nextId)) {
				throw new Error(
					`The supersession links around ${superseded.id} already form a cycle; resolve them before superseding.`,
				);
			}
			visited.add(nextId);
			// A broken link simply ends the chain; only a path back to the replacement closes a cycle.
			current = await this.fs.loadDecision(nextId);
		}
	}

	/**
	 * Moves a retired ADR to backlog/archive/decisions. Only a rejected, deprecated, or superseded
	 * ADR may archive; an applicable accepted ADR must go through a valid lifecycle transition
	 * (supersession) first, and a proposal can only be rejected. The move is whole-file, so
	 * identity, content, and supersession links survive; archive is never a delete or purge.
	 */
	async archiveDecision(decisionId: string, autoCommit?: boolean): Promise<Decision> {
		const decision = await this.fs.loadDecision(decisionId);
		if (!decision) {
			throw new Error(`Decision not found: ${decisionId}`);
		}
		if (decision.archived) {
			throw new Error(`Decision ${decision.id} is already archived.`);
		}
		if (!isAdr(decision)) {
			throw new Error(
				`Decision ${decision.id} is not an architecture decision record (kind: ${ADR_KIND}); only ADRs can be archived.`,
			);
		}
		if (!isRetiredAdrStatus(decision.status)) {
			const hint =
				decision.status === "accepted"
					? "An accepted ADR is still applicable; supersede it with 'backlog decision supersede' or deprecate it before archiving."
					: "A proposed ADR is not retired; reject it instead.";
			throw new Error(
				`Cannot archive ${decision.id}: only a rejected, deprecated, or superseded ADR can be archived. ${hint}`,
			);
		}

		const { sourcePath, targetPath } = await this.fs.moveDecisionToArchive(decision.id);

		if (await this.shouldAutoCommit(autoCommit)) {
			const repoRoot = await this.git.stageFileMove(sourcePath, targetPath);
			await this.git.commitFiles(`backlog: Archive decision ${decision.id}`, [sourcePath, targetPath], repoRoot);
		}

		return (await this.fs.loadDecision(decision.id)) ?? decision;
	}

	/** Moves an archived ADR back to backlog/decisions; the record and its content are unchanged. */
	async restoreDecision(decisionId: string, autoCommit?: boolean): Promise<Decision> {
		const decision = await this.fs.loadDecision(decisionId);
		if (!decision) {
			throw new Error(`Decision not found: ${decisionId}`);
		}
		if (!decision.archived) {
			throw new Error(`Decision ${decision.id} is not archived.`);
		}

		const { sourcePath, targetPath } = await this.fs.moveDecisionFromArchive(decision.id);

		if (await this.shouldAutoCommit(autoCommit)) {
			const repoRoot = await this.git.stageFileMove(sourcePath, targetPath);
			await this.git.commitFiles(`backlog: Restore decision ${decision.id}`, [sourcePath, targetPath], repoRoot);
		}

		return (await this.fs.loadDecision(decision.id)) ?? decision;
	}

	async createDocument(doc: Document, autoCommit?: boolean, subPath = ""): Promise<void> {
		const { relativePath, removedFilepaths } = await this.fs.saveDocument(doc, normalizeDocumentSubPath(subPath));
		doc.path = relativePath;

		if (await this.shouldAutoCommit(autoCommit)) {
			const docsDir = this.fs.docsDir;
			const absolutePath = join(docsDir, ...relativePath.split("/"));
			await this.commitWrittenFile(`backlog: Add document ${doc.id}`, removedFilepaths, absolutePath);
		}
	}

	async updateDocument(existingDoc: Document, content: string, autoCommit?: boolean): Promise<void> {
		await this.updateDocumentFromInput(
			{
				id: existingDoc.id,
				title: existingDoc.title,
				type: existingDoc.type,
				tags: existingDoc.tags,
				content,
				...(existingDoc.path !== undefined && { path: getDocumentSubPathFromRelativePath(existingDoc.path) }),
			},
			autoCommit,
		);
	}

	async createDocumentWithId(title: string, content: string, autoCommit?: boolean): Promise<Document> {
		return await this.createDocumentFromInput({ title, content }, autoCommit);
	}

	/**
	 * Resolves the structured links a change document references. Lookups reuse the canonical
	 * task, document, and decision resolvers, so ambiguous IDs fail closed with their own error.
	 */
	private changeLinkResolver(): ChangeLinkResolver {
		return {
			getDocument: (id) => this.getDocument(id),
			hasTask: async (id) => (await this.getTask(id)) !== null,
			hasDecision: async (id) => (await this.fs.loadDecision(id)) !== null,
		};
	}

	/**
	 * Validates change content and records a baseline for each affected specification that
	 * does not already carry one. Saving never enforces recorded baselines (that is the job
	 * of `backlog doc validate`) and never rewrites an existing Baselines section, so a
	 * proposal keeps the baselines it was written against.
	 */
	private async preparedChangeContent(content: string): Promise<string> {
		const parsed = parseChangeDocument(content);
		await validateChangeContent(content, this.changeLinkResolver(), { ignoreRecordedBaselines: true });
		if (parsed.baselines.length > 0) return content;
		const baselines = new Map<string, string>();
		for (const link of parsed.affectedSpecs) {
			const document = await this.getDocument(link.id);
			if (document?.type === "specification") {
				baselines.set(document.id, specBaselineHash(document.rawContent));
			}
		}
		return withRecordedBaselines(content, baselines);
	}

	/** Validates a change document and projects its affected specs without touching any file. */
	async buildChangePreview(documentId: string): Promise<ChangePreview> {
		const document = await this.getDocument(documentId);
		if (!document) {
			throw new Error(`Document not found: ${documentId}`);
		}
		if (document.type !== "change") {
			throw new Error(
				`Document ${documentId} is a ${document.type} document. Validate and preview apply to change documents only.`,
			);
		}
		return await buildChangeDocumentPreview(document, this.changeLinkResolver());
	}

	/**
	 * Records the explicit human review decision on a change document. The approval marker
	 * is the only input `applyChangeDocument` trusts; it can be replaced while the change
	 * is not integrated, and it survives archival as history.
	 */
	async approveChangeDocument(
		documentId: string,
		options: { by?: string } = {},
		autoCommit?: boolean,
	): Promise<Document> {
		return await this.withCreateLock(async () => {
			// Checked under the lock so an approve racing an apply cannot write a review
			// record into a change that was just integrated and archived.
			const document = await this.requireChangeDocument(documentId);
			this.assertChangeNotIntegrated(document);
			const reviewer = options.by?.trim();
			const now = new Date().toISOString().slice(0, 16).replace("T", " ");
			const approved: Document = {
				...document,
				rawContent: withManagedSection(document.rawContent, "Review", [
					`Approved${reviewer ? ` by ${reviewer}` : ""} on ${now}.`,
				]),
				updatedDate: now,
			};
			const { relativePath, removedFilepaths } = await this.fs.saveDocument(
				approved,
				getDocumentSubPathFromRelativePath(document.path),
			);
			approved.path = relativePath;
			if (await this.shouldAutoCommit(autoCommit)) {
				await this.commitWrittenFile(
					`backlog: Approve change ${document.id}`,
					removedFilepaths,
					documentAbsolutePath(this, relativePath),
				);
			}
			return (await this.getDocument(document.id)) ?? approved;
		});
	}

	/**
	 * Integrates a reviewed change into its affected current specs and archives the change
	 * as history. Apply is refused for a change without an explicit approval record and for
	 * one that was already integrated; a linked task's status is never consulted. The whole
	 * operation runs under the shared create lock: the change is revalidated against the
	 * current specifications immediately before any write (a stale baseline refuses), every
	 * spec is written from the same validated preview projection, a failed write rolls the
	 * already-written specs back to their exact prior content with a full diagnostic, and
	 * only then is the Integrated record written and the file archived under its own ID.
	 */
	async applyChangeDocument(documentId: string, autoCommit?: boolean): Promise<ChangeApplicationResult> {
		const document = await this.requireChangeDocument(documentId);
		this.assertChangeNotIntegrated(document);
		this.assertChangeApproved(document);

		return await this.withCreateLock(async () => {
			// Re-read and re-check under the lock: the document may have changed since.
			const change = await this.requireChangeDocument(documentId);
			this.assertChangeNotIntegrated(change);
			this.assertChangeApproved(change);

			const preview = await this.buildChangePreview(change.id);
			if (!preview.valid) {
				throw new Error(
					[
						`Change ${change.id} cannot be applied: it is not valid against the current specifications.`,
						...preview.issues.map((issue) => `- line ${issue.line}: ${issue.message}`),
					].join("\n"),
				);
			}

			const written: Array<{ updated: Document; previous: Document }> = [];
			const specs: ChangeApplicationResult["specs"] = [];
			let marked = false;
			let sourcePath = "";
			let targetPath = "";
			try {
				for (const projected of preview.specs) {
					const specDocument = await this.getDocument(projected.specId);
					if (!specDocument) {
						throw new Error(`Specification ${projected.specId} disappeared while applying ${change.id}.`);
					}
					if (projected.resultingContent === specDocument.rawContent) {
						specs.push({
							specId: projected.specId,
							path: specDocument.path ?? "",
							updated: false,
						});
						continue;
					}
					const now = new Date().toISOString().slice(0, 16).replace("T", " ");
					const updated: Document = {
						...specDocument,
						rawContent: projected.resultingContent,
						updatedDate: now,
					};
					const { relativePath } = await this.fs.saveDocument(
						updated,
						getDocumentSubPathFromRelativePath(specDocument.path),
					);
					updated.path = relativePath;
					written.push({ updated, previous: specDocument });
					specs.push({ specId: projected.specId, path: relativePath, updated: true });
				}

				const integratedDate = new Date().toISOString().slice(0, 16).replace("T", " ");
				const integrated: Document = {
					...change,
					rawContent: withManagedSection(change.rawContent, "Integrated", [
						`Integrated on ${integratedDate} into ${preview.specs.map((spec) => spec.specId).join(", ")}.`,
					]),
					updatedDate: integratedDate,
				};
				marked = true;
				await this.fs.saveDocument(integrated, getDocumentSubPathFromRelativePath(change.path));
				({ sourcePath, targetPath } = await this.fs.moveDocumentToArchive(change.id));
			} catch (error) {
				throw await this.rollbackAppliedSpecs(change, written, marked, error);
			}

			if (await this.shouldAutoCommit(autoCommit)) {
				const repoRoot = await this.git.stageFileMove(sourcePath, targetPath);
				for (const { updated } of written) {
					await this.git.addFile(documentAbsolutePath(this, updated.path ?? ""));
				}
				await this.git.commitFiles(
					`backlog: Apply change ${change.id}`,
					[...written.map(({ updated }) => documentAbsolutePath(this, updated.path ?? "")), sourcePath, targetPath],
					repoRoot,
				);
			}

			return { changeId: change.id, specs, archivedPath: targetPath };
		});
	}

	/**
	 * Restores every file a failed apply touched — written specs, and the change document
	 * when its Integrated record was already written — then reports exactly what happened.
	 */
	private async rollbackAppliedSpecs(
		change: Document,
		written: Array<{ updated: Document; previous: Document }>,
		marked: boolean,
		cause: unknown,
	): Promise<Error> {
		const rollbackFailures: string[] = [];
		for (const { previous } of written) {
			try {
				await this.fs.saveDocument(previous, getDocumentSubPathFromRelativePath(previous.path));
			} catch (rollbackError) {
				rollbackFailures.push(
					`${previous.id}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
				);
			}
		}
		if (marked) {
			try {
				await this.fs.saveDocument(change, getDocumentSubPathFromRelativePath(change.path));
			} catch (rollbackError) {
				rollbackFailures.push(
					`${change.id}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
				);
			}
		}
		const causeMessage = cause instanceof Error ? cause.message : String(cause);
		const lines = [`Change ${change.id} could not be applied: ${causeMessage}`];
		if (rollbackFailures.length === 0) {
			if (written.length > 0) {
				lines.push(
					`Rolled back ${written.map(({ previous }) => previous.id).join(", ")} to their exact content from before this apply.`,
				);
			}
			lines.push(`No specification was left modified, and ${change.id} was not marked integrated or archived.`);
		} else {
			lines.push(
				`Rollback failed for ${rollbackFailures.join("; ")}. Those files may hold partially applied content; compare them with 'backlog doc preview ${change.id}' and Git before retrying.`,
			);
		}
		return new Error(lines.join("\n"));
	}

	private async requireChangeDocument(documentId: string): Promise<Document> {
		const document = await this.getDocument(documentId);
		if (!document) {
			throw new Error(`Document not found: ${documentId}`);
		}
		if (document.type !== "change") {
			throw new Error(
				`Document ${documentId} is a ${document.type} document. Only change documents can be approved and applied.`,
			);
		}
		return document;
	}

	private assertChangeApproved(change: Document): void {
		if (parseChangeReview(change.rawContent).approved) return;
		throw new Error(
			`Change ${change.id} has not been reviewed. Record an explicit approval with 'backlog doc approve ${change.id}' first; a linked task's status is never treated as approval.`,
		);
	}

	private assertChangeNotIntegrated(change: Document): void {
		const integration = parseChangeIntegration(change.rawContent);
		if (!integration.integrated) return;
		throw new Error(
			`Change ${change.id} was already integrated on ${integration.integratedDate ?? "an unknown date"}; applying it again is refused.`,
		);
	}

	async createDocumentFromInput(input: DocumentCreateInput, autoCommit?: boolean): Promise<Document> {
		const title = input.title.trim();
		if (!title) {
			throw new Error("Title is required to create a document.");
		}

		const tags = normalizeStringList(input.tags);
		const type = normalizeDocumentTypeInput(input.type) ?? "other";
		let content = input.content ?? "";
		if (type === "specification") {
			validateSpecificationContent(content);
		} else if (type === "change") {
			content = await this.preparedChangeContent(content);
		}
		// doc-4 layout: change records live under docs/changes unless a path is given.
		const subPath = normalizeDocumentSubPath(input.path ?? (type === "change" ? "changes" : undefined));
		const document = await this.withCreateLock(async () => {
			const id = normalizeDocumentId(await generateNextDocId(this));
			const document: Document = {
				id,
				title,
				type,
				createdDate: new Date().toISOString().slice(0, 16).replace("T", " "),
				rawContent: content,
				...(tags && tags.length > 0 && { tags }),
			};

			await this.createDocument(document, autoCommit, subPath);
			return document;
		});

		return (await this.getDocument(document.id)) ?? document;
	}

	async updateDocumentFromInput(input: DocumentUpdateInput, autoCommit?: boolean): Promise<Document> {
		const existingDoc = await this.getDocument(input.id);
		if (!existingDoc) {
			throw new Error(`Document not found: ${input.id}`);
		}

		const normalizedTitle = input.title?.trim();
		if (input.title !== undefined && !normalizedTitle) {
			throw new Error("Document title cannot be empty.");
		}

		const tags = input.tags !== undefined ? normalizeStringList(input.tags) : existingDoc.tags;
		const type = normalizeDocumentTypeInput(input.type) ?? existingDoc.type;
		let content = input.content;
		if (type === "specification") {
			validateSpecificationContent(content);
		} else if (type === "change") {
			content = await this.preparedChangeContent(content);
		}
		const subPath =
			input.path === undefined
				? getDocumentSubPathFromRelativePath(existingDoc.path)
				: normalizeDocumentSubPath(input.path);
		const updatedDoc: Document = {
			...existingDoc,
			id: normalizeDocumentId(existingDoc.id),
			title: normalizedTitle ?? existingDoc.title,
			type,
			rawContent: content,
			updatedDate: new Date().toISOString().slice(0, 16).replace("T", " "),
			tags: tags && tags.length > 0 ? tags : undefined,
		};

		await this.createDocument(updatedDoc, autoCommit, subPath);
		return (await this.getDocument(existingDoc.id)) ?? updatedDoc;
	}

	/**
	 * Delete one document file after an explicit request. Every active record whose structured
	 * documentation references it is rewritten first — under that record's file lock, with the
	 * reference set re-scanned inside the locks — and only then is the file removed. A cancel
	 * resolution deletes only a document with no active references; unlink and reassign rewrite
	 * every referencing record as the validated update set describes.
	 *
	 * Deletion removes the file outright: it is not a move to an archive, and Git restores only
	 * committed versions.
	 */
	async deleteDocument(
		documentId: string,
		resolution: DeletionResolution,
		autoCommit?: boolean,
	): Promise<DocumentDeletionResult> {
		const document = await this.getDocument(documentId);
		if (!document) {
			throw new Error(`Document ${documentId} not found. Nothing would be deleted.`);
		}
		const docId = document.id;
		const documentPath = documentAbsolutePath(this, document.path ?? `${docId}.md`);

		const scanReferences = async (): Promise<DocumentReferenceCleanup> => {
			const [active, completed, drafts] = await Promise.all([
				this.fs.listTasks(),
				this.fs.listCompletedTasks(),
				this.fs.listDrafts(),
			]);
			const withReferences = (records: Task[]) =>
				records.filter((record) =>
					(record.documentation ?? []).some((entry) => isDocumentIdReference(entry) && documentIdsEqual(entry, docId)),
				);
			return { tasks: withReferences([...active, ...completed]), drafts: withReferences(drafts) };
		};

		// The same discipline as a vacated task ID: the referencing records must be read and
		// locked as one state, so a record that starts referencing the document while the locks
		// are being taken is caught by re-scanning inside them and widens the lock set.
		let candidates = await scanReferences();
		for (let attempt = 0; attempt < VACATED_ID_CLEANUP_LOCK_ATTEMPTS; attempt++) {
			const covered = new Set(
				[...candidates.tasks, ...candidates.drafts].map((record) => record.id.trim().toLowerCase()),
			);
			const covers = (record: Task) => covered.has(record.id.trim().toLowerCase());
			const outcome = await this.fs.withTaskLocks(candidates.tasks, () =>
				this.withDraftLocks(
					candidates.drafts,
					async (): Promise<{ value: DocumentDeletionResult } | { widened: DocumentReferenceCleanup }> => {
						const fresh = await scanReferences();
						if ([...fresh.tasks, ...fresh.drafts].some((record) => !covers(record))) {
							return { widened: fresh };
						}
						return {
							value: await this.deleteDocumentUnderLocks(document, fresh, resolution, autoCommit, documentPath),
						};
					},
				),
			);
			if ("value" in outcome) return outcome.value;
			candidates = outcome.widened;
		}
		throw new Error(
			`Could not take a stable set of record locks to clean references to ${docId}. Retry once the records referencing it stop changing.`,
		);
	}

	private async deleteDocumentUnderLocks(
		document: Document,
		references: DocumentReferenceCleanup,
		resolution: DeletionResolution,
		autoCommit: boolean | undefined,
		documentPath: string,
	): Promise<DocumentDeletionResult> {
		const docId = document.id;
		// Re-validate under the locks: the resolution the requester saw may be stale by the time
		// the files are locked, and a rejected resolution must not touch anything.
		const preview = await buildDeletionPreview(this, "document", docId);
		if (preview.status !== "found") {
			throw new Error(preview.message);
		}
		if (resolution.action === "cancel" && preview.references.length > 0) {
			throw new Error(
				`${docId} has ${preview.references.length} active structured reference${
					preview.references.length === 1 ? "" : "s"
				}. Nothing was deleted; choose unlink or reassign to resolve them.`,
			);
		}
		const validation = await validateDeletionResolution(this, preview, resolution);
		if (!validation.ok) {
			throw new Error(validation.errors.join("\n"));
		}

		const updatedDate = new Date().toISOString().slice(0, 16).replace("T", " ");
		const replacementBySource = new Map(
			validation.updates.map((update) => [update.sourceId.trim().toLowerCase(), update.replacement] as const),
		);
		const rewriteDocumentation = (record: Task): Task | null => {
			const replacement = replacementBySource.get(record.id.trim().toLowerCase());
			if (replacement === undefined) return null;
			const documentation = (record.documentation ?? []).flatMap((entry) =>
				isDocumentIdReference(entry) && documentIdsEqual(entry, docId)
					? replacement === null
						? []
						: [replacement]
					: [entry],
			);
			return { ...record, documentation, updatedDate };
		};

		// Reference edits land before the file is removed: if a write fails here, the document
		// still exists and no link is left dangling.
		const editedPaths: string[] = [];
		const writeAll = async () => {
			for (const record of references.tasks) {
				const updated = rewriteDocumentation(record);
				if (!updated) continue;
				const savedPath = await this.fs.saveTask(updated);
				editedPaths.push(savedPath);
				this.contentStore?.upsertTask({ ...updated, filePath: savedPath });
			}
			for (const record of references.drafts) {
				const updated = rewriteDocumentation(record);
				if (!updated) continue;
				editedPaths.push(await this.fs.saveDraft(updated));
			}
		};
		if (this.contentStore) await this.contentStore.batchTaskUpdates(writeAll);
		else await writeAll();

		try {
			await unlink(documentPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
				const editedNote =
					editedPaths.length > 0
						? ` The edited records are on disk (${editedPaths.length} file${editedPaths.length === 1 ? "" : "s"}).`
						: "";
				throw new Error(
					`Could not delete ${displayDeletionPath(this, documentPath)}: ${
						error instanceof Error ? error.message : String(error)
					}.${editedNote}`,
				);
			}
		}

		if (await this.shouldAutoCommit(autoCommit)) {
			try {
				// `git add` on the removed path stages the deletion; an untracked path may match
				// nothing, which must not block committing the reference edits.
				await this.git.addFile(documentPath);
			} catch {
				// The deleted file was never tracked.
			}
			try {
				await this.git.commitFiles(`backlog: Delete document ${docId}`, [documentPath, ...editedPaths]);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(
					`Deleted document ${docId}, but committing failed: ${message}. The deletion and the reference edits are on disk but uncommitted.`,
				);
			}
		}

		return {
			id: docId,
			title: document.title,
			path: displayDeletionPath(this, documentPath),
			updates: validation.updates,
		};
	}

	/** Draft counterpart of the bulk task lock: sorted acquisition, then run. */
	private async withDraftLocks<T>(drafts: Task[], fn: () => Promise<T>): Promise<T> {
		const acquire = async (index: number): Promise<T> => {
			const draft = drafts[index];
			if (!draft) return await fn();
			const filePath = draft.filePath?.trim();
			if (!filePath) {
				throw new Error(`Cannot lock draft ${draft.id} without its file path.`);
			}
			return await this.fs.withDraftLock({ filePath, canonicalId: draft.id }, () => acquire(index + 1));
		};
		return await acquire(0);
	}

	async listTasksWithMetadata(
		includeBranchMeta = false,
		filesystem = this.fs,
		git = this.git,
	): Promise<Array<Task & { lastModified?: Date; branch?: string }>> {
		const tasks = await filesystem.listTasks();
		return await Promise.all(
			tasks.map(async (task) => {
				const filePath = task.filePath ?? (await getTaskPath(task.id, { filesystem }));

				if (filePath) {
					const bunFile = Bun.file(filePath);
					const stats = await bunFile.stat();
					return {
						...task,
						lastModified: new Date(stats.mtime),
						// Only include branch if explicitly requested
						...(includeBranchMeta && {
							branch: (await git.getFileLastModifiedBranch(filePath)) || undefined,
						}),
					};
				}
				return task;
			}),
		);
	}

	/**
	 * Open a file in the configured editor with minimal interference
	 * @param filePath - Path to the file to edit
	 * @param screen - Optional blessed screen to suspend (for TUI contexts)
	 */
	async editTaskInTui(taskId: string, screen: BlessedScreen, selectedTask?: Task): Promise<TuiTaskEditResult> {
		const contextualTask = selectedTask && taskIdsEqual(selectedTask.id, taskId) ? selectedTask : undefined;

		if (contextualTask && (!isLocalEditableTask(contextualTask) || contextualTask.branch)) {
			return { changed: false, task: contextualTask, reason: "read_only" };
		}

		let resolvedTask: Task | null | undefined = contextualTask ?? (await this.getTask(taskId));
		if (!resolvedTask) {
			try {
				resolvedTask = await this.fs.loadDraft(taskId);
			} catch (error) {
				if (isAmbiguousIdError(error)) {
					return { changed: false, reason: "ambiguous" };
				}
				throw error;
			}
		}
		if (!resolvedTask) {
			return { changed: false, reason: "not_found" };
		}
		if (!isLocalEditableTask(resolvedTask) || resolvedTask.branch) {
			return { changed: false, task: resolvedTask, reason: "read_only" };
		}

		const draftsDir = await this.fs.getDraftsDir();
		const selectedFilePath = resolvedTask.filePath;

		let taskFilePath: string | null = null;
		let draftFilePath: string | null = null;
		let editableTask: Task;

		if (selectedFilePath !== undefined && dirname(selectedFilePath) === draftsDir) {
			// The row's home directory decides its store before any task lookup: a project whose
			// task prefix is "draft" can hold task ids identical to draft ids, so resolving by id
			// first would silently target the task file instead of the selected draft row. The
			// validated reference binds the editor session to this exact file — but a numeric
			// identity shared with another file stays ambiguous and must fail closed here too.
			let validated: Awaited<ReturnType<FileSystem["draftReferenceFromPath"]>>;
			try {
				validated = await this.fs.draftReferenceFromPath(selectedFilePath);
			} catch (error) {
				return {
					changed: false,
					task: resolvedTask,
					reason: error instanceof DraftParseError ? "unreadable" : "identity_conflict",
				};
			}
			const selectedDuplicates = findDuplicateDraftFilenameGroups(await this.fs.listDraftFilenames()).find((group) =>
				group.includes(basename(selectedFilePath)),
			);
			if (selectedDuplicates) {
				return { changed: false, task: resolvedTask, reason: "ambiguous" };
			}
			editableTask = validated.task;
			draftFilePath = validated.filePath;
		} else {
			const localTask = await this.fs.loadTask(resolvedTask.id);
			editableTask = localTask ?? resolvedTask;

			taskFilePath = await getTaskPath(editableTask.id, this);
			if (!taskFilePath) {
				const rowFilePath = editableTask.filePath;
				if (rowFilePath !== undefined && dirname(rowFilePath) === draftsDir) {
					let validatedRow: Awaited<ReturnType<FileSystem["draftReferenceFromPath"]>>;
					try {
						validatedRow = await this.fs.draftReferenceFromPath(rowFilePath);
					} catch (error) {
						return {
							changed: false,
							task: editableTask,
							reason: error instanceof DraftParseError ? "unreadable" : "identity_conflict",
						};
					}
					const rowDuplicates = findDuplicateDraftFilenameGroups(await this.fs.listDraftFilenames()).find((group) =>
						group.includes(basename(rowFilePath)),
					);
					if (rowDuplicates) {
						return { changed: false, task: editableTask, reason: "ambiguous" };
					}
					draftFilePath = validatedRow.filePath;
				} else {
					const resolvedReference = await this.fs.resolveDraftReference(editableTask.id);
					if (!resolvedReference) {
						return { changed: false, task: editableTask, reason: "not_found" };
					}
					editableTask = resolvedReference.task;
					draftFilePath = resolvedReference.filePath;
				}
			}
		}

		const filePath = taskFilePath ?? draftFilePath;
		if (!filePath) {
			return { changed: false, task: editableTask, reason: "not_found" };
		}
		// Re-reading through the validation authority keeps the editor session honest. Parse or
		// read failures and genuine identity conflicts are reported as distinct outcomes. The
		// known on-disk path is attached to reloaded tasks so contentStore publication works.
		const reloadTaskAfterEdit = async (path: string): Promise<{ task: Task } | { failure: "unreadable" }> => {
			try {
				const content = await Bun.file(path).text();
				const reparsed = normalizeTaskIdentity(parseTask(content));
				return { task: { ...reparsed, filePath: path } };
			} catch {
				return { failure: "unreadable" };
			}
		};

		let beforeContent: string;
		try {
			beforeContent = await Bun.file(filePath).text();
		} catch {
			return { changed: false, task: editableTask, reason: "not_found" };
		}

		const opened = await this.openEditor(filePath, screen);
		if (!opened) {
			return { changed: false, task: editableTask, reason: "editor_failed" };
		}

		let afterContent: string;
		try {
			afterContent = await Bun.file(filePath).text();
		} catch {
			return { changed: false, task: editableTask, reason: "not_found" };
		}

		if (afterContent === beforeContent) {
			if (!taskFilePath) {
				try {
					return { changed: false, task: (await this.fs.draftReferenceFromPath(filePath)).task };
				} catch (error) {
					return {
						changed: false,
						task: editableTask,
						reason: error instanceof DraftParseError ? "unreadable" : "identity_conflict",
					};
				}
			}
			const outcome = await reloadTaskAfterEdit(taskFilePath);
			if ("failure" in outcome) {
				return { changed: false, task: editableTask, reason: outcome.failure };
			}
			return { changed: false, task: outcome.task };
		}

		const now = new Date().toISOString().slice(0, 16).replace("T", " ");

		if (!taskFilePath) {
			// Draft close: hold the draft lock around the write+validate window so a concurrent
			// edit cannot interleave with the save. The lock is never held across the interactive
			// editor itself; contention detected inside fails fast and leaves the user's saved
			// content on disk untouched. Identity or parse problems keep their distinct reasons.
			const canonicalId = extractDraftIdFromFilename(basename(filePath)) ?? "";
			try {
				return await this.fs.withDraftLock({ filePath, canonicalId }, async () => {
					const currentOnDisk = await Bun.file(filePath).text();
					if (currentOnDisk !== afterContent) {
						throw newTaskLockError(canonicalId);
					}
					await Bun.write(filePath, upsertTaskUpdatedDate(afterContent, now));
					const validated = await this.fs.draftReferenceFromPath(filePath);
					return { changed: true, task: validated.task };
				});
			} catch (error) {
				if (error instanceof DraftParseError) {
					return { changed: false, task: editableTask, reason: "unreadable" };
				}
				if (error instanceof DraftIdentityError) {
					return { changed: false, task: editableTask, reason: "identity_conflict" };
				}
				throw error;
			}
		}

		await Bun.write(filePath, upsertTaskUpdatedDate(afterContent, now));

		const outcome = await reloadTaskAfterEdit(taskFilePath);
		if ("failure" in outcome) {
			return { changed: false, task: editableTask, reason: outcome.failure };
		}
		const refreshedTask = outcome.task;
		if (this.contentStore && refreshedTask) {
			this.contentStore.upsertTask(refreshedTask);
		}

		return {
			changed: true,
			task: refreshedTask ?? { ...editableTask, updatedDate: now },
		};
	}

	async openEditor(filePath: string, screen?: BlessedScreen): Promise<boolean> {
		const config = await this.fs.loadConfig();

		// If no screen provided, use simple editor opening
		if (!screen) {
			return await openInEditor(filePath, config);
		}

		const program = screen.program;

		// Leave alternate screen buffer FIRST
		screen.leave();

		// Reset keypad/cursor mode using terminfo if available
		if (typeof program.put?.keypad_local === "function") {
			program.put.keypad_local();
			if (typeof program.flush === "function") {
				program.flush();
			}
		}

		// Send escape sequences directly as reinforcement
		// ESC[0m   = Reset all SGR attributes (fixes white background in nano)
		// ESC[?25h = Show cursor (ensure cursor is visible)
		// ESC[?1l  = Reset DECCKM (cursor keys send CSI sequences)
		// ESC>     = DECKPNM (numeric keypad mode)
		const fs = await import("node:fs");
		fs.writeSync(1, "\u001b[0m\u001b[?25h\u001b[?1l\u001b>");

		// Pause the terminal AFTER leaving alt buffer (disables raw mode, releases terminal)
		const resume = typeof program.pause === "function" ? program.pause() : undefined;
		try {
			return await openInEditor(filePath, config);
		} finally {
			// Resume terminal state FIRST (re-enables raw mode)
			if (typeof resume === "function") {
				resume();
			}
			// Re-enter alternate screen buffer
			screen.enter();
			// Restore application cursor mode
			if (typeof program.put?.keypad_xmit === "function") {
				program.put.keypad_xmit();
				if (typeof program.flush === "function") {
					program.flush();
				}
			}
			// Full redraw
			screen.render();
		}
	}

	/**
	 * Load and process all tasks with the same logic as CLI overview
	 * This method extracts the common task loading logic for reuse
	 */
	async loadAllTasksForStatistics(
		progressCallback?: (msg: string) => void,
	): Promise<{ tasks: Task[]; drafts: Task[]; statuses: string[]; priorities: string[] }> {
		const snapshot = await this.loadTaskCorpusSnapshot(progressCallback);
		const config = snapshot.config;
		const statuses = (config?.statuses || DEFAULT_STATUSES) as string[];
		const priorities = config?.priorities ?? [];
		if (!snapshot.identityIndex) throw new Error("Task corpus identity index was not initialized");
		const tasks = snapshot.identityIndex.getTasks(true);

		// Load drafts
		progressCallback?.("Loading drafts...");
		const drafts = await this.fs.listDrafts();

		return { tasks, drafts, statuses: statuses as string[], priorities };
	}

	/**
	 * Load all tasks with cross-branch support
	 * This is the single entry point for loading tasks across all interfaces
	 */
	async loadTasks(
		progressCallback?: (msg: string) => void,
		abortSignal?: AbortSignal,
		options?: { includeCompleted?: boolean },
	): Promise<Task[]> {
		return (
			await this.loadTasksWithStableBranchSnapshot({
				progressCallback,
				abortSignal,
				includeCompleted: options?.includeCompleted,
			})
		).tasks;
	}

	private async loadTaskCorpusSnapshot(
		progressCallback?: (message: string) => void,
		options?: { publishSharedState?: boolean },
	): Promise<TaskCorpusSnapshot> {
		return await this.loadTasksWithStableBranchSnapshot({
			progressCallback,
			includeCompleted: true,
			visibleCompleted: false,
			publishSharedState: options?.publishSharedState,
		});
	}

	/**
	 * The ContentStore's corpus loader. By default its result becomes the shared cross-branch
	 * state; pass { publish: false } for a throwaway load (e.g. resolving one task's identity)
	 * whose result must not be installed on the store's behalf.
	 */
	private async loadContentStoreCorpus(
		progressCallback?: (message: string) => void,
		options?: { publish?: boolean },
	): Promise<TaskCorpusSnapshot> {
		if (Object.hasOwn(this, "loadTasks")) {
			const [activeTasks, completedTasks, config] = await Promise.all([
				this.loadTasks(progressCallback),
				this.fs.listCompletedTasks(),
				this.fs.loadConfig(),
			]);
			const identityIndex = await this.buildTaskIdentityIndex(
				activeTasks,
				completedTasks,
				[],
				config?.statuses ?? [...DEFAULT_STATUSES],
				config?.taskResolutionStrategy ?? "most_progressed",
			);
			return {
				tasks: identityIndex.getTasks(false),
				activeTasks,
				completedTasks,
				identityIndex,
				branchStateEntries: [],
				config,
			};
		}
		return await this.loadTaskCorpusSnapshot(progressCallback, { publishSharedState: options?.publish ?? true });
	}

	private async loadTasksWithStableBranchSnapshot(
		options: TaskCorpusLoadOptions,
		snapshotAttempt = 0,
		retrySnapshot?: ActiveBranchSnapshot,
	): Promise<TaskCorpusSnapshot> {
		const { progressCallback, abortSignal } = options;
		const generation = this.projectGeneration;
		const filesystem = this.fs;
		const git = this.git;
		const branchTaskLoader = this.branchTaskLoader;
		const projectRoot = filesystem.rootDir;
		const backlogRoot = filesystem.backlogDir;
		const projectChanged = () =>
			generation !== this.projectGeneration ||
			filesystem !== this.fs ||
			git !== this.git ||
			branchTaskLoader !== this.branchTaskLoader ||
			projectRoot !== this.fs.rootDir ||
			backlogRoot !== filesystem.backlogDir;
		const retryForCurrentProject = async (nextSnapshot?: ActiveBranchSnapshot) => {
			if (snapshotAttempt >= 2) {
				throw new Error("Project root or active branch refs kept changing while tasks were loading");
			}
			return await this.loadTasksWithStableBranchSnapshot(options, snapshotAttempt + 1, nextSnapshot);
		};

		const config = await filesystem.loadConfig();
		if (projectChanged()) return await retryForCurrentProject();
		git.setConfig(config);
		// A cancelled load must not wait out the fetch timeout before noticing.
		if (abortSignal?.aborted) {
			throw new Error("Loading cancelled");
		}
		await this.refreshRemoteRefsForTaskRead(config, git, { force: options.forceRemoteRefresh });
		if (projectChanged()) return await retryForCurrentProject();
		const settingsKey = JSON.stringify(this.getActiveBranchSettings(config, filesystem));
		const snapshotBefore =
			retrySnapshot?.settingsKey === settingsKey
				? retrySnapshot
				: await this.getActiveBranchSnapshot(config, generation, filesystem, git);
		if (projectChanged()) return await retryForCurrentProject();
		const statuses = config?.statuses || [...DEFAULT_STATUSES];
		const resolutionStrategy = config?.taskResolutionStrategy || "most_progressed";
		const includeCompleted = options.includeCompleted ?? false;
		const shouldLoadBranches = config?.checkActiveBranches !== false && config?.filesystemOnly !== true;

		// Check for cancellation
		if (abortSignal?.aborted) {
			throw new Error("Loading cancelled");
		}

		// Load local filesystem tasks first (needed for optimization)
		const [localTasks, completedTasks] = await Promise.all([
			this.listTasksWithMetadata(false, filesystem, git),
			filesystem.listCompletedTasks(),
		]);
		if (projectChanged()) return await retryForCurrentProject();

		// Check for cancellation
		if (abortSignal?.aborted) {
			throw new Error("Loading cancelled");
		}

		// Load tasks from remote branches and other local branches in parallel
		// Skip entirely when cross-branch scanning is disabled
		const branchStateEntries: BranchTaskStateEntry[] = [];
		let branchLoadComplete = true;

		let backlogDir: string | null = null;
		if (shouldLoadBranches) {
			progressCallback?.(getTaskLoadingMessage(config));
			backlogDir = filesystem.backlogDirName;
			const branchLoad = await branchTaskLoader.load(
				snapshotBefore.branchTips,
				config,
				localTasks,
				includeCompleted,
				backlogDir,
				progressCallback,
				snapshotBefore.currentBranch,
			);
			branchStateEntries.push(...branchLoad.entries);
			branchLoadComplete = branchLoad.complete;
			if (projectChanged()) return await retryForCurrentProject();
		}

		// Check for cancellation after loading
		if (abortSignal?.aborted) {
			throw new Error("Loading cancelled");
		}

		// Check for cancellation before identity resolution
		if (abortSignal?.aborted) {
			throw new Error("Loading cancelled");
		}

		if (shouldLoadBranches) {
			progressCallback?.("Applying latest task states from branch scans...");
		}
		const identityIndex = await this.buildTaskIdentityIndex(
			localTasks,
			completedTasks,
			branchStateEntries,
			statuses,
			resolutionStrategy,
			undefined,
			filesystem,
			git,
		);
		if (projectChanged()) return await retryForCurrentProject();
		const filteredTasks = identityIndex.getTasks(options.visibleCompleted ?? includeCompleted);

		// This read must begin after this scan finishes. Reusing an unrelated
		// in-flight pre-scan snapshot could otherwise publish a generation that
		// moved while immutable commit trees were still being indexed.
		const snapshotAfter = await this.computeActiveBranchSnapshot(await filesystem.loadConfig(), filesystem, git);
		if (projectChanged()) return await retryForCurrentProject();
		if (snapshotBefore.stabilityFingerprint !== snapshotAfter.stabilityFingerprint) {
			return await retryForCurrentProject(snapshotAfter);
		}
		// Only the corpus this Core installs into its ContentStore may advance shared
		// freshness state. A standalone load (statistics, ID allocation, a TUI board
		// read) that publishes its refs would make every later read believe the store
		// already holds them and serve the older corpus until the refs move again.
		// Healthy branches remain publishable after a partial read, but an
		// incomplete generation must retry even while its refs stay unchanged.
		if (options.publishSharedState) {
			this.activeBranchFingerprint = branchLoadComplete ? snapshotAfter.fingerprint : null;
		}
		if (shouldLoadBranches && backlogDir) {
			branchTaskLoader.retainSnapshot(snapshotAfter.branchTips, {
				backlogDir,
				prefix: config?.prefixes?.task ?? "task",
				activeBranchDays: config?.activeBranchDays ?? 30,
			});
		} else {
			branchTaskLoader.clear();
		}
		return {
			tasks: filteredTasks,
			activeTasks: localTasks,
			completedTasks,
			identityIndex,
			branchStateEntries,
			config,
		};
	}
}

/**
 * Builds a Core bound to the project every interface resolves the same way: the runtime working
 * directory (`--cwd`/`BACKLOG_CWD`, else `process.cwd()`), then walked up to the project root just
 * like the CLI commands do. When no project is found the resolved directory is used as-is, so
 * callers keep degrading to their own fallbacks instead of failing.
 * Prefer passing an existing Core; use this only where no instance is available.
 */
export async function createRuntimeCore(options?: { enableWatchers?: boolean }): Promise<Core> {
	const { cwd } = await resolveRuntimeCwd();
	return new Core((await findBacklogRoot(cwd)) ?? cwd, options);
}
