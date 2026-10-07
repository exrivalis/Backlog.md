---
id: FORK-19
title: Offer explicit deletion in the terminal UI without changing archive
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
- [ ] #1 Archival remains the default or existing TUI action for tasks and drafts.
- [ ] #2 A distinct delete action targets only eligible records and communicates file removal and reference impacts before execution.
- [ ] #3 TUI errors and cancellation preserve data and match canonical CLI outcomes.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-8/9, inspect board, task viewer, draft and document TUI actions; keep current archive/complete shortcuts and labels intact.
2. Add a separate discoverable delete action only on eligible entity views, backed by the same core preview/resolution/delete operations as the CLI; do not add ADR or milestone delete.
3. Present affected links, cancel/unlink/reassign options and uncommitted-file recovery warning; require intentional confirmation, preserve keyboard focus and return to the correct view on cancel/error/success.
4. Exercise task/draft/document flows, archive-versus-delete, linked-target errors and no-Git behavior with TUI interaction tests and manual keyboard review; run scoped tests/static checks.
<!-- SECTION:PLAN:END -->
