# Night Shift Report

A local, print-first Windows application for preparing the nightly Human Remains and Cremated Remains report. The report date is always the next local calendar day, data stays on the computer, and every finalized report is retained as an immutable revision.

The same application also includes a separate **First Call Sheet** workspace. It reproduces the supplied paper form, defaults the call date and Taken By fields, derives the deceased last name, and can remember verified funeral-home and facility details. The sheet in progress is saved automatically and reopens exactly as it was left; it is never archived or versioned, and it clears for good only when you start a new one. When Place of Death is set to **Residence**, that carve-out still holds: only an explicitly submitted address search is sent to TomTom, and the app never saves, caches, recommends, logs, backs up, or recovers the residence query or result, even though the rest of the sheet now persists.

It also includes a **Cremation Batch** workspace for A5 certificates, C5 envelopes, and Brother PT-D610BT labels. Batch rows and deceased names are saved automatically and reopen exactly as left; they stay only until you choose **Clear batch**. The explicitly managed cremation funeral-home directory, the confirmed final sequence number, and certificate/envelope calibration remain separate, deliberate saves of their own.

## Use the built app

1. Double-click `Start Night Shift Report.bat` in the production folder.
2. Choose **Open Night Shift Report**, resume an unfinished report, or continue from the latest finalized report when one exists.
3. Choose a section from the left report navigator, then add or edit entries in the inspector immediately beside it. The live canvas sits to the right; you can also click any ruled line there to type directly. Press **Enter** or **Tab** to save and continue in the next blank line, click away to save and stop, or press **Escape** to cancel.
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

For a First Call Sheet, choose **New First Call Sheet** on the start screen or **First Call** in the report toolbar. Saved funeral homes and facilities appear as ranked suggestions while typing, including aliases and abbreviations; favorites and recently used locations appear first. Use **Search TomTom** only when a saved match does not fit, then review the result before applying or saving it. A Residence address may also be searched explicitly, but it remains temporary and never enters the directory or lookup cache, saved sheet, or backups. Use **Manage directories** for editing, favorites, aliases, merging, deletion, and CSV import/export. Paste a free TomTom API key once; Windows protects it and the key controls then collapse into the TomTom settings menu. The preview toolbar can fit or zoom the canvas without changing physical print size. Select printed wording to apply one of five temporary highlight colors; checked options can highlight their matching labels automatically. Fill directly on the page, use the separate First Call calibration controls for the company printer, and choose **Print sheet**. Printing leaves the sheet open and saved; **New sheet** clears it for good after confirmation.

For cremations, choose **New Cremation Batch** on the start screen or **Cremation Batch** in the report toolbar. On first use, enter the starting number as `major-middle-final` (for example, `6-063-37`). Press Enter after a complete row to create the next row automatically; the final segment runs from `01` through `38`, then the middle segment advances. Editing any number recalculates every following row. Choosing a saved funeral home fills its City / State when available; that field remains optional for unknown or out-of-state locations. The full name prints on the certificate, while the editable first-and-last version prints on the envelope and label. Certificate, envelope, and label jobs can run in any order across all selected rows, and the selection stays together until all three outputs have printed. Completed rows then clear their selection automatically, while later rows start selected for a separate batch. Edits mark affected output as **Needs reprint**. The batch itself is saved automatically as you go; at the end choose **Save final number** so the next batch continues the sequence, and use **Clear batch** whenever you're ready to remove the saved rows for good.

Brother label printing requires the 64-bit b-PAC 3 component, the PT-D610BT Windows driver, and the printer connected by USB. The `out` build includes the 12 mm laminated-white template and b-PAC bridge. The template uses a centered BRU 18 pt bold first-and-last name, a rounded double-line frame, automatic length, large margins, one copy, and an automatic cut. P-touch Editor is optional at runtime but is useful if the template needs to be revised later.

Undo and redo are also bound to **Ctrl+Z** and **Ctrl+Y**, and are ignored while the cursor is in a text field.

A report is named for the next calendar day, so that name changes at midnight — partway through a shift. If the app is restarted after midnight there is no report yet for the new date, and the start screen offers **Resume unfinished report** for the draft begun earlier in the same shift rather than leaving it stranded. Resuming opens it unchanged; nothing is written until the next edit.

The app stores its database, backups, logs, and window state in `%LOCALAPPDATA%\Night Shift Report`. Reports are retained for 90 days; database backups are retained for 14 days. **Recovery** can restore finalized revisions or retained backups. Main-process errors are written to `logs\main-<date>.log`, which is the first place to look if something fails overnight.

The window is frameless: the dark command bar is also the title bar, with its own minimize, maximize, and close controls at the right. Window size, position, and maximized state are restored on next launch.

## Moving to another computer

- One-time production setup: copy the contents of `production-runtime` to a permanent folder on the production computer, open a terminal there, and run `pnpm install --prod`. Then copy the laptop's built `out` folder into that same folder. This installs only Electron in `node_modules`; Node.js and pnpm are needed for setup, but the launcher calls Electron directly afterward.
- Build updates on the laptop with `pnpm build`. Close the production app, replace only its `out` folder with the newly built `out` folder, and relaunch it with `Start Night Shift Report.bat`. No installer or compression step is involved.
- Copy the entire `out` folder as one unit. It contains the application, Prisma query engine, and cremation printing resources that belong to that build.
- Repeat the one-time dependency setup whenever the Electron version in `production-runtime/package.json` changes. Ordinary application updates only require `out`.
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
- A5 cremation certificate alignment against the preprinted stock, printed through the PowerShell/.NET print engine (not Electron's print dialog) with a printer and paper source/tray saved in the Printer tab.
- C5 envelope orientation and separate X/Y/scale calibration, same print engine.
- Certificate/envelope printing on a fresh machine: confirm PowerShell's execution policy doesn't block `resources/cremation/print-cremation.ps1`, and that the configured tray actually feeds the right stock.
- A large certificate/envelope batch, to confirm the print timeout scales with batch size instead of cutting off partway through.
- PT-D610BT tape recognition, automatic length, one label, and one cut per selected cremation.

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

`pnpm build` writes the directly runnable application to `out`; it also stages the Prisma engine and print resources there. `pnpm start` runs that build through the local Electron runtime. `pnpm package:portable` additionally creates a self-contained Windows executable in `release` when a portable handoff is needed. `pnpm verify` runs lint checks, type checking, unit and integration tests, Prisma schema validation, the production build, and Electron desktop tests. Persistence tests use temporary real SQLite databases.

The implementation is separated into:

- `src/domain`: dates, parsing, normalization, merging, duplicate handling, rush ordering, and report types.
- `src/application`: workflows, version conflicts, revisions, and the serialized mutation queue.
- `src/infrastructure`: SQLite migrations, Prisma repositories, retention, backups, and recovery.
- `src/main` and `src/preload`: Electron lifecycle, protected IPC, local data paths, window state, logging, and printing.
- `src/renderer`: the React report controller, workspace state, document studio, contextual inspector, command palette, archive, and shared preview/print component.

Renderer state is split into two contexts. `useReportState` carries values that change (report, layout, save status); `useReportActions` carries an identity-stable set of operations. Components needing only actions — the command palette, for example — therefore never re-render on report changes. `useReportController` remains as a combined shim for older call sites.

## Release notes

- The Cremation Batch workspace adds automatic rollover numbering, a separate funeral-home directory, temporary non-persistent batch rows, output-specific reprint tracking, A5/C5 calibrated printing, and per-row Brother PT-D610BT label printing through b-PAC.
- Version 2.0.0 simplifies the launch screen and expands First Call directory tools with saved-location type-ahead, favorites, recency ranking, aliases, duplicate review and merging, searchable maintenance, and CSV import/export. TomTom remains an explicit fallback, removes the US `+1` phone prefix, and now supports address-only Residence lookup without saving, caching, logging, backing up, or recommending any residence information. First Call sheets remain entirely temporary.
- Version 1.0.1 adds the canvas context menu and welcome-screen return added after 1.0.0, preserves merged-person grouping during edits, keeps shared special requests round-trip safe, and reliably resets manually widened cards after content is removed.
- Version 1.0.0 adds a frameless window with an integrated title bar and app icon, restored window state, main-process file logging, a Ctrl+K command palette, a read-only report archive, drag-to-reorder with bottom-pinning, and a React architecture pass (split state/actions contexts, memoized preview, deferred canvas rendering). It also recovers drafts stranded when the report date rolls over after midnight. The `pinnedBottom` column is applied automatically to existing databases on launch. The printed report's visual styling was revised — special requests print darker, Cremated funeral-home names are no longer bold when a row carries no deceased name, and Cremated cards start narrower while still expanding for edge cases — so it needs a fresh pass through the physical print-quality gate below.
- Version 0.2.0 introduces the dark document-studio interface, contextual inspector, responsive minimum-width layout, fit/manual preview zoom, consolidated Tools menu, and portal-based accessible overlays. The verified print layout and stored report format are unchanged.
- Email delivery is intentionally deferred from v1. A later version can attach a generated PDF or use a configured email client after company policy and recipient handling are decided.
- The app runs through the installed Electron runtime rather than a packaged executable. Test that company policy allows this launch method on the production computer during the feasibility gate.
- There is no cloud sync, authentication, auto-update system, paid code signing, or separate PDF export library in version 2.0.
