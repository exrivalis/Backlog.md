---
id: FORK-22
title: Verify old Backlog data and upstream merge compatibility
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:17'
updated_date: '2026-10-07 08:42'
labels: []
dependencies:
  - FORK-4
  - FORK-5
  - FORK-6
  - FORK-8
  - FORK-9
  - FORK-10
  - FORK-11
  - FORK-12
  - FORK-16
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
  - backlog/docs/strategy/doc-3 - Upstream-integration-policy.md
type: chore
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Versioned test fixtures and a documented upstream-sync checklist verify old Markdown, defaults, IDs and new feature interactions.

## Contexte
The fork must stay useful on existing Backlog projects and remain mergeable with new upstream releases, without turning file format changes into silent migrations.

## Résultat attendu
Versioned test fixtures and a documented upstream-sync checklist verify old Markdown, defaults, IDs and new feature interactions.

## Périmètre
CLI smoke fixtures across task/draft/doc/decision/milestone, no-Git and Git behavior, no accidental default deletion, change/ADR migration and doc-3 sync evidence.

## Hors périmètre
Do not merge an upstream release or publish the package as part of this task.

## Vérification attendue
Run bun run test, bunx tsc --noEmit, bun run check . and a documented fixture round trip.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Old-format project fixtures still load and preserve existing archive/complete semantics after new features are introduced.
- [ ] #2 Git and filesystem-only fixtures exercise explicit deletion, spec changes and ADR lookup without corrupting unrelated records.
- [ ] #3 An upstream-sync checklist documents merge tests, incompatible migrations and human review before publication.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After the listed CLI/model dependencies, assemble versioned old-format fixtures for task, draft, document, decision, milestone, Git and filesystem-only projects without rewriting original fixture bytes unnecessarily.
2. Round-trip the fixtures through current CLI workflows: default archive/complete, explicit deletion and link resolution, ADR lookup/retirement and optional spec-change integration; assert stable IDs and unrelated content.
3. Document the doc-3 upstream-sync checklist with baseline and target revisions, semantic comparison, migrations/rollback examples, conflict evidence and human review gate; no upstream merge in this task.
4. Run bun run test, bunx tsc --noEmit, bun run check . and fixture smoke checks; investigate failures before treating compatibility as verified.
<!-- SECTION:PLAN:END -->
