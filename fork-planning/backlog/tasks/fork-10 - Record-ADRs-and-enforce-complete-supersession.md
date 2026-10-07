---
id: FORK-10
title: Record ADRs and enforce complete supersession
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:07'
updated_date: '2026-10-07 12:27'
labels: []
dependencies:
  - FORK-4
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
The CLI can record an ADR as a decision, accept/reject it, and fully supersede an accepted ADR with a linked replacement.

## Contexte
Backlog decisions have no defined architecture-decision lifecycle or enforceable replacement relationship. A retired ADR must not remain authoritative for new work.

## Résultat attendu
The CLI can record an ADR as a decision, accept/reject it, and fully supersede an accepted ADR with a linked replacement.

## Périmètre
Decision identity and kind, context/alternatives/outcome/consequences, lifecycle, full-scope replacement checks, bidirectional historical links and preservation of earlier text.

## Hors périmètre
Do not move ADRs to archive or implement agent search filtering here.

## Vérification attendue
Exercise proposed/accepted/rejected/superseded states, invalid or partial replacement, duplicate IDs and link history; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An ADR is a discoverable Backlog decision with stable ID, status, rationale, alternatives and consequences.
- [x] #2 Full supersession identifies the authoritative replacement and preserves links and content of the older ADR.
- [x] #3 Partial or ambiguous supersession cannot silently retire still-applicable guidance.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-4, inspect the decision model, parser and CLI; represent architecture decisions in the existing decision ID/storage model while leaving legacy decisions readable.
2. Add validated ADR fields for scope, context, alternatives, choice, rationale and consequences, with explicit proposed/accepted/rejected lifecycle transitions.
3. Implement full supersession as one reviewed operation: validate replacement identity, accepted status, full prior scope coverage and no cycles; retain old text and both historical links. If scope remains unresolved, refuse retirement and request a human decision.
4. Test ADR creation, transitions, duplicate IDs, full versus partial replacement and bidirectional history in CLI/core round trips; leave archive and default discovery for FORK-11/12.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Represent ADRs as decisions with kind: architecture in the existing decision ID namespace; legacy decisions have no kind and stay free-form. New optional fields: scope (## Scope), rationale (## Rationale), supersedes and superseded_by (frontmatter). The ADR choice is the existing ## Decision section, not a second field.

Lifecycle: proposed -> accepted|rejected; an accepted ADR retires only through supersession; rejected/superseded are terminal. Acceptance requires a non-empty Decision and Scope, so supersession coverage can always be verified. Statuses outside the set are refused for ADRs; legacy decisions keep free-form status.

Full supersession is one reviewed Core operation (supersedeDecision) exposed as 'decision supersede <supersededId> <replacementId>': validates both are ADRs, old accepted, replacement accepted and not already linked, no cycle through the supersedes chain, and full scope coverage (comma/semicolon/newline items matched case/whitespace-insensitively). The replacement link is written before retirement; both files commit once. Old text is preserved.

Fixed a pre-existing extractSection regex bug exposed by ADR validation: an empty section swallowed the following heading as its content (greedy \s*\n). Now only spaces/tabs may follow a heading on its own line. Archiving and default discovery filtering are left to FORK-11/12; MCP/web untouched (web paths go through the same Core validation).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
ADRs are now decisions with kind: architecture (src/utils/adr.ts, src/markdown/parser.ts, src/markdown/serializer.ts): optional scope/rationale sections plus supersedes/superseded_by frontmatter links; legacy decisions parse and save unchanged. Lifecycle is validated in Core.createDecision and updateDecisionFromInput: ADR statuses are proposed/accepted/rejected/superseded, acceptance requires stated Decision and Scope, and accepted ADRs retire only by supersession (src/core/backlog.ts). 'decision create' gained --kind/--scope; new 'decision supersede <old> <replacement>' performs the single reviewed operation, refusing non-ADRs, unaccepted records, reuse of a replacement, cycles, and any uncovered scope (AC3), and writes bidirectional links while preserving the old text (AC2), committing once under auto-commit. Verified: bun test src/test/cli-adr-supersede.test.ts (9 pass), markdown/parser+serializer tests (37 pass), related decision suites (91 pass across 7 files), bunx tsc --noEmit clean, biome check clean. Known unrelated: pre-existing failure in core-autocommit-scope 'bulk task updates legacy path' also fails on the base commit (git status output quirk).
<!-- SECTION:FINAL_SUMMARY:END -->
