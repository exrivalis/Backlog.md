---
id: FORK-21
title: Teach agents the optional change and explicit delete rules
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:17'
updated_date: '2026-10-07 08:42'
labels: []
dependencies:
  - FORK-8
  - FORK-9
  - FORK-12
  - FORK-16
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Shipped CLI instructions explain default archive, authorized explicit deletion, linked-reference handling, optional specs/changes and retired-ADR filtering.

## Contexte
Agents currently refuse explicitly requested deletion because archive is the documented operation. They may also cite historical ADRs as current guidance unless instructions and retrieval agree.

## Résultat attendu
Shipped CLI instructions explain default archive, authorized explicit deletion, linked-reference handling, optional specs/changes and retired-ADR filtering.

## Périmètre
Instructions surfaced by backlog instructions, public CLI help examples, human/agent parity and safe noninteractive invocation with direct user authorization.

## Hors périmètre
Do not add an agent-only mutation path or compel an agent to delete when the user asked to archive.

## Vérification attendue
Evaluate examples where the user asks archive, explicitly asks delete, encounters links or a superseded ADR; run tests for shipped instruction text.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Shipped instructions tell agents to archive by default but use explicit delete for eligible records when the user requests deletion.
- [ ] #2 Instructions require a reference resolution choice when active structured links exist and warn about uncommitted file recovery.
- [ ] #3 Instructions guide agents to applicable ADRs and optional spec changes without using historical ADRs as current authority.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-8/9/12/16, inspect generated backlog instructions, shipped CLI help and sample agent flows; keep CLI guidance canonical for both humans and agents.
2. Explain default archive/complete versus separately authorized explicit delete for tasks/drafts/documents, including noninteractive commands, linked-reference choices and uncommitted-file recovery limits.
3. Explain that specifications/changes are optional, current specs differ from proposed deltas, and only applicable accepted ADRs govern new work; show historical lookup with replacement warnings.
4. Test shipped instruction text and exercise archive, authorized delete, linked delete and superseded-ADR scenarios against public CLI help; do not introduce agent-only commands.
<!-- SECTION:PLAN:END -->
