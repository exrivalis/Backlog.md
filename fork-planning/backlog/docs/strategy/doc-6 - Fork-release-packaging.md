---
id: doc-6
title: Fork release packaging
type: guide
created_date: '2026-10-08 17:26'
updated_date: '2026-10-13 18:02'
---
Status: **Agreed release configuration** (2026-10-08; package renamed to `@exrivalis/backlog.md` on 2026-10-13; executable renamed to `backlog` and version bumped to `1.54.0` the same day by explicit product decision). Delegated decision implemented in FORK-23. Records the distribution identity selected for the reusable fork. Baseline product rules: doc-4; upstream and release boundary: doc-3.

## Selected identity
- npm package: `@exrivalis/backlog.md` (scoped under `@exrivalis`, distinct from upstream `backlog.md`; renamed from `@exrivalis/backlog-fork` on 2026-10-13).
- CLI executable: `backlog` (same name as upstream, chosen by explicit decision on 2026-10-13; renamed from `backlog.md`).
- Platform packages: `@exrivalis/backlog.md-{linux,darwin,windows}-{x64,arm64}`, each shipping an internal `backlog` binary inside its own package directory; no path is shared with upstream packages.
- Versioning: the fork versions independently (`1.54.0` is the first fork feature release, built on upstream `1.53.0`); the upstream baseline of each release is recorded at sync time per doc-3/doc-5. The release workflow syncs the package version to the git tag.

## Coexistence rule (amended 2026-10-13)
Upstream Backlog.md (`backlog.md` / `backlog`) and this fork share the `backlog` executable name, so they cannot both be installed globally on one machine: the most recently installed package owns the command, and uninstalling one may leave the other without its shim. Project data stays plain Backlog.md Markdown either way; the fork must not overwrite or rewrite a project in a way upstream (or a later fork version) cannot read. Consumers who need both CLIs side by side must use distinct install prefixes or the scoped `npx @exrivalis/backlog.md` form.

## Distribution notes
- Installation, version pinning, upgrades, and rollback for consuming projects are documented in the repository README ("Installing this fork").
- One-off runs use the scoped name (`npx @exrivalis/backlog.md ...`); an unscoped `npx backlog.md` resolves to the upstream package.
- Product identity inside projects stays Backlog.md (app name, instruction markers, project defaults unchanged); only distribution metadata is fork-scoped.
- The Nix flake and shell completions still expose upstream spellings (`backlog-md`, `backlog`); they are outside the npm coexistence scope and can be revisited if the fork ever ships Nix releases.
- Publication to npm requires explicit human authorization (doc-3); no publish or push is authorized by this document.
