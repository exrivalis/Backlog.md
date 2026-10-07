---
id: FORK-11
title: Archive and retrieve retired ADRs without losing identity
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:16'
updated_date: '2026-10-07 08:42'
labels: []
dependencies:
  - FORK-10
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
A retired ADR can be archived and retrieved by its original ID; an applicable accepted ADR remains active.

## Contexte
Retired architecture decisions clutter the active working set but remain needed for historical traceability. Archive must not be conflated with delete.

## Résultat attendu
A retired ADR can be archived and retrieved by its original ID; an applicable accepted ADR remains active.

## Périmètre
Archive eligibility after rejection, deprecation or supersession, stable lookup of archived IDs, readable replacement pointer and explicit restore of an accidentally archived ADR.

## Hors périmètre
Do not permit deletion of ADRs or automatically archive them on supersession.

## Vérification attendue
Archive retired/accepted test records, verify lookup and restore with/without Git, and run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retired ADRs can move out of the active working set without losing identity, content or replacement links.
- [ ] #2 Archived ADRs remain addressable with clear status and can be restored without changing the original decision.
- [ ] #3 A currently applicable accepted ADR cannot be archived as retired without a valid lifecycle transition.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-10, inspect existing archive moves and decision ID/path resolution; specify retired-only eligibility and preserve historical decision IDs across directories.
2. Add explicit ADR archive and restore CLI actions backed by safe moves to/from backlog/archive/decisions; never auto-archive on supersession or treat archive as delete.
3. Make exact-ID historical lookup display status and replacement even after a move; reject path collisions, duplicate IDs and attempts to archive an applicable accepted ADR.
4. Test archive/restore, lookup, immutable links, collisions and filesystem-only/Git behavior in temporary projects; run targeted tests and static checks.
<!-- SECTION:PLAN:END -->
