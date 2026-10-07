---
id: FORK-14
title: Create optional change documents linked to specs and tasks
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:16'
updated_date: '2026-10-07 08:42'
labels: []
dependencies:
  - FORK-13
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
A change is one optional Backlog document linking affected spec IDs, existing task IDs and optional ADR IDs with proposed added/modified/removed requirements.

## Contexte
OpenSpec proposals and delta specs help agree on behavior, but a second tasks.md would duplicate Backlog task ownership.

## Résultat attendu
A change is one optional Backlog document linking affected spec IDs, existing task IDs and optional ADR IDs with proposed added/modified/removed requirements.

## Périmètre
Create/view/update a change document, explicit delta/scenario fields and cross-entity links using stable IDs and existing document storage.

## Hors périmètre
Do not create a second task checklist, copy current whole specs or require change records for routine tasks.

## Vérification attendue
Use CLI on a sample behavioral change and a routine task without a change; test link and delta parsing with scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One change document records rationale, scope and added/modified/removed requirement deltas with scenarios.
- [ ] #2 The change links to affected specs and existing Backlog tasks without duplicating task plans or statuses.
- [ ] #3 A task without a behavior change still works without a change document.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-13, inspect doc creation/update and task/decision ID resolvers; choose one optional change document shape in the existing doc namespace (type and path), not a separate task system.
2. Record rationale, scope, affected spec IDs, linked task IDs, optional ADR IDs and explicit add/modify/remove requirement deltas with scenarios; retain the document's own stable ID on edit.
3. Validate structured links and delta syntax at CLI creation/update, distinguishing proposed change text from current specs; never duplicate linked task plans/statuses or require changes for ordinary tasks.
4. Add CLI/core/parser round-trip tests for multi-spec links, invalid targets and routine tasks without changes; run targeted Bun tests and static checks.
<!-- SECTION:PLAN:END -->
