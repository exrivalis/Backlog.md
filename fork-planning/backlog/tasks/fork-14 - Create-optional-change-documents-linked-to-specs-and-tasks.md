---
id: FORK-14
title: Create optional change documents linked to specs and tasks
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:16'
updated_date: '2026-10-07 12:25'
labels: []
dependencies:
  - FORK-13
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
A change is one optional Backlog document linking affected spec IDs, existing task IDs and optional ADR IDs with proposed added/modified/removed requirements.

## Contexte
OpenSpec proposals and delta specs help agree on behavior, but a second tasks.md would duplicate Backlog task ownership.

## Résultat attendu
A change is one optional Backlog document linking affected spec IDs, existing task IDs and optional ADR IDs with proposed added/modified/removed requirements.

## Périmètre
Create/view/update a change document, explicit delta/scenario fields and cross-entity links using stable IDs and existing document storage.

## Hors périmètre
Do not create a second task checklist, copy current whole specs or require change records for routine tasks.

## Vérification attendue
Use CLI on a sample behavioral change and a routine task without a change; test link and delta parsing with scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One change document records rationale, scope and added/modified/removed requirement deltas with scenarios.
- [x] #2 The change links to affected specs and existing Backlog tasks without duplicating task plans or statuses.
- [x] #3 A task without a behavior change still works without a change document.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-13, inspect doc creation/update and task/decision ID resolvers; choose one optional change document shape in the existing doc namespace (type and path), not a separate task system.
2. Record rationale, scope, affected spec IDs, linked task IDs, optional ADR IDs and explicit add/modify/remove requirement deltas with scenarios; retain the document's own stable ID on edit.
3. Validate structured links and delta syntax at CLI creation/update, distinguishing proposed change text from current specs; never duplicate linked task plans/statuses or require changes for ordinary tasks.
4. Add CLI/core/parser round-trip tests for multi-spec links, invalid targets and routine tasks without changes; run targeted Bun tests and static checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation started: inspecting doc namespace, spec-requirements helpers from FORK-13, and planning the optional change document type.

Design settled (per doc-4, no new product decisions): change = document type 'change' in the existing doc namespace (doc-N IDs, no separate system). Body convention documented in src/markdown/change-document.ts: ## Why / ## Scope / ## Affected specs / ## Linked tasks / ## Related decisions / ## Added|Modified|Removed requirements, delta requirements reuse FORK-13's '### Requirement: Title [REQ-ID]' + '#### Scenario:' syntax. Validation lives in core create/update (CLI+MCP+server get it free): affected specs must resolve to specification docs; linked tasks/decisions must exist; modified/removed deltas must name an existing requirement ID unique across the affected specs; added deltas must not reuse an existing spec requirement ID; deltas never touch the specs and tasks keep their own plan/status. Minimal/empty change docs stay valid so create-then-update works. Create defaults the subpath to 'changes' in core so all surfaces agree; update preserves the existing path.

Implementation notes: (1) src/types/index.ts adds 'change' to DOCUMENT_TYPE_VALUES so CLI help, MCP schemas and the server accept it from one source. (2) New src/markdown/change-document.ts parses the optional body convention (## Why, ## Scope, ## Affected specs, ## Linked tasks, ## Related decisions, ## Added|Modified|Removed requirements) reusing parseSpecificationRequirements on each delta section with blank-line padding so issue line numbers stay absolute. (3) validateChangeContent is wired into Core.createDocumentFromInput/updateDocumentFromInput, so CLI, MCP and web server all validate; Core.changeLinkResolver reuses canonical task/document/decision resolvers and ambiguous IDs fail closed. Rules: affected specs must resolve to specification documents; linked tasks and decisions must exist; modified/removed deltas must name an existing requirement ID unique across the listed specs; added deltas must not reuse an existing spec requirement ID; duplicate IDs across delta sections rejected; structural scenario issues inherit spec conventions. Deltas are proposal-only — nothing writes to specs, and no task plan/status is duplicated. (4) Core create defaults the subpath to 'changes' (doc-4 layout) so every surface agrees; update preserves the existing path; minimal/empty change docs stay valid so create-then-update works. (5) Tests: src/test/change-document.test.ts (14 parser/validator cases) and src/test/cli-change-documents.test.ts (6 CLI end-to-end cases incl. round trip, default path, invalid targets, ambiguity, minimal change, routine task without change). Three existing tests asserted the literal type enumeration and were updated to include 'change'.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added optional change documents as a new 'change' document type in the existing doc namespace (no second task system). A change is one markdown doc recording Why, Scope, Affected specs, Linked tasks, Related decisions and explicit Added/Modified/Removed requirement deltas that reuse FORK-13's '### Requirement: Title [REQ-ID]' + '#### Scenario:' convention; each modified/removed delta must name an existing requirement ID unique across the listed affected specs, and the doc keeps its own stable doc-N ID on edit. Validation runs in core document create/update (so CLI, MCP and web all enforce it): spec/task/decision links must resolve, invalid or ambiguous targets are rejected with line-numbered, actionable errors, and file state is left untouched on failure. Create defaults the path to docs/changes; update preserves it; minimal change docs and change-free routine tasks keep working. Verification: 20 new tests pass (14 parser/validator, 6 CLI end-to-end incl. multi-spec links, invalid targets, ambiguity, round trip via disk, routine task flow); 240 tests across 14 neighboring suites pass; bunx tsc --noEmit clean; bunx biome check clean on all changed files; manual CLI smoke of a sample behavioral change plus a routine task without a change. Risks/follow-ups: apply/integrate of an approved delta into specs and archive behavior are deliberately out of scope (doc-4 treats them as later lifecycle steps).
<!-- SECTION:FINAL_SUMMARY:END -->
