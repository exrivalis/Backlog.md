---
id: FORK-18
title: Expose ADR and spec-change workflows in the browser
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:17'
updated_date: '2026-10-07 08:42'
labels: []
dependencies:
  - FORK-12
  - FORK-16
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Browser views expose current specs, linked changes and ADR status/replacement with clear preview of spec integration.

## Contexte
A person must be able to inspect proposed behavior and applicable architecture decisions without relying on an agent or accidentally adopting retired guidance.

## Résultat attendu
Browser views expose current specs, linked changes and ADR status/replacement with clear preview of spec integration.

## Périmètre
Human-readable link/navigation, proposed vs current specs, retired ADR notice and review/preview affordances using shared CLI semantics.

## Hors périmètre
Do not implement a browser-only change engine or a second approval state model.

## Vérification attendue
Exercise proposed/current change, archived ADR and applicable ADR navigation with browser tests/manual review; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A person can distinguish proposed deltas from current specifications in browser views.
- [ ] #2 A retired ADR displays its replacement and cannot appear as applicable guidance by default.
- [ ] #3 Reviewing a change does not silently apply it or complete linked tasks.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-12/16, inspect browser DecisionDetail, DocumentationDetail, route data and API helpers; use the shared ADR/change/spec model rather than a UI-specific parser or approval state.
2. Surface applicable ADRs, explicit historical lookup, replacement links and current versus proposed spec text; navigate linked tasks/specs/changes without showing retired ADRs as current guidance.
3. Provide human-readable review and preview access to the validated change projection; applying remains an explicit separately gated operation, never a side effect of viewing or editing a linked task.
4. Test active/retired ADR navigation, proposal/current distinction, preview and no implicit apply/completion in server/component tests; manually check focus, keyboard and desktop/narrow rendering.
<!-- SECTION:PLAN:END -->
