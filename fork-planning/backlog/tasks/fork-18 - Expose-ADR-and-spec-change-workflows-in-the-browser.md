---
id: FORK-18
title: Expose ADR and spec-change workflows in the browser
status: Done
assignee:
  - '@alex-agent'
created_date: '2026-10-07 08:17'
updated_date: '2026-10-08 16:34'
labels: []
dependencies:
  - FORK-12
  - FORK-16
documentation:
  - backlog/docs/strategy/doc-4 - Product-definition-for-the-Backlog.md-fork.md
type: feature
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## TL;DR
Browser views expose current specs, linked changes and ADR status/replacement with clear preview of spec integration.

## Contexte
A person must be able to inspect proposed behavior and applicable architecture decisions without relying on an agent or accidentally adopting retired guidance.

## Résultat attendu
Browser views expose current specs, linked changes and ADR status/replacement with clear preview of spec integration.

## Périmètre
Human-readable link/navigation, proposed vs current specs, retired ADR notice and review/preview affordances using shared CLI semantics.

## Hors périmètre
Do not implement a browser-only change engine or a second approval state model.

## Vérification attendue
Exercise proposed/current change, archived ADR and applicable ADR navigation with browser tests/manual review; run scoped Bun tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A person can distinguish proposed deltas from current specifications in browser views.
- [x] #2 A retired ADR displays its replacement and cannot appear as applicable guidance by default.
- [x] #3 Reviewing a change does not silently apply it or complete linked tasks.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. After FORK-12/16, inspect browser DecisionDetail, DocumentationDetail, route data and API helpers; use the shared ADR/change/spec model rather than a UI-specific parser or approval state.
2. Surface applicable ADRs, explicit historical lookup, replacement links and current versus proposed spec text; navigate linked tasks/specs/changes without showing retired ADRs as current guidance.
3. Provide human-readable review and preview access to the validated change projection; applying remains an explicit separately gated operation, never a side effect of viewing or editing a linked task.
4. Test active/retired ADR navigation, proposal/current distinction, preview and no implicit apply/completion in server/component tests; manually check focus, keyboard and desktop/narrow rendering.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Studied shared model (adr.ts, change-document.ts, backlog.ts guidance/apply) and browser surfaces (server routes, api.ts, DocumentationDetail, DecisionDetail, search filtering). Plan: new read-only server routes /api/decision/:id/guidance and /api/doc/:id/preview; DecisionDetail retired banner + replacement link; DocumentationDetail type awareness, change status chip + linked specs/tasks/decisions navigation + preview modal. No browser apply/approve mutation surface.

Implemented: GET /api/decision/:id/guidance (resolveAdrGuidance; 404/409 mapping) and GET /api/doc/:id/preview (core.buildChangePreview; read-only). Web client: fetchDecisionGuidance, fetchChangePreview. DecisionDetail: retired banner with replacement link, archived chip, broken-chain alert. DocumentationDetail: type label, Proposed/Approved/Integrated chip from managed sections, Affected specs/Linked tasks/Related decisions navigation, Preview button (hidden once integrated). New ChangePreviewModal renders the shared projection read-only — no approve/apply controls anywhere in the browser; approve+apply stay CLI-gated (FORK-16 semantics). Verified: 20 new tests pass (7 guidance endpoint, 4 preview endpoint, 9 component); 74 pass across the 7 targeted+adjacent files; bunx tsc --noEmit clean; biome check clean. Manual review in headless Chromium at 1280px and 390px: retired banner + replacement link render, retired/rejected ADRs absent from sidebar guidance, preview modal shows diff/resulting spec, Escape closes with focus returning, no horizontal overflow, and viewing leaves change/spec/task files byte-identical.

Simplification pass (AGENTS.md): folded the four change parses into one memoized shared-model read and extracted the repeated link-list markup into a local LinkGroup; re-verified 74 targeted tests, tsc, biome, and a fresh headless-Chromium render of both surfaces.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Exposed ADR and spec-change workflows in the browser over the shared core model, with no second state model and no browser apply path. Two read-only server routes: /api/decision/:id/guidance (core resolveAdrGuidance — applicable ADRs as-is, retired ADRs with state + accepted replacement, 409 for broken chains) and /api/doc/:id/preview (core buildChangePreview — same validated projection as 'backlog doc preview'). DecisionDetail now performs explicit historical lookup: a retired ADR shows a Retired(state) banner marked 'historical record, not current guidance', links its replacement, and shows an Archived chip; a broken supersession chain surfaces as an alert without hiding the record. DocumentationDetail labels the document type (Specification vs Change), derives a Proposed/Approved/Integrated chip from the change's own managed sections, and navigates Affected specs, Linked tasks, and Related decisions; the Preview modal renders per-spec diffs and resulting specs read-only and disappears once a change is integrated history. Applicable ADRs remain the default guidance corpus (search/side nav already filter via isApplicableDecision). Applying or approving a change is not possible from the browser — it stays the explicitly gated CLI operation, and reviewing never writes files or touches linked tasks. Verification: 20 new tests (server guidance, server preview, component) all pass; 74 pass across targeted + adjacent suites; bunx tsc --noEmit clean; biome clean on changed files; headless-Chromium review at desktop and 390px widths confirmed rendering, keyboard close, and byte-identical files after viewing.
<!-- SECTION:FINAL_SUMMARY:END -->
