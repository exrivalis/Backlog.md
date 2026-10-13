---
id: doc-6
title: Fork release packaging
type: guide
created_date: '2026-10-08 17:26'
updated_date: '2026-10-13 17:47'
---
Status: **Agreed release configuration** (2026-10-08; package scope renamed to `@exrivalis/backlog.md` and executable to `backlog.md` on 2026-10-13; delegated decision implemented in FORK-23). Records the distribution identity selected for the reusable fork. Baseline product rules: doc-4; upstream and release boundary: doc-3.

## Selected identity
- npm package: `@exrivalis/backlog.md` (scoped under `@exrivalis`, distinct from upstream `backlog.md`; renamed from `@exrivalis/backlog-fork` on 2026-10-13).
- CLI executable: `backlog.md` (distinct from upstream `backlog`; renamed from `backlog-fork` on 2026-10-13 so the scoped package and executable share one spelling).
- Platform packages: `@exrivalis/backlog.md-{linux,darwin,windows}-{x64,arm64}`, each shipping an internal `backlog` binary inside its own package directory; no path is shared with upstream packages.
- Versioning: fork versions track the upstream Backlog.md release they are built from (currently `1.53.0`). The release workflow syncs the version to the git tag.

## Coexistence rule
Upstream Backlog.md (`backlog.md` / `backlog`) must remain installable and runnable in the same environment and on the same projects. The fork must never overwrite the upstream executable, package, or project defaults. Consumers choose per machine or per project by running `backlog.md` or `backlog`.

## Distribution notes
- Installation, version pinning, upgrades, and rollback for consuming projects are documented in the repository README ("Installing this fork").
- One-off runs use the scoped name (`npx @exrivalis/backlog.md ...`); an unscoped `npx backlog.md` resolves to the upstream package.
- Product identity inside projects stays Backlog.md (app name, instruction markers, project defaults unchanged); only distribution metadata is fork-scoped.
- The Nix flake and shell completions still expose upstream spellings (`backlog-md`, `backlog`); they are outside the npm coexistence scope and can be revisited if the fork ever ships Nix releases.
- Publication to npm requires explicit human authorization (doc-3); no publish or push is authorized by this document.
