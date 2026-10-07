---
id: doc-2
title: Edit and delete capability audit
type: guide
created_date: '2026-10-06 20:21'
updated_date: '2026-10-07 08:05'
---
Status: **Observed baseline, not a feature specification.** Audited 2026-10-06 against the cloned Backlog.md 1.53.0 at 69e7b153. Recheck after every upstream sync. CLI means the documented public CLI, not an internal TypeScript method.

## Capability matrix
| Entity | CLI edit today | CLI removal today | Gap or qualification |
| --- | --- | --- | --- |
| Task | task edit changes title, description, status, assignees, labels, dates, criteria, plan, notes, summary, dependencies, references, documentation and more | task archive and task complete move records; task demote moves to drafts | No CLI delete, restore, or purge. task edit appends comments but exposes no individual comment edit/remove. Check whether empty-value flags clear every other field before promising new flags. |
| Draft | draft edit supports many task fields; draft promote moves to tasks | draft archive moves record | No CLI delete/restore/purge; same comment correction question as tasks. |
| Document | doc update changes title, content, path, type, tags | none in doc help | No CLI remove, restore, or purge. Specification is already an available document type, not an OpenSpec-style delta lifecycle. |
| Decision | decision create sets title and status; decision list lists IDs, titles, statuses | none in decision help | No CLI view, update, delete, restore, or purge. Browser API does expose GET and PUT with raw content; avoid claiming decisions cannot be edited anywhere. |
| Milestone | milestone rename changes name and optional due date; milestone add sets description | milestone remove and milestone archive move to archive | No CLI description edit or permanent delete/restore. milestone remove handles linked task values via clear/keep/reassign; preserve that protection. |
| Configuration | config get/set/list for supported keys | not applicable | Not a deletion target; do not promise arbitrary config mutations beyond validated keys. |

## Surface evidence
- Public CLI: backlog task edit --help, backlog draft edit --help, backlog doc --help, backlog doc update --help, backlog decision --help, backlog milestone --help, backlog milestone remove --help; all run from the fork at 1.53.0.
- CLI registration: src/cli.ts around task/draft commands, milestone commands near 4284, document commands near 4678-4897, decision commands near 4899-4970.
- Browser route registration: src/server/index.ts around 427-490. DELETE /api/tasks/:id calls core.archiveTask, not a purge (near 1217-1224). PUT /api/decisions/:id updates decision content (near 1477-1483). DELETE /api/milestones/:id invokes the milestone removal handler; the CLI documents removal as archival.
- CLI is the canonical contract according to MANIFESTO.md and AGENTS.md. A browser-only edit is a parity gap, not a request to remove browser behavior.

## Candidate changes, not tasks
1. Complete missing CLI decision and milestone edit paths before exposing new deletion operations.
2. Define individual comment correction and removal without silently rewriting prior discussion. Do not extend this to arbitrary text replacement by index without a stable identity rule.
3. Add explicit physical deletion for tasks, drafts and documents only; leave existing task/draft archival and milestone/decision behavior unchanged. Account for active structured references and protect ADRs (decisions). Do not add trash/restore/purge.
4. Offer a clear preview for an explicit delete request; warn that uncommitted deleted files may not be recoverable. Keep IDs unambiguous after deletion. Flag non-structured references in prose as not automatically enumerable.
5. Improve browser/TUI parity after canonical CLI behavior is specified. Investigate existing MCP capabilities before changing the optional adapter.
6. Reuse specification-type documents when evaluating an optional change/delta workflow; no evidence yet supports importing the whole OpenSpec artifact set.

## Unknowns to verify before implementation
- The exact semantics of empty-string flags for plan, notes, description, documentation, and milestone values.
- Whether an archived entity can already be restored through any shipped public surface. No corresponding CLI restore command appeared in the inspected help.
- How references to documents and decisions are stored outside structured fields, and whether any aliases or links point to old paths after a move.
- The current browser/TUI edit affordances beyond the server routes cited above. Do not infer UI availability from API routes alone.
- What upstream has changed since commit 69e7b153; source findings are time-bound.
