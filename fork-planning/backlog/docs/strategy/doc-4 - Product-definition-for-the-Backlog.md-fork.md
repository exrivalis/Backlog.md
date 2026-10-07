---
id: doc-4
title: Product definition for the Backlog.md fork
type: guide
created_date: '2026-10-06 20:44'
updated_date: '2026-10-07 08:05'
---
# Product definition: a single Backlog.md workflow

Status: **Agreed product definition** (2026-10-06; explicit deletion scope confirmed 2026-10-07). This is a product contract for the reusable fork, not a convention copied from any consuming project. Implementation designs still require review before execution. Baseline audit: doc-2; roadmap: doc-1; upstream integration: doc-3.

## Purpose and boundaries
The fork provides one local-first, Markdown-native workflow for humans and agents. Backlog.md's canonical CLI and shared model own all semantic mutations. Browser and terminal user interface (TUI) follow that model. Model Context Protocol (MCP) remains an optional adapter. Git and an agent are optional for the core workflow. The fork must continue to accept future upstream changes without a parallel task framework.

A task describes delivery. A specification describes current required behavior. A change describes a proposed behavior delta. An architecture decision record (ADR) records a durable architecture choice. A change may link to tasks, specifications, and ADRs; no record duplicates the task checklist or the ADR rationale. Most routine tasks need neither a change nor a specification. Do not import OpenSpec's entire directory tree, mandatory artifact chain, workflow engine, or second status system.

## Proposed layout in a project using the fork
The layout below describes the target product, not commands available in Backlog.md 1.53.0. Existing project layouts must be evaluated for compatibility rather than used to decide the product's default.

```text
backlog/
├── tasks/                              # Existing task identity, status, plan and verification
├── docs/
│   ├── specifications/
│   │   └── doc-12 - Session-behavior.md # Current required behavior
│   └── changes/
│       ├── doc-18 - Warn-before-expiry.md # Proposed change and spec delta
│       └── archive/
│           └── doc-9 - Earlier-change.md  # Integrated proposal, historical evidence
├── decisions/
│   └── decision-2 - Storage-choice.md  # Current accepted ADR
└── archive/
    └── decisions/
        └── decision-1 - Earlier-storage-choice.md # Retired ADR; same stable ID
```

The existing document ID namespace covers specifications and change records. ADRs use the existing decision ID namespace, with a discriminant such as kind: architecture; a second adr- ID allocator is not required. Paths are illustrative and must not override stable ID lookup. Historical links resolve after an archive or move. New entity types or configurable directory trees require evidence that existing documents and decisions cannot express the required lifecycle safely.

## OpenSpec capabilities to adapt
| OpenSpec concept | Target Backlog.md behavior | Avoid |
| --- | --- | --- |
| Current specs | Existing documents of type specification state current, testable behavior; requirements have stable identity where deltas need precise targets. | A competing openspec/specs tree. |
| Proposal | An optional single change document contains why, scope, affected spec IDs, and links to work. | Copying a task's plan, status, and checklist. |
| Delta specs | A change records added, modified, and removed requirements with scenarios; each modification/removal names an unambiguous existing requirement. | Editing canonical specs before review or duplicating whole specs in every change. |
| Design choices | Refer to an accepted ADR for durable cross-change choices; document a small local trade-off inside the change only when it is specific to that change. | Mandatory design.md for routine work and two authoritative copies of a decision. |
| Validate/preview | Check IDs, requirement targets, scenarios, references, and conflicts. Preview the resulting current specs before incorporation. | Silent overwrite or applying a delta against an unknown baseline. |
| Apply/archive | Following verification and human review, integrate the approved delta into current specs and retain the change as history. | Treating Done as automatic approval of a spec change or losing the delta. |

A change may affect several specs and link to several tasks. Its own lifecycle is about proposal/review/integration, not execution progress. A task stays the source of truth for implementation work. No new status system is required to make routine tasks work.

## ADRs, supersession and agents
- ADRs are first-class decisions in backlog/decisions, not a second spec or a mandatory design file. One ADR records one architecture decision, context, alternatives, rationale, consequences, and a lifecycle state.
- Accepting an ADR establishes guidance for the scope stated in that ADR. A newer ADR may fully supersede an older one only if it resolves the whole earlier decision. If the change is partial, explicitly resolve the remaining scope before marking the old ADR superseded.
- A full supersession makes the new ADR the only authoritative guidance for current work. Retain the old ADR and a historical supersession link in both directions. Historical records may still point to the old ADR as evidence; current tasks, changes, and specs must not use it as governing guidance.
- Archiving is orthogonal to status. An applicable accepted ADR remains active. A rejected, deprecated, or superseded ADR may move to backlog/archive/decisions after review. Archiving preserves identity, contents, history, and historical links; restore is possible. It must never imply purge.
- Default CLI/agent decision discovery returns applicable accepted ADRs. Fetching an archived or superseded ADR must identify its status and replacement, not present it as current guidance. Validation blocks or flags new/current governing references to a retired ADR and detects unknown replacements or supersession cycles. Active structured references are reviewed and corrected as part of supersession; immutable historical citations are not rewritten.
- No local tool can control arbitrary raw filesystem reads by every agent. Shipped instructions, default retrieval, resolver warnings, and reference validation together define the supported safety boundary.

## Semantic editing and safe removal
- Supported managed entities include tasks, drafts, documents, decisions/ADRs, and milestones. Every user-visible mutable field should have a discoverable, validated correction path through the CLI. Existing paths must be audited before adding new ones; for example, browser decision edits exist but CLI decision edits do not in 1.53.0.
- Preserve existing task/draft archive and task complete as the default behavior. Add a separate opt-in delete command for tasks, drafts, and documents (including specifications and changes) only. When explicitly requested, delete removes the file from the filesystem; it is not a move to trash and has no Backlog restore/purge step. Do not add delete for milestones or decisions/ADRs. Deleted IDs must not silently reidentify a different active record.
- An explicit human request to an agent to delete an eligible record is sufficient authorization to use the opt-in CLI command; the agent must not refuse merely because archive is the default. Preview resolvable inbound structured references. If active references exist, cancel unless the user explicitly chooses unlink or reassignment. Reject ambiguous identity or invalid choices without deleting. State that free-text mentions cannot be guaranteed discoverable. Warn that a deleted uncommitted file may not be recoverable without a backup; Git recovery applies only to committed files.
- Do not introduce trash, restore, purge, or automatic deletion. A task or draft comment may be edited or removed only with a visible correction/redaction record retained. Preserve evidence proportional to risk without inventing a universal audit database.

## Upstream and release boundary
Keep fork-only plans and tasks under fork-planning/backlog rather than adding them to upstream's backlog. Maintain separate origin/upstream remotes. Prefer small shared-model and canonical-CLI changes. At every upstream release, compare shipped semantics before adding or retaining duplicates; integrate on a reviewed branch, run relevant tests, and record conflicts and migrations. See doc-3. Distribute the fork as a distinctly named scoped npm package with a distinct CLI name; upstream Backlog.md must remain installable alongside it. Set the exact scope and CLI spelling as release configuration, without changing this product rule.

## Confirmed decisions and implementation design gates
- The product choices above were confirmed before implementation task creation: no decision spikes are needed. Scope explicit deletion to tasks, drafts and documents. See the roadmap doc-1 and tasks in this isolated Backlog workspace.
- Implementation planning must still settle technical details such as CLI option spelling, rollback mechanics for multi-file updates, exact document metadata, and package naming inside the selected scoped distribution model. These are bounded design details, not new product workflows.
- If a new product, architecture, or workflow choice appears during implementation, pause and ask for explicit human review. The product definition does not authorize a commit or push.
