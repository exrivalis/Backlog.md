---
id: FORK-5
title: Edit milestone descriptions through the CLI
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 07:58'
updated_date: '2026-10-07 10:54'
labels: []
dependencies: []
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Allow correction of a milestone description while preserving its stable identity and existing linked tasks.

## Contexte
Milestone creation accepts a description, while the existing rename command covers title and due date but not description.

## Résultat attendu
The CLI can replace or clear a milestone description without renaming it or changing task assignments.

## Périmètre
Include active milestone identity checks, description replacement/clear, help and filesystem-only operation.

## Hors périmètre
Do not redesign milestone removal, task reassignment, or release scheduling.

## Vérification attendue
Create a temporary milestone, edit and clear its description, confirm linked tasks are unchanged, and run relevant Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Description replacement and clear are possible through public CLI commands.
- [x] #2 Editing a description leaves the milestone ID and linked tasks unchanged.
- [x] #3 Unknown or ambiguous IDs fail safely and CLI help/tests cover the operation.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inspect milestone rename, load and save and the CLI/browser update paths; confirm active-ID resolution and how description is serialized.
2. Extend the existing milestone mutation path with explicit description replacement and clearing, exposing it through CLI help without changing rename, due date or task reassignment behavior.
3. Validate the active target before writing and preserve ID, title, due date and linked tasks; fail closed on missing/ambiguous names.
4. Test replace, clear and invalid targets in temporary filesystem-only projects with linked tasks; run scoped Bun tests and static checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented milestone edit path end to end. CLI: new 'milestone edit <name>' subcommand (src/cli.ts) with --description/-d replace and --clear-description, mutually exclusive, both required-guarded. Shared handler editMilestone + MilestoneEditArgs (src/mcp/tools/milestones/handlers.ts) resolves the active milestone via findActiveMilestoneByAlias before any write, so unknown and ambiguous titles fail closed as 'Milestone not found'; no-change input returns an idempotent 'No changes made' without rewriting the file. Core editMilestoneDescription (src/core/backlog.ts) mirrors renameMilestone's autoCommit and rollback pattern (commit 'backlog: Edit milestone description <id>'). Filesystem updateMilestoneDescription (src/file-system/operations.ts) rewrites only the ## Description section in place; clearing restores the create-default 'Milestone: <title>' placeholder so cleared state equals a milestone created without a description. Section regex hoisted to shared module constant reused by rewriteDefaultMilestoneDescription. ID, filename, title, due date, and task milestone values are untouched. MCP tool registration deliberately not added (task scope is CLI; handler is shared so adoption is a one-line wrapper later). Tests: src/test/cli-milestone-description-edit.test.ts (9 tests: replace, clear, idempotent no-change, unknown target without writes, ambiguous duplicate titles fail closed, flag conflicts, missing flag, help coverage, autoCommit commit message) plus existing milestone suites re-run.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added 'backlog milestone edit <name>' with --description/-d to replace and --clear-description to clear a milestone description. The edit reuses the existing milestone mutation path (shared MilestoneHandlers handler, Core.editMilestoneDescription, filesystem updateMilestoneDescription), rewrites only the ## Description section in place, and leaves milestone ID, filename, title, due date, and linked task values untouched. Clearing restores the same 'Milestone: <title>' default a milestone created without a description gets. Identity is resolved against active milestones before any write; unknown or ambiguous titles fail closed with 'Milestone not found' and no file changes. Verified: 9 new tests in src/test/cli-milestone-description-edit.test.ts pass (replace with linked task, clear, idempotent no-change, unknown target without writes, ambiguous duplicate titles fail closed, flag conflicts, help output, autoCommit message 'backlog: Edit milestone description m-0'); existing milestone suites re-run (68 tests across cli-milestone-management, mcp-milestones, cli-task-milestone, milestone-filter) with 0 failures; bunx tsc --noEmit clean; bunx biome check clean on changed files; manual CLI smoke test confirmed multi-line description replacement and help listing.
<!-- SECTION:FINAL_SUMMARY:END -->
