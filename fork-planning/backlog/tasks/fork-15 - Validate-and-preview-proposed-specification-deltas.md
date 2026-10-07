---
id: FORK-15
title: Validate and preview proposed specification deltas
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:16'
updated_date: '2026-10-07 13:39'
labels: []
dependencies:
  - FORK-14
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
A CLI validation/preview reports errors and shows the resulting specification before any current spec is changed.

## Contexte
A change may target outdated or ambiguous requirements. Applying it before review can damage the description of current behavior.

## Résultat attendu
A CLI validation/preview reports errors and shows the resulting specification before any current spec is changed.

## Périmètre
Multi-spec deltas, missing or duplicate requirement IDs, stale baseline, conflicting changes, requirement scenarios, and readable preview output.

## Hors périmètre
Do not incorporate deltas or archive the proposal in this task.

## Vérification attendue
Run accepted and rejected examples including stale/missing/duplicate targets and conflicting changes; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Validation rejects stale, missing, duplicate and conflicting requirement targets without modifying current specs.
- [x] #2 A valid preview shows added, modified and removed requirements and the resulting current spec.
- [x] #3 CLI help makes clear that validation and preview are non-mutating.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-14, inspect requirement parsing and change links; record or compare a deterministic baseline for each affected spec without making old specs invalid by default.
2. Build a shared non-mutating validator that resolves unique spec and requirement IDs, checks add/modify/remove targets, scenarios, conflicts and stale baselines across all affected specs.
3. Expose CLI validate and preview, rendering per-spec diffs and the resulting current-spec text from the same validated projection; report all actionable errors before any write.
4. Test valid multi-spec previews, duplicates, missing targets, conflicts, stale inputs and unchanged spec bytes; document in help that validation/preview do not apply changes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the shared non-mutating validator and preview in src/markdown/change-document.ts: managed '## Baselines' section (sha256 per affected spec, recorded on create/update via Core.preparedChangeContent), staleness/unlisted/duplicate baseline checks, addition placement checks (additions need an ID and resolve to exactly one affected spec), and buildChangeDocumentPreview() projecting per-spec block diffs plus resulting spec text from the same validated deltas. Added CLI 'doc validate' and 'doc preview' (read-only, help states neither modifies files). Deviation from FORK-14 behavior: additions with more than one affected spec are now rejected as ambiguous so preview can place them; updated FORK-14 test fixtures accordingly. formatChangePreview renders plain text with a 'does not modify any files' footer.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a shared non-mutating validator and preview for change documents. src/markdown/change-document.ts now records a managed '## Baselines' section (sha256 of each affected spec at proposal time, written by Core when a change is saved without one), rejects stale, unlisted, or duplicate baselines, requires additions to carry an ID and resolve to exactly one affected spec, and projects every affected spec through buildChangeDocumentPreview(): per-spec requirement block diffs plus the resulting spec text from the same validated deltas. New read-only CLI commands 'backlog doc validate <docId>' and 'backlog doc preview <docId>' render formatChangePreview output; their help states neither command modifies any file, and output carries a 'Validation and preview do not modify any files.' footer. Verified: 40 targeted tests pass (change-document, cli-change-documents) covering valid multi-spec and single-spec previews, missing/duplicate/ambiguous/conflicting targets, stale baselines, and byte-identical spec files after validate/preview; 305 pass across 12 neighboring test files with one pre-existing unrelated failure in core.test.ts (auto-commit path resolution, fails identically at clean HEAD); bunx tsc --noEmit clean; biome check clean on all changed files; manual smoke test in /tmp confirmed identical spec file hashes across validate and preview and readable requirement-aligned diffs. Known limitation: additions in a change listing several affected specs are rejected as ambiguous (split per spec); FORK-16 may add explicit target syntax or a baseline refresh option.
<!-- SECTION:FINAL_SUMMARY:END -->
