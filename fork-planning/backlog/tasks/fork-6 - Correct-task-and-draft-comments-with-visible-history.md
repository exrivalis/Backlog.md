---
id: FORK-6
title: Correct task and draft comments with visible history
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
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
A CLI user can target one unambiguous comment, edit or redact it, and inspect its retained correction history.

## Contexte
Task and draft comments can be appended but cannot be corrected semantically. The agreed product rule permits editing or removal only when a visible correction/redaction record remains.

## Résultat attendu
A CLI user can target one unambiguous comment, edit or redact it, and inspect its retained correction history.

## Périmètre
Stable comment targeting, author/time preservation, edit and redact behavior, ambiguous or missing comment errors, agent-readable audit evidence.

## Hors périmètre
Do not create a generic event database or change normal task status and plan fields.

## Vérification attendue
Exercise correction, redaction, multiple comments and invalid targets in a temporary repository; run relevant Bun tests and bunx tsc --noEmit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One selected task or draft comment can be corrected or redacted without changing other comments.
- [ ] #2 A later reader sees that the comment changed and can inspect the retained correction record.
- [ ] #3 Invalid or ambiguous comment targets fail without altering existing comments.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inspect comment parsing, indexing and task/draft serialization, including duplicate-looking comments and the existing append-only CLI path; define a stable target that survives unrelated edits.
2. Add a shared task/draft comment correction operation that selects exactly one comment and retains its original author/time plus visible edit or redaction evidence, without a generic audit database.
3. Expose an explicit CLI edit/redact/read-history path; reject stale, missing or ambiguous targets before writing, and never erase the correction record when redacting.
4. Cover multiple comments, index shifts, malformed targets, history round trips and unchanged neighbors in Bun CLI/parser tests; type-check.
<!-- SECTION:PLAN:END -->
