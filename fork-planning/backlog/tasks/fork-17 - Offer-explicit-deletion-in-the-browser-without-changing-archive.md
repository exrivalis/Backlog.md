---
id: FORK-17
title: Offer explicit deletion in the browser without changing archive
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:17'
updated_date: '2026-10-07 13:43'
labels: []
dependencies:
  - FORK-8
  - FORK-9
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Browser users can invoke an explicit task/draft/document delete action and see its consequences; existing archive controls still archive.

## Contexte
The browser currently uses a DELETE task route to archive. New deletion semantics must not silently change existing browser behavior or hide the risk of physical file removal.

## Résultat attendu
Browser users can invoke an explicit task/draft/document delete action and see its consequences; existing archive controls still archive.

## Périmètre
Task/draft/document affordances, preview/confirmation, shared reference choices, API naming and old DELETE route compatibility.

## Hors périmètre
Do not expose decision/ADR or milestone deletion, or redesign the board.

## Vérification attendue
Use browser interaction tests/manual scenarios for archive, explicit delete, linked targets and non-Git warning; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Existing browser archive controls and API routes continue to archive by default.
- [x] #2 A distinct intentional action deletes eligible task/draft/document files only after showing linked-reference choices and the irreversibility warning.
- [x] #3 Browser and CLI reject the same invalid target and reference cases.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-8/9, inspect existing browser archive controls, DELETE /api/tasks/:id behavior and doc/draft views; leave those archive routes and affordances unchanged.
2. Add distinct explicit-delete API actions for eligible records that call the shared core preview and delete operations, with consistent identity/reference error responses and no ADR/milestone deletion.
3. Add a clearly labeled browser action and confirmation showing affected references, cancel/unlink/reassign choices and uncommitted-file recovery warning; keep focus and cancellation safe.
4. Test archive versus delete, linked and unlinked records, invalid replacements and Git/no-Git warning through server/component interaction tests; manually review desktop and narrow layouts.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Evidence: (AC1) server-delete-endpoint.test.ts 'keeps the existing DELETE /api/tasks/:id route archiving' passes: task lands in listArchivedTasks, no delete route involved; archive affordances unchanged. (AC2) GET/POST /api/tasks/:id/delete (serves drafts via DRAFT- prefix) and GET/POST /api/docs/:id/delete route through buildDeletionPreview + Core.deleteEntity/deleteDocument; DeleteEntityDialog shows file path, inbound references, unlink/reassign radios, recovery + free-text warnings; confirm disabled until a valid choice; Escape/Cancel/backdrop close without deleting; focus starts on the dialog. (AC3) server tests assert the CLI's exact core rejections over HTTP: linked-target cancel 400 'requires an unlink or reassign choice', invalid replacement 400 'does not match exactly one task or draft.', self-reassign 400 'it is the record being deleted', missing target 404, ambiguous ID 409, changed-corpus handled by the server rebuilding the preview at confirm time (reference added after the browser preview is still unlinked) plus core's under-lock DeletionPreviewChangedError re-validation shared with the CLI.

Verification commands run: 'bun test --timeout=10000 src/test/server-delete-endpoint.test.ts src/test/web-delete-dialog.test.tsx' (24 pass, 0 fail); regression: web-task-details-modal-* + web-app-open-detail-refresh (68 pass), server-delete/demote/documents/decision/cache tests + deletion-preview + web-dependency-cleanup-notice (60 pass), cli-delete + cli-doc-delete (40 pass, CLI surface untouched); 'bunx tsc --noEmit' clean; 'bunx biome check src/server/index.ts src/web/lib/api.ts src/test/server-delete-endpoint.test.ts' clean (repo biome config only covers src/**/*.ts; .tsx files are out of its scope by existing convention). Smoke-tested live: served the built browser on a /tmp project, GET /api/tasks/TASK-1/delete returned the full preview with dependency reference and Git recovery warning. Layout: no rendered-browser review was possible in this environment (no playwright/puppeteer; pen.dev browser needs an open canvas) - review was static over the responsive classes (dialog max-w-xl in p-4 overlay, w-full sidebar button, max-h-40 scrollable reference list, flex-wrap added to the doc header actions row for narrow screens); a rendered desktop/narrow pass is still worthwhile before release.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added explicit browser deletion alongside unchanged archive. Server: GET+POST /api/tasks/:id/delete (one route serves tasks and DRAFT- drafts, resolving entity type with the configured prefix) and GET+POST /api/docs/:id/delete; both call buildDeletionPreview/deletionRecoveryWarning and Core.deleteEntity/deleteDocument, so identity, replacement, and changed-corpus rejections are the CLI's own core validations, not server copies. POST rebuilds the preview before mutating, so references added after the browser preview loaded are still resolved. The existing DELETE /api/tasks/:id archive route and every archive affordance are untouched. Browser: DeleteEntityDialog confirmation shows the target file, inbound references with source paths, unlink/reassign-to choices (reassign requires an ID), unresolved outbound links, and the recovery + free-text warnings; focus starts on the dialog, Escape/Cancel/backdrop cancel safely, the parent task modal's shortcuts pause while the dialog is open, and a delete whose later commit step failed is reported as done (deletionState) instead of inviting a retry. Entry points: 'Delete Permanently' in the task/draft modal sidebar (hidden for completed and cross-branch records, same eligibility the CLI enforces) and 'Delete' in the documentation header. Verification: 24 new server+component tests passing (archive-vs-delete, linked/unlinked, invalid/self replacement, 404/409/400 mapping, both recovery warnings, dialog interactions), 168 regression tests across touched surfaces, tsc clean, biome clean on the .ts files it covers. Risk/ follow-up: no rendered desktop/narrow browser pass was possible in this environment; static responsive review done, visual pass recommended before release.
<!-- SECTION:FINAL_SUMMARY:END -->
