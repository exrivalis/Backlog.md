---
id: FORK-8
title: Delete tasks and drafts only on explicit request
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
- [ ] #1 A direct CLI delete removes a task or draft file only after an explicit delete request, while existing archive/complete paths retain their behavior.
- [ ] #2 An agent with explicit user authorization can use the noninteractive delete operation without first archiving or refusing solely because archive is the default.
- [ ] #3 Linked, unknown, ambiguous, and failed-deletion cases follow FORK-7 without silent reference damage; deleted IDs cannot silently identify a different active record.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Depend on FORK-7: reuse its preview, ID resolver and validated reference choices; recheck existing task/draft archive and task complete semantics, including children and ID allocation.
2. Add separate explicit task and draft delete CLI commands with scriptable confirmation; refuse linked targets unless unlink/reassign was chosen and validated. Do not call archive as a deletion substitute.
3. Prepare reference edits and target removal under the existing locks; check for write/unlink errors, avoid silent partial reference damage, and leave useful recovery diagnostics. Ensure deleted IDs cannot accidentally resolve to another active task or draft.
4. Test archived versus deleted files, linked records, repeated/missing/ambiguous IDs, failed writes, and Git/no-Git warnings; run scoped Bun tests and static checks.
<!-- SECTION:PLAN:END -->
