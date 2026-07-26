# Night Shift Report — Round 3: Component Architecture + Richer Palette + Section Nav

This folds in your two decisions: a richer single (still green-branded) palette, and structure-plus-visible-nav — extracting a real component library and replacing the section dropdown with a proper sidebar list. It supersedes the more speculative parts of the round-2 plan (round 2's toast/drawer/motion items are absorbed below with concrete component homes; its zoom-control and start-screen-summary items are still optional extras, not core to this pass). As always: `ReportPage.tsx`, domain/application logic, and the print CSS path are untouched — this is entirely the editor chrome and how it's built.

## 1. A small internal component library (`src/renderer/ui/`)

Right now every button, badge, and panel is a raw HTML element with a hand-typed `className` string, repeated at each call site. Pulling the recurring pieces into typed components is the concrete way to "use React's capabilities" here — consistent styling enforced by the type system instead of by convention, and every future tweak happens in one file instead of N call sites.

- **`Button`** — variants (`primary` / `secondary` / `quiet` / `danger` / `print`), an optional icon slot, and a `busy` state that shows a spinner and disables the button, replacing the scattered `disabled={status === "saving"}` checks.
- **`IconButton`** — a constrained wrapper around `Button` that requires an `aria-label` prop at the type level, so an icon-only action can't accidentally ship without one (the Edit/Remove buttons added last round rely on convention today; this makes it a compile error to forget).
- **`Badge`** — a small pill component with `tone` (`neutral` / `success` / `warning` / `danger`) and optional count, backing the save-state indicator, the Draft/Finalized badge, the rush pill, and the new section entry-counts below, so all four stop being four separate hand-tuned CSS rules.
- **`Toast` + `ToastProvider` + `useToast()`** — replaces the sticky message bar that currently pushes the whole layout down. Toasts float top-right, auto-dismiss after ~5s (errors persist until dismissed), and stack if more than one fires. `setMessage(...)` call sites become `toast.error(...)` / `toast.info(...)`.
- **`Drawer`** — a single slide-over shell driven by one `activeDrawer: "directory" | "recovery" | "print" | null` state instead of the current three independent booleans (`showDirectory`, `showRecovery`, `showAdvanced`). Funeral homes, Recovery, and Print setup become the three possible contents of the same drawer rather than three panels that stack inline and push the entry list down the page.
- **`Card`** — the shared bordered/padded/rounded container behind entry-items and panel sections, so hover-lift and focus treatment are defined once.

## 2. Section navigation (`SectionNav`)

The "Section" control is currently a native `<select>` — functional, but it's the single most-used control in the app and it hides information (you can't see which sections have entries, or rush items, without opening each one). Replacing it with a `SectionNav` list:

- Two grouped columns (or a grouped list), Human Remains and Cremated Remains, each showing all of that category's sections by title.
- Each row shows an entry-count `Badge` (using the component above) and a small rush-indicator dot if that section currently contains a rush entry — so the whole report's status is visible at a glance without switching sections.
- The active section is highlighted; clicking a row is the new equivalent of picking from the dropdown, with no change to the underlying `selectedSection` state or any domain logic.

## 3. A richer palette, still green-branded

Expand the current single `--forest` value into a proper scale rather than one flat accent color reused everywhere:

- `--brand-50` through `--brand-900` (a light-tint-to-dark-shade ramp of the same green family) for backgrounds, hover/active states, and text-on-tint, so hover states and subtle backgrounds stop being separately hand-picked hex values.
- Formal semantic tokens — `--success`, `--warning`, `--danger`, `--info` — each with a matching soft background tint, and every existing status color (save-state dot, Draft/Finalized badge, rush pill, toast tones) remapped onto these four instead of the handful of slightly-different hex values currently in use for "roughly red" or "roughly amber."
- This is what the new `Badge` and `Toast` components consume, so the palette expansion and the component library are really one piece of work, not two.

## 4. Motion, now with concrete homes

Same goals as round 2's motion section, but each one now has an obvious place to live instead of being bolted onto individual elements:

- Toast slide-in/fade-out, owned by `ToastProvider`.
- Drawer slide-from-right + backdrop fade, owned by `Drawer`.
- Entry-item and `SectionNav` row hover-lift, button active-state scale-down, and a consistent focus-ring token — defined once on `Card`/`Button` and inherited everywhere instead of repeated per call site.

## 5. Optional, bigger, and separate: an app-state Context

Worth naming even though it's not core to this pass: `EntryForm`, `PrintSettings`, `FuneralHomeManager`, and `RecoveryPanel` currently take their data and callbacks as long explicit prop lists from `App.tsx`. A `NightReportContext` could remove most of that drilling. I'd flag this as optional and lower-priority — it's a real refactor of how state flows through the app (more regression surface around undo/redo and the save queue) rather than a visual change, so it's worth doing on its own once the visual pass above is stable, not bundled into it.

## Sequencing

1. Palette tokens (3) — foundation, no visible change by itself.
2. `Button` / `IconButton` / `Badge` / `Card` (1) — swap existing call sites over to them; visually this should look like a refinement of what's already there, not a redesign.
3. `Toast` + `ToastProvider` (1) — replace the message bar.
4. `Drawer` (1) — consolidate the three inline panels.
5. `SectionNav` (2) — replace the dropdown.
6. Motion polish (4) on top of the now-shared components.
7. (Optional, separate) `NightReportContext` (5), only if you want it after the above lands.

Items 1–6 are one coherent pass with no change to domain logic, save/undo behavior, or the print path — the report data flows through exactly the same functions in `App.tsx`, just presented through new components. Ready to build whenever you say go.
