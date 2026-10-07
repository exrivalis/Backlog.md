---
id: FORK-7
title: Preview explicit deletion and resolve inbound references
status: To Do
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:03'
updated_date: '2026-10-07 08:42'
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
- [ ] #1 A delete request previews resolvable active inbound references; with links present, deletion cancels unless unlink/reassign is explicitly selected.
- [ ] #2 Invalid replacement IDs or ambiguous targets do not change linked records or remove the target.
- [ ] #3 CLI help describes free-text limitations and explains that uncommitted deleted files may not be recoverable.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Recheck task/draft/document identity resolvers and structured references (parent, dependencies, documentation, linked spec/change/ADR IDs); enumerate only resolvable active inbound links and affected files.
2. Build one shared non-mutating deletion preview for eligible entity IDs; report link locations, invalid/ambiguous identities, unresolved links and the limitation on free-text mentions.
3. Define explicit cancel/unlink/reassign input; validate replacement type and identity, self/cycle cases and the complete reference-update set before any deletion. Keep archive and complete separate.
4. Expose CLI preview/help with a no-Git/uncommitted-file warning. Test linked/unlinked and invalid cases for each entity in Git and filesystem-only fixtures; do not delete files in this task. Review the destructive-operation contract with Alex before implementing consumers.
<!-- SECTION:PLAN:END -->
