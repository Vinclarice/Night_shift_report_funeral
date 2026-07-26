# Night Shift Report

A local, print-first Windows application for preparing the nightly Human Remains and Cremated Remains report. The report date is always the next local calendar day, data stays on the computer, and every finalized report is retained as an immutable revision.

## Use the portable app

1. Double-click `Night Shift Report Portable 0.2.0.exe`.
2. Choose **Start empty**, or clone the latest finalized report when one exists.
3. Choose a section from the left report navigator. Add or edit entries in the contextual inspector on the right, or click any ruled line in the live canvas to type directly. Press **Enter** or click away to save; press **Escape** to cancel.
4. As you type, an Auto-width card expands immediately to fit the line. Funeral-home and deceased names typed in lowercase are capitalized automatically when saved.
5. Drag an existing entry onto another card to move it. Moving into Deliver also applies its merge and Rush-first rules.
6. Use **Paste** in the inspector to add multiple entries through the required review screen.
7. Use the canvas Fit and zoom controls to adjust the on-screen view without changing the printed report. Drag a card's small right-edge handle to set its print width.
8. Open **Tools** > **Print setup** to show calibration marks, reset a card width to Auto, or tune margin, scale, and printer offsets.
9. Finalize the report when it is ready. Draft prints intentionally carry a watermark.
10. Choose **Print report** and select the company printer or Microsoft Print to PDF.

The app stores its database and backups in `%LOCALAPPDATA%\Night Shift Report`. Reports are retained for 90 days; database backups are retained for 14 days. **Recovery** can restore finalized revisions or retained backups.

## Moving to another computer

- For ordinary use, copy only `release\Night Shift Report Portable 0.2.0.exe`. It includes the application runtime and does not require Node.js, pnpm, or `node_modules`.
- For continued development, move or copy the source project without `node_modules`, then run `pnpm install` in its new location. Dependencies are generated for the current project path and computer and should not be treated as project files.
- Report data is not stored beside the executable. To transfer existing reports, close the app and separately copy `%LOCALAPPDATA%\Night Shift Report` to the same location on the destination computer.

## Physical print-quality gate

Before expanding or deploying the editor further, print and compare these cases beside the current Word report on the actual company printer:

- Empty report.
- The photographed sample report.
- Busy report with automatic compaction.
- Long funeral-home and deceased names.
- Multiple merged entries and multiple rush deliveries.

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
- `src/main` and `src/preload`: Electron lifecycle, protected IPC, portable data paths, and printing.
- `src/renderer`: the React report controller, workspace state, document studio, contextual inspector, and shared preview/print component.

## Release notes

- Version 0.2.0 introduces the dark document-studio interface, contextual inspector, responsive minimum-width layout, fit/manual preview zoom, consolidated Tools menu, and portal-based accessible overlays. The verified print layout and stored report format are unchanged.
- Email delivery is intentionally deferred from v1. A later version can attach a generated PDF or use a configured email client after company policy and recipient handling are decided.
- The executable is unsigned. Windows or company policy may warn or block it; test that explicitly on the company computer during the feasibility gate.
- There is no cloud sync, authentication, archive browser, auto-update system, or separate PDF export library in v1.
