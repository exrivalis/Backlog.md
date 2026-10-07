---
id: FORK-16
title: Integrate approved deltas and preserve change history
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:16'
updated_date: '2026-10-07 08:42'
labels: []
dependencies:
  - FORK-15
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
A reviewed and validated change can update affected current specs and be archived without losing its stable document identity.

## Contexte
After work is verified, accepted behavior must appear in the current spec while the reason and proposed delta remain available as history.

## Résultat attendu
A reviewed and validated change can update affected current specs and be archived without losing its stable document identity.

## Périmètre
Explicit apply after review, baseline revalidation, multi-document failure handling, repeat-apply protection and archive/read of integrated changes.

## Hors périmètre
Do not mark a task Done automatically, integrate unreviewed changes, or remove history during archival.

## Vérification attendue
Apply a reviewed change and retry, test stale/partial failures, verify archived change lookup and spec results; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Only a reviewed valid change can update the referenced current specs; task status alone never applies it.
- [ ] #2 A second apply or stale baseline does not silently duplicate or overwrite requirements.
- [ ] #3 The integrated change remains readable by its original ID after archive, and failures do not leave undocumented partial results.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-15, define an explicit reviewed-change gate and revalidate every referenced spec immediately before apply; do not infer review from a linked task's Done status.
2. Reuse the validated preview projection to prepare all affected spec writes; apply under shared locks with a rollback/recovery strategy for multi-file failures and clear diagnostics, without silently leaving partial results.
3. Record integrated state/history on the original change document to prevent repeat apply, then archive it without changing its document ID; preserve exact-ID lookup of integrated changes.
4. Test approved and unreviewed attempts, stale baselines, retries, interrupted writes, multi-spec results and archived lookup in Git/no-Git fixtures; run targeted tests and static checks.
<!-- SECTION:PLAN:END -->
