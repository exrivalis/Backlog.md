---
id: FORK-12
title: Exclude retired ADRs from agent guidance and active references
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:16'
updated_date: '2026-10-07 21:02'
labels: []
dependencies:
  - FORK-10
  - FORK-11
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Default CLI discovery and shipped agent guidance favor applicable accepted ADRs; old IDs resolve with a warning and the replacement.

## Contexte
An archived or superseded ADR is historical evidence, not current architecture guidance. Agents must not cite it as authoritative for new work.

## Résultat attendu
Default CLI discovery and shipped agent guidance favor applicable accepted ADRs; old IDs resolve with a warning and the replacement.

## Périmètre
Default decision search/list behavior, explicit historical lookup, active task/change/spec reference validation, supersession-chain safety, and instructions for agents.

## Hors périmètre
Do not rewrite immutable historical citations or claim to control arbitrary external filesystem reads.

## Vérification attendue
Test search, old-ID lookup, active reference validation, history lookup and cycle diagnostics; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Default decision discovery excludes rejected, superseded and archived ADRs from applicable guidance.
- [x] #2 Opening a retired ADR clearly points to its authoritative replacement; unknown replacements and supersession cycles are errors.
- [x] #3 Current structured references to retired guidance are reported or blocked while historical references remain readable.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-10/11, inspect decision list/search, task documentation/references and change/spec link models; distinguish applicable ADR guidance from legacy ordinary decisions and historical citations.
2. Default applicable-ADR discovery to accepted, active records; provide explicit historical lookup with retired state and replacement-chain notice, without pretending to control raw filesystem reads.
3. Validate current governing structured references against retired ADRs; report or block new invalid links, unresolved replacements and supersession cycles while leaving historical citations intact.
4. Update shipped CLI instructions and add CLI/search/reference tests for active, rejected, superseded, archived and cyclic cases; run scoped Bun tests and static checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Default discovery now returns applicable guidance only: one shared predicate isApplicableDecision (src/utils/adr.ts) filters 'decision list' (new Core.listApplicableDecisions; --all shows every record incl. archive) and the shared search index (SearchService), so proposed/rejected/superseded ADRs and archived records stay out while legacy decisions are untouched.

Historical lookup: decision view resolves through Core.resolveAdrGuidance, which walks superseded_by across active+archive directories to the authoritative accepted replacement and prints '<id> is retired|archived (superseded by <replacement>).' or '(rejected)'. A superseded_by link resolving to no record, a chain that cycles, or a replacement that is not accepted-and-active is an error naming the diagnosis; body content still prints in full (historical citations stay readable, never rewritten).

Active-reference validation: documentation entries spelled as decision IDs (isDecisionIdReference) are checked on task/draft create and on every documentation-changing edit (createTaskFromInput + applyTaskUpdateInput, all update paths). New/edited links naming a retired ADR are blocked with the retirement reason; links predating a retirement are immutable historical citations and pass untouched. 'decision supersede' prints the current structured references (tasks+drafts) left on the retired ADR so they get reviewed. Unknown decision IDs stay tolerated like unknown doc- links (consistency with deletion-preview); documents (changes/specs) carry no structured decision-link field in the current model, so prose citations there are out of scope by doc-4's free-text boundary.

Instructions: 'backlog instructions overview' gained a 'Decisions and ADRs' section (applicable-only discovery + historical-lookup path); agent-guidelines.md states the same at the directory map and search key points. cli-agent-nudge.md left unchanged (short nudge; overview is the required first read).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Retired ADRs are now excluded from agent guidance and active references. One shared predicate, isApplicableDecision (src/utils/adr.ts), drives default discovery: 'decision list' returns accepted ADRs plus legacy decisions (Core.listApplicableDecisions; --all lists every record including the archive), and the shared search index (SearchService, used by CLI/web/MCP search) filters identically, so rejected, superseded, proposed, and archived ADRs never surface as applicable guidance while legacy ordinary decisions are unaffected (AC1). 'decision view' resolves an old ID through Core.resolveAdrGuidance: a retired ADR prints its retired/archived state and the authoritative replacement at the end of the supersession chain (across archive moves), a superseded_by link to a missing record, a cycling chain, or a non-accepted replacement is a named error, and the historical body remains fully readable (AC2). Documentation entries spelled as decision IDs are validated on task/draft create and documentation-changing edits: links to a retired ADR are blocked with the retirement reason, links that predate a retirement are left untouched as historical citations, and 'decision supersede' reports the current structured references (active tasks and drafts) left on the retired ADR (AC3). 'backlog instructions overview' teaches the applicable-only default and the historical-lookup path; agent-guidelines.md states the same. Verified: bun test --timeout=10000 on cli-adr-guidance (10 pass), cli-adr-archive + cli-adr-supersede + cli-adr-guidance (33 pass), and 82 pass across all 8 affected suites (search-service, cli-search-command, cli-list-window, cli-decision-edit, cli-doc-decision-board); bunx tsc --noEmit clean; bunx biome check clean on all changed files. One FORK-10 test expectation (proposed ADR in default list) was updated to the new --all contract. Known unrelated: agent-instructions 'auto-commits selected instructions' fails identically on the base commit. Note: changes/specs have no structured decision-link field in the current model, so their citations are prose and stay outside validation per doc-4's free-text boundary.
<!-- SECTION:FINAL_SUMMARY:END -->
