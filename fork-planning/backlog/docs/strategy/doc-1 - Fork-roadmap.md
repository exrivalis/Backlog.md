---
id: doc-1
title: Fork roadmap
type: guide
created_date: '2026-10-06 20:21'
updated_date: '2026-10-07 08:19'
---
Status: **Agreed product direction; phased delivery is proposed.** Canonical definition: doc-4. Implementation work and open choices still require review.
Baseline: Backlog.md 1.53.0, upstream commit 69e7b153, audited 2026-10-06. Fork: exrivalis/Backlog.md. Scope: the reusable fork only; no consuming project defines the product model.

## Outcome
One Markdown-native tool supports task delivery and, when behavior changes, a small specification-change loop. A human and an agent can safely edit or remove supported entities through the canonical CLI. The fork remains able to receive upstream Backlog.md improvements.

## Product rules
- Preserve the upstream manifesto: local files, human review before consequences, stable IDs, shared semantics, CLI first, and optional Git. Do not edit the manifesto without an explicit product decision.
- Treat the CLI as canonical. Browser, TUI, and optional MCP follow the same shared mutation semantics; do not create an agent-only workflow.
- A task tracks work. A specification describes current behavior. An optional change describes a proposed behavioral delta. Do not copy a second task checklist into each change.
- Ordinary tasks need no change or spec. Preserve upstream Markdown compatibility where practical. Avoid a generic workflow engine and arbitrary schema editor.
- The fork planning project lives in fork-planning/backlog, apart from the upstream backlog/ data. Fork-only tasks and product documents live there. Keep local auto-commit disabled.

## Roadmap: proposed sequence and gates
### 0. Baseline and contract (P0)
- Confirm the capability audit (doc-2) against current public CLI help and browser routes. Record what exists versus what is absent; do not describe archive as permanent deletion.
- Apply the agreed contract in doc-4: existing archive/complete stays the default, while explicit delete removes only tasks, drafts and documents. ADRs and milestones have no new delete command. Define CLI spelling, reference handling and failure diagnostics before coding.
- Define cross-entity mutation guarantees: unambiguous ID lookup; preview affected files and references; confirmation proportional to risk; no partial writes; useful recovery evidence; deterministic Markdown; no silent change to unrelated fields.
**Exit:** human approves a written contract and a small end-to-end example for each destructive operation.

### 1. Fill semantic edit gaps (P0)
- Add CLI decision view and semantic edit (title, status, body) on top of the existing browser update capability. Avoid accepting unvalidated raw front matter as a new public contract.
- Add CLI milestone description edit while retaining existing rename, due-date, and task-reference handling.
- Make task and draft corrections possible for remaining structured content, especially individual comments (edit/remove with history or explicit evidence). Verify what already works through empty-value replacements before adding clear flags.
- For each edit, expose affected fields, validation, and safe error handling through shared model operations; provide CLI tests and explain any deliberate browser/TUI lag.
**Exit:** every supported field has an explicit, tested correction path; a CLI user does not need to edit managed Markdown manually.

### 2. Explicit deletion, without changing archive defaults (P0)
- Add opt-in CLI delete for tasks, drafts and documents only. Delete removes the file; there is no new trash, restore or purge workflow. Preserve the existing archive/complete behavior and do not silently alter browser task DELETE or milestone remove.
- Preview inbound structured links and child/dependency relationships. Cancel by default when links exist; explicitly chosen unlink/reassign is required. Explain free-text limits and lack of recovery for uncommitted files without backups.
- Fail safely on unknown or ambiguous IDs, invalid reference choices, or incomplete writes. Verify that normal archive remains available and unchanged.
**Exit:** an explicit delete request succeeds safely for eligible files; ordinary use still archives rather than deleting.

### 3. Durable architecture decisions (P1)
- Treat an architecture decision record (ADR) as a kind of existing Backlog decision. Add a human-readable CLI path to view/edit one decision and review its status.
- Permit full supersession only when the replacement covers the previous choice's entire scope. Archive only retired decisions after review; keep old IDs and historical supersession links resolvable.
- By default, agents discover only applicable accepted ADRs. Current tasks, specs, and changes must not cite superseded/archived decisions as authoritative. Resolve an old ID with a warning and a replacement pointer; keep historical citations for traceability.
**Exit:** a new ADR can supersede, archive, and replace guidance for active work without erasing the old decision or misleading an agent.

### 4. Optional OpenSpec-inspired behavior-change loop (P1, after edit/delete is stable)
- Reuse documents of type specification as the canonical description of current behavior. Give requirements stable identity when a delta needs a precise target.
- Add one optional change document with rationale, scope, affected specification IDs, task links, and added/modified/removed requirements with scenarios. Do not add an OpenSpec tasks.md or copy task statuses.
- Add validate, preview, review, apply, and archive semantics: reject ambiguous targets or stale baselines; show the resulting spec; incorporate approved deltas after verification; retain integrated changes as history.
- Keep local design notes optional. Use a linked ADR for durable cross-change architecture, not a duplicate design.md. Ordinary tasks require no change artifact.
**Exit:** one change can be proposed, reviewed, delivered, and reflected in current specs while linked tasks and ADRs remain the single sources of truth.

### 5. Human and agent parity (P1)
- Mirror approved edit/delete operations in browser/TUI when useful. Show the consequences of explicit file removal clearly. MCP is an adapter, not the owner of semantics.
- Update shipped CLI instructions so an agent can discover and use the same safe operations that a person can use. Test interactive and non-interactive paths and project-without-Git behavior.
**Exit:** CLI behavior is coherent across exposed surfaces, with documented coverage or deliberate exclusions.

### Continuous. Upstream maintenance
- Follow doc-3 for release monitoring, upstream sync, conflict triage, test verification, provenance, and separation of fork-only work from upstream data.
- Prefer narrow additive patches and upstreamable fixes over parallel frameworks. Review upstream changes before adding a feature that may already have landed.
**Exit per sync:** upstream revision recorded, differences reviewed, migration impact assessed, tests run, human reviews the merge before publication.

## Tracked implementation tasks
All items below are in this workspace's active Backlog. Each task has acceptance criteria and its own dependency metadata; this list is a navigation aid, not a second task system. No task has been started or assigned.

- Semantic editing: FORK-4 (decision CLI), FORK-5 (milestone description), FORK-6 (comment correction with visible history).
- Explicit deletion: FORK-7 (reference preview), FORK-8 (tasks and drafts), FORK-9 (documents). Archive remains the default; no trash, purge, or extra entity deletion is planned.
- Architecture decision records (ADRs): FORK-10 (full supersession), FORK-11 (archive/restore retired ADRs), FORK-12 (retired ADR guidance and active-reference safety).
- OpenSpec adaptations: FORK-13 (current spec requirements), FORK-14 (single optional change document), FORK-15 (delta validation/preview), FORK-16 (approved integration and history).
- Human interfaces: FORK-17 and FORK-19 (explicit deletion in browser and terminal user interface), FORK-18 and FORK-20 (ADR/spec-change views).
- Agent and maintenance: FORK-21 (agent instructions), FORK-22 (existing-data/upstream compatibility), FORK-23 (distinct scoped package and coexistence). See doc-3 for the recurring upstream-sync procedure.

## Not in scope
A hosted backend, AI-only automation, configurable workflow engines, a wholesale OpenSpec port, mandatory spec changes for routine tasks, broad refactors of upstream internals, or publication under the upstream package name.

## Task readiness
Product choices are recorded in doc-4, including opt-in deletion scope, explicit reference resolution, comment history, and distinct scoped distribution. The task list consists of implementation work only; no decision spikes are required. Research implementation details when a task starts, record the plan then, and request review for any new product or architecture decision. Do not commit or push without explicit instruction. Recheck upstream releases before execution.
