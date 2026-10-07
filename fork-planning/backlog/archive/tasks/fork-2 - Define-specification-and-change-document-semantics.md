---
id: FORK-2
title: Define specification and change document semantics
status: To Do
assignee: []
created_date: '2026-10-07 07:58'
labels: []
dependencies: []
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: spike
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Set the minimal document, requirement, and change lifecycle contract for the OpenSpec-inspired workflow.

## Contexte
Backlog already has specification documents but has no requirements identity, delta validation, or integration semantics. The product definition does not settle whether changes need a new document type or which structured fields carry links.

## Résultat attendu
A reviewed Backlog document and example show one existing spec, a proposed delta, its linked work/ADR, validation, approved incorporation, and retained history.

## Périmètre
Specify requirement identifiers, added/modified/removed scenarios, baseline conflicts, multi-spec changes, status/metadata, link ownership, and what happens on reapply or partial failure.

## Hors périmètre
Do not implement a second task checklist, mandatory design artifacts, or a generic schema engine.

## Vérification attendue
Walk through a nominal, stale-baseline, missing-target, duplicate-identity and rejected-change example; document the expected diagnostics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A complete example connects one change, its current specs, tasks and an optional ADR without duplicate task statuses.
- [ ] #2 Validation, preview, review, integration and archive semantics cover stale or ambiguous requirements and safe retry.
- [ ] #3 The document records the approved document representation and link rules before implementation work starts.
<!-- AC:END -->
