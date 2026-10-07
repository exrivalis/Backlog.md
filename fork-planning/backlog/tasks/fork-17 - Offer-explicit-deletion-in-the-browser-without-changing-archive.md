---
id: FORK-17
title: Offer explicit deletion in the browser without changing archive
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:17'
updated_date: '2026-10-07 08:42'
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
- [ ] #1 Existing browser archive controls and API routes continue to archive by default.
- [ ] #2 A distinct intentional action deletes eligible task/draft/document files only after showing linked-reference choices and the irreversibility warning.
- [ ] #3 Browser and CLI reject the same invalid target and reference cases.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-8/9, inspect existing browser archive controls, DELETE /api/tasks/:id behavior and doc/draft views; leave those archive routes and affordances unchanged.
2. Add distinct explicit-delete API actions for eligible records that call the shared core preview and delete operations, with consistent identity/reference error responses and no ADR/milestone deletion.
3. Add a clearly labeled browser action and confirmation showing affected references, cancel/unlink/reassign choices and uncommitted-file recovery warning; keep focus and cancellation safe.
4. Test archive versus delete, linked and unlinked records, invalid replacements and Git/no-Git warning through server/component interaction tests; manually review desktop and narrow layouts.
<!-- SECTION:PLAN:END -->
