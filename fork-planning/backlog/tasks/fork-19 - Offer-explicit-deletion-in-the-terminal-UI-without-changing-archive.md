---
id: FORK-19
title: Offer explicit deletion in the terminal UI without changing archive
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:17'
updated_date: '2026-10-07 14:21'
labels: []
dependencies:
  - FORK-8
  - FORK-9
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Where tasks, drafts and documents are managed in the TUI, a distinct delete action explains its consequences and retains archive defaults.

## Contexte
The terminal user interface (TUI) must not present archival and permanent file removal as the same operation.

## Résultat attendu
Where tasks, drafts and documents are managed in the TUI, a distinct delete action explains its consequences and retains archive defaults.

## Périmètre
Discoverability, keyboard/focus/confirmation, linked-reference preview and parity with CLI validation on exposed TUI entity views.

## Hors périmètre
Do not add milestone or ADR delete controls or change TUI archive shortcuts to delete.

## Vérification attendue
Exercise task/draft/document archive vs explicit delete through TUI/manual or automated interaction and run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Archival remains the default or existing TUI action for tasks and drafts.
- [x] #2 A distinct delete action targets only eligible records and communicates file removal and reference impacts before execution.
- [x] #3 TUI errors and cancellation preserve data and match canonical CLI outcomes.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-8/9, inspect board, task viewer, draft and document TUI actions; keep current archive/complete shortcuts and labels intact.
2. Add a separate discoverable delete action only on eligible entity views, backed by the same core preview/resolution/delete operations as the CLI; do not add ADR or milestone delete.
3. Present affected links, cancel/unlink/reassign options and uncommitted-file recovery warning; require intentional confirmation, preserve keyboard focus and return to the correct view on cancel/error/success.
4. Exercise task/draft/document flows, archive-versus-delete, linked-target errors and no-Git behavior with TUI interaction tests and manual keyboard review; run scoped tests/static checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design settled: shared src/ui/deletion.ts flow (preview dialog -> reassign/unlink choice -> explicit confirm -> core.deleteEntity/deleteDocument), D key on board/task viewer/document viewer, archive/complete untouched. Entity type for the viewer comes from the draft-status convention (same signal board.ts and unified-view.ts already use); board is always 'task'.

Implementation complete. New src/ui/deletion.ts: shared explicit-delete flow (buildDeletionPreview dialog -> cancel/unlink/reassign with in-dialog validation -> separate 'Permanently delete' confirm -> core.deleteEntity/core.deleteDocument). Wired: board (screen + task-popup D key), task viewer (D; draft status selects the draft entity), doc list/doc view (D in scrollableViewer via optional action). Archive/complete keys and wording untouched; footers/help updated ([D] Del / Delete task file). Verified: bun test tui-delete (15 pass) + affected suites (112 pass across 7 files; board-tui-move, deletion-preview, cli-delete*, cli-doc-delete, help-popup); bunx tsc --noEmit clean; biome clean. PTY keyboard review (expect, /tmp/fork19-manual): board D on linked task -> refs preview -> unlink -> confirm -> dep unlinked + not archived; plain board delete; archive wording + decline keeps task; viewer cancel keeps task; drafts view shows 'Delete Draft' + recovery warning, cancel keeps draft; doc view delete removes the file and exits; no-Git warning renders in the preview.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added an explicit, discoverable delete action to the TUI for tasks, drafts, and documents without touching archive/complete defaults. A shared flow (src/ui/deletion.ts) renders the CLI's deletion preview (file, active structured references, unresolved links, free-text limit, Git/no-Git recovery warning), collects cancel/unlink/reassign (reassign validates the replacement in-dialog), requires a separate 'Permanently delete' confirmation, then runs the same Core operations as the CLI; errors surface verbatim. Board: D at screen and task-popup level; task viewer/drafts view: D (draft status picks the draft entity; cross-branch refused like archive); documents: D in the doc list/doc view viewers. Footers and help list the new key next to untouched A/C entries. Verification: 15 new interaction tests (tui-delete.test.ts) covering delete, cancel, confirm-decline, unlink, reassign, rejected reassign, missing target, no-Git warning, draft, document, board wiring, archive intact, help/footer entries; affected suites pass (112 tests/7 files); tsc and biome clean; expect-driven PTY review exercised every flow end to end with filesystem assertions. Risk noted: the first keypress after closing any popup in the task-list viewer is swallowed - reproduced with the shipped complete/archive popup (probe5), so pre-existing and left untouched.
<!-- SECTION:FINAL_SUMMARY:END -->
