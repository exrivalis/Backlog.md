---
id: FORK-9
title: Delete documents only on explicit request
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:03'
updated_date: '2026-10-07 08:42'
labels: []
dependencies:
  - FORK-7
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
A separate explicit CLI command removes a selected document file, including a specification or change document, without changing task archive or decision behavior.

## Contexte
Backlog documents can be created and edited but cannot be deleted through the CLI. Users need to remove unwanted documents when they explicitly ask for it.

## Résultat attendu
A separate explicit CLI command removes a selected document file, including a specification or change document, without changing task archive or decision behavior.

## Périmètre
Documents of all supported types, ID and structured reference checks via FORK-7, scriptable explicit request, non-Git warning, and failure diagnostics.

## Hors périmètre
Do not delete decisions/ADRs or milestones, or add a document trash/restore/purge workflow.

## Vérification attendue
In temporary projects, verify explicit deletion of ordinary/specification/change documents, refusal for ambiguous/linked documents without resolution, and no-Git behavior; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A direct CLI delete removes the requested document file without modifying unrelated documents or changing existing task archive behavior.
- [ ] #2 Documents with active structured references require the explicit FORK-7 resolution, and unknown/ambiguous IDs fail safely.
- [ ] #3 CLI help warns that uncommitted deleted files may not be recoverable; decision/ADR records remain outside this delete command.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Depend on FORK-7: inspect document ID/path resolution, doc types and structured inbound links, including specs and changes.
2. Add an explicit doc delete CLI operation using the shared preview and validated cancel/unlink/reassign choices; preserve doc update and task archive behavior, and never include decisions/ADRs or milestones.
3. Lock and prepare reference edits before removing the selected file; handle missing/ambiguous paths and write/unlink failure without silently corrupting linked documents. Explain no-Git and uncommitted-file recovery limits in help.
4. Test ordinary, specification and change documents with and without active links, invalid replacement IDs, repeat deletion and filesystem errors in temporary projects; run scoped Bun tests and static checks.
<!-- SECTION:PLAN:END -->
