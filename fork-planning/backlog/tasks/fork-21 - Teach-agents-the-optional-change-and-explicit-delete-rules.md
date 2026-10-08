---
id: FORK-21
title: Teach agents the optional change and explicit delete rules
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:17'
updated_date: '2026-10-08 16:13'
labels: []
dependencies:
  - FORK-8
  - FORK-9
  - FORK-12
  - FORK-16
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Shipped CLI instructions explain default archive, authorized explicit deletion, linked-reference handling, optional specs/changes and retired-ADR filtering.

## Contexte
Agents currently refuse explicitly requested deletion because archive is the documented operation. They may also cite historical ADRs as current guidance unless instructions and retrieval agree.

## Résultat attendu
Shipped CLI instructions explain default archive, authorized explicit deletion, linked-reference handling, optional specs/changes and retired-ADR filtering.

## Périmètre
Instructions surfaced by backlog instructions, public CLI help examples, human/agent parity and safe noninteractive invocation with direct user authorization.

## Hors périmètre
Do not add an agent-only mutation path or compel an agent to delete when the user asked to archive.

## Vérification attendue
Evaluate examples where the user asks archive, explicitly asks delete, encounters links or a superseded ADR; run tests for shipped instruction text.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Shipped instructions tell agents to archive by default but use explicit delete for eligible records when the user requests deletion.
- [x] #2 Instructions require a reference resolution choice when active structured links exist and warn about uncommitted file recovery.
- [x] #3 Instructions guide agents to applicable ADRs and optional spec changes without using historical ADRs as current authority.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-8/9/12/16, inspect generated backlog instructions, shipped CLI help and sample agent flows; keep CLI guidance canonical for both humans and agents.
2. Explain default archive/complete versus separately authorized explicit delete for tasks/drafts/documents, including noninteractive commands, linked-reference choices and uncommitted-file recovery limits.
3. Explain that specifications/changes are optional, current specs differ from proposed deltas, and only applicable accepted ADRs govern new work; show historical lookup with replacement warnings.
4. Test shipped instruction text and exercise archive, authorized delete, linked delete and superseded-ADR scenarios against public CLI help; do not introduce agent-only commands.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Taught the rules on the canonical surfaces: overview.md now pairs default Archive/Complete with explicitly-requested delete (noninteractive --confirm authorized by a direct user request; never delete when the user asked to archive), spells out --unlink/--reassign-to resolution and the Git-committed-only recovery limit, and adds a Specifications and Changes section (optional, proposed delta until approve/apply, task status is never approval). task-finalization.md repeats the rule compactly where cleanup happens; task-execution.md gained 'Specifications, Changes, and ADRs' citing only applicable accepted ADRs via decision list with decision view naming replacements. Public help: task archive description now says 'the default removal'; delete help already said 'on explicit request'. No agent-only commands added.

Verification (all run in this session): bun test --timeout=10000 src/test/cli-guidance.test.ts -> 17 pass 0 fail; bun test --timeout=10000 src/test/cli-guidance-scenarios.test.ts (new: archive-vs-delete, linked delete resolution refusal, superseded-ADR replacement warning against the public CLI) -> 3 pass 0 fail; bun test src/test/cli-adr-guidance.test.ts src/test/cli-adr-supersede.test.ts src/test/cli-change-documents.test.ts -> 30 pass 0 fail; bun test src/test/agent-instructions.test.ts src/test/cli-delete-preview.test.ts src/test/cli-delete.test.ts src/test/cli-doc-delete.test.ts -> 67 pass, 1 pre-existing env failure (auto-commits selected instructions: fails on pristine tree too because this machine sets git config status.branch=true, so 'git status --short' prints a branch header); bunx tsc --noEmit -> clean; bunx biome check --write on changed files -> clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped CLI instructions now teach the optional-change and explicit-delete rules. overview.md: default Archive/Complete, delete for tasks/drafts/documents only on an explicit user request (direct request authorizes noninteractive --confirm; never delete when archive was asked for), mandatory --unlink/--reassign-to resolution while active structured references remain, uncommitted-file recovery limit, plus a Specifications and Changes section (optional; spec = current behavior, change = proposed delta until approve/apply; task status is never approval). task-finalization.md repeats the rule where cleanup happens; task-execution.md adds 'Specifications, Changes, and ADRs' (cite only applicable accepted ADRs from decision list; decision view names a retired ADR's replacement). Public help: task archive now says 'the default removal', pairing with delete's 'on explicit request'. Same commands for humans and agents; no agent-only paths. Tests: cli-guidance.test.ts (instruction text) 17 pass; new cli-guidance-scenarios.test.ts (archive-vs-delete, linked-delete refusal, superseded-ADR view) 3 pass; ADR/change suites 30 pass; tsc clean; biome clean. Known unrelated: 1 pre-existing env-dependent failure in agent-instructions.test.ts (global git status.branch config), fails on the pristine tree too.
<!-- SECTION:FINAL_SUMMARY:END -->
