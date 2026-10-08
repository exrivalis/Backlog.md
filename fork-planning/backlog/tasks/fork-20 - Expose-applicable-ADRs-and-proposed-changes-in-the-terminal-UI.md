---
id: FORK-20
title: Expose applicable ADRs and proposed changes in the terminal UI
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:17'
updated_date: '2026-10-08 16:54'
labels: []
dependencies:
  - FORK-12
  - FORK-16
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
TUI views expose linked current specs, proposed changes and ADR status/replacement using the shared model.

## Contexte
Terminal users should be able to identify current behavior and applicable architecture guidance without mistaking an archived ADR or a proposal for current truth.

## Résultat attendu
TUI views expose linked current specs, proposed changes and ADR status/replacement using the shared model.

## Périmètre
Read and navigate applicable decisions, historical lookup, current vs proposed change distinctions and preview access where these surfaces exist.

## Hors périmètre
Do not create an independent TUI parser or mandatory change form for routine tasks.

## Vérification attendue
Exercise TUI navigation/focus for current specs, proposed deltas and superseded ADRs; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Applicable accepted ADRs are discoverable by default; retired ones appear only as clearly marked history.
- [x] #2 A user can distinguish proposed change text from the current specification through the TUI.
- [x] #3 TUI views do not imply a change was approved, applied or linked task completed when it was not.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-12/16, inspect existing TUI task and document viewing/navigation; derive ADR/change/spec data from the shared model rather than parsing Markdown a second time.
2. Show applicable accepted ADRs by default with explicit marked historical lookup and replacement navigation; show linked current specs separately from proposed deltas and integrated change history.
3. Expose non-mutating validated preview access where the TUI has a relevant record view; never imply approval, apply or task completion from a navigation action.
4. Test navigation, focus, active versus retired ADRs, proposal/current labels and archived links with TUI tests/manual checks; run scoped Bun tests and static checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation: new src/ui/guidance.ts derives all TUI labels from the shared model (Core.resolveAdrGuidance, Core.buildChangePreview, markdown/change-document parsers) - no second Markdown parser in the TUI. scrollableViewer generalized from one hardcoded D action to named actions (key+hint+run), keeping the FORK-19 pattern; documentDeleteViewerAction carries key d. decision list gains an interactive selection on a TTY (applicable decisions by default, retired/archived grayed as history) and selection opens the guidance viewer with [V] replacement navigation; plain and JSON outputs are byte-identical to before. doc view / doc list viewers get type banners: specifications labeled current required behavior, change docs labeled Change proposal (not the current specification) with Affected specs (current), Approved ... - not yet integrated stated factually, and Integrated ... (history) for applied changes; change docs gain a read-only [P] Preview popup showing the same validated projection as backlog doc preview. Preview popup binds B for Back because q/Esc are screen-level viewer close keys. No delete affordance for decisions or milestones; no approve/apply/task-completion affordance anywhere in the TUI.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TUI now exposes decision guidance and change/spec state from the shared model. decision list is interactive on a TTY (applicable decisions by default; retired/archived grayed as history) and opens a guidance viewer; decision view shows a status banner derived from resolveAdrGuidance with [V] replacement navigation across supersession chains. Document viewers label specifications as current required behavior, change documents as proposals (with Affected specs (current), factual approval state marked not yet integrated, and linked tasks/decisions) or as integrated history, and change documents gain a read-only [P] preview popup using the same validated projection as backlog doc preview. Plain and JSON outputs are unchanged. Verification: bun test --timeout=10000 on tui-guidance.test.ts plus tui-delete, cli-doc-view, cli-adr-guidance, cli-doc-decision-board suites - 64 pass, 0 fail; bunx tsc --noEmit clean; bunx biome check clean on all changed files; scripted real-PTY keyboard review of four flows (retired-ADR navigation, preview popup open/scroll/back, spec label, interactive decision list) passed end to end. Risks: none known; follow-up candidates are archived-document shortcuts in the selection lists.
<!-- SECTION:FINAL_SUMMARY:END -->
