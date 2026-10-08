---
id: doc-5
title: Upstream sync checklist
type: guide
created_date: '2026-10-08 16:19'
updated_date: '2026-10-08 16:20'
---
# Upstream sync checklist

Run this checklist for every upstream sync. It operationalizes doc-3 (integration policy) against doc-4 (product definition) and records the evidence a reviewer needs before a merge can be approved. A step without its evidence blocks the sync. Never merge, commit, or push without the human review gate at the end.

## 1. Revisions

- [ ] Record the baseline: the upstream commit the fork last integrated (current baseline: 69e7b153, Backlog.md 1.53.0, 2026-10-06) and the fork main commit it sits on.
- [ ] Record the target: the upstream release tag or commit hash under review and its release notes link.
- [ ] Confirm the fork working tree is clean and on an isolated integration branch created from fork main.

## 2. Semantic comparison

- [ ] Diff shipped behavior, not just code: CLI help text, public instruction files, MCP tool schemas, config keys, and defaults.
- [ ] For each fork feature (explicit deletion, ADR lifecycle and retirement, spec-change documents, comment correction history, completion records), state whether upstream now ships an equivalent. Prefer upstream's shared-model implementation and retire the fork duplicate only with a migration and test plan (doc-3).
- [ ] Re-run the old-data compatibility suite (`bun test src/test/old-data-compatibility.test.ts`) against the merged tree: upstream 1.53.0 fixtures must still load, and old records outside an operation must keep their bytes.
- [ ] Compare archive, delete, and ID semantics against doc-4 whenever upstream touched them; human review decides whether fork behavior must change.

## 3. Migrations and rollback

- [ ] For every file-format change, write the migration, the backward-compatibility decision, and a rollback or recovery path before merging (doc-3 failure policy).
- [ ] Include a before/after example of at least one real record per format change, and mark destructive migrations as preview-required.
- [ ] If a migration cannot preserve stable IDs or historical links, stop: escalate to a product decision instead of merging.

## 4. Conflict evidence

- [ ] List every conflicted file with the resolution chosen and why; never auto-accept either side for schemas, help text, instruction files, or migrations.
- [ ] Record behavior differences found in step 2, even when no file conflicted.
- [ ] Note upstream changes to `backlog/` project data and confirm none were silently applied to fork-planning/ or MANIFESTO.md.

## 5. Tests and review gate

- [ ] Run the repository checks on the integration branch: `bun run test`, `bunx tsc --noEmit`, `bun run check .`, and the CLI/TUI/browser smoke for affected surfaces, filesystem-only operation, and old Markdown data.
- [ ] Write the integration note: baseline and target hashes, conflicts, behavior differences, migrations, test results, remaining risks, and any fork feature retired.
- [ ] Human review of the integration note is the gate. Do not merge to fork main, commit, or push without explicit authorization, and record the review measures doc-3 asks for (days since release, conflict count, resolution time, failing tests, fork patches replaced).
