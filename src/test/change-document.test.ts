import { describe, expect, it } from "bun:test";
import { type ChangeLinkResolver, parseChangeDocument, validateChangeContent } from "../markdown/change-document.ts";
import type { Document } from "../types/index.ts";

const SESSION_SPEC = `# Session behavior

### Requirement: Sessions expire [SES-1]

The system SHALL expire sessions after 30 days.

#### Scenario: Expired session

- WHEN a client presents an expired token
- THEN the request is rejected

### Requirement: Expiry emails [SES-2]

The system SHALL email users when a session expires.
`;

const FILE_SPEC = `# File naming

### Requirement: Kebab file names [FIL-1]

The system SHALL name files in kebab-case.
`;

const VALID_CHANGE = `# Change: Warn before expiry

## Why

Sessions end silently and users lose work.

## Scope

The session library and its specifications.

## Affected specs

- doc-12
- doc-13

## Linked tasks

- task-3

## Related decisions

- decision-2

## Added requirements

### Requirement: Warn before expiry [SES-3]

The system SHALL warn one day before expiry.

#### Scenario: Expiring soon

- WHEN a session expires within one day
- THEN the client receives a warning

## Modified requirements

### Requirement: Sessions expire after 14 days [SES-1]

The system SHALL expire sessions after 14 days.

## Removed requirements

### Requirement: Expiry emails [SES-2]
`;

function specDocument(id: string, rawContent: string): Document {
	return { id, title: id, type: "specification", createdDate: "2026-10-07 08:00", rawContent };
}

function makeResolver(docs: Document[] = [], tasks: string[] = [], decisions: string[] = []): ChangeLinkResolver {
	return {
		getDocument: async (id) => docs.find((doc) => doc.id.toLowerCase() === id.toLowerCase()) ?? null,
		hasTask: async (id) => tasks.includes(id),
		hasDecision: async (id) => decisions.includes(id),
	};
}

const FULL_RESOLVER = makeResolver(
	[specDocument("doc-12", SESSION_SPEC), specDocument("doc-13", FILE_SPEC)],
	["task-3"],
	["decision-2"],
);

async function expectError(content: string, resolver: ChangeLinkResolver, ...messages: string[]) {
	let error: Error | undefined;
	try {
		await validateChangeContent(content, resolver);
	} catch (caught) {
		error = caught as Error;
	}
	expect(error).toBeDefined();
	for (const message of messages) {
		expect(error?.message).toContain(message);
	}
}

describe("change document parser", () => {
	it("parses link lists and delta requirements with absolute line numbers", () => {
		const parsed = parseChangeDocument(VALID_CHANGE);

		expect(parsed.affectedSpecs.map((entry) => entry.id)).toEqual(["doc-12", "doc-13"]);
		expect(parsed.linkedTasks.map((entry) => entry.id)).toEqual(["task-3"]);
		expect(parsed.relatedDecisions.map((entry) => entry.id)).toEqual(["decision-2"]);
		expect(parsed.added.map((requirement) => requirement.id)).toEqual(["SES-3"]);
		expect(parsed.modified.map((requirement) => requirement.id)).toEqual(["SES-1"]);
		expect(parsed.removed.map((requirement) => requirement.id)).toEqual(["SES-2"]);
		expect(parsed.issues).toEqual([]);

		// Delta line numbers stay absolute so validation errors point into the document.
		const specListLine = parsed.affectedSpecs[0]?.line ?? 0;
		const addedLine = parsed.added[0]?.line ?? 0;
		const removedLine = parsed.removed[0]?.line ?? 0;
		expect(specListLine).toBeGreaterThan(0);
		expect(addedLine).toBeGreaterThan(specListLine);
		expect(removedLine).toBeGreaterThan(addedLine);
	});

	it("ignores requirement-shaped headings outside delta sections", () => {
		const parsed = parseChangeDocument(
			"## Why\n\n### Requirement: not a delta [X-1]\n\nJust prose mentioning the convention.\n",
		);
		expect(parsed.added).toEqual([]);
		expect(parsed.modified).toEqual([]);
		expect(parsed.removed).toEqual([]);
	});

	it("keeps fenced code inside a delta section from splitting sections or adding requirements", () => {
		const parsed = parseChangeDocument(
			[
				"## Added requirements",
				"",
				"```text",
				"## Removed requirements",
				"### Requirement: not real [FAKE-1]",
				"```",
				"",
				"### Requirement: Real requirement [NEW-1]",
				"",
				"The system SHALL work.",
				"",
			].join("\n"),
		);
		expect(parsed.added.map((requirement) => requirement.id)).toEqual(["NEW-1"]);
		expect(parsed.removed).toEqual([]);
	});
});

describe("change document validation", () => {
	it("accepts a valid change linking several specs, a task, and a decision", async () => {
		await expect(validateChangeContent(VALID_CHANGE, FULL_RESOLVER)).resolves.toBeUndefined();
	});

	it("accepts a minimal change with no links or deltas", async () => {
		await expect(validateChangeContent("# Change: note only\n", FULL_RESOLVER)).resolves.toBeUndefined();
	});

	it("rejects an affected spec that matches no document", async () => {
		await expectError(
			"## Affected specs\n\n- doc-99\n",
			FULL_RESOLVER,
			'Affected spec "doc-99" does not match any document.',
		);
	});

	it("rejects an affected spec that is not a specification document", async () => {
		const resolver = makeResolver(
			[{ id: "doc-5", title: "Guide", type: "guide", createdDate: "", rawContent: "" }],
			[],
			[],
		);
		await expectError(
			"## Affected specs\n\n- doc-5\n",
			resolver,
			'Affected spec "doc-5" is a guide document, not a specification.',
		);
	});

	it("rejects linked tasks and decisions that do not exist", async () => {
		await expectError(
			"## Linked tasks\n\n- task-99\n\n## Related decisions\n\n- decision-9\n",
			FULL_RESOLVER,
			'Linked task "task-99" does not exist.',
			'Related decision "decision-9" does not exist.',
		);
	});

	it("rejects a modified requirement missing from the affected specs", async () => {
		await expectError(
			"## Affected specs\n\n- doc-12\n\n## Modified requirements\n\n### Requirement: Anything [SES-9]\n",
			FULL_RESOLVER,
			'Requirement "SES-9" does not exist in the affected specs.',
		);
	});

	it("rejects a modified requirement ambiguous across several affected specs", async () => {
		const resolver = makeResolver([specDocument("doc-12", SESSION_SPEC), specDocument("doc-13", SESSION_SPEC)]);
		await expectError(
			"## Affected specs\n\n- doc-12\n- doc-13\n\n## Modified requirements\n\n### Requirement: Sessions expire [SES-1]\n",
			resolver,
			'Requirement "SES-1" is ambiguous: it exists in doc-12 and doc-13.',
		);
	});

	it("rejects an added requirement reusing an existing specification requirement ID", async () => {
		await expectError(
			"## Affected specs\n\n- doc-12\n\n## Added requirements\n\n### Requirement: Sessions expire [SES-1]\n",
			FULL_RESOLVER,
			'Added requirement ID "SES-1" already exists in affected spec doc-12.',
		);
	});

	it("rejects modified and removed deltas without a requirement ID", async () => {
		await expectError(
			"## Modified requirements\n\n### Requirement: Untitled\n\n## Removed requirements\n\n### Requirement: Also untitled\n",
			FULL_RESOLVER,
			"Modified requirement has no ID.",
			"Removed requirement has no ID.",
		);
	});

	it("rejects duplicate requirement IDs across delta sections", async () => {
		await expectError(
			"## Added requirements\n\n### Requirement: First [NEW-1]\n\n## Added requirements\n\n### Requirement: Second [NEW-1]\n",
			FULL_RESOLVER,
			'Duplicate requirement ID "NEW-1"',
		);
	});

	it("rejects a scenario outside any requirement inside a delta section at an absolute line", async () => {
		await expectError(
			"## Added requirements\n\n#### Scenario: Orphaned\n",
			FULL_RESOLVER,
			'- line 3: Scenario "Orphaned" is not inside a requirement',
		);
	});
});
