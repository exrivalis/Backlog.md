---
id: FORK-23
title: Package the fork alongside upstream Backlog.md
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:17'
updated_date: '2026-10-08 17:29'
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
- [x] #1 The fork has a distinct scoped package name and executable name; upstream CLI remains runnable in the same environment.
- [x] #2 Installation and version documentation explains pinning, updates and rollback for consuming projects.
- [x] #3 A build and coexistence smoke check pass before any publication request is made.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-17/18/19/20/21/22, review the release gate and agree the exact scoped npm package and distinct CLI binary spelling with Alex; retain upstream license, attribution and existing project defaults.
2. Make narrow package/bin/build metadata changes and document independent version pinning, installation, upgrades and rollback; do not overwrite the upstream backlog executable or publish from this task.
3. Build reproducibly, install fork and upstream in an isolated environment, invoke both executables on separate and existing sample projects, and check for shared package/bin collisions.
4. Record smoke/test evidence and request release review before any commit, push or publication; run build, Bun tests, type-check and Biome checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Packaging: package.json -> @exrivalis/backlog-fork, bin backlog-fork, scoped optionalDependencies; resolveBinary.cjs + postuninstall.cjs platform package names; cli.cjs launcher help/arg-filter; build.ts default outfile dist/backlog-fork; release.yml platform package matrix, dist bin backlog-fork, sanity installs via npx backlog-fork; DEVELOPMENT.md trusted-publisher list; README "Installing this fork" (install/pin/upgrade/rollback/coexist). Product identity (app-info name backlog.md, instruction markers) and project defaults unchanged.
Checks: bun run build -> dist/backlog-fork, ./dist/backlog-fork -v -> 1.53.0; bunx tsc --noEmit clean; bunx biome check . clean (460 files); bun run test -> 3170 pass / 8 fail / 8 skip: the 8 fails are exactly the known pre-existing list; moveTasksToStatus ordered placement passes in isolation (24/24).
Coexistence smoke (isolated /tmp/npm-global prefix): fork launcher+platform built as local tarballs mirroring release.yml, installed in ONE prefix with upstream backlog.md@1.53.0 from the public registry. bin/ holds distinct backlog and backlog-fork; node_modules holds backlog.md plus @exrivalis/backlog-fork and @exrivalis/backlog-fork-darwin-arm64; fork launcher resolves @exrivalis/backlog-fork-darwin-arm64/backlog (verified via require.resolve). Both CLIs -v/--help/task create/task list on separate sample projects (proj-upstream, proj-fork). On a copied existing backlog/ project both CLIs produce identical task list output and diff -rq against a pristine copy shows zero file changes. Upgrade 1.53.0->1.53.1 and rollback ->1.53.0 work in the same prefix with upstream unaffected; uninstall removes only backlog-fork, upstream keeps running.
Decision recorded in doc-6 (Fork release packaging). No publish, no push.
Observation (inherited upstream behavior, unchanged): postuninstall platform-package cleanup uses fire-and-forget spawns and left the orphaned platform package behind in the sandboxed prefix on uninstall.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Packaged the fork for coexistence with upstream: package @exrivalis/backlog-fork, executable backlog-fork, platform packages @exrivalis/backlog-fork-{linux,darwin,windows}-{x64,arm64}; versions track the upstream release (1.53.0). Narrow metadata-only diff: package.json name/bin/optionalDependencies, scripts/resolveBinary.cjs, scripts/cli.cjs launcher copy, scripts/postuninstall.cjs, scripts/build.ts default outfile, .github/workflows/release.yml package/bin/sanity references, DEVELOPMENT.md trusted-publisher list, README "Installing this fork" section (install/pin/upgrade/rollback). Product identity and project defaults unchanged. Decision recorded in doc-6. Verified: bun run build (dist/backlog-fork -v -> 1.53.0), bunx tsc --noEmit clean, bunx biome check . clean, bun run test 3170 pass with only the 8 known pre-existing failures (flaky one passes in isolation). Coexistence smoke in an isolated /tmp npm prefix: fork tarballs + upstream backlog.md@1.53.0 from the public registry installed side by side; distinct bin and package paths; both CLIs exercised on separate sample projects and on a copied existing backlog/ project with identical output and zero file changes; upgrade/rollback and uninstall isolation demonstrated. Not published, not pushed; release review still required before any publication.
<!-- SECTION:FINAL_SUMMARY:END -->
