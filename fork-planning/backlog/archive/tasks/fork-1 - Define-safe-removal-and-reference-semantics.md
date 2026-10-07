---
id: FORK-1
title: Define safe removal and reference semantics
status: To Do
assignee: []
created_date: '2026-10-07 07:58'
labels: []
dependencies: []
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: spike
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Specify archive, recoverable deletion, restore, purge, and reference handling for supported entities before implementing destructive commands.

## Contexte
Backlog currently archives tasks and milestones but has no consistent CLI deletion/restore contract. The product definition confirms recovery and fail-closed references but leaves purge eligibility and multi-file failure behavior open.

## Résultat attendu
A reviewed Backlog document specifies entity-by-entity removal, identity retention, linked-item choices, preview/confirmation, safe rollback, and restore/purge behavior.

## Périmètre
Cover tasks, drafts, documents, decisions including ADRs, and milestones; include no-Git operation, stale IDs, free-text limits, comment correction evidence, and CLI/browser DELETE compatibility.

## Hors périmètre
Do not implement removal commands or add a generic event store.

## Vérification attendue
Run a written scenario matrix for linked and unlinked entities, interrupted operations, restore conflicts, and rejected purge; document each expected result.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The contract distinguishes archive, recoverable delete, restore and irreversible purge for every supported entity.
- [ ] #2 The contract specifies inbound structured-reference handling, ambiguous-ID failure, recovery without Git, and no automatic purge.
- [ ] #3 The contract records an explicit human decision for irreversible purge eligibility and comments before implementation starts.
<!-- AC:END -->
