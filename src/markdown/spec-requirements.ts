/**
 * Stable requirement identity and testable scenarios for specification documents.
 *
 * A specification (a document with type "specification") may describe current required
 * behavior with a minimal Markdown convention:
 *
 *   ### Requirement: Short title [REQ-1]
 *
 *   The system SHALL do something.
 *
 *   #### Scenario: It works
 *
 *   - WHEN something happens
 *   - THEN the outcome holds
 *
 * The stable requirement ID is the trailing bracketed token of the requirement heading,
 * so a delta can target it precisely even when the title is reworded. A scenario belongs
 * to the requirement it is nested under. Requirements without an ID stay valid but are
 * not targetable by ID.
 */

export interface SpecRequirement {
	id: string;
	title: string;
	line: number;
}

export interface SpecScenario {
	requirementId?: string;
	title: string;
	line: number;
}

export interface SpecificationIssue {
	line: number;
	message: string;
}

export interface ParsedSpecification {
	requirements: SpecRequirement[];
	scenarios: SpecScenario[];
	issues: SpecificationIssue[];
}

const REQUIREMENT_HEADING = /^### Requirement:\s*(.*)$/;
const SCENARIO_HEADING = /^#### Scenario:\s*(.*)$/;
const CLOSES_REQUIREMENT = /^#{1,3}\s/;
const REQUIREMENT_ID = /\[([^[\]]+)\]\s*$/;
const FENCE = /^\s*(```|~~~)/;

export function parseSpecificationRequirements(content: string): ParsedSpecification {
	const lines = content.replace(/\r\n/g, "\n").split("\n");
	const requirements: SpecRequirement[] = [];
	const scenarios: SpecScenario[] = [];
	const issues: SpecificationIssue[] = [];
	const firstLineById = new Map<string, number>();

	let currentRequirement: SpecRequirement | undefined;
	let inFence = false;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const lineNumber = index + 1;

		if (FENCE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const requirementMatch = line.match(REQUIREMENT_HEADING);
		if (requirementMatch) {
			const heading = requirementMatch[1] ?? "";
			const idMatch = heading.match(REQUIREMENT_ID);
			const id = (idMatch?.[1] ?? "").trim();
			const title = (idMatch ? heading.slice(0, heading.length - idMatch[0].length) : heading).trim();
			const requirement: SpecRequirement = { id, title, line: lineNumber };
			requirements.push(requirement);
			currentRequirement = requirement;
			if (id) {
				const firstLine = firstLineById.get(id);
				if (firstLine === undefined) {
					firstLineById.set(id, lineNumber);
				} else {
					issues.push({
						line: lineNumber,
						message: `Duplicate requirement ID "${id}" (first used on line ${firstLine}). Give each requirement a unique ID.`,
					});
				}
			}
			continue;
		}

		const scenarioMatch = line.match(SCENARIO_HEADING);
		if (scenarioMatch) {
			const title = (scenarioMatch[1] ?? "").trim();
			scenarios.push({ title, line: lineNumber, ...(currentRequirement && { requirementId: currentRequirement.id }) });
			if (!currentRequirement) {
				issues.push({
					line: lineNumber,
					message: title
						? `Scenario "${title}" is not inside a requirement. Put it under a "### Requirement: <title> [REQ-ID]" heading.`
						: `Scenario is not inside a requirement. Put it under a "### Requirement: <title> [REQ-ID]" heading.`,
				});
			} else if (!title) {
				issues.push({ line: lineNumber, message: `Scenario has no title. Use "#### Scenario: <title>".` });
			}
			continue;
		}

		if (CLOSES_REQUIREMENT.test(line)) {
			currentRequirement = undefined;
		}
	}

	return { requirements, scenarios, issues };
}

/** Throws one actionable, multi-line error when specification content breaks the convention. */
export function validateSpecificationContent(content: string): void {
	const { issues } = parseSpecificationRequirements(content);
	if (issues.length === 0) return;
	throw new Error(
		[
			"Specification requirements are invalid:",
			...issues.map((issue) => `- line ${issue.line}: ${issue.message}`),
		].join("\n"),
	);
}
