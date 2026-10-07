import { describe, expect, it } from "bun:test";
import {
	buildChangeDocumentPreview,
	type ChangeLinkResolver,
	parseChangeDocument,
	specBaselineHash,
	validateChangeContent,
	withRecordedBaselines,
} from "../markdown/change-document.ts";
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

// Two affected specs with only modified and removed deltas: valid multi-spec change.
const MULTI_SPEC_CHANGE = `# Change: Tighten session expiry

## Affected specs

- doc-12
- doc-13

## Modified requirements

### Requirement: Sessions expire after 14 days [SES-1]

The system SHALL expire sessions after 14 days.

## Removed requirements

### Requirement: Expiry emails [SES-2]
`;

// One affected spec with an addition, a modification, and a removal.
const SINGLE_SPEC_CHANGE = `# Change: Warn before expiry

## Affected specs

- doc-12

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

// Several affected specs plus an addition: rejected because the target spec is ambiguous.
const AMBIGUOUS_ADDITION_CHANGE = `# Change: Warn before expiry

## Affected specs

- doc-12
- doc-13

## Added requirements

### Requirement: Warn before expiry [SES-3]

The system SHALL warn one day before expiry.
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
		const parsed = parseChangeDocument(AMBIGUOUS_ADDITION_CHANGE);

		expect(parsed.affectedSpecs.map((entry) => entry.id)).toEqual(["doc-12", "doc-13"]);
		expect(parsed.added.map((requirement) => requirement.id)).toEqual(["SES-3"]);
		expect(parsed.issues).toEqual([]);

		// Delta line numbers stay absolute so validation errors point into the document.
		const specListLine = parsed.affectedSpecs[0]?.line ?? 0;
		const addedLine = parsed.added[0]?.line ?? 0;
		expect(specListLine).toBeGreaterThan(0);
		expect(addedLine).toBeGreaterThan(specListLine);
	});

	it("parses recorded baselines with their spec IDs and hashes", () => {
		const content = withRecordedBaselines(
			MULTI_SPEC_CHANGE,
			new Map([
				["doc-12", "abc123"],
				["doc-13", "def456"],
			]),
		);
		const parsed = parseChangeDocument(content);
		expect(parsed.baselines.map((baseline) => baseline.specId)).toEqual(["doc-12", "doc-13"]);
		expect(parsed.baselines.map((baseline) => baseline.hash)).toEqual(["abc123", "def456"]);
		expect(parsed.baselines[0]?.line).toBeGreaterThan(0);
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

describe("specification baselines", () => {
	it("hashes content stably and sensitively", () => {
		expect(specBaselineHash(SESSION_SPEC)).toBe(specBaselineHash(SESSION_SPEC));
		expect(specBaselineHash(SESSION_SPEC)).not.toBe(specBaselineHash(`${SESSION_SPEC}\n`));
	});

	it("records baselines sorted by spec ID and strips an existing section", () => {
		const recorded = withRecordedBaselines(
			MULTI_SPEC_CHANGE,
			new Map([
				["doc-13", "def456"],
				["doc-12", "abc123"],
			]),
		);
		expect(recorded).toContain("\n## Baselines\n\n- doc-12: abc123\n- doc-13: def456\n");
		expect(recorded.startsWith(MULTI_SPEC_CHANGE.trimEnd())).toBe(true);

		const replaced = withRecordedBaselines(recorded, new Map([["doc-12", "fff000"]]));
		expect(replaced).not.toContain("abc123");
		expect(replaced).toContain("- doc-12: fff000");
		expect(parseChangeDocument(replaced).baselines).toHaveLength(1);
	});

	it("strips the baselines section when no baselines are given", () => {
		const recorded = withRecordedBaselines(MULTI_SPEC_CHANGE, new Map([["doc-12", "abc123"]]));
		const stripped = withRecordedBaselines(recorded, new Map());
		expect(stripped).not.toContain("## Baselines");
		expect(parseChangeDocument(stripped).baselines).toEqual([]);
	});
});

describe("change document validation", () => {
	it("accepts a valid multi-spec change with modified and removed requirements", async () => {
		await expect(validateChangeContent(MULTI_SPEC_CHANGE, FULL_RESOLVER)).resolves.toBeUndefined();
	});

	it("accepts a single-spec change with added, modified, and removed requirements", async () => {
		await expect(validateChangeContent(SINGLE_SPEC_CHANGE, FULL_RESOLVER)).resolves.toBeUndefined();
	});

	it("accepts a minimal change with no links or deltas", async () => {
		await expect(validateChangeContent("# Change: note only\n", FULL_RESOLVER)).resolves.toBeUndefined();
	});

	it("rejects an added requirement when several specifications are affected", async () => {
		await expectError(
			AMBIGUOUS_ADDITION_CHANGE,
			FULL_RESOLVER,
			'Added requirement "SES-3" is ambiguous: it could join doc-12 or doc-13.',
		);
	});

	it("rejects an added requirement without an ID", async () => {
		await expectError(
			"## Affected specs\n\n- doc-12\n\n## Added requirements\n\n### Requirement: Untitled\n",
			FULL_RESOLVER,
			"Added requirement has no ID.",
		);
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

describe("recorded baseline validation", () => {
	function withBaseline(content: string, baselines: Record<string, string>): string {
		return withRecordedBaselines(content, new Map(Object.entries(baselines)));
	}

	it("accepts a change whose recorded baselines match the current specifications", async () => {
		const content = withBaseline(SINGLE_SPEC_CHANGE, { "doc-12": specBaselineHash(SESSION_SPEC) });
		await expect(validateChangeContent(content, FULL_RESOLVER)).resolves.toBeUndefined();
	});

	it("rejects a change whose recorded baseline is stale", async () => {
		const content = withBaseline(SINGLE_SPEC_CHANGE, { "doc-12": "not-the-current-hash" });
		await expectError(
			content,
			FULL_RESOLVER,
			"Recorded baseline for doc-12 is stale: the specification changed after this change was written.",
		);
	});

	it("ignores stale baselines when saving re-records them", async () => {
		const content = withBaseline(SINGLE_SPEC_CHANGE, { "doc-12": "not-the-current-hash" });
		await expect(
			validateChangeContent(content, FULL_RESOLVER, { ignoreRecordedBaselines: true }),
		).resolves.toBeUndefined();
	});

	it("rejects baselines for specifications that are not affected", async () => {
		const content = withBaseline(SINGLE_SPEC_CHANGE, { "doc-99": "abc123" });
		await expectError(
			content,
			FULL_RESOLVER,
			'Baseline references doc-99, which is not listed under "Affected specs".',
		);
	});

	it("rejects duplicate baselines for one specification", async () => {
		const content = `${SINGLE_SPEC_CHANGE.trimEnd()}\n\n## Baselines\n\n- doc-12: abc123\n- doc-12: def456\n`;
		await expectError(content, FULL_RESOLVER, "Duplicate baseline for doc-12 (first recorded on line");
	});
});

describe("change preview projection", () => {
	const changeDocument: Document = {
		id: "doc-20",
		title: "Warn before expiry",
		type: "change",
		createdDate: "2026-10-07 08:00",
		rawContent: SINGLE_SPEC_CHANGE,
	};

	it("projects modified, removed, and added requirements into the resulting specification", async () => {
		const preview = await buildChangeDocumentPreview(changeDocument, FULL_RESOLVER);

		expect(preview.valid).toBe(true);
		expect(preview.issues).toEqual([]);
		expect(preview.specs).toHaveLength(1);

		const [spec] = preview.specs;
		expect(spec?.specId).toBe("doc-12");
		expect(spec?.resultingContent).toBe(
			[
				"# Session behavior",
				"",
				"### Requirement: Sessions expire after 14 days [SES-1]",
				"",
				"The system SHALL expire sessions after 14 days.",
				"",
				"### Requirement: Warn before expiry [SES-3]",
				"",
				"The system SHALL warn one day before expiry.",
				"",
				"#### Scenario: Expiring soon",
				"",
				"- WHEN a session expires within one day",
				"- THEN the client receives a warning",
				"",
			].join("\n"),
		);

		const kinds = spec?.diff.filter((line) => line.kind !== "context");
		expect(kinds).toContainEqual({ kind: "removed", text: "The system SHALL expire sessions after 30 days." });
		expect(kinds).toContainEqual({ kind: "added", text: "The system SHALL expire sessions after 14 days." });
		expect(kinds).toContainEqual({ kind: "removed", text: "### Requirement: Expiry emails [SES-2]" });
		expect(kinds).toContainEqual({ kind: "added", text: "### Requirement: Warn before expiry [SES-3]" });
	});

	it("leaves unaffected specifications byte-identical", async () => {
		const preview = await buildChangeDocumentPreview(
			{ ...changeDocument, rawContent: MULTI_SPEC_CHANGE },
			FULL_RESOLVER,
		);

		expect(preview.valid).toBe(true);
		expect(preview.specs).toHaveLength(2);

		const fileSpec = preview.specs.find((spec) => spec.specId === "doc-13");
		expect(fileSpec?.resultingContent).toBe(FILE_SPEC);
		expect(fileSpec?.diff.every((line) => line.kind === "context")).toBe(true);
	});

	it("reports issues without projecting any specification", async () => {
		const preview = await buildChangeDocumentPreview(
			{
				...changeDocument,
				rawContent: "## Affected specs\n\n- doc-12\n\n## Modified requirements\n\n### Requirement: Anything [SES-9]\n",
			},
			FULL_RESOLVER,
		);

		expect(preview.valid).toBe(false);
		expect(preview.issues.some((issue) => issue.message.includes('Requirement "SES-9" does not exist'))).toBe(true);
		expect(preview.specs).toEqual([]);
	});
});
