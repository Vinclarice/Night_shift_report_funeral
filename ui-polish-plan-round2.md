# Night Shift Report — Round 2: Thorough Modern Polish Plan

This builds on the committed "Modernize editor UI" pass (sans-serif type, neutral palette, brighter accent, icons, header grouping — commit `7847fbc`). That pass changed the palette and typography; this round is about the layer on top of that: consistent design tokens, hover/focus/motion detail, and a couple of structural changes that would make the app feel like a finished modern product rather than a styled prototype. Same constraint as before: nothing here touches `ReportPage.tsx`, the print-path CSS, or `@media print` — the printed report stays exactly as the physical print-quality gate left it.

## A. Design tokens (foundation for everything else)

Right now spacing, transition timing, and hover states are ad hoc — a `9px` here, a `13px` there, some elements with hover states and most without. Before adding more polish on top, it's worth formalizing:

- A spacing scale (e.g. 4/8/12/16/20/24/32px) as CSS custom properties, so panel padding, gaps, and margins pull from the same scale instead of one-off values.
- A motion scale (`--duration-fast: 100ms`, `--duration-base: 160ms`, `--ease: cubic-bezier(.2,.7,.3,1)`) so every transition in the app (button hover, panel expand, modal open) shares the same feel instead of each animation having its own hand-picked timing.
- A focus-ring token (`--focus-ring: 0 0 0 3px rgb(14 159 110 / 30%)`) applied consistently to every interactive element — buttons currently fall back to the browser's default focus outline, which looks out of place next to the custom-styled inputs.

This is invisible by itself but makes every item below faster to implement consistently.

## B. Component-level polish

- **Hover and active states everywhere.** Entry-item cards, panel-section rows, and the preview toolbar currently have no hover feedback at all — only buttons do. Adding a subtle lift (`translateY(-1px)` + shadow) on entry-item hover, and a background tint on hoverable rows, makes the app feel responsive to the cursor instead of static.
- **Save-state indicator.** Replace the colored-dot + text with a small inline spinner icon while saving (instead of a static orange dot) and a checkmark icon when saved, with a smooth crossfade between states instead of the current key-remount flash.
- **Status badge.** Swap the plain colored dot on the Draft/Finalized badge for a small icon (pencil for draft, check for finalized) — reinforces the meaning at a glance rather than relying on color alone (also an accessibility win for color-blind users).
- **Rush indicator.** The rush pill is solid red text-on-red; consider a left-edge accent bar on rush entry-items in the sidebar list in addition to the pill, so rush items are scannable in the list without reading the tag.
- **Custom scrollbars.** The editor panel, modals, and preview panel use the default Chromium scrollbar, which looks noticeably "un-designed" against the rest of the UI. A thin, muted custom scrollbar (`::-webkit-scrollbar`) would match the rest of the polish.
- **Button micro-interactions.** Add a slight scale-down on `:active` (98%) across primary/secondary/print buttons for tactile feedback, using the new motion tokens.

## C. Structural refinements

- **Toast notifications instead of a sticky message bar.** The current message bar pushes all content down by 40px whenever a validation error or parser warning appears, and again when dismissed. A floating toast (top-right, auto-dismiss after ~5s, manually dismissible) is the more modern pattern and doesn't reflow the layout underneath it.
- **Slide-over panels for Funeral homes / Recovery / Print setup.** These currently render inline in the sidebar, pushing the entry list and paste box further down the page each time one is opened. Converting them to a slide-over drawer (or a right-side sheet) from the header would keep the primary entry workflow stable underneath instead of shifting every time a secondary panel opens. This is the single biggest structural change in this round — worth calling out because it changes the interaction model, not just the visuals, so flagging it separately in case you'd rather keep the current inline behavior.
- **Zoom control on the live preview.** The preview is fixed at a .72 scale. A simple +/- zoom control (50–100%) in the preview toolbar would feel more like a real document viewer and help on higher-resolution displays.

## D. Motion

- **Panel open/close transitions** for the three toggle panels (height/opacity) instead of an abrupt appear/disappear — small, but this is exactly the kind of detail that reads as "polished" vs. "functional."
- **Modal enter/exit animation** (scale-from-98% + fade, ~120ms) instead of the current instant appearance.
- **Page-level fade-in** on initial load, after the loading spinner resolves, instead of a hard cut to the editor.

## E. Screens

- **Start screen.** Currently just a card with two buttons. Showing a short summary of the last finalized report (date, entry count) alongside the "clone last report" option would make the screen feel informative rather than just a gate.
- **Loading screen.** Fine as-is; low priority.

## Suggested sequencing

1. Design tokens (A) — foundation, no visible change by itself but unblocks everything else.
2. Hover/focus states + button micro-interactions (B) — highest visual payoff for the effort, zero structural risk.
3. Save-state and status-badge icon treatment (B) — small, self-contained.
4. Toast notifications (C) — replaces the message bar, no interaction-model change.
5. Panel and modal motion (D) — layered on top of 1–4.
6. Custom scrollbars (B) — cosmetic, do anytime.
7. Preview zoom control and start-screen summary (C/E) — nice-to-haves, do last.
8. Slide-over panels (C) — the one item that changes how the app is used, not just how it looks. Recommend deciding on this one specifically before I touch it, since it's a bigger diff and a UX change rather than pure polish.

Items 1–6 are safe to batch into one implementation pass with no product-behavior change. Item 7 is low-risk but adds a small new control. Item 8 is worth a separate go/no-go decision.
