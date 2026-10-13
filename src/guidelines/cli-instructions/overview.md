## Backlog.md Overview (CLI)

Backlog.md tracks committed work: what will be built, fixed, or changed.

### When to Use Backlog

Create a task when work requires planning, decisions, or handoff notes. Search for an existing task first. Skip task creation for questions, exploration, and obvious mechanical edits.

### Find and Read Work

- `backlog search "query" --plain`
- `backlog task list --status "<todo status>" --plain`
- `backlog task list --status "<active status>" --plain`
- `backlog task list --search "login" --labels frontend,bug --limit 20 --plain`
- `backlog task view {{TASK_ID:123}} --plain`

For long lists, use `--max-count` and `--skip`, follow the printed `Next` command, or use `--count` for the total; command help covers the details.

For scripts, `task list`, `task view`, `task <id>`, and `search` accept versioned `--json` output instead of `--plain`. `task list --json --watch` emits complete replacement responses; read successive JSON values, not individual lines. Filters and local scope are unchanged; intermediate edits may be coalesced. Restart for a fresh snapshot.

### Required Guides

Read the matching guide before taking these actions; this overview does not replace it:

- `backlog instructions task-creation` — before creating or splitting tasks
- `backlog instructions task-execution` — before planning, changing status or assignee, adding notes, or implementing
- `backlog instructions task-finalization` — before checking acceptance criteria, writing final summaries, or marking work finished

Use `backlog <command> --help` before unfamiliar operations. Help describes fields, output, and examples.

### Task Lifecycle

Mark finished work Done (or the configured final status). During periodic cleanup, use Complete (`backlog task complete {{TASK_ID:123}}`) to move it off the board while preserving its record and dependency links.

Use Archive (`backlog task archive {{TASK_ID:123}}`) for canceled, duplicate, or invalid work. Archiving removes incoming dependencies and task references.

Archive and Complete are the defaults. Delete a task, draft, or document only when the user explicitly asks for deletion — a direct request authorizes the noninteractive `--confirm` run of `backlog task delete {{TASK_ID:1}}`, `backlog draft delete DRAFT-1`, or `backlog doc delete doc-1`. Never refuse a requested deletion because archive is the default, and never delete when the user asked to archive.

Run the matching `delete` with `--preview` first. Deletion stops while active structured references remain unless the user chose `--unlink` to remove them or `--reassign-to <id>` to point them at another record. Deletion removes the file permanently: free-text mentions are not listed, and a deleted uncommitted file may not be recoverable — Git restores only committed files.

Use the CLI for Backlog changes. Never edit task, draft, document, decision, or milestone markdown files directly; commands preserve metadata, relationships, and history.

### Decisions and ADRs

`backlog decision list` and `backlog search` return applicable guidance only: accepted ADRs and ordinary decisions. Rejected, deprecated, superseded, and archived ADRs are history — never cite them as current guidance for new work.

For an old ID, run `backlog decision view <decision-id> --plain`. A retired ADR identifies its retired state and the accepted ADR that now governs its scope. `backlog decision list --all` shows every record, including archived ones.

### Specifications and Changes

Specifications and changes are optional; most tasks need neither. A specification (document type `specification`) states current required behavior; a change (document type `change`) is only a proposed delta until applied. `backlog doc validate <change-id>` and `backlog doc preview <change-id>` check a change without writing; `backlog doc approve <change-id>` records explicit human review; `backlog doc apply <change-id>` integrates the approved delta into the current specs and archives the change as history. Never treat a task's status as approval.
