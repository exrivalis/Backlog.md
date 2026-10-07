---
id: FORK-23
title: Package the fork alongside upstream Backlog.md
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:17'
updated_date: '2026-10-07 08:42'
labels: []
dependencies:
  - FORK-17
  - FORK-18
  - FORK-19
  - FORK-20
  - FORK-21
  - FORK-22
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
  - backlog/docs/strategy/doc-3 - Upstream-integration-policy.md
type: feature
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
A distinctly named scoped npm package and CLI command can be installed alongside upstream without changing either product’s existing projects by default.

## Contexte
The reusable fork will be used by multiple projects. Overwriting the upstream npm package or command would prevent safe coexistence and complicate upstream updates.

## Résultat attendu
A distinctly named scoped npm package and CLI command can be installed alongside upstream without changing either product’s existing projects by default.

## Périmètre
Package metadata, version policy, installation/upgrade/rollback instructions, reproducible build and coexistence smoke checks; record the selected package scope in doc-3.

## Hors périmètre
Do not publish to npm or push a Git remote without explicit human authorization.

## Vérification attendue
Build the fork, install both packages in an isolated environment, run both CLIs, and confirm no shared binary/package collision.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The fork has a distinct scoped package name and executable name; upstream CLI remains runnable in the same environment.
- [ ] #2 Installation and version documentation explains pinning, updates and rollback for consuming projects.
- [ ] #3 A build and coexistence smoke check pass before any publication request is made.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-17/18/19/20/21/22, review the release gate and agree the exact scoped npm package and distinct CLI binary spelling with Alex; retain upstream license, attribution and existing project defaults.
2. Make narrow package/bin/build metadata changes and document independent version pinning, installation, upgrades and rollback; do not overwrite the upstream backlog executable or publish from this task.
3. Build reproducibly, install fork and upstream in an isolated environment, invoke both executables on separate and existing sample projects, and check for shared package/bin collisions.
4. Record smoke/test evidence and request release review before any commit, push or publication; run build, Bun tests, type-check and Biome checks.
<!-- SECTION:PLAN:END -->
