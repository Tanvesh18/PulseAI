# Pulse AI Employee Frontend — Independent Technical UI Audit (Assessment B)

## Implementation Integrity Verdict

**Pass, with release-blocking workflow and accessibility defects.** The slice is recognizably Pulse AI rather than a generic dashboard: it uses the authoritative token system, pulse rails, explicit text-and-icon statuses, employee-scoped navigation, tabular hours, exception-local warnings, a read-only/scoped AI drawer, and a true mobile day-card adaptation. However, the editor presents simulated persistence as “Saved,” keeps validation findings static after edits, and completes submission without the required timestamp/reviewer/next-step evidence. Those behaviors undermine the product’s deterministic, auditable workflow promise.

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|---|---:|---|
| 1 | Accessibility | 2/4 | The global focus ring is only 2.23:1 against white, and the mobile flagged input loses its warning association. |
| 2 | Performance | 3/4 | Lean, image-free slice with memoized totals and bounded motion; no production build or runtime profile was permitted. |
| 3 | Responsive Design | 3/4 | Strong mobile grid adaptation, but 32px small controls miss the 44px product rule and global overflow clipping threatens zoom/reflow. |
| 4 | Theming | 3/4 | Centralized, well-tested tokens; one undefined consumer token and an under-contrast focus token remain. |
| 5 | Implementation Integrity | 3/4 | Coherent product-specific system, weakened by misleading save/validation/submission state and one failing test. |
| **Total** |  | **14/20** | **Good — address weak dimensions before release** |

## Detector Result

The mandated one-time command was invoked exactly as supplied:

`python .agents/skills/impeccable/scripts/detect.py frontend --format full --output .impeccable/audit.md`

It failed before scanning because `.agents/skills/impeccable/scripts/detect.py` does not exist. The installed skill contains `detect.mjs`, but the command was not rerun or substituted in order to preserve the exactly-once constraint. **Detector score: unavailable. Detector severity summary: unavailable. Do not interpret this as zero findings.**

## Executive Summary

- Audit score: **14/20 (Good)**
- Verified issues: **10 total — P0: 0, P1: 3, P2: 6, P3: 1**
- Automated checks: Prettier pass; TypeScript pass; ESLint pass; Vitest **fail (1 of 12 tests; 4 of 5 files pass)**
- Browser evidence: unavailable because no in-app or connected browser was available; no viewport claims are fabricated.
- Production build: not run because `next build` writes `.next`, contrary to the assessment’s sole-write constraint.

## Detailed Findings

### P1 — Focus indicator fails non-text contrast

- **Location:** `frontend/src/styles/tokens.css:45`; consumed globally at `frontend/src/app/globals.css:52-53`
- **Category:** Accessibility / Theming
- **Impact:** Keyboard users can lose track of focus on white and light-gray surfaces. `#84ADFF` measures **2.23:1 on white** and **2.13:1 on the canvas**, below the 3:1 requirement for essential UI graphics/focus indicators.
- **WCAG:** 1.4.11 Non-text Contrast; product target WCAG 2.2 AA
- **Recommendation:** Replace the focus token with a hue that reaches at least 3:1 on every surface where it appears, or use a two-color focus treatment with a contrasting outer ring.
- **Suggested command:** `$impeccable harden`

### P1 — Editor reports persistence and validation state that it does not perform

- **Location:** `frontend/src/features/employee/components/timesheet-editor.tsx:64-67,94-116,155-158,177-180,220-221,323-343`
- **Category:** Implementation Integrity / Accessibility
- **Impact:** Every change becomes “Saved” after a timer without persistence, validation findings remain the original `timesheet.issues` after users correct or create problems, and Submit simply flips local status. Users can be told the record is safe and accurate when navigation will discard it and displayed warnings may be stale. Validation changes are also never announced because none are recomputed.
- **Standard:** PRODUCT.md deterministic numerical/policy validation and traceability; design.md lines 538-541 and 736
- **Recommendation:** Either label the experience explicitly as an unsaved interaction prototype or implement a persistence boundary with real success/failure states. Recompute deterministic validation from `entries`, associate/announce changes, and submit only the validated snapshot.
- **Suggested command:** `$impeccable harden`

### P1 — Mobile flagged input is not associated with its explanation

- **Location:** `frontend/src/features/employee/components/timesheet-editor.tsx:463-491`; compare desktop association at `:407-410` and explanation at `:506-509`
- **Category:** Accessibility / Responsive
- **Impact:** On mobile, assistive technology announces the field as invalid but cannot identify why or locate the potential-duplicate warning. The desktop version supplies `aria-describedby`; the mobile adaptation drops it.
- **WCAG:** 1.3.1 Info and Relationships; 3.3.1 Error Identification
- **Recommendation:** Give the mobile input the same programmatic warning association, preferably to an entry-specific message, and reconsider `aria-invalid` if the condition is only a non-blocking warning.
- **Suggested command:** `$impeccable adapt`

### P2 — Small action controls violate the 44px product touch-target rule

- **Location:** `frontend/src/components/ui/ui.module.css:65-69`; used by `frontend/src/features/employee/components/timesheet-table.tsx:73-80`, `frontend/src/app/(app)/employee/page.tsx:150-156`, and warning actions at `frontend/src/features/employee/components/timesheet-editor.tsx:331-337`
- **Category:** Responsive / Accessibility
- **Impact:** These controls have a 32px minimum height and are harder to activate on touch screens. They meet WCAG 2.5.8’s base 24px floor but violate Pulse AI’s explicit 44×44 CSS-pixel rule.
- **Standard:** design.md line 727; `--layout-touch-target-minimum`
- **Recommendation:** Preserve compact visual styling with padding or pseudo-element hit areas while enforcing a 44px interactive target on touch layouts.
- **Suggested command:** `$impeccable adapt`

### P2 — Submission success omits required evidence

- **Location:** `frontend/src/features/employee/components/timesheet-editor.tsx:155-158,293-315,318-321`
- **Category:** Implementation Integrity
- **Impact:** After submission, status becomes “Pending review” and fields lock, but the UI does not show submitted time, responsible reviewer, or next step. Users cannot verify who owns the decision or when the state changed.
- **Standard:** design.md lines 550-554; Product Principle 2
- **Recommendation:** Model a submitted event and render its timestamp, reviewer/queue owner, and next action adjacent to the status.
- **Suggested command:** `$impeccable harden`

### P2 — Assistant response changes are not announced

- **Location:** `frontend/src/components/shell/app-shell.tsx:193-211`
- **Category:** Accessibility
- **Impact:** Activating a suggested question replaces response text away from focus with no live/status semantics, so screen-reader users may receive no confirmation or answer.
- **WCAG:** 4.1.3 Status Messages
- **Recommendation:** Add an appropriately scoped polite live region or move focus to a labelled response region after the update.
- **Suggested command:** `$impeccable harden`

### P2 — Notifications are informational dead ends

- **Location:** `frontend/src/components/shell/app-shell.tsx:128-155`; notification data at `frontend/src/features/employee/data/mock-employee.ts:177-199`
- **Category:** Implementation Integrity / Accessibility
- **Impact:** Items show title, message, timestamp, and read styling but have no destination or action, contrary to the design contract. The trigger’s `aria-label="Notifications"` also overrides the visible unread count, so the count is unavailable before opening.
- **Standard:** design.md lines 589-592; Product Principle 1
- **Recommendation:** Add scoped destinations/actions and include unread count in the trigger’s accessible name or description.
- **Suggested command:** `$impeccable clarify`

### P2 — Test suite is red because the accessible-name contract drifted

- **Location:** implementation `frontend/src/components/shell/app-shell.tsx:126-131`; expectation `frontend/src/components/shell/app-shell.test.tsx:21-23`
- **Category:** Implementation Integrity
- **Impact:** CI cannot pass and the intended control label is ambiguous between source and test. Current Vitest result: 1 failed, 11 passed.
- **Recommendation:** Choose one action-oriented accessible name, update implementation/test together, and add the unread-count expectation.
- **Suggested command:** `$impeccable harden`

### P2 — Global horizontal clipping creates zoom/reflow risk

- **Location:** `frontend/src/app/globals.css:5-10`
- **Category:** Responsive / Accessibility
- **Impact:** `max-width: 100vw` plus `overflow-x: hidden` on both `html` and `body` can hide content or focus indicators at high zoom instead of exposing a local, usable scroller. Source includes good local table scrollers, so global clipping is unnecessary defense.
- **WCAG:** 1.4.10 Reflow (risk; browser verification unavailable)
- **Recommendation:** Remove global clipping, constrain the actual offending component, and verify all routes at 320 CSS px and 200–400% zoom.
- **Suggested command:** `$impeccable adapt`

### P2 — Contributor documentation no longer describes the implemented surface

- **Location:** `frontend/README.md:5-6,35-58`
- **Category:** Implementation Integrity
- **Impact:** The README says Phase 0 has no dashboards/domain workflows and describes a domain-neutral bootstrap page, while the repository now contains an employee dashboard, shell, editor, history, assistant, and notifications. Future contributors may make incorrect architectural or QA assumptions.
- **Recommendation:** Update the phase, route map, test claims, and demo-data limitations.
- **Suggested command:** `$impeccable document`

### P3 — Undefined font-weight token silently invalidates a declaration

- **Location:** `frontend/src/features/employee/employee.module.css:142-147`
- **Category:** Theming / Implementation Integrity
- **Impact:** `--font-weight-regular` is not defined. The declaration is dropped, so the `<small>` inside the KPI `<dd>` inherits the large data value’s weight instead of its intended caption weight.
- **Recommendation:** Use the defined `--font-weight-caption` token and add a test that every `var(--*)` consumer resolves to a declared token.
- **Suggested command:** `$impeccable polish`

## Patterns and Systemic Risks

- The token architecture is strong, but existing tests verify declarations/raw colors rather than all token references or focus-indicator contrast.
- Responsive adaptation is deliberate; remaining risks are concentrated in interaction target size, warning associations, and global clipping rather than desktop-only layout.
- The largest product risk is simulated authoritative state: “Saved,” warning count, and submission status are presented as evidence even though they are disconnected from persistence and live validation.
- Automated accessibility smoke tests cover static page renders but do not exercise dialogs, dynamic status changes, mobile DOM, keyboard grid navigation, or high zoom.

## False Positives to Disregard

- Raw hex colors in `src/styles/tokens.css` are authoritative token declarations, not hard-coded consumer drift.
- Literal media-query widths (`767px`, `768px`, `1024px`) are required by CSS and are annotated to mirror breakpoint tokens.
- `min-width: 720px/1160px` on data grids is intentional where a local scroller exists; the editable grid is replaced with day cards below 768px.
- No dark mode is not a defect for this slice: the authoritative design specifies a light enterprise system and the implementation explicitly uses `color-scheme: light`.
- The reduced-motion rule removes optional transitions/entry animations while preserving the resulting state and hierarchy; it is not the harmful `0.01ms` pattern described by the audit playbook.
- Static, already-present warning sections do not require `role="alert"`; their semantic label and visible placement are acceptable. Dynamic validation changes do require announcements once implemented.

## Positive Findings

- Semantic landmarks, skip link, one H1 per page, labelled navigation, breadcrumbs, table captions/scopes, visible labels, icon names/tooltips, and Radix dialog focus management are present.
- Statuses and warnings combine text, icons, semantic color, borders, and pulse rails rather than relying on color alone.
- The mobile timesheet is a real day-grouped adaptation with 44px inputs, preserved project/task context, and weekly totals.
- Approved/read-only records lock inputs, and AI content is clearly labelled read-only, employee-scoped, demo-grounded, and non-authoritative.
- Consumer CSS uses centralized design tokens; raw-color and contrast tests cover the principal text/semantic pairs.
- Totals are memoized, timers are cleaned up, motion is transform/opacity based and bounded, and there are no unoptimized images or broad `will-change` hints.

## Prioritized Actions

1. **P1 — `$impeccable harden`:** replace simulated save/static validation with truthful persistence and deterministic validation, complete submission evidence, repair focus contrast, and make dynamic changes announceable.
2. **P1 — `$impeccable adapt`:** restore the mobile warning association, enforce 44px touch targets, remove global overflow clipping, and verify zoom/reflow in a real browser.
3. **P2 — `$impeccable clarify`:** make notifications actionable and expose unread count programmatically.
4. **P2 — `$impeccable document`:** align README phase/surface/test documentation with the implemented vertical slice.
5. **P3 — `$impeccable polish`:** resolve the undefined caption-weight token and add unresolved-token coverage after functional fixes.

You can ask me to run these one at a time, all at once, or in any order you prefer.

Re-run `$impeccable audit` after fixes to see your score improve.
