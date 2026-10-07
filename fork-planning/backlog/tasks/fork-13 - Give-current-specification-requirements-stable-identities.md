---
id: FORK-13
title: Give current specification requirements stable identities
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:16'
updated_date: '2026-10-07 10:50'
labels: []
dependencies: []
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Existing specification documents support stable requirement identity and testable scenarios without requiring tasks to contain a spec.

## Contexte
Backlog already stores specification documents, but a delta cannot safely modify or remove a requirement unless it can target it unambiguously.

## Résultat attendu
Existing specification documents support stable requirement identity and testable scenarios without requiring tasks to contain a spec.

## Périmètre
Requirement identity, scenarios, parsing/validation and document edit compatibility for current specs under backlog/docs/specifications.

## Hors périmètre
Do not require specs for every task or create an openspec directory.

## Vérification attendue
In temporary projects, create/read/update specs, test duplicate/missing identities and verify CLI doc view/update; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A specification document exposes uniquely identified requirements and testable scenarios.
- [x] #2 Duplicate or missing requirement targets produce actionable validation errors without rewriting the document.
- [x] #3 Existing ordinary documents and routine tasks remain usable without spec metadata.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inspect document type=specification storage, doc CLI update and parser/serializer behavior; keep ordinary documents and old specs readable without migration.
2. Define a minimal stable requirement-ID and scenario convention inside specification Markdown, using the existing doc ID namespace and preserving human-readable content.
3. Add parsing/validation for duplicate IDs, missing targets and scenario shape; expose actionable CLI validation without rewriting invalid or unrelated documents.
4. Test create/view/update round trips, duplicate and missing IDs, and ordinary task/doc compatibility in temporary projects; run targeted tests and static checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation started in worktree fork-13 (branch fork/FORK-13).

Implementation: new src/markdown/spec-requirements.ts defines the convention (### Requirement: <title> [REQ-ID] with nested #### Scenario: <title>); parseSpecificationRequirements extracts requirements/scenarios and reports duplicate IDs, scenarios outside any requirement (missing target) and titleless scenarios (malformed shape) with line numbers; validateSpecificationContent throws one actionable multi-line error. Core hooks it in createDocumentFromInput and updateDocumentFromInput for type=specification, so CLI, MCP and browser surfaces share the same validation and invalid writes leave the document unchanged. Verified: bun test --timeout=10000 src/test/spec-requirements.test.ts src/test/cli-spec-requirements.test.ts (19 pass, 0 fail); neighbor suites cli-doc-decision-board, cli-doc-view, mcp-documents, content-store, markdown (134 pass, 0 fail); bunx tsc --noEmit clean; bunx biome check on changed files clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Specifications are documents with type=specification; requirements now get stable identities through a minimal Markdown convention: a requirement is a '### Requirement: <title> [REQ-ID]' heading and its testable scenarios are nested '#### Scenario: <title>' headings. The bracketed ID is the stable handle deltas can target; requirements without an ID stay valid but untargetable. src/markdown/spec-requirements.ts parses and validates: duplicate requirement IDs, scenarios outside any requirement (missing target) and titleless scenarios produce one actionable multi-line error with line numbers, and no document is rewritten. Validation runs in Core (createDocumentFromInput/updateDocumentFromInput) only for type=specification, so CLI, MCP and browser share it; ordinary documents, old specs and routine tasks need no migration. Verified in temporary projects: spec create/update/view round trip preserves requirement lines; duplicate, orphan-scenario and titleless-scenario updates fail with line-numbered errors and leave the file byte-identical; a guide doc with duplicate bracketed IDs, a legacy prose spec, and task create/view all keep working. Tests: 19 pass / 0 fail (spec-requirements + cli-spec-requirements); 134 pass / 0 fail across five neighboring doc suites; tsc --noEmit clean; biome clean on changed files.
<!-- SECTION:FINAL_SUMMARY:END -->
