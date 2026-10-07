---
id: FORK-7
title: Preview explicit deletion and resolve inbound references
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:03'
updated_date: '2026-10-07 11:15'
labels: []
dependencies: []
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
A CLI preview for explicit deletion lists affected active structured references and requires a cancel, unlink or reassign choice where needed.

## Contexte
The default archive path must remain unchanged. When deletion is requested explicitly, tasks, drafts or documents may have active structured links that must not be broken silently.

## Résultat attendu
A CLI preview for explicit deletion lists affected active structured references and requires a cancel, unlink or reassign choice where needed.

## Périmètre
Tasks, drafts and documents only; detect task relationships and other resolvable structured links, reject ambiguous IDs and invalid reassignment, disclose untracked free-text mentions.

## Hors périmètre
No milestone or decision deletion, no recoverable trash/restore/purge, no automatic archive-to-delete conversion.

## Vérification attendue
Exercise linked and unlinked tasks/drafts/documents, invalid references, ambiguous IDs and no-Git behavior in temporary projects; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A delete request previews resolvable active inbound references; with links present, deletion cancels unless unlink/reassign is explicitly selected.
- [x] #2 Invalid replacement IDs or ambiguous targets do not change linked records or remove the target.
- [x] #3 CLI help describes free-text limitations and explains that uncommitted deleted files may not be recoverable.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Recheck task/draft/document identity resolvers and structured references (parent, dependencies, documentation, linked spec/change/ADR IDs); enumerate only resolvable active inbound links and affected files.
2. Build one shared non-mutating deletion preview for eligible entity IDs; report link locations, invalid/ambiguous identities, unresolved links and the limitation on free-text mentions.
3. Define explicit cancel/unlink/reassign input; validate replacement type and identity, self/cycle cases and the complete reference-update set before any deletion. Keep archive and complete separate.
4. Expose CLI preview/help with a no-Git/uncommitted-file warning. Test linked/unlinked and invalid cases for each entity in Git and filesystem-only fixtures; do not delete files in this task. Review the destructive-operation contract with Alex before implementing consumers.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Core preview module + CLI preview commands implemented (task/draft/doc delete --preview with cancel/unlink/reassign validation); writing tests.

Shared non-mutating preview shipped in src/core/deletion-preview.ts: resolves task/draft/document identity (invalid, not-found and ambiguous all fail closed), enumerates resolvable inbound structured references (parent, dependencies, references, documentation doc-ID links) with backlog-relative file locations, and reports the target record's own unresolved links (missing/ambiguous/invalid). validates cancel/unlink/reassign via validateDeletionResolution: replacement must resolve to exactly one record (task corpus incl. drafts for dependencies; working-copy task for parents; document for documentation links), rejects self-reassign, self-dependency, dependency cycles (reuses buildDependencyGraph + findCycleThroughRoot), parent cycles, reference namespace mismatches, and returns the complete reference-update set or no updates at all. CLI: backlog task/draft/doc delete <id> --preview with --unlink / --reassign-to; help carries the free-text and uncommitted-recovery warnings; output picks the Git or no-Git recovery warning via git.isRepository().

Deviations recorded: (1) The plan's 'linked spec/change/ADR ids' are covered as documentation doc-ID links today; the current model has no structured task->decision link field and decisions are not deletable, so ADR inbound links do not exist yet for the preview to enumerate (FORK-12/FORK-14 introduce them). (2) The preview is exposed on task/draft/doc delete with a required --preview flag; the bare command refuses with exit 1 and deletes nothing until FORK-8/FORK-9 add the destructive path to these same commands. Verification: bun test --timeout=10000 src/test/deletion-preview.test.ts src/test/cli-delete-preview.test.ts -> 32 pass / 0 fail (Git and filesystem-only fixtures); bunx tsc --noEmit clean; bunx biome check clean on all changed files. No file deletion implemented.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
FORK-7 delivers the non-mutating deletion preview for explicit task/draft/document deletion. One shared module, src/core/deletion-preview.ts, resolves the target identity (invalid/ambiguous/not-found fail closed), lists resolvable active inbound structured references with file locations (parent, dependency, reference, and documentation doc-ID links across active, draft and completed corpora), reports the target's own unresolved links, and validates cancel/unlink/reassign choices into a complete reference-update set: replacement identity and type checks, self/cycle rejections, no partial update sets, nothing written. CLI: backlog task delete, draft delete and doc delete take --preview plus optional --unlink/--reassign-to; without --preview they refuse and delete nothing. Help and output disclose that free-text mentions cannot be guaranteed discoverable and that Git recovery applies only to committed files (or that the project has no Git at all). Verified with 32 passing scoped Bun tests across Git and filesystem-only fixtures, tsc --noEmit, and Biome. Deletion itself and reference rewriting stay out of scope for FORK-8/FORK-9, which reuse this preview under their own locks.
<!-- SECTION:FINAL_SUMMARY:END -->
