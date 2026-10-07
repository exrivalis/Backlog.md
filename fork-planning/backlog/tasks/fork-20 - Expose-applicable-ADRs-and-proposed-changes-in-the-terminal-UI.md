---
id: FORK-20
title: Expose applicable ADRs and proposed changes in the terminal UI
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
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
TUI views expose linked current specs, proposed changes and ADR status/replacement using the shared model.

## Contexte
Terminal users should be able to identify current behavior and applicable architecture guidance without mistaking an archived ADR or a proposal for current truth.

## Résultat attendu
TUI views expose linked current specs, proposed changes and ADR status/replacement using the shared model.

## Périmètre
Read and navigate applicable decisions, historical lookup, current vs proposed change distinctions and preview access where these surfaces exist.

## Hors périmètre
Do not create an independent TUI parser or mandatory change form for routine tasks.

## Vérification attendue
Exercise TUI navigation/focus for current specs, proposed deltas and superseded ADRs; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Applicable accepted ADRs are discoverable by default; retired ones appear only as clearly marked history.
- [ ] #2 A user can distinguish proposed change text from the current specification through the TUI.
- [ ] #3 TUI views do not imply a change was approved, applied or linked task completed when it was not.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-12/16, inspect existing TUI task and document viewing/navigation; derive ADR/change/spec data from the shared model rather than parsing Markdown a second time.
2. Show applicable accepted ADRs by default with explicit marked historical lookup and replacement navigation; show linked current specs separately from proposed deltas and integrated change history.
3. Expose non-mutating validated preview access where the TUI has a relevant record view; never imply approval, apply or task completion from a navigation action.
4. Test navigation, focus, active versus retired ADRs, proposal/current labels and archived links with TUI tests/manual checks; run scoped Bun tests and static checks.
<!-- SECTION:PLAN:END -->
