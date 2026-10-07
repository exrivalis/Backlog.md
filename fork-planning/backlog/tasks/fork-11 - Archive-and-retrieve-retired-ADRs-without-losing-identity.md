---
id: FORK-11
title: Archive and retrieve retired ADRs without losing identity
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:16'
updated_date: '2026-10-07 13:34'
labels: []
dependencies:
  - FORK-10
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
A retired ADR can be archived and retrieved by its original ID; an applicable accepted ADR remains active.

## Contexte
Retired architecture decisions clutter the active working set but remain needed for historical traceability. Archive must not be conflated with delete.

## Résultat attendu
A retired ADR can be archived and retrieved by its original ID; an applicable accepted ADR remains active.

## Périmètre
Archive eligibility after rejection, deprecation or supersession, stable lookup of archived IDs, readable replacement pointer and explicit restore of an accidentally archived ADR.

## Hors périmètre
Do not permit deletion of ADRs or automatically archive them on supersession.

## Vérification attendue
Archive retired/accepted test records, verify lookup and restore with/without Git, and run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Retired ADRs can move out of the active working set without losing identity, content or replacement links.
- [x] #2 Archived ADRs remain addressable with clear status and can be restored without changing the original decision.
- [x] #3 A currently applicable accepted ADR cannot be archived as retired without a valid lifecycle transition.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-10, inspect existing archive moves and decision ID/path resolution; specify retired-only eligibility and preserve historical decision IDs across directories.
2. Add explicit ADR archive and restore CLI actions backed by safe moves to/from backlog/archive/decisions; never auto-archive on supersession or treat archive as delete.
3. Make exact-ID historical lookup display status and replacement even after a move; reject path collisions, duplicate IDs and attempts to archive an applicable accepted ADR.
4. Test archive/restore, lookup, immutable links, collisions and filesystem-only/Git behavior in temporary projects; run targeted tests and static checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented ADR archive/restore. FS: archive/decisions dir (DEFAULT_DIRECTORIES.ARCHIVE_DECISIONS), listArchivedDecisions sharing listDecisionsInDir, loadDecision now resolves exact IDs across active+archive and fails closed on duplicates, moveDecisionToArchive/moveDecisionFromArchive refuse collisions. Core: archiveDecision (retired-only eligibility via isRetiredAdrStatus; accepted must supersede first, proposed must be rejected; non-ADR refused), restoreDecision (pure move), archived records cannot be edited until restored, getDecisionContent reads from the right base dir. ID allocator scans archived decisions locally and on all branches so archived IDs are never reused. CLI: decision archive/restore commands with help schemas; decision view prefixes archived/superseded records with a status+replacement line.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added explicit ADR archive and restore to the canonical CLI, backed by safe whole-file moves between backlog/decisions and backlog/archive/decisions. 'backlog decision archive <id>' accepts only retired ADRs (rejected/deprecated/superseded); an applicable accepted ADR is refused until it is superseded and a proposal must be rejected, so archive never becomes a shortcut around the lifecycle. Archive is not delete: the move preserves the file byte-for-byte, so ID, frontmatter, content, and supersession links survive, and 'backlog decision restore <id>' returns the record unchanged. Exact-ID lookup now resolves across both directories and fails closed when one ID exists in both; 'decision view' prefixes an archived or superseded record with its status and replacement (e.g. 'decision-1 is archived (superseded by decision-2).'), and archived records cannot be edited until restored. The decision ID allocator scans the archive locally and on all branches so a retired ID is never reallocated. Collisions with an existing file in the target directory are rejected, never overwritten; there is no auto-archive on supersession and no purge. Verified with bun test src/test/cli-adr-archive.test.ts (14 pass: round trips, lookup, immutable links, collisions, duplicate-ID fail-closed, ID reuse, list hiding, edit guard, filesystem-only and auto-commit Git behavior), 166 pass across 14 adjacent decision/search/IDs tests, bunx tsc --noEmit clean, and biome check clean on the changed files. Follow-up noted: the web decision list serves cached active decisions and may briefly include an archived record after a move; CLI list is correct.
<!-- SECTION:FINAL_SUMMARY:END -->
