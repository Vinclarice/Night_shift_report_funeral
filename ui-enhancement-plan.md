# Night Shift Report — UI Enhancement Plan

Based on a review of `App.tsx`, `styles.css`, the editor components (`EntryForm`, `PrintSettings`, `FuneralHomeManager`, `RecoveryPanel`, `PasteReviewModal`), and the current print output (`test-results/*.png`).

## Constraint up front

The printed report is a deliberate, print-first replica of an existing Word form, and the README's "Physical print-quality gate" says explicitly not to approve changes to it without a side-by-side printer comparison. So this plan treats the **editor chrome** (header, side panel, forms, modals, live preview frame) as low-risk, high-value territory, and treats the **printed page itself** as an area for small, reversible polish only — nothing that touches spacing, borders, or type in a way that could shift the physical print.

## Editor screen

The app already has a coherent visual identity (forest green, Georgia serif headings, sage/paper palette) — the gaps are mostly in feedback, hierarchy, and density, not in the color system itself.

**Header and status.** The save-state dot (`saved`/`saving`/`error`) is the only feedback for background saves — it's easy to miss. A brief toast or inline animation on state change, plus a visible last-saved timestamp, would reduce "did that actually save?" uncertainty. The row of six header buttons (Undo, Redo, Funeral homes, Recovery, Print setup, Finalize, Print) is flat and same-weight; grouping the three toggle panels (Funeral homes / Recovery / Print setup) into a single overflow or icon-tab cluster would cut visual noise and make Finalize/Print read as the primary actions they are.

**Side panel density.** `EntryForm`, "Current entries," and "Quick paste" are all stacked in one scrolling column with identical section styling, so nothing signals which one matters right now. Making the active section header sticky, and giving "Current entries" a count badge instead of relying on `<h2>{count}</h2>`, would help orient a user scanning a long list. The entry list itself (`.entry-item`) is serviceable but the Edit/Remove buttons are tiny, low-contrast text buttons — worth sizing them for a fast-moving, low-precision "click while multitasking" workflow rather than a typical desktop-app density.

**Forms.** `EntryForm`'s field set changes shape based on `entryKind` (funeral vs. count vs. combined vs. plain), which is good, but there's no visual transition — fields just appear/disappear, which can be jarring mid-typing. A short fade/height transition would smooth that. The "Format" `<select>` is also the single highest-leverage control in the form and looks identical to every other input; a segmented control or icon-labeled toggle would make the five entry kinds easier to scan than a dropdown.

**Modals and secondary panels.** `PasteReviewModal`, `PrintSettings`, `FuneralHomeManager`, and `RecoveryPanel` all reuse `.panel-section`/`.settings-panel` styling, which is consistent but visually indistinguishable from the main flow — a user can lose track of whether they're in a "safe" editing area or a "destructive" one (e.g., `RecoveryPanel`'s backup restore, which uses a native `confirm()` dialog that clashes with the rest of the app's styling). Replacing that native confirm with a styled in-app confirmation would close the one spot where the UI currently breaks character.

**Live preview frame.** The preview toolbar's "Draft"/"Finalized" badge is the only persistent indicator of report state in the main view — it could be paired with a small colored left border or background tint on the whole `.preview-panel` so the draft/finalized distinction is visible peripherally, not just readable when you look at the toolbar.

**Empty/loading states.** The loading screen and start screen are already nicely done (spinner card, branded start card). The empty "Current entries" section just prints the word "None" as a heading, which is functionally fine but visually flat next to the branded start screen — a one-line muted placeholder would match the app's polish level better than reusing the count `<h2>`.

## Printed report page

Given the fidelity constraint, the safest category of change is anything that's visible on screen but invisible on paper, plus any print change small enough to verify in one printer pass:

- The on-screen preview is scaled to `.72` and cropped with a negative margin hack (`margin-bottom: -3.08in`) to fit the viewport — this works but is fragile if the window is resized or the page length ever changes. Worth a layout pass that doesn't depend on a hardcoded crop value, purely as an editor-side robustness fix (zero print impact).
- The draft watermark, calibration marks, and width-handle affordances are print-adjacent UI that only need to look good on screen; the watermark's rotation/opacity could be tuned for on-screen legibility without touching the actual print CSS path (they already share variables, so this would need care to keep them print-identical, or intentionally split into a screen-only variant).
- Any true print-layout change (row height, border weight, font) should stay out of scope for this pass and go through the existing physical print-quality gate as its own tracked change.

## Suggested sequencing

1. Save-state feedback + sticky active-section header (cheap, immediately noticeable).
2. Header button grouping (Finalize/Print as primary; the three toggles collapsed together).
3. Segmented "Format" control in `EntryForm`, plus transition on field-set changes.
4. Styled confirmation dialog to replace `RecoveryPanel`'s native `confirm()`.
5. Preview-panel draft/finalized affordance (border/tint) and empty-state polish.
6. Preview scaling/crop robustness (editor-only, no print risk).

Items 1–5 are pure CSS/markup changes with no print-fidelity risk and no backend involvement — good candidates to implement first and review on screen. Item 6 touches layout math and deserves its own quick regression pass against the three `test-results` reference screenshots before merging.
