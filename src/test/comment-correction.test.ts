import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import { CommentsManager } from "../markdown/structured-sections.ts";
import type { Task, TaskComment } from "../types/index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const CLI_PATH = getTestCliPath();
let TEST_DIR: string;

type Comments = NonNullable<Task["comments"]>;

const fingerprintOf = (comment: TaskComment | undefined): string => {
	if (!comment) throw new Error("expected a comment to fingerprint");
	return CommentsManager.fingerprint(comment);
};

const fingerprints = (comments: Comments): string[] => comments.map((comment) => CommentsManager.fingerprint(comment));

const seedComments = (bodies: string[]): TaskComment[] =>
	bodies.map((body, index) => ({
		index: index + 1,
		author: index % 2 === 0 ? "@first" : "@second",
		createdDate: `2026-06-0${index + 1} 0${index + 1}:00`,
		body,
	}));

const createTaskWithComments = async (title: string, bodies: string[]): Promise<Task> => {
	const core = new Core(TEST_DIR);
	const task: Task = {
		id: "task-1",
		title,
		status: "To Do",
		assignee: [],
		createdDate: "2026-05-31 10:00",
		labels: [],
		dependencies: [],
		description: "Task description",
		comments: seedComments(bodies),
	};
	await core.createTask(task, false);
	const loaded = await core.filesystem.loadTask("task-1");
	if (!loaded) throw new Error("expected task-1 to exist");
	return loaded;
};

const loadComments = async (): Promise<Comments> => {
	const core = new Core(TEST_DIR);
	const loaded = await core.filesystem.loadTask("task-1");
	return loaded?.comments ?? [];
};

const taskContent = async (): Promise<string> => (await new Core(TEST_DIR).getTaskContent("task-1")) ?? "";

describe("Comment correction and redaction", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-comment-correction");
		await mkdir(TEST_DIR, { recursive: true });
		const core = new Core(TEST_DIR);
		await initializeFilesystemTestProject(core, "Comment Correction Test Project");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("corrects one comment of several while preserving its author, time, and neighbors", async () => {
		await createTaskWithComments("Multi comment task", ["first body", "second body", "third body"]);
		const beforeFingerprints = fingerprints(await loadComments());

		const core = new Core(TEST_DIR);
		const updated = await core.updateTaskFromInput("task-1", {
			editComment: { target: `#2@${beforeFingerprints[1]}`, body: "second body corrected", editor: "@reviewer" },
		});

		const corrected = updated.comments?.[1];
		expect(corrected?.body).toBe("second body corrected");
		expect(corrected?.author).toBe("@second");
		expect(corrected?.createdDate).toBe("2026-06-02 02:00");
		expect(corrected?.history?.[0]).toMatchObject({ action: "edited", editor: "@reviewer", body: "second body" });

		// Neighbors keep their identity: bodies, metadata, and fingerprints are untouched.
		const after = await loadComments();
		expect(after[0]?.body).toBe("first body");
		expect(after[2]?.body).toBe("third body");
		expect(fingerprints(after)[0]).toBe(beforeFingerprints[0]);
		expect(fingerprints(after)[2]).toBe(beforeFingerprints[2]);
	});

	it("keeps the correction record visible in the file and stable across round trips", async () => {
		await createTaskWithComments("Round trip task", ["original text"]);
		const before = await loadComments();

		const core = new Core(TEST_DIR);
		await core.updateTaskFromInput("task-1", {
			editComment: { target: `#1@${fingerprintOf(before[0])}`, body: "corrected text", editor: "@alex" },
		});

		let core2 = new Core(TEST_DIR);
		let content = await taskContent();
		expect(content).toContain("edited: ");
		expect(content).toContain("by @alex");
		expect(content).toContain("---\noriginal text\n---");
		expect(content).toContain("corrected text");

		// A second correction extends the record; parsing survives every round trip.
		const loaded = await core2.filesystem.loadTask("task-1");
		const firstHistory = loaded?.comments?.[0]?.history ?? [];
		expect(firstHistory).toHaveLength(1);
		expect(firstHistory[0]).toMatchObject({ action: "edited", editor: "@alex", body: "original text" });

		await core2.updateTaskFromInput("task-1", {
			editComment: { target: `#1@${fingerprintOf(loaded?.comments?.[0])}`, body: "second correction", editor: "@kim" },
		});

		core2 = new Core(TEST_DIR);
		const reloaded = await core2.filesystem.loadTask("task-1");
		content = await taskContent();
		const secondHistory = reloaded?.comments?.[0]?.history ?? [];
		expect(reloaded?.comments?.[0]?.body).toBe("second correction");
		expect(reloaded?.comments?.[0]?.createdDate).toBe("2026-06-01 01:00");
		expect(secondHistory).toEqual([
			{ action: "edited", date: firstHistory[0]?.date ?? "", editor: "@alex", body: "original text" },
			{ action: "edited", date: secondHistory[1]?.date ?? "", editor: "@kim", body: "corrected text" },
		]);
		expect(secondHistory).toHaveLength(2);
		expect(content).toContain("original text");
		expect(content).toContain("corrected text");
	});

	it("redacts a comment without retaining its content and never erases the record", async () => {
		await createTaskWithComments("Redaction task", ["sensitive content"]);
		const before = await loadComments();
		const target = `#1@${fingerprintOf(before[0])}`;

		const core = new Core(TEST_DIR);
		const updated = await core.updateTaskFromInput("task-1", { redactComment: { target, editor: "@moderator" } });

		const redacted = updated.comments?.[0];
		expect(redacted?.body).toBe(`[Redacted by @moderator on ${redacted?.history?.[0]?.date ?? ""}.]`);
		expect(redacted?.author).toBe("@first");
		expect(redacted?.createdDate).toBe("2026-06-01 01:00");
		expect(redacted?.history?.[0]).toMatchObject({ action: "redacted", editor: "@moderator" });

		// The redacted content is gone from the file, but the record is visible.
		const content = await taskContent();
		expect(content).not.toContain("sensitive content");
		expect(content).toContain("redacted: ");
		expect(content).toContain("by @moderator");
		expect(content).toContain("[Redacted by @moderator");

		// Redaction is terminal: the record cannot be edited or redacted away.
		const redactedFingerprint = fingerprintOf(redacted);
		await expect(
			core.updateTaskFromInput("task-1", {
				editComment: { target: `#1@${redactedFingerprint}`, body: "bring it back", editor: "@alex" },
			}),
		).rejects.toThrow("was redacted and cannot be edited");
		await expect(
			core.updateTaskFromInput("task-1", {
				redactComment: { target: `#1@${redactedFingerprint}`, editor: "@moderator" },
			}),
		).rejects.toThrow("already redacted");
		const finalContent = await taskContent();
		expect(finalContent).toContain("redacted: ");
		expect(finalContent).toContain("by @moderator");
	});

	it("rejects stale, missing, and ambiguous targets without altering existing comments", async () => {
		// Comments #1 and #3 are duplicate-looking: identical author, time, and body.
		const core = new Core(TEST_DIR);
		await core.createTask(
			{
				id: "task-1",
				title: "Target task",
				status: "To Do",
				assignee: [],
				createdDate: "2026-05-31 10:00",
				labels: [],
				dependencies: [],
				description: "Task description",
				comments: [
					{ index: 1, author: "@same", createdDate: "2026-06-01 01:00", body: "duplicate body" },
					{ index: 2, author: "@other", createdDate: "2026-06-02 02:00", body: "unique body" },
					{ index: 3, author: "@same", createdDate: "2026-06-01 01:00", body: "duplicate body" },
				],
			},
			false,
		);
		const before = await loadComments();
		const beforeFingerprints = fingerprints(before);
		const rawBefore = await taskContent();

		const failing: Array<{ input: object; message: RegExp }> = [
			{
				input: { editComment: { target: `#2@${"0".repeat(8)}`, body: "x", editor: "@a" } },
				message: /does not match fingerprint/,
			},
			{
				input: { editComment: { target: "#2", body: "x", editor: "@a" } },
				message: /needs the comment fingerprint/,
			},
			{
				input: { editComment: { target: `#9@${beforeFingerprints[0]}`, body: "x", editor: "@a" } },
				message: /Comment #9 not found/,
			},
			{
				input: { editComment: { target: "not-a-target", body: "x", editor: "@a" } },
				message: /Invalid comment target/,
			},
			{
				input: { editComment: { target: "#2x", body: "x", editor: "@a" } },
				message: /Invalid comment target/,
			},
			{
				input: { editComment: { target: "#2@zzzzzz", body: "x", editor: "@a" } },
				message: /Invalid comment target/,
			},
			{
				input: {
					editComment: { target: fingerprintOf(before[0]), body: "x", editor: "@a" },
				},
				message: /target is ambiguous[\s\S]*#1, #3/,
			},
			{
				input: { redactComment: { target: `#2@${"0".repeat(8)}`, editor: "@a" } },
				message: /does not match fingerprint/,
			},
		];
		for (const { input, message } of failing) {
			await expect(core.updateTaskFromInput("task-1", input)).rejects.toThrow(message);
		}

		expect(fingerprints(await loadComments())).toEqual(beforeFingerprints);
		expect(await taskContent()).toBe(rawBefore);
	});

	it("resolves a unique fingerprint and keeps fingerprints stable across unrelated edits", async () => {
		await createTaskWithComments("Stable task", ["only this body is unique"]);
		const [uniqueFingerprint] = fingerprints(await loadComments());
		if (!uniqueFingerprint) throw new Error("expected a comment fingerprint");
		const core = new Core(TEST_DIR);

		// Appending an unrelated comment changes nothing about the existing one.
		await core.updateTaskFromInput("task-1", { appendComments: [{ body: "later addition", author: "@late" }] });
		expect(fingerprints(await loadComments())[0]).toBe(uniqueFingerprint);

		const updated = await core.updateTaskFromInput("task-1", {
			editComment: { target: uniqueFingerprint, body: "found by fingerprint", editor: "@alex" },
		});
		expect(updated.comments?.[0]?.body).toBe("found by fingerprint");
	});

	it("still targets the comment by fingerprint after its index shifted", async () => {
		await createTaskWithComments("Shift task", ["first", "second", "third"]);
		const secondFingerprint = fingerprints(await loadComments())[1];
		if (!secondFingerprint) throw new Error("expected a second comment fingerprint");

		// An out-of-band removal shifts every later index.
		const shifter = new Core(TEST_DIR);
		const loaded = await shifter.filesystem.loadTask("task-1");
		if (!loaded?.comments) throw new Error("expected comments");
		loaded.comments = loaded.comments.slice(1);
		await shifter.updateTask(loaded, false);

		const core = new Core(TEST_DIR);
		// The positional target now fails closed: #2 is a different comment.
		await expect(
			core.updateTaskFromInput("task-1", {
				editComment: { target: `#2@${secondFingerprint}`, body: "shifted edit", editor: "@alex" },
			}),
		).rejects.toThrow(/does not match fingerprint/);
		// The fingerprint itself still resolves the same comment at its new position.
		const updated = await core.updateTaskFromInput("task-1", {
			editComment: { target: secondFingerprint, body: "shifted edit", editor: "@alex" },
		});
		expect(updated.comments?.[0]?.body).toBe("shifted edit");
	});

	it("leaves the comment unchanged when the corrected body equals the current body", async () => {
		await createTaskWithComments("No-op task", ["same text"]);
		const before = await loadComments();
		const rawBefore = await taskContent();
		const core = new Core(TEST_DIR);
		const updated = await core.updateTaskFromInput("task-1", {
			editComment: { target: `#1@${fingerprintOf(before[0])}`, body: "same text", editor: "@alex" },
		});
		expect(updated.comments?.[0]?.history ?? []).toEqual([]);
		expect(await taskContent()).toBe(rawBefore);
	});
});

describe("Comment correction CLI", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-comment-correction-cli");
		await mkdir(TEST_DIR, { recursive: true });
		const core = new Core(TEST_DIR);
		await initializeFilesystemTestProject(core, "Comment Correction CLI Project");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	const createTaskWithComments = async (title: string, bodies: string[]): Promise<void> => {
		const create = await $`bun ${[CLI_PATH, "task", "create", title]}`.cwd(TEST_DIR).quiet().nothrow();
		expect(create.exitCode).toBe(0);
		for (const body of bodies) {
			const append = await $`bun ${[CLI_PATH, "task", "edit", "1", "--comment", body, "--comment-author", "@cli"]}`
				.cwd(TEST_DIR)
				.quiet()
				.nothrow();
			expect(append.exitCode).toBe(0);
		}
	};

	type JsonComment = {
		index: number;
		body: string;
		author: string | null;
		fingerprint: string;
		history: Array<{ action: string; date: string | null; editor: string | null; body: string | null }>;
	};

	const viewComments = async (): Promise<JsonComment[]> => {
		const view = await $`bun ${[CLI_PATH, "task", "view", "1", "--json"]}`.cwd(TEST_DIR).quiet().nothrow();
		expect(view.exitCode).toBe(0);
		return JSON.parse(view.stdout.toString()).task.comments;
	};

	const requireComments = (comments: JsonComment[], count: number): JsonComment[] => {
		if (comments.length < count) throw new Error(`expected ${count} comments, found ${comments.length}`);
		return comments;
	};

	const at = <T>(items: T[], index: number): T => {
		const item = items[index];
		if (item === undefined) throw new Error(`expected an item at index ${index}`);
		return item;
	};

	it("corrects and redacts one comment through the CLI and exposes fingerprint and history in JSON", async () => {
		await createTaskWithComments("CLI correction task", ["cli first", "cli second"]);
		const comments = requireComments(await viewComments(), 2);
		const firstComment = at(comments, 0);
		const secondComment = at(comments, 1);
		expect(firstComment.fingerprint).toMatch(/^[0-9a-f]{8}$/);
		expect(secondComment.fingerprint).toMatch(/^[0-9a-f]{8}$/);
		expect(firstComment.history).toEqual([]);
		expect(secondComment.history).toEqual([]);

		const edit = await $`bun ${[
			CLI_PATH,
			"task",
			"edit",
			"1",
			"--edit-comment",
			`#${secondComment.index}@${secondComment.fingerprint}`,
			"--comment-text",
			"cli second corrected",
			"--comment-editor",
			"@agent",
			"--plain",
		]}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(edit.exitCode).toBe(0);
		const output = edit.stdout.toString();
		expect(output).toContain("cli second corrected");
		expect(output).toContain("History:");
		expect(output).toContain("@agent edited");
		expect(output).toContain("cli second\n");

		const afterEdit = requireComments(await viewComments(), 2);
		const afterFirst = at(afterEdit, 0);
		const afterSecond = at(afterEdit, 1);
		expect(afterSecond.body).toBe("cli second corrected");
		expect(afterSecond.author).toBe("@cli");
		expect(afterSecond.history[0]).toMatchObject({
			action: "edited",
			editor: "@agent",
			body: "cli second",
		});

		// The targeted read path agrees with the inline plain view.
		const history = await $`bun ${[CLI_PATH, "task", "view", "1", "--comment-history", "2"]}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(history.exitCode).toBe(0);
		expect(history.stdout.toString()).toContain("@agent edited");
		expect(history.stdout.toString()).toContain("cli second");

		// Redact through the CLI: content gone, record visible, retargeting fails.
		const redact = await $`bun ${[
			CLI_PATH,
			"task",
			"edit",
			"1",
			"--redact-comment",
			`#${afterFirst.index}@${afterFirst.fingerprint}`,
			"--comment-editor",
			"@moderator",
			"--plain",
		]}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(redact.exitCode).toBe(0);
		expect(redact.stdout.toString()).toContain("[Redacted by @moderator");

		const redactedComment = at(requireComments(await viewComments(), 1), 0);
		expect(redactedComment.body).not.toContain("cli first");
		expect(redactedComment.history[0]?.action).toBe("redacted");

		const reRedact = await $`bun ${[
			CLI_PATH,
			"task",
			"edit",
			"1",
			"--redact-comment",
			`#${redactedComment.index}@${redactedComment.fingerprint}`,
			"--comment-editor",
			"@moderator",
		]}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(reRedact.exitCode).not.toBe(0);
	});

	it("fails without altering comments when the CLI target is stale, missing evidence, or ambiguous", async () => {
		await createTaskWithComments("CLI target task", ["same body", "same body"]);
		const comments = requireComments(await viewComments(), 2);
		const firstComment = at(comments, 0);
		const secondComment = at(comments, 1);
		expect(firstComment.fingerprint).toBe(secondComment.fingerprint);
		const rawBefore = await taskContent();

		const failing: Array<{ args: string[]; message: RegExp }> = [
			{
				args: ["--edit-comment", `#1@${"0".repeat(8)}`, "--comment-text", "x", "--comment-editor", "@a"],
				message: /does not match fingerprint/,
			},
			{
				args: ["--edit-comment", "1", "--comment-text", "x", "--comment-editor", "@a"],
				message: /needs the comment fingerprint/,
			},
			{
				args: ["--edit-comment", `#1@${firstComment.fingerprint}`, "--comment-text", "x"],
				message: /editor name is required/,
			},
			{
				args: ["--edit-comment", `#1@${firstComment.fingerprint}`],
				message: /--comment-text needs the corrected comment body/,
			},
			{
				args: ["--comment-text", "x", "--comment-editor", "@a"],
				message: /--comment-text replaces the body of a comment/,
			},
			{
				args: ["--comment-editor", "@a"],
				message: /--comment-editor records who corrected a comment/,
			},
			{
				args: ["--redact-comment", firstComment.fingerprint, "--comment-editor", "@a"],
				message: /target is ambiguous[\s\S]*#1, #2/,
			},
			{
				args: ["--edit-comment", "garbage", "--comment-text", "x", "--comment-editor", "@a"],
				message: /Invalid comment target/,
			},
		];
		for (const { args, message } of failing) {
			const result = await $`bun ${[CLI_PATH, "task", "edit", "1", ...args]}`.cwd(TEST_DIR).quiet().nothrow();
			expect(result.exitCode).not.toBe(0);
			expect(`${result.stderr.toString()}${result.stdout.toString()}`).toMatch(message);
		}

		expect(await taskContent()).toBe(rawBefore);
		const unchanged = at(requireComments(await viewComments(), 2), 0);
		expect(unchanged.fingerprint).toBe(firstComment.fingerprint);
		expect(unchanged.history).toEqual([]);
	});

	it("corrects draft comments through the draft CLI paths", async () => {
		const create = await $`bun ${[CLI_PATH, "draft", "create", "Draft with comments"]}`.cwd(TEST_DIR).quiet().nothrow();
		expect(create.exitCode).toBe(0);
		const append =
			await $`bun ${[CLI_PATH, "draft", "edit", "1", "--comment", "draft original", "--comment-author", "@drafter"]}`
				.cwd(TEST_DIR)
				.quiet()
				.nothrow();
		expect(append.exitCode).toBe(0);

		const core = new Core(TEST_DIR);
		const draft = await core.filesystem.loadDraft("draft-1");
		expect(draft?.comments?.[0]?.body).toBe("draft original");

		const edit = await $`bun ${[
			CLI_PATH,
			"draft",
			"edit",
			"1",
			"--edit-comment",
			`#1@${fingerprintOf(draft?.comments?.[0])}`,
			"--comment-text",
			"draft corrected",
			"--comment-editor",
			"@editor",
			"--plain",
		]}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(edit.exitCode).toBe(0);
		expect(edit.stdout.toString()).toContain("draft corrected");
		expect(edit.stdout.toString()).toContain("@editor edited");

		const history = await $`bun ${[CLI_PATH, "draft", "view", "1", "--comment-history", "1"]}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(history.exitCode).toBe(0);
		expect(history.stdout.toString()).toContain("draft original");

		const corrected = await core.filesystem.loadDraft("draft-1");
		const redact = await $`bun ${[
			CLI_PATH,
			"draft",
			"edit",
			"1",
			"--redact-comment",
			`#1@${fingerprintOf(corrected?.comments?.[0])}`,
			"--comment-editor",
			"@moderator",
		]}`
			.cwd(TEST_DIR)
			.quiet()
			.nothrow();
		expect(redact.exitCode).toBe(0);
		const redacted = await core.filesystem.loadDraft("draft-1");
		expect(redacted?.comments?.[0]?.body).not.toContain("draft corrected");
		expect(redacted?.comments?.[0]?.body).toContain("[Redacted by @moderator");
		expect(redacted?.comments?.[0]?.history).toHaveLength(2);
	});
});
