# Night Shift Report

A local, print-first Windows application for preparing the nightly Human Remains and Cremated Remains report. The report date is always the next local calendar day, data stays on the computer, and every finalized report is retained as an immutable revision.

The same executable also includes a separate **First Call Sheet** workspace. It reproduces the supplied paper form, defaults the call date and Taken By fields, derives the deceased last name, and can remember verified funeral-home and facility details. First Call sheets are temporary and are never archived. When Place of Death is set to **Residence**, its name, address, and phone remain only in the current in-memory sheet and are never searched, saved, backed up, or recovered.

## Use the portable app

1. Double-click `Night Shift Report Portable 1.0.1.exe`.
2. Choose **Start empty**, or clone the latest finalized report when one exists.
3. Choose a section from the left report navigator, then add or edit entries in the inspector immediately beside it. The live canvas sits to the right; you can also click any ruled line there to type directly. Press **Enter** or click away to save; press **Escape** to cancel.
4. As you type, an Auto-width card expands immediately to fit the line. Funeral-home and deceased names typed in lowercase are capitalized automatically when saved.
5. Drag an existing entry onto another card to move it. Moving into Deliver also applies its merge and Rush-first rules.
6. Drag an entry onto another entry to reorder it: the row you drop on moves down. Drop onto a blank row past the last entry to **pin** the entry to the bottom of that section — useful for a line that belongs to the section but sits apart from its list, like a road trip in Deliver. A pinned entry stays at the bottom as new entries are added; drag it back up to unpin it. In the Deliver sections Rush entries still hold the top, and your manual order is kept within the Rush and non-Rush groups.
7. Use **Paste** in the inspector to add multiple entries through the required review screen.
8. Use the canvas Fit and zoom controls to adjust the on-screen view without changing the printed report. Drag a card's small right-edge handle to set its print width.
9. Press **Ctrl+K** to open the command palette. Type to jump to any section or run a command — undo, redo, print, open a tools panel, or toggle the inspector. Arrow keys move, Enter runs, Escape closes. Finalize and Reopen are intentionally excluded so they can't fire from a fuzzy match.
10. Open **Tools** > **Print setup** to show calibration marks, reset a card width to Auto, or tune margin, scale, and printer offsets.
11. Open **Tools** > **Report archive** to view or reprint any retained report. The archive is read-only; finalized reports stay immutable.
12. Finalize the report when it is ready. Draft prints intentionally carry a watermark.
13. Choose **Print report** and select the company printer or Microsoft Print to PDF.

For a First Call Sheet, choose **First Call Sheet** on the start screen or **First Call** in the report toolbar. Choose Facility to use the saved directory and optional confirmed TomTom lookup, or Residence to keep all location details temporary. Paste a free TomTom API key once in the Online search panel; Windows protects the saved key. The preview toolbar can fit or zoom the canvas without changing physical print size. Select printed wording to apply one of five temporary highlight colors; checked options can highlight their matching labels automatically. Fill directly on the page, use the separate First Call calibration controls for the company printer, and choose **Print sheet**. Printing leaves the sheet open; **New sheet** clears it after confirmation.

Undo and redo are also bound to **Ctrl+Z** and **Ctrl+Y**, and are ignored while the cursor is in a text field.

A report is named for the next calendar day, so that name changes at midnight — partway through a shift. If the app is restarted after midnight there is no report yet for the new date, and the start screen offers **Resume that report** for the draft begun earlier in the same shift rather than leaving it stranded. Resuming opens it unchanged; nothing is written until the next edit.

The app stores its database, backups, logs, and window state in `%LOCALAPPDATA%\Night Shift Report`. Reports are retained for 90 days; database backups are retained for 14 days. **Recovery** can restore finalized revisions or retained backups. Main-process errors are written to `logs\main-<date>.log`, which is the first place to look if something fails overnight.

The window is frameless: the dark command bar is also the title bar, with its own minimize, maximize, and close controls at the right. Window size, position, and maximized state are restored on next launch.

## Moving to another computer

- For ordinary use, copy only `release\Night Shift Report Portable 1.0.1.exe`. It includes the application runtime and does not require Node.js, pnpm, or `node_modules`.
- For continued development, move or copy the source project without `node_modules`, then run `pnpm install` in its new location. Dependencies are generated for the current project path and computer and should not be treated as project files.
- Report data is not stored beside the executable. To transfer existing reports, close the app and separately copy `%LOCALAPPDATA%\Night Shift Report` to the same location on the destination computer.

## Physical print-quality gate

Before expanding or deploying the editor further, print and compare these cases beside the current Word report on the actual company printer:

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
pnpm package:portable
```

`pnpm verify` runs formatting/lint checks, type checking, unit and integration tests, Prisma schema validation, the production build, and Electron desktop tests. Persistence tests use temporary real SQLite databases.

The implementation is separated into:

- `src/domain`: dates, parsing, normalization, merging, duplicate handling, rush ordering, and report types.
- `src/application`: workflows, version conflicts, revisions, and the serialized mutation queue.
- `src/infrastructure`: SQLite migrations, Prisma repositories, retention, backups, and recovery.
- `src/main` and `src/preload`: Electron lifecycle, protected IPC, portable data paths, window state, logging, and printing.
- `src/renderer`: the React report controller, workspace state, document studio, contextual inspector, command palette, archive, and shared preview/print component.

Renderer state is split into two contexts. `useReportState` carries values that change (report, layout, save status); `useReportActions` carries an identity-stable set of operations. Components needing only actions — the command palette, for example — therefore never re-render on report changes. `useReportController` remains as a combined shim for older call sites.

## Release notes

- Version 1.0.1 adds the canvas context menu and welcome-screen return added after 1.0.0, preserves merged-person grouping during edits, keeps shared special requests round-trip safe, and reliably resets manually widened cards after content is removed.
- Version 1.0.0 adds a frameless window with an integrated title bar and app icon, restored window state, main-process file logging, a Ctrl+K command palette, a read-only report archive, drag-to-reorder with bottom-pinning, and a React architecture pass (split state/actions contexts, memoized preview, deferred canvas rendering). It also recovers drafts stranded when the report date rolls over after midnight. The `pinnedBottom` column is applied automatically to existing databases on launch. The printed report's visual styling was revised — special requests print darker, Cremated funeral-home names are no longer bold when a row carries no deceased name, and Cremated cards start narrower while still expanding for edge cases — so it needs a fresh pass through the physical print-quality gate below.
- Version 0.2.0 introduces the dark document-studio interface, contextual inspector, responsive minimum-width layout, fit/manual preview zoom, consolidated Tools menu, and portal-based accessible overlays. The verified print layout and stored report format are unchanged.
- Email delivery is intentionally deferred from v1. A later version can attach a generated PDF or use a configured email client after company policy and recipient handling are decided.
- The executable is unsigned. Windows or company policy may warn or block it; test that explicitly on the company computer during the feasibility gate.
- There is no cloud sync, authentication, archive browser, auto-update system, or separate PDF export library in v1.
