---
id: FORK-12
title: Exclude retired ADRs from agent guidance and active references
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:16'
updated_date: '2026-10-07 08:42'
labels: []
dependencies:
  - FORK-10
  - FORK-11
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Default CLI discovery and shipped agent guidance favor applicable accepted ADRs; old IDs resolve with a warning and the replacement.

## Contexte
An archived or superseded ADR is historical evidence, not current architecture guidance. Agents must not cite it as authoritative for new work.

## Résultat attendu
Default CLI discovery and shipped agent guidance favor applicable accepted ADRs; old IDs resolve with a warning and the replacement.

## Périmètre
Default decision search/list behavior, explicit historical lookup, active task/change/spec reference validation, supersession-chain safety, and instructions for agents.

## Hors périmètre
Do not rewrite immutable historical citations or claim to control arbitrary external filesystem reads.

## Vérification attendue
Test search, old-ID lookup, active reference validation, history lookup and cycle diagnostics; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Default decision discovery excludes rejected, superseded and archived ADRs from applicable guidance.
- [ ] #2 Opening a retired ADR clearly points to its authoritative replacement; unknown replacements and supersession cycles are errors.
- [ ] #3 Current structured references to retired guidance are reported or blocked while historical references remain readable.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-10/11, inspect decision list/search, task documentation/references and change/spec link models; distinguish applicable ADR guidance from legacy ordinary decisions and historical citations.
2. Default applicable-ADR discovery to accepted, active records; provide explicit historical lookup with retired state and replacement-chain notice, without pretending to control raw filesystem reads.
3. Validate current governing structured references against retired ADRs; report or block new invalid links, unresolved replacements and supersession cycles while leaving historical citations intact.
4. Update shipped CLI instructions and add CLI/search/reference tests for active, rejected, superseded, archived and cyclic cases; run scoped Bun tests and static checks.
<!-- SECTION:PLAN:END -->
