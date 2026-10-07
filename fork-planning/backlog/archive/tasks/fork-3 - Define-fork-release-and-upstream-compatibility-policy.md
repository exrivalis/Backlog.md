---
id: FORK-3
title: Define fork release and upstream compatibility policy
status: To Do
assignee: []
created_date: '2026-10-07 07:58'
labels: []
dependencies: []
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: spike
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Set fork naming, versioning, migration, and upstream synchronization gates before a distribution is published.

## Contexte
The fork must stay mergeable with upstream and must not overwrite the globally installed upstream package. doc-3 describes integration but leaves distribution identity open.

## Résultat attendu
A reviewed policy names the fork package/version strategy, upgrade and rollback expectations, and upstream release review cadence.

## Périmètre
Consider CLI coexistence, package naming, backward compatibility for existing Markdown, origin/upstream merge strategy, regression checks, and review ownership.

## Hors périmètre
Do not publish a package, merge upstream, or change the installed CLI as part of this task.

## Vérification attendue
Document a dry-run installation/upgrade/rollback scenario and an upstream merge checklist with validation commands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A distribution identity and version policy are explicitly approved without collision with the upstream package.
- [ ] #2 The policy names tests and migration/rollback evidence needed before a fork release or upstream sync.
- [ ] #3 A release and periodic upstream monitoring cadence is recorded in doc-3 or a linked document.
<!-- AC:END -->
