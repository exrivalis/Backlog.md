---
id: FORK-6
title: Correct task and draft comments with visible history
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:03'
updated_date: '2026-10-07 11:20'
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
- [x] #1 One selected task or draft comment can be corrected or redacted without changing other comments.
- [x] #2 A later reader sees that the comment changed and can inspect the retained correction record.
- [x] #3 Invalid or ambiguous comment targets fail without altering existing comments.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inspect comment parsing, indexing and task/draft serialization, including duplicate-looking comments and the existing append-only CLI path; define a stable target that survives unrelated edits.
2. Add a shared task/draft comment correction operation that selects exactly one comment and retains its original author/time plus visible edit or redaction evidence, without a generic audit database.
3. Expose an explicit CLI edit/redact/read-history path; reject stale, missing or ambiguous targets before writing, and never erase the correction record when redacting.
4. Cover multiple comments, index shifts, malformed targets, history round trips and unchanged neighbors in Bun CLI/parser tests; type-check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design settled. Targeting: each comment carries a content fingerprint (8 hex chars, sha256 over author/created/body/history). Target token is '#<index>@<fingerprint>' or a bare fingerprint; '#<index>' alone is read-only. Writes require the fingerprint so a stale target (comment changed since it was read) fails closed; a bare fingerprint matching several duplicate-looking comments fails as ambiguous. History: TaskComment.history entries {action edited|redacted, date, editor, body?}; edited entries retain the replaced original body, redacted entries retain no body. Serialization extends the compact comment block with 'edited: <date> by <editor>' / 'redacted: <date> by <editor>' groups after the body delimiter. Redacted comments get a visible '[Redacted by ... on ...]' body, cannot be edited or re-redacted, and the record is never erased. Shared op lives in CommentsManager (fingerprint + resolveTargetedComment) plus applyTaskUpdateInput (already shared by tasks and drafts). CLI: task/draft edit --edit-comment/--redact-comment with --comment-text/--comment-editor; task view / draft view --comment-history; plain view shows the target handle per comment and inline history; --json exposes fingerprint + history.

Implemented. Shared model: TaskComment.history (action edited|redacted, date, editor, body only for edits) in src/types/index.ts; fingerprint (8-char sha256 over author/created/body/history) and resolveTargetedComment (missing/stale/ambiguous/malformed all fail closed, writes require the fingerprint) in CommentsManager; history parse/serialize inside the compact comment block via 'edited:'/'redacted:' metadata groups; applyTaskUpdateInput (shared by tasks and drafts) applies --edit-comment/--redact-comment and never touches other comments. CLI: task edit / draft edit gained --edit-comment, --redact-comment, --comment-text, --comment-editor (builder rejects bad flag combos; per-task-only batch flags); task view and draft view gained --comment-history; plain view renders the '#<index>@<fingerprint>' target handle and inline history; --json exposes fingerprint and history per comment. Verification: bun test --timeout=10000 over comment-correction (10), comments, cli-json-output, cli-guidance, utc-date-display, mcp-tasks, cli-draft-edit, markdown, structured-sections-code-fences, filesystem-task-cache = 203 pass / 0 fail / 1 pre-existing skip; bunx tsc --noEmit clean; bunx biome check clean on all 14 changed files. Manual smoke in a temp repo confirmed the plain view handle, edit, history read, redact notice, raw file record, stale/missing-fingerprint errors and help copy. Note: pre-existing unrelated failure 'Config commands > reads the config key at column 0' fails identically with the changes stashed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Task and draft comments can now be corrected and redacted with a retained, visible correction record. Shared model: each comment carries a content fingerprint (8-char sha256 over author/time/body/history) shown by the view output as the target handle '#<index>@<fingerprint>'; CommentsManager.resolveTargetedComment selects exactly one comment and fails closed on missing, stale (fingerprint mismatch), ambiguous (a bare fingerprint matching several duplicate-looking comments), or malformed targets before any write. applyTaskUpdateInput (shared by tasks and drafts) applies editComment/redactComment: edits replace the body while keeping the original author and time and recording an 'edited' history entry that retains the replaced text; redaction replaces the body with a visible '[Redacted by ... on ...]' notice, retains no content, is terminal (no edit or re-redact), and never erases the record. History serializes inside the compact comment block as 'edited:'/'redacted:' groups, parses back losslessly, and is exposed through plain view (inline History section), '--comment-history' on task/draft view, and '--json' (fingerprint + history). Verification: targeted Bun tests over 10 files (new comment-correction suite plus comments, cli-json-output, cli-guidance, utc-date-display, mcp-tasks, cli-draft-edit, markdown, structured-sections-code-fences, filesystem-task-cache) = 203 pass / 0 fail / 1 pre-existing skip; bunx tsc --noEmit clean; bunx biome check clean on all changed files; manual smoke in a temp repository confirmed the view handle, edit, history read, redact notice, raw-file record, and stale-target errors. Risks/follow-ups: TUI and browser surfaces do not yet render history (CLI/JSON are the contract surfaces per roadmap); the pre-existing config-YAML test failure is unrelated and reproduces without these changes.
<!-- SECTION:FINAL_SUMMARY:END -->
