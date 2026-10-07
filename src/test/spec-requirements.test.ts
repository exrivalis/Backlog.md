import { describe, expect, it } from "bun:test";
import { parseSpecificationRequirements, validateSpecificationContent } from "../markdown/spec-requirements.ts";

const VALID_SPEC = `# Session behavior

## Requirements

### Requirement: Sessions expire [SES-1]

The system SHALL expire sessions after 30 days.

#### Scenario: Expired session is rejected

- WHEN a client presents an expired token
- THEN the request is rejected with 401

### Requirement: Login requires credentials [AUTH-2]

The system SHALL reject anonymous access.
`;

describe("parseSpecificationRequirements", () => {
	it("parses requirement IDs, titles, lines, and nested scenarios", () => {
		const parsed = parseSpecificationRequirements(VALID_SPEC);

		expect(parsed.issues).toEqual([]);
		expect(parsed.requirements).toEqual([
			{ id: "SES-1", title: "Sessions expire", line: 5 },
			{ id: "AUTH-2", title: "Login requires credentials", line: 14 },
		]);
		expect(parsed.scenarios).toEqual([{ requirementId: "SES-1", title: "Expired session is rejected", line: 9 }]);
	});

	it("keeps requirements without an ID valid but untargetable", () => {
		const parsed = parseSpecificationRequirements("### Requirement: Legacy prose\n\nText.\n");

		expect(parsed.issues).toEqual([]);
		expect(parsed.requirements).toEqual([{ id: "", title: "Legacy prose", line: 1 }]);
	});

	it("does not treat ordinary markdown as requirements", () => {
		const parsed = parseSpecificationRequirements(
			"## Purpose\n\nProse about the spec.\n\n### Details\n\nMore prose.\n",
		);

		expect(parsed.requirements).toEqual([]);
		expect(parsed.scenarios).toEqual([]);
		expect(parsed.issues).toEqual([]);
	});

	it("reports duplicate requirement IDs once per repeat with the first line", () => {
		const parsed = parseSpecificationRequirements(
			"### Requirement: First [REQ-1]\n\nA.\n\n### Requirement: Second [REQ-2]\n\nB.\n\n### Requirement: Third [REQ-1]\n\nC.\n",
		);

		expect(parsed.issues).toHaveLength(1);
		expect(parsed.issues[0]?.line).toBe(9);
		expect(parsed.issues[0]?.message).toContain('Duplicate requirement ID "REQ-1" (first used on line 1)');
	});

	it("reports a scenario outside any requirement as a missing target", () => {
		const parsed = parseSpecificationRequirements("## Purpose\n\n#### Scenario: Orphaned\n\n- WHEN x\n- THEN y\n");

		expect(parsed.requirements).toEqual([]);
		expect(parsed.issues).toHaveLength(1);
		expect(parsed.issues[0]?.line).toBe(3);
		expect(parsed.issues[0]?.message).toContain('Scenario "Orphaned" is not inside a requirement');
	});

	it("reports a scenario heading without a title as malformed", () => {
		const parsed = parseSpecificationRequirements("### Requirement: Login [REQ-1]\n\n#### Scenario:\n\n- WHEN x\n");

		expect(parsed.scenarios).toEqual([{ requirementId: "REQ-1", title: "", line: 3 }]);
		expect(parsed.issues).toEqual([{ line: 3, message: 'Scenario has no title. Use "#### Scenario: <title>".' }]);
	});

	it("ignores convention headings inside fenced code blocks", () => {
		const parsed = parseSpecificationRequirements(
			"Example:\n\n```md\n### Requirement: Sample [REQ-9]\n#### Scenario:\n```\n",
		);

		expect(parsed.requirements).toEqual([]);
		expect(parsed.scenarios).toEqual([]);
		expect(parsed.issues).toEqual([]);
	});

	it("closes requirement scope at the next heading of level three or shallower", () => {
		const parsed = parseSpecificationRequirements("### Requirement: A [REQ-1]\n\n## Notes\n\n#### Scenario: Orphan\n");

		expect(parsed.issues).toHaveLength(1);
		expect(parsed.issues[0]?.message).toContain('Scenario "Orphan" is not inside a requirement');
	});

	it("parses CRLF content without changing reported line numbers", () => {
		const parsed = parseSpecificationRequirements("### Requirement: A [REQ-1]\r\n\r\n#### Scenario: Works\r\n");

		expect(parsed.requirements).toEqual([{ id: "REQ-1", title: "A", line: 1 }]);
		expect(parsed.scenarios).toEqual([{ requirementId: "REQ-1", title: "Works", line: 3 }]);
		expect(parsed.issues).toEqual([]);
	});
});

describe("validateSpecificationContent", () => {
	it("accepts valid specification content", () => {
		expect(() => validateSpecificationContent(VALID_SPEC)).not.toThrow();
	});

	it("throws one actionable multi-line error listing every issue", () => {
		let thrown: Error | undefined;
		try {
			validateSpecificationContent(
				"#### Scenario: Orphan\n\n### Requirement: A [REQ-1]\n\n### Requirement: B [REQ-1]\n\n#### Scenario:\n",
			);
		} catch (error) {
			thrown = error as Error;
		}

		const lines = thrown?.message.split("\n") ?? [];
		expect(lines[0]).toBe("Specification requirements are invalid:");
		expect(lines).toHaveLength(4);
		expect(lines[1]).toContain('- line 1: Scenario "Orphan" is not inside a requirement');
		expect(lines[2]).toContain('- line 5: Duplicate requirement ID "REQ-1" (first used on line 3)');
		expect(lines[3]).toContain("- line 7: Scenario has no title");
	});

	it("does not rewrite the content it validates", () => {
		const content = "### Requirement: A [REQ-1]\n\n#### Scenario: Works\n";
		validateSpecificationContent(content);
		expect(content).toBe("### Requirement: A [REQ-1]\n\n#### Scenario: Works\n");
	});
});
