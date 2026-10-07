---
id: FORK-15
title: Validate and preview proposed specification deltas
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:16'
updated_date: '2026-10-07 08:42'
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
- [ ] #1 Validation rejects stale, missing, duplicate and conflicting requirement targets without modifying current specs.
- [ ] #2 A valid preview shows added, modified and removed requirements and the resulting current spec.
- [ ] #3 CLI help makes clear that validation and preview are non-mutating.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-14, inspect requirement parsing and change links; record or compare a deterministic baseline for each affected spec without making old specs invalid by default.
2. Build a shared non-mutating validator that resolves unique spec and requirement IDs, checks add/modify/remove targets, scenarios, conflicts and stale baselines across all affected specs.
3. Expose CLI validate and preview, rendering per-spec diffs and the resulting current-spec text from the same validated projection; report all actionable errors before any write.
4. Test valid multi-spec previews, duplicates, missing targets, conflicts, stale inputs and unchanged spec bytes; document in help that validation/preview do not apply changes.
<!-- SECTION:PLAN:END -->
