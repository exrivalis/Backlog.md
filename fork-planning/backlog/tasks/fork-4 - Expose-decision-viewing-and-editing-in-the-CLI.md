---
id: FORK-4
title: Expose decision viewing and editing in the CLI
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 07:58'
updated_date: '2026-10-07 10:55'
labels: []
dependencies: []
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Let a CLI user view and correct an existing Backlog decision without manually changing managed Markdown.

## Contexte
Backlog 1.53.0 can create/list decisions and edit their content through the browser API, but has no public decision view/update CLI command.

## Résultat attendu
The CLI views a decision and applies validated changes to its title, body and status using the same decision identity and storage.

## Périmètre
Include help, noninteractive use, unknown/ambiguous IDs, invalid content, and consistency with the browser update path.

## Hors périmètre
Do not introduce ADR supersession or deletion here.

## Vérification attendue
Run the new decision commands on a temporary project, then run the targeted Bun tests, bunx tsc --noEmit, and bun run check .
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A CLI user can view and update a decision title, body, and status without editing a file by hand.
- [x] #2 Unknown, ambiguous, or invalid updates fail without damaging the original decision.
- [x] #3 CLI help and tests document the behavior and the browser continues to read the updated decision.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Recheck decision create/list CLI help, browser PUT semantics, decision parsing/serialization and identity lookup; define field-level validation without accepting arbitrary frontmatter rewrites.
2. Add decision view and edit commands in src/cli.ts using one core mutation path for title, body and status; keep existing decision ID and preserve untouched fields. Route the browser update through the same validation where practical.
3. Reject missing/duplicate identities and invalid status or content before a write; ensure a failed update leaves the original file intact.
4. Document help and add temporary-project CLI/core/browser regression tests; run targeted Bun tests, bunx tsc --noEmit and bun run check .
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Plan recheck done: browser PUT /api/decisions/:id goes through core.updateDecisionFromContent (src/server/index.ts:1481) which today applies title/status/date straight from payload frontmatter; decision create/list accept free-form status. Implementing one core mutation updateDecisionFromInput (field-level title/status/content validation, frontmatter in body ignored) with CLI decision view/edit and a thin browser delegate.

Implementation: added Core.updateDecisionFromInput (src/core/backlog.ts) as the single validated mutation for decision title/status/body; Core.getDecisionContent for raw file reads; CLI decision view + decision edit (src/cli.ts) with help schemas; browser PUT /api/decisions/:id now calls updateDecisionFromInput directly. Decisions: (1) status stays free-form to match shipped decision create help/behavior; only empty values are rejected. (2) Frontmatter inside a replacement body is ignored (parseDecision extracts sections only), closing the old hole where PUT payload frontmatter overwrote title/status/date. (3) Body sections merge like the old browser path: sections absent from new content keep previous values. (4) Simplification: removed the updateDecisionFromContent wrapper; the server calls the input mutation directly, mirroring the document update handler. Verification: bun test --timeout=10000 on cli-decision-edit.test.ts, server-decision-endpoint.test.ts (new) and cli-doc-decision-board, server-documents-endpoint, cli-doc-view, web-ambiguous-id suites = 42 pass / 0 fail; bunx tsc --noEmit clean; bunx biome check on changed files clean; bun run check . clean (433 files). Note: core-autocommit-scope.test.ts has 1 pre-existing failure on the clean tree (verified via git stash), unrelated to this task.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Exposed decision viewing and editing in the CLI with one shared, validated mutation. Core: updateDecisionFromInput (src/core/backlog.ts) validates title/status (non-empty; free-form to match decision create) and applies body sections via the shared decision parser, ignoring frontmatter in replacement content so identity and metadata can never be rewritten through raw markdown; getDecisionContent reads the raw file. CLI: decision view <id> (plain/interactive, ambiguous and missing IDs fail with exit 1) and decision edit <id> --title/-s/--content (src/cli.ts), both documented in help schemas. Browser: PUT /api/decisions/:id now routes through the same mutation (server/index.ts), so payload frontmatter no longer overwrites title/status/date, and both surfaces read the same storage. Failures for unknown/ambiguous IDs and empty values happen before any write, leaving the original file byte-identical. Verified: 42 tests pass / 0 fail across the two new suites (cli-decision-edit, server-decision-endpoint) and four adjacent suites; bunx tsc --noEmit clean; bun run check . clean. Risk note: core-autocommit-scope.test.ts has one failure that reproduces on the clean tree (pre-existing, unrelated).
<!-- SECTION:FINAL_SUMMARY:END -->
