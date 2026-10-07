---
id: FORK-8
title: Delete tasks and drafts only on explicit request
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:03'
updated_date: '2026-10-07 12:40'
labels: []
dependencies:
  - FORK-7
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
A separate explicit CLI command removes the selected task or draft file; ordinary archive/complete behavior stays unchanged.

## Contexte
Archiving is the current default, but a person sometimes asks an agent to delete an unwanted task or draft instead. No CLI command currently supports that exact intent.

## Résultat attendu
A separate explicit CLI command removes the selected task or draft file; ordinary archive/complete behavior stays unchanged.

## Périmètre
Task and draft file deletion, intentional noninteractive agent use, identity and dependency checks via FORK-7, no-Git warning, failure diagnostics, and ID collision avoidance.

## Hors périmètre
Do not add a trash folder, restore/purge workflow, or implicit deletion during archive or complete.

## Vérification attendue
In temporary Git and filesystem-only projects, verify archive still moves the file, explicit delete removes it, linked targets require a choice, and missing/ambiguous IDs fail; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A direct CLI delete removes a task or draft file only after an explicit delete request, while existing archive/complete paths retain their behavior.
- [x] #2 An agent with explicit user authorization can use the noninteractive delete operation without first archiving or refusing solely because archive is the default.
- [x] #3 Linked, unknown, ambiguous, and failed-deletion cases follow FORK-7 without silent reference damage; deleted IDs cannot silently identify a different active record.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Depend on FORK-7: reuse its preview, ID resolver and validated reference choices; recheck existing task/draft archive and task complete semantics, including children and ID allocation.
2. Add separate explicit task and draft delete CLI commands with scriptable confirmation; refuse linked targets unless unlink/reassign was chosen and validated. Do not call archive as a deletion substitute.
3. Prepare reference edits and target removal under the existing locks; check for write/unlink errors, avoid silent partial reference damage, and leave useful recovery diagnostics. Ensure deleted IDs cannot accidentally resolve to another active task or draft.
4. Test archived versus deleted files, linked records, repeated/missing/ambiguous IDs, failed writes, and Git/no-Git warnings; run scoped Bun tests and static checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation: extended FORK-7's preview-only delete commands into real deletion. Core.deleteEntity (src/core/backlog.ts) removes the task/draft file behind a found preview under existing locks: draft locks outermost, then sorted task locks; inside the locks it re-scans references (shared scanDeletionReferences) and throws DeletionPreviewChangedError when the set no longer matches the approved preview, re-validates the unlink/reassign choice against the fresh corpus (validateDeletionResolutionForCorpus), rewrites sources from the fresh corpus (repointTaskLinks covers dependencies, references, and parentTaskId - unlike withoutVacatedTaskLinks, which archive keeps unchanged byte-for-byte), then unlinks the target and commits 'backlog: Delete <type> <id>' when autoCommit is on. Reference edits run BEFORE the unlink so no failure leaves the target gone with references unapplied; failure messages list touched files and recovery guidance.

Decisions: (1) --confirm is the scriptable explicit authorization; --preview and --confirm are mutually exclusive; a linked target still refuses until --unlink or --reassign-to validates, and doc delete stays preview-only in this task's scope (documents remain a separate delete task). (2) Deleted-ID reidentification is prevented by construction, not by tombstones: the delete refuses unless every resolvable structured reference (active, completed, and draft sources; parent, dependency, reference relations) is unlinked or reassigned, and lookups fail closed (identity index returns not-found). The allocator is max+1 and archived IDs are reused by design, so a freed middle ID is not handed straight out and a freed highest ID can only rebind to a new record after all structured references were validated away; free-text mentions remain disclosed as undiscoverable (DELETION_FREE_TEXT_LIMIT). This matches the documented archive trade-off in withVacatedIdCleanup without adding a trash/tombstone store that doc-4 excludes. (3) Residual race (a record not in the lock set starts referencing the target mid-delete) is the same documented trade-off as archive; the preview-mismatch abort closes the unlocked-preview hole the task calls out.

Verification (all run in this session): bun test --timeout=10000 src/test/cli-delete.test.ts -> 19 pass 0 fail; with deletion-preview.test.ts + cli-delete-preview.test.ts -> 51 pass 0 fail; auto-commit.test.ts (11 pass), cli-draft-edit/cli-guidance/draft-lifecycle-autocommit-scope (53 pass 1 skip). bunx tsc --noEmit clean. bunx biome check clean on changed files. Manual CLI smokes: refused bare/linked deletes, unlink + reassign end states, missing/ambiguous IDs, completed-record source cleanup, chmod-444 write failure and chmod-555 unlink failure diagnostics with retry recovery, git commit 'backlog: Delete task TASK-1' with clean tree, filesystem-only no-git warning. Full suite NOT run here per instructions (orchestrator runs it post-merge).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Explicit delete is now real: 'task delete' / 'draft delete' gained --confirm (scriptable authorization) alongside --preview; without one of them nothing happens. A confirmed delete refuses on missing/ambiguous IDs and on linked targets until --unlink or --reassign-to validates; the resolution is re-validated and the reference set re-scanned under the existing locks (draft locks then sorted task locks) immediately before mutating, aborting when the corpus changed since the preview. Reference rewrites (dependencies, references, parent links; sources may be active, completed, or draft records) run before the target file is unlinked, so failures leave recovery diagnostics naming every touched file and never a deleted target with unapplied references. Archive/complete paths are untouched. Deleted IDs fail closed at lookup and the validated reference cleanup prevents silent reidentification. Verified with 19 new tests plus the FORK-7 suites (51 pass), related draft/auto-commit/guidance suites, tsc, and Biome.
<!-- SECTION:FINAL_SUMMARY:END -->
