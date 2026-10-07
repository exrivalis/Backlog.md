---
id: FORK-4
title: Expose decision viewing and editing in the CLI
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
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Let a CLI user view and correct an existing Backlog decision without manually changing managed Markdown.

## Contexte
Backlog 1.53.0 can create/list decisions and edit their content through the browser API, but has no public decision view/update CLI command.

## Résultat attendu
The CLI views a decision and applies validated changes to its title, body and status using the same decision identity and storage.

## Périmètre
Include help, noninteractive use, unknown/ambiguous IDs, invalid content, and consistency with the browser update path.

## Hors périmètre
Do not introduce ADR supersession or deletion here.

## Vérification attendue
Run the new decision commands on a temporary project, then run the targeted Bun tests, bunx tsc --noEmit, and bun run check .
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A CLI user can view and update a decision title, body, and status without editing a file by hand.
- [ ] #2 Unknown, ambiguous, or invalid updates fail without damaging the original decision.
- [ ] #3 CLI help and tests document the behavior and the browser continues to read the updated decision.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Recheck decision create/list CLI help, browser PUT semantics, decision parsing/serialization and identity lookup; define field-level validation without accepting arbitrary frontmatter rewrites.
2. Add decision view and edit commands in src/cli.ts using one core mutation path for title, body and status; keep existing decision ID and preserve untouched fields. Route the browser update through the same validation where practical.
3. Reject missing/duplicate identities and invalid status or content before a write; ensure a failed update leaves the original file intact.
4. Document help and add temporary-project CLI/core/browser regression tests; run targeted Bun tests, bunx tsc --noEmit and bun run check .
<!-- SECTION:PLAN:END -->
