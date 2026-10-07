---
id: FORK-10
title: Record ADRs and enforce complete supersession
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:07'
updated_date: '2026-10-07 08:42'
labels: []
dependencies:
  - FORK-4
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
The CLI can record an ADR as a decision, accept/reject it, and fully supersede an accepted ADR with a linked replacement.

## Contexte
Backlog decisions have no defined architecture-decision lifecycle or enforceable replacement relationship. A retired ADR must not remain authoritative for new work.

## Résultat attendu
The CLI can record an ADR as a decision, accept/reject it, and fully supersede an accepted ADR with a linked replacement.

## Périmètre
Decision identity and kind, context/alternatives/outcome/consequences, lifecycle, full-scope replacement checks, bidirectional historical links and preservation of earlier text.

## Hors périmètre
Do not move ADRs to archive or implement agent search filtering here.

## Vérification attendue
Exercise proposed/accepted/rejected/superseded states, invalid or partial replacement, duplicate IDs and link history; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An ADR is a discoverable Backlog decision with stable ID, status, rationale, alternatives and consequences.
- [ ] #2 Full supersession identifies the authoritative replacement and preserves links and content of the older ADR.
- [ ] #3 Partial or ambiguous supersession cannot silently retire still-applicable guidance.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-4, inspect the decision model, parser and CLI; represent architecture decisions in the existing decision ID/storage model while leaving legacy decisions readable.
2. Add validated ADR fields for scope, context, alternatives, choice, rationale and consequences, with explicit proposed/accepted/rejected lifecycle transitions.
3. Implement full supersession as one reviewed operation: validate replacement identity, accepted status, full prior scope coverage and no cycles; retain old text and both historical links. If scope remains unresolved, refuse retirement and request a human decision.
4. Test ADR creation, transitions, duplicate IDs, full versus partial replacement and bidirectional history in CLI/core round trips; leave archive and default discovery for FORK-11/12.
<!-- SECTION:PLAN:END -->
