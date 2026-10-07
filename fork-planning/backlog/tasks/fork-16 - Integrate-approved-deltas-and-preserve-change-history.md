---
id: FORK-16
title: Integrate approved deltas and preserve change history
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:16'
updated_date: '2026-10-07 21:00'
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
- [x] #1 Only a reviewed valid change can update the referenced current specs; task status alone never applies it.
- [x] #2 A second apply or stale baseline does not silently duplicate or overwrite requirements.
- [x] #3 The integrated change remains readable by its original ID after archive, and failures do not leave undocumented partial results.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-15, define an explicit reviewed-change gate and revalidate every referenced spec immediately before apply; do not infer review from a linked task's Done status.
2. Reuse the validated preview projection to prepare all affected spec writes; apply under shared locks with a rollback/recovery strategy for multi-file failures and clear diagnostics, without silently leaving partial results.
3. Record integrated state/history on the original change document to prevent repeat apply, then archive it without changing its document ID; preserve exact-ID lookup of integrated changes.
4. Test approved and unreviewed attempts, stale baselines, retries, interrupted writes, multi-spec results and archived lookup in Git/no-Git fixtures; run targeted tests and static checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the reviewed-change gate and apply/archive flow: managed Review/Integrated sections in src/markdown/change-document.ts (withManagedSection/readManagedSection shared with Baselines), Core.approveChangeDocument and Core.applyChangeDocument under the shared create lock with full rollback (spec writes, integration record, archive move), fs.moveDocumentToArchive into docs/changes/archive, and 'backlog doc approve'/'backlog doc apply' CLI commands with help schemas. Tests: 6 new unit tests, 9 new CLI tests covering unreviewed refusal with a Done linked task, happy path multi-spec apply + archive + exact-ID lookup, second-apply refusal, stale baseline, mid-apply write failure rollback, archive-collision rollback, no-Git fixture, auto-commit Git fixture, and target gates.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered the explicit reviewed-change gate and integration flow on top of FORK-14/15. 'backlog doc approve <docId> [--by]' records a managed Review section (the only approval signal; never inferred from task status). 'backlog doc apply <docId>' runs entirely under the shared create lock: it re-checks the gates, revalidates the change against current specs via the FORK-15 preview projection (stale baselines refuse), writes every affected spec from that projection, records the Integrated section, and archives the change into docs/changes/archive without changing its document ID, preserving exact-ID lookup. Any failed write (spec, integration record, or archive move) rolls every touched file back to its exact prior content and exits 1 with a diagnostic naming what was rolled back; rollback failures are reported explicitly instead of being hidden. Linked tasks are never marked Done. Verified with 'bun test --timeout=10000' over 5 files (73 pass / 0 fail; includes 6 new unit tests and 9 new CLI tests), 'bunx tsc --noEmit' clean, and 'bunx biome check' clean on all changed files. Deviations recorded in notes: approve command shape, rollback also covers mark/archive writes, and the no-Git fixture runs under the OS temp dir because a repo-nested fixture would lock the surrounding repository.
<!-- SECTION:FINAL_SUMMARY:END -->
