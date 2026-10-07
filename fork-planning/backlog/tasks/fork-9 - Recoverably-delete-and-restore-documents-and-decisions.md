---
id: FORK-9
title: Delete documents only on explicit request
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:03'
updated_date: '2026-10-07 12:29'
labels: []
dependencies:
  - FORK-7
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
A separate explicit CLI command removes a selected document file, including a specification or change document, without changing task archive or decision behavior.

## Contexte
Backlog documents can be created and edited but cannot be deleted through the CLI. Users need to remove unwanted documents when they explicitly ask for it.

## Résultat attendu
A separate explicit CLI command removes a selected document file, including a specification or change document, without changing task archive or decision behavior.

## Périmètre
Documents of all supported types, ID and structured reference checks via FORK-7, scriptable explicit request, non-Git warning, and failure diagnostics.

## Hors périmètre
Do not delete decisions/ADRs or milestones, or add a document trash/restore/purge workflow.

## Vérification attendue
In temporary projects, verify explicit deletion of ordinary/specification/change documents, refusal for ambiguous/linked documents without resolution, and no-Git behavior; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A direct CLI delete removes the requested document file without modifying unrelated documents or changing existing task archive behavior.
- [x] #2 Documents with active structured references require the explicit FORK-7 resolution, and unknown/ambiguous IDs fail safely.
- [x] #3 CLI help warns that uncommitted deleted files may not be recoverable; decision/ADR records remain outside this delete command.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Depend on FORK-7: inspect document ID/path resolution, doc types and structured inbound links, including specs and changes.
2. Add an explicit doc delete CLI operation using the shared preview and validated cancel/unlink/reassign choices; preserve doc update and task archive behavior, and never include decisions/ADRs or milestones.
3. Lock and prepare reference edits before removing the selected file; handle missing/ambiguous paths and write/unlink failure without silently corrupting linked documents. Explain no-Git and uncommitted-file recovery limits in help.
4. Test ordinary, specification and change documents with and without active links, invalid replacement IDs, repeat deletion and filesystem errors in temporary projects; run scoped Bun tests and static checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation: extended FORK-7's doc delete to perform real deletion. Core: new Core.deleteDocument(documentId, resolution, autoCommit) in src/core/backlog.ts resolves the target (unknown -> error, ambiguous -> AmbiguousIdError), scans active+completed+draft documentation references, locks every referencing task file via fs.withTaskLocks and every draft via withDraftLocks, re-scans inside the locks and widens/retries on change (same discipline as vacated-ID cleanup), re-validates the cancel/unlink/reassign resolution against the fresh preview under the locks, rewrites each referencing record's documentation field in place (other entries preserved), saves via saveTask/saveDraft with contentStore refresh, then unlinks the file last (ENOENT tolerated); single 'backlog: Delete document' commit when autoCommit is enabled. deletion-preview.ts: exported isDocumentIdReference, documentAbsolutePath, displayPath for reuse. CLI: doc delete gains --confirm (scriptable explicit request; refuses while active references remain; --unlink / --reassign-to doc-2 resolve them); --preview behavior unchanged; refusal without flags now names both --preview and --confirm; help schema updated (writes, warnings, --confirm example).

Verification (all run in this session): bun test --timeout=10000 src/test/cli-doc-delete.test.ts -> 21 pass / 0 fail (87 expect calls): ordinary + specification + changes/ subdirectory documents deleted with --confirm; linked document refuses plain --confirm keeping task + file untouched; --unlink preserves non-doc entries and clears active, completed, and draft referencers; --reassign-to repoints links; invalid (doc-99) and self reassignment rejected with 'Nothing has been deleted or modified.'; repeat deletion and unknown/ambiguous IDs fail safely with exit 1; decision-1 and m-1 IDs stay outside the command (not found, records intact); permission-failure tests (chmod-protected task file aborts before unlink; read-only docs dir keeps the file, 'Could not delete' error) run non-root; autoCommit=true produces a single 'backlog: Delete document doc-1' commit with clean git status; filesystem-only project deletes with the no-Git warning and still requires resolution for links. FORK-7 regression: bun test --timeout=10000 src/test/deletion-preview.test.ts src/test/cli-delete-preview.test.ts -> 32 pass / 0 fail. Adjacent smoke: cli-doc-decision-board.test.ts + cli-doc-search.test.ts -> 25 pass / 0 fail. bunx tsc --noEmit -> clean. bunx biome check --write on the four changed files -> clean. Full bun run test suite intentionally not run here (orchestrator runs it after merge). Deviations from plan: (1) 'change' documents: the change TYPE is FORK-14 scope and does not exist yet, so the change-layout case is covered by a document under docs/changes/ plus ordinary/specification types; deletion is type-independent by construction. (2) Help carries the static uncommitted-recovery warning (project-independent text); the project-specific no-Git warning is emitted at runtime in --confirm output and previews for no-Git projects.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
doc delete now performs real deletion on explicit request. --confirm deletes the document file (any type, including specifications and documents under subdirectories) when it has no active structured references; when references exist, --confirm refuses and requires the FORK-7 resolutions --unlink or --reassign-to doc-N, which rewrite every active, completed, or draft referencer under its file lock (re-scanned and re-validated inside the locks) before the file is removed. Reference edits precede the unlink, write failures abort before deletion, unlink failures keep the file, and unknown/ambiguous/repeat IDs fail closed with exit 1. Deletion is a real removal with no trash or restore step; when autoCommit is enabled it lands as one 'backlog: Delete document <id>' commit, and help plus command output warn that uncommitted deleted files may not be recoverable. Decisions/ADRs and milestones are structurally outside the doc-ID namespace and stay untouched. Verified with 21 new CLI tests, FORK-7's 32 preview tests, 25 adjacent doc tests, tsc, and Biome; full suite left for post-merge run.
<!-- SECTION:FINAL_SUMMARY:END -->
