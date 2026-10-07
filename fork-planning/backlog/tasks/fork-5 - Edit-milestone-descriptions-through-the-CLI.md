---
id: FORK-5
title: Edit milestone descriptions through the CLI
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 07:58'
updated_date: '2026-10-07 08:42'
labels: []
dependencies: []
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Allow correction of a milestone description while preserving its stable identity and existing linked tasks.

## Contexte
Milestone creation accepts a description, while the existing rename command covers title and due date but not description.

## Résultat attendu
The CLI can replace or clear a milestone description without renaming it or changing task assignments.

## Périmètre
Include active milestone identity checks, description replacement/clear, help and filesystem-only operation.

## Hors périmètre
Do not redesign milestone removal, task reassignment, or release scheduling.

## Vérification attendue
Create a temporary milestone, edit and clear its description, confirm linked tasks are unchanged, and run relevant Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Description replacement and clear are possible through public CLI commands.
- [ ] #2 Editing a description leaves the milestone ID and linked tasks unchanged.
- [ ] #3 Unknown or ambiguous IDs fail safely and CLI help/tests cover the operation.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inspect milestone rename, load and save and the CLI/browser update paths; confirm active-ID resolution and how description is serialized.
2. Extend the existing milestone mutation path with explicit description replacement and clearing, exposing it through CLI help without changing rename, due date or task reassignment behavior.
3. Validate the active target before writing and preserve ID, title, due date and linked tasks; fail closed on missing/ambiguous names.
4. Test replace, clear and invalid targets in temporary filesystem-only projects with linked tasks; run scoped Bun tests and static checks.
<!-- SECTION:PLAN:END -->
