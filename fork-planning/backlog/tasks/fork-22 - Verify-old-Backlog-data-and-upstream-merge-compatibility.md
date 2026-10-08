---
id: FORK-22
title: Verify old Backlog data and upstream merge compatibility
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:17'
updated_date: '2026-10-08 16:30'
labels: []
dependencies:
  - FORK-4
  - FORK-5
  - FORK-6
  - FORK-8
  - FORK-9
  - FORK-10
  - FORK-11
  - FORK-12
  - FORK-16
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
  - backlog/docs/strategy/doc-3 - Upstream-integration-policy.md
type: chore
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Versioned test fixtures and a documented upstream-sync checklist verify old Markdown, defaults, IDs and new feature interactions.

## Contexte
The fork must stay useful on existing Backlog projects and remain mergeable with new upstream releases, without turning file format changes into silent migrations.

## Résultat attendu
Versioned test fixtures and a documented upstream-sync checklist verify old Markdown, defaults, IDs and new feature interactions.

## Périmètre
CLI smoke fixtures across task/draft/doc/decision/milestone, no-Git and Git behavior, no accidental default deletion, change/ADR migration and doc-3 sync evidence.

## Hors périmètre
Do not merge an upstream release or publish the package as part of this task.

## Vérification attendue
Run bun run test, bunx tsc --noEmit, bun run check . and a documented fixture round trip.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Old-format project fixtures still load and preserve existing archive/complete semantics after new features are introduced.
- [x] #2 Git and filesystem-only fixtures exercise explicit deletion, spec changes and ADR lookup without corrupting unrelated records.
- [x] #3 An upstream-sync checklist documents merge tests, incompatible migrations and human review before publication.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After the listed CLI/model dependencies, assemble versioned old-format fixtures for task, draft, document, decision, milestone, Git and filesystem-only projects without rewriting original fixture bytes unnecessarily.
2. Round-trip the fixtures through current CLI workflows: default archive/complete, explicit deletion and link resolution, ADR lookup/retirement and optional spec-change integration; assert stable IDs and unrelated content.
3. Document the doc-3 upstream-sync checklist with baseline and target revisions, semantic comparison, migrations/rollback examples, conflict evidence and human review gate; no upstream merge in this task.
4. Run bun run test, bunx tsc --noEmit, bun run check . and fixture smoke checks; investigate failures before treating compatibility as verified.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Assembled byte-identical upstream 1.53.0 fixtures (commit 69e7b153) under tests/fixtures/upstream-1.53.0/project covering task/draft/doc/decision/milestone in active, completed, and archive states. Added src/test/old-data-compatibility.test.ts (12 passing tests) round-tripping them through archive/complete, explicit deletion with link resolution, ADR supersede/archive with archived exact-ID lookup, and spec-change validate/preview/approve/apply; asserts byte-stability of unrelated records and that legacy decisions, old docs, and old IDs (back-*, doc-001) load without migration.

Created fork-planning doc doc-5 'Upstream sync checklist' via the doc CLI under backlog/docs/strategy: revisions (baseline 69e7b153/1.53.0 vs target), semantic comparison incl. re-running the old-data fixture suite, migration/rollback evidence, conflict evidence, and the human review gate. No upstream merge performed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Verified old Backlog data and upstream merge compatibility end to end. Fixtures: tests/fixtures/upstream-1.53.0/project is a byte-identical upstream Backlog.md 1.53.0 project (commit 69e7b153) with active/completed/archived tasks, draft, archived draft, legacy doc-001, legacy decision-1, milestone, archived milestone, and the upstream config.yml with its back task prefix; each byte was verified identical to the git baseline before commit. Tests: src/test/old-data-compatibility.test.ts (12 passing) copies that project into isolated Git and filesystem-only directories and round-trips it through current CLI workflows — task/draft/milestone archive and task complete (default semantics preserved, moved bytes unchanged), explicit task and document deletion with --unlink reference resolution (deleted files are not archived), ADR supersede/archive with archived exact-ID lookup, and spec-change validate/preview/approve/apply with the change archived under docs/changes/archive. Assertions prove no silent migration: legacy decisions stay free-form and are refused as ADRs, doc-001 keeps its zero-padded ID while new allocation continues at doc-2, back-* IDs continue at BACK-422, and unrelated records keep byte-identical content. Upstream-sync checklist: created fork-planning doc doc-5 (backlog/docs/strategy/doc-5 - Upstream-sync-checklist.md) via the doc CLI covering baseline/target revisions, semantic comparison, migration/rollback evidence, conflict evidence, and the human review gate. Verification: bun run test 3129 pass / 8 fail (7 exactly match the known pre-existing failure list; the 8th is a sibling of the documented flaky Core.moveTasksToStatus ordered-placement group and passes in isolation, 3/3 solo and 24/24 as a file), bunx tsc --noEmit clean, bunx biome check . clean (455 files). No upstream release was merged and nothing was published.
<!-- SECTION:FINAL_SUMMARY:END -->
