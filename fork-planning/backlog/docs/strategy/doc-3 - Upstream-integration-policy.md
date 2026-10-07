---
id: doc-3
title: Upstream integration policy
type: guide
created_date: '2026-10-06 20:21'
updated_date: '2026-10-07 08:18'
---
Status: **Proposed maintenance policy for review.** No sync merge, commit, or push is authorized by this document. Baseline: upstream MrLesk/Backlog.md main at 69e7b153 (Backlog.md 1.53.0), fork exrivalis/Backlog.md main at the same commit on 2026-10-06.

## Repository layout and ownership
- Git remote upstream tracks the original repository. Git remote origin tracks the personal fork. Work lives in the fork repository, separate from any project that later installs the fork.
- Leave upstream backlog/ as upstream project data. Keep this fork's roadmap and future implementation tasks under fork-planning/backlog, with task prefix fork. This reduces task/doc ID collisions during future upstream merges.
- Keep upstream LICENSE and attribution. Distribute this fork through a distinctly named scoped npm package and CLI command so upstream can coexist. Choose the exact scope and versioning before any release.
- Preserve upstream MANIFESTO.md. A divergence from its product principles needs an explicit product decision; do not silently amend it when merging.

## Sync cadence and procedure
Proposed cadence: inspect each upstream release and do a monthly check. The cadence is open for human approval. Prefer a merge-based update so upstream commits and fork commits remain traceable; do not force-push or rebase shared published fork branches.

1. Fetch upstream and examine release notes, merged changes, CLI help, public instruction text, migrations, and new upstream task/doc edits. Record old and target upstream commit hashes.
2. Compare each fork-only feature with upstream behavior. If upstream ships an equivalent, prefer its shared model or retire the duplicate after a migration and test plan. Do not keep two public commands for the same meaning without a proven need.
3. Create an isolated integration branch from the fork's main branch. Merge upstream/main into it. Resolve conflicts locally and deliberately. Never auto-accept upstream or fork versions of schemas, help text, instruction files, or migrations without review.
4. Run upstream's targeted tests, then its full test suite and static checks using the repository's prescribed Bun commands. Test CLI, browser and TUI behavior affected by the changes, filesystem-only operation, and old Markdown data. Review diffs for unintentional changes to upstream backlog/, fork-planning/, or MANIFESTO.md.
5. Record a short integration note: upstream source/target hashes, conflicts, behavior differences, migration requirements, tests and results, remaining risks, and any fork feature retired or replaced. Ask for human review before merge to fork main. Do not commit or push without explicit authorization.

## Patch discipline to limit merge cost
- Keep fork features in the shared domain model and canonical CLI first. Prefer narrow changes and reuse existing stores, validators, and serializers instead of copying upstream modules.
- Place fork-specific planning files in their isolated folder. Keep public docs and command help synchronized when behavior changes, but minimize churn in unrelated upstream files.
- Split work into independently reviewable changes. Avoid large formatting-only commits, broad rename waves, and fork-only forks of the upstream task model.
- Where a fix is useful to everyone and does not expose private roadmap strategy, consider proposing it upstream. Treat upstream acceptance as optional; the fork must still be operable independently.

## Failure and migration policy
- A conflict or failing test blocks a sync. Keep the fork on the last verified upstream base until resolved; do not hide regressions by changing acceptance criteria.
- File-format changes require a documented migration, backward-compatibility decision, rollback or recovery path, and example before rollout. A preview is required for destructive migrations.
- If upstream changes the semantics of archive, remove, or IDs, compare it against doc-4 before merging. Human review decides whether the fork behavior must change; ADRs remain outside explicit delete scope; active references require explicit resolution.
- If ongoing merges repeatedly touch the same fork code, record the cost and propose an architectural simplification rather than accumulating permanent compatibility layers.

## Maintenance review measures
Record per sync: days since upstream release, number of conflict files, time to resolve, failing tests, and number of fork-specific patches replaced by upstream behavior. If integration consumes more effort than the feature work it enables for two consecutive releases, pause feature expansion and simplify the divergence.
