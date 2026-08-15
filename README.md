# Night Shift Report

A local, print-first Windows application for preparing the nightly Human Remains and Cremated Remains report. The report date is always the next local calendar day, and data stays on the computer.

## Use the built app

1. Double-click `Start Night Shift Report.bat` in the production folder. The app opens directly into tonight's report — no start screen or click required. If a report already exists for tonight it opens as-is; otherwise a new one is created automatically, pre-populated with the previous report's entries so nothing has to be retyped.
2. Add or edit entries in the inspector beside the live canvas; you can also click any ruled line on the canvas to type directly. Press **Enter** or **Tab** to save and continue in the next blank line, click away to save and stop, or press **Escape** to cancel.
3. As you type, an Auto-width card expands immediately to fit the line. Funeral-home and deceased names typed in lowercase are capitalized automatically when saved.
4. Drag an existing entry onto another card to move it. Moving into Deliver also applies its merge and Rush-first rules.
5. Drag an entry onto another entry to reorder it: the row you drop on moves down. Drop onto a blank row past the last entry to **pin** the entry to the bottom of that section — useful for a line that belongs to the section but sits apart from its list, like a road trip in Deliver. A pinned entry stays at the bottom as new entries are added; drag it back up to unpin it. In the Deliver sections Rush entries still hold the top, and your manual order is kept within the Rush and non-Rush groups.
6. Use **Paste** in the inspector to add multiple entries through the required review screen.
7. Use the canvas Fit and zoom controls to adjust the on-screen view without changing the printed report. Drag a card's small right-edge handle to set its print width.
8. Press **Ctrl+K** to open the command palette. Type to jump to any section or run a command — undo, redo, print, open a tools panel, or toggle the inspector. Arrow keys move, Enter runs, Escape closes.
9. Open **Tools** > **Print setup** to show calibration marks, reset a card width to Auto, or tune margin, scale, and printer offsets.
10. Choose **Print report** at any time and select the company printer or Microsoft Print to PDF — printing always sends whatever is currently on the page; there is no draft/final distinction or locking step.

Undo and redo are also bound to **Ctrl+Z** and **Ctrl+Y**, and are ignored while the cursor is in a text field.

A report is named for the next calendar day, so that name changes at midnight — partway through a shift. If the app is restarted after midnight and tonight's work hasn't been superseded yet, it resumes that same report unchanged rather than starting a new one; nothing is written until the next edit.

Only the most recently worked-on report is retained — it exists purely to seed the next night's entries, so there is no report archive. The app stores its database, backups, logs, and window state in `%LOCALAPPDATA%\Night Shift Report`. Database backups are retained for 14 days, with a fresh one taken automatically whenever a new night's report is created. **Recovery** can restore a retained backup. Main-process errors are written to `logs\main-<date>.log`, which is the first place to look if something fails overnight.

The window is frameless: the dark command bar is also the title bar, with its own minimize, maximize, and close controls at the right. Window size, position, and maximized state are restored on next launch.

## Moving to another computer

- One-time production setup: copy the contents of `production-runtime` to a permanent folder on the production computer, open a terminal there, and run `pnpm install --prod`. Then copy the laptop's built `out` folder into that same folder. This installs only Electron in `node_modules`; Node.js and pnpm are needed for setup, but the launcher calls Electron directly afterward.
- Build updates on the laptop with `pnpm build`. Close the production app, replace only its `out` folder with the newly built `out` folder, and relaunch it with `Start Night Shift Report.bat`. No installer or compression step is involved.
- Copy the entire `out` folder as one unit. It contains the application and Prisma query engine that belong to that build.
- Repeat the one-time dependency setup whenever the Electron version in `production-runtime/package.json` changes. Ordinary application updates only require `out`.
- Report data is not stored beside the executable. To transfer existing reports, close the app and separately copy `%LOCALAPPDATA%\Night Shift Report` to the same location on the destination computer.

## Physical print-quality gate

Run `node scripts/print-gate.mjs` first (after `pnpm build`). It renders every case below through the real application into `print-gate/`, as a one-page PDF and a PNG each, plus a calibration sheet and a `CHECKLIST.md` to work through at the printer. It also runs the checks that can be made without paper — nine cards present, no text clipped at a card edge, no card in the wrong column, the 3.55in card ceiling, one-page fit, and compaction engaging only where intended — and exits non-zero if any of those fail. It uses a throwaway data directory, so it never touches the real report database.

Those checks cannot approve this gate. Print and compare these cases beside the current Word report on the actual company printer:

- Empty report.
- The photographed sample report.
- Busy report with automatic compaction.
- Long funeral-home and deceased names.
- Multiple merged entries and multiple rush deliveries.
- A section with an entry pinned to the bottom, to confirm the separating rule reads on paper.
- A Cremated card at its new narrower default beside one expanded by a deceased name.

In **Print setup**, enable **Show calibration marks**. All four dashed edges must be visible. Adjust page margin and horizontal/vertical offsets for the company printer, then print the cases again. Do not approve the release if text clips, borders look fuzzy, cards move columns, or the result is worse than the Word document.

The automated print references are written to `test-results/empty-report-page.png`, `test-results/sample-report-page.png`, and `test-results/busy-report-page.png` by the desktop test suite. They verify Chromium rendering, but they do not replace the physical printer comparison.

## Development

Requirements: Windows, Node.js 24+, and pnpm.

```powershell
pnpm install
pnpm verify
pnpm build
pnpm start
pnpm package:portable
```

`pnpm build` writes the directly runnable application to `out`; it also stages the Prisma engine there. `pnpm start` runs that build through the local Electron runtime. `pnpm package:portable` additionally creates a self-contained Windows executable in `release` when a portable handoff is needed. `pnpm verify` runs lint checks, type checking, unit and integration tests, Prisma schema validation, the production build, and Electron desktop tests. Persistence tests use temporary real SQLite databases.

The implementation is separated into:

- `src/domain`: dates, parsing, normalization, merging, duplicate handling, rush ordering, and report types.
- `src/application`: the tonight-report resolver (auto-create/clone/resume), version conflicts, and the serialized mutation queue.
- `src/infrastructure`: SQLite migrations, Prisma repositories, retention, and backups.
- `src/main` and `src/preload`: Electron lifecycle, protected IPC, local data paths, window state, logging, and printing.
- `src/renderer`: the React report controller, workspace state, document studio, contextual inspector, command palette, and shared preview/print component.

Renderer state is split into two contexts. `useReportState` carries values that change (report, layout, save status); `useReportActions` carries an identity-stable set of operations. Components needing only actions — the command palette, for example — therefore never re-render on report changes. `useReportController` remains as a combined shim for older call sites.

## Release notes

- Version 2.5.0 reworks entry handling and the printed sheet. The format toggle offers only the formats each column actually uses — Funeral and Plain for Human Remains; FH only, Count and Combined for Cremated — rather than all five everywhere, though a format the column does not normally offer still appears while editing a row that uses one. A count of one is no longer printed as "x 1", since a bare line already means one; the editable line drops it too, so a row that prints "Reese" opens showing "Reese", and the parser learned to read "A // B" with no trailing count as a combined pair of one so that round-trip stays lossless. Combined rows get more air either side of the //. Ticking Rush now offers a free-text deadline — "by 10:00 AM", "first trip" — printed in place of the bare label as RUSH BY 10:00 AM and stored in a new `rushBy` column that existing databases gain automatically on launch. On the sheet itself: column banners are set in condensed caps rather than the body face at a heavier weight; each section card carries its total counted as people rather than rows, so a card of five lines can report nine remains; a ruled notes block sits at the foot for the day shift's occasional written note; the row hairline is heavier and darker at .75px, chosen from a printed comparison sheet; the body type rises to 10pt with leading, card headers and inline chips moving with it; and the footer carries the time the sheet was printed, so two copies of one night can be told apart. Compaction treats the notes block as its floor rather than the paper's edge, and its tolerance no longer varies with the preview zoom. `node scripts/print-gate.mjs` gains an eighth sheet comparing row hairline weights. **The printed sheet changed substantially in this release and has not yet been through the physical print-quality gate below — run it before deploying.**
- Version 2.4.0 restyles both the application and the printed report. The report's forest and navy columns — a carryover from the first version — separated by only 1.01:1 in greyscale, so on a black-and-white printer the Human/Cremated colour coding conveyed nothing at all; they are now ledger ink and warm stone, which stay 2.64:1 apart with every hue removed while keeping white banner text and card headers above 4.5:1. The interface is light rather than dark, its neutrals desaturated from the document's own ink, and the command bar takes the same ink the page rules its masthead with. Section identity is set in Bahnschrift Condensed and location codes and counts in Cascadia Mono — both Windows system faces, so the app still needs no network. Colour means one thing across the panel and the paper: the channel colour marks where you are, ink marks the field or row being typed in, and red marks rush, replacing six hardcoded greens that had put a green cursor inside a navy Cremated card. Clicking a section card's header now selects it without opening a row for editing, the canvas toolbar reports the entry count and whether the report still fits one page before you print rather than only once it has overflowed, and the date hint reads "Change date" instead of naming the override setting. Four layout and print defects are fixed: the overflow tolerance was measured in screen pixels against a zoomable preview, so it ranged from 0.139in to 0.25in of page space depending on zoom; compaction escalated while print styles were active, when the hidden live page measures as zero height, and could render the printed copy compacted; the first card in each column overlapped its banner by 0.05in while the compacted page instead left a 0.04in gap; and the Human banner spanned the full column, overhanging the cards beneath it. `node scripts/print-gate.mjs` renders all seven cases of the physical print-quality gate below to `print-gate/` with a calibration sheet and a checklist, and runs the checks that do not need paper. This release passed that gate on the company printer.
- Version 2.3.0 fixes the report date rolling over at midnight partway through a shift, and adds a manual date override in the command bar for the nights that land on the wrong day. The override is session-only by design: it changes what the page shows and prints, and reopening the app returns to the clock-derived date.
- Version 2.2.0 removes the report archive, the finalize/lock workflow (and its draft watermark), the far-left section navigator, and 90-day report retention. The app now opens directly into tonight's report — auto-created by cloning the previous report when one exists — and only that single most recent report is retained. Revision history is removed along with finalize (its only trigger); database-backup restore remains, now triggered once per new night's report instead of on finalize.
- Version 2.1.0 removes the First Call Sheet and Cremation Batch workspaces now that their duties moved to a separate program; the app is Night Shift Report only again.
- The Cremation Batch workspace adds automatic rollover numbering, a separate funeral-home directory, temporary non-persistent batch rows, output-specific reprint tracking, A5/C5 calibrated printing, and per-row Brother PT-D610BT label printing through b-PAC.
- Version 2.0.0 simplifies the launch screen and expands First Call directory tools with saved-location type-ahead, favorites, recency ranking, aliases, duplicate review and merging, searchable maintenance, and CSV import/export. TomTom remains an explicit fallback, removes the US `+1` phone prefix, and now supports address-only Residence lookup without saving, caching, logging, backing up, or recommending any residence information. First Call sheets remain entirely temporary.
- Version 1.0.1 adds the canvas context menu and welcome-screen return added after 1.0.0, preserves merged-person grouping during edits, keeps shared special requests round-trip safe, and reliably resets manually widened cards after content is removed.
- Version 1.0.0 adds a frameless window with an integrated title bar and app icon, restored window state, main-process file logging, a Ctrl+K command palette, a read-only report archive, drag-to-reorder with bottom-pinning, and a React architecture pass (split state/actions contexts, memoized preview, deferred canvas rendering). It also recovers drafts stranded when the report date rolls over after midnight. The `pinnedBottom` column is applied automatically to existing databases on launch. The printed report's visual styling was revised — special requests print darker, Cremated funeral-home names are no longer bold when a row carries no deceased name, and Cremated cards start narrower while still expanding for edge cases — so it needs a fresh pass through the physical print-quality gate below.
- Version 0.2.0 introduces the dark document-studio interface, contextual inspector, responsive minimum-width layout, fit/manual preview zoom, consolidated Tools menu, and portal-based accessible overlays. The verified print layout and stored report format are unchanged.
- Email delivery is intentionally deferred from v1. A later version can attach a generated PDF or use a configured email client after company policy and recipient handling are decided.
- The app runs through the installed Electron runtime rather than a packaged executable. Test that company policy allows this launch method on the production computer during the feasibility gate.
- There is no cloud sync, authentication, auto-update system, paid code signing, or separate PDF export library in version 2.0.
