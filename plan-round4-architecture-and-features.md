# Night Shift Report — Round 4: React Architecture + Archive and Command Palette

Rounds 2 and 3 were about how the editor looks and how its components are organized. Those landed: the brand ramp, semantic tones, motion scale, custom scrollbars, reduced-motion support, the `ui/` component library, the section navigator, and the document-studio shell are all in. The CSS layer is in good shape and this round barely touches it.

What's left is underneath. The renderer is styled like a modern app but wired like an older one: one monolithic context that invalidates on every keystroke, nothing memoized, a manual selection-sync effect in the Inspector, and none of React 19's actual features in use despite being on 19.2. This round fixes that, and then adds the two features that benefit most from the fix.

As always: no changes to `ReportPage`'s print path, `@media print`, the domain layer, or the stored report format. The physical print-quality gate is unaffected.

## Part 1 — React architecture

### 1.1 Split `ReportController` into state and actions contexts

`ReportController.tsx:249–256` assembles a fresh value object on every render. Because that object is the context value, every consumer of `useReportController()` re-renders whenever anything in the controller changes — including the entire `ReportPage` and all of its rows, on every keystroke.

There is already a correct pattern in this repo to copy: `WorkspaceContext` exposes `useWorkspaceState` and `useWorkspaceDispatch` separately. `ReportController` should follow the same convention rather than inventing a second one.

- **`ReportStateContext`** — `bootstrap`, `report`, `layout`, `status`, `lastSavedAt`, `calibration`, `revisions`, `undoAvailable`, `redoAvailable`, `compactLevel`, `overflow`.
- **`ReportActionsContext`** — `createDraft`, `persist`, `undo`, `redo`, `finalize`, `reopen`, `saveLayout`, `previewLayout`, `setCalibration`, `setRevisions`, `updateFuneralHomes`, `refreshSupportingData`, `restoreRevision`, `canonicalFuneralHome`.

The actions object must be identity-stable — `useMemo` with an empty dependency list, with each action reading current values through the refs that already exist (`reportRef`, `versionRef`, `layoutRef`). Two call out for care:

- `canonicalFuneralHome` closes over `bootstrap`, so it needs a `bootstrapRef` to stay stable.
- `undo`/`redo` are already mirrored into `undoRef`/`redoRef` by a dep-less effect at `146–149` purely so the keyboard handler can reach them. Once the actions object is stable, that mirroring is redundant and the effect can go.

Keep `useReportController()` as a thin shim that reads both contexts, so call sites migrate incrementally instead of in one large diff. Remove it once `Studio`, `Inspector`, and `PreviewCanvas` have moved over.

### 1.2 Memoize the render-heavy path

With the context split in place, the expensive subtree stops re-rendering for unrelated reasons. Two additions finish the job:

- `React.memo` on `ReportPage`, `SectionCard`, and `EntryLine`.
- `useDeferredValue` on the report handed to `PreviewCanvas`, so typing in the Inspector stays responsive while the page catches up a frame later.

The `structuredClone(report)` on every edit stays — it's what makes undo and the mutation queue correct. The point is that its cost stops being felt on the typing path.

### 1.3 Replace the Inspector's manual selection sync with a `key`

`Inspector.tsx:33–54` keeps a `selectionRef` and a `syncRef`, rebuilds a string key each render, compares it against the previous one, and calls `reset` or `loadEntry` accordingly — plus a dep-less effect at `38–40` whose only job is keeping `syncRef` fresh. This is the "adjust state when props change" pattern that React's docs specifically recommend against.

The idiomatic replacement is to derive that same string and pass it as `key` to `EntryForm`, letting React remount the form on selection change. That deletes both refs, both effects, and the comparison logic.

### 1.4 Adopt React 19 where it genuinely fits

Three places, in descending order of confidence:

- **`useActionState` for the entry form.** `Inspector.tsx:93–106` is a hand-rolled `submitEntry` with try/catch that converts thrown validation errors into toasts. React 19 form actions model exactly this, with pending and error state built in.
- **`useTransition` for layout and zoom updates**, marking them non-urgent so they never compete with typing.
- **`useOptimistic` for adding entries**, so a new entry paints immediately and rolls back if the save fails.

`useOptimistic` is the one to treat carefully and do last — it interacts with both the `MutationQueue` and the undo stack, and getting rollback wrong there means a report that disagrees with what's on disk. I'd call this item optional and worth deferring until 1.1–1.3 are stable.

## Part 2 — Archive browser (read-only)

Reports are retained 90 days, and `PrismaReportRepository.findByDate` already exists (`prismaRepository.ts:80`) — it simply isn't exposed over IPC. Today the only ways to reach an older report are cloning the single latest finalized one, or a destructive whole-database backup restore that relaunches the app. A read-only archive closes that gap cheaply.

**Scope: view and reprint only.** No editing, no cloning into tonight's draft. Finalized reports stay immutable, which is the guarantee the revision system is built on.

**New IPC**, matching the existing zod-validated `handle()` style in `main/index.ts`:

- `report:list` — report date, status, and entry count, ordered newest first, within the retention window.
- `report:load` — a single report by id.

**UI.** `workspace.utility` is currently `"directory" | "recovery" | "print" | null`; it gains `"archive"`. The existing `Drawer` renders it, so there is no new overlay machinery — just a dated list, and a selected report rendered through the non-interactive `ReportPage` path that print preview already uses.

**One design detail worth deciding during implementation:** `report:print` prints `mainWindow.webContents`, which prints whatever currently occupies `.print-only`. Reprinting an archived report therefore means temporarily swapping what `.print-only` renders, then restoring it. Worth handling explicitly so a reprint can never leave the wrong report staged for the next print.

## Part 3 — Command palette

`Ctrl+K` opens a portal-based overlay reusing the existing `useDialogSurface` hook, so focus trapping and escape handling match the other overlays.

**Scope: navigation plus safe actions.** Jump to any of the nine sections; open Funeral homes, Recovery, Print setup, or Archive; toggle the inspector; undo; redo; print; reset zoom to fit. **Finalize and reopen are deliberately excluded** — they're the two state-changing operations where firing by muscle memory would be genuinely annoying to walk back.

The command list is assembled from the actions context in 1.1 plus the static section list, so there's exactly one definition of what the app can do rather than a registry that drifts from the toolbar.

The new keyboard handler has to coexist with the existing `Ctrl+Z`/`Ctrl+Y` listener at `ReportController.tsx:151–167`, and should reuse its guard against firing while focus is in an input, textarea, or contenteditable.

## Part 4 — Component tests

`@testing-library/react` is already a dependency but no editor component has a test. Three UI rewrites have now landed on this code with only the domain and application suites underneath them. This round adds a first layer:

- The palette: opens on `Ctrl+K`, filters, executes the selected command, closes on escape, and does not fire while typing in a field.
- The archive: lists reports, renders a selected one read-only, and restores print staging afterward.
- The contexts: actions keep a stable identity across state changes — the property the whole refactor depends on, and the one most likely to regress silently.

## Part 5 — Shell and OS integration

Everything above happens inside the window. This part is about the window itself, which is what you see before you see any of it. The security posture in `main/index.ts` is already strong — `contextIsolation`, `sandbox`, `nodeIntegration: false`, a `validateSender` guard on every IPC call, `will-navigate` prevented, and a window-open handler that denies everything non-https. None of that changes. What's missing is presentation and durability.

- **App icon.** `electron-builder.yml` has no `icon:` field, so packaged builds ship the default Electron logo in the taskbar, alt-tab, window corner, and Explorer. Generate a multi-resolution `.ico` from the existing "NS" brand mark and the `--brand-600` green already used on the start screen, wire it into both `BrowserWindow` and the builder config.
- **Frameless window with a custom titlebar.** `createWindow` currently takes the stock Windows chrome, which sits as a light bar directly above the dark `#080b10` studio. Switch to `frame: false` and promote `CommandBar` into the titlebar: an `-webkit-app-region: drag` region across the empty space, `no-drag` on every interactive control inside it, and minimize/maximize/close buttons on the right driven by new IPC. Maximize must toggle to a restore icon and the window needs a `maximized` class so the shell can drop its rounded corners when snapped.
- **`backgroundColor`.** With no value set, launch flashes white before first paint against a near-black UI. Set it to the `--studio-bg` value.
- **Remove the default menu.** `Menu.setApplicationMenu(null)` — the stock File/Edit/View/Window/Help bar with a Toggle DevTools item currently ships in packaged builds.
- **Window state persistence.** Size and position reset to a hardcoded 1500×960 every launch. Persist bounds and maximized state to the existing `userData` directory and restore on open, validating that the saved bounds still land on an attached display.
- **File logging.** The `console.error` in the post-finalize maintenance block (`main/index.ts:110`) goes nowhere once packaged. Write main-process errors to a rotating log under `%LOCALAPPDATA%\Night Shift Report\logs` so there's a trail when something fails overnight.

Deliberately still out of scope: code signing and auto-update. Both are real, but they're distribution decisions rather than application work, and neither blocks anything above.

## Sequencing

1. **Context split (1.1)** — no visible change; the existing 43-test suite is the safety net.
2. **Memo and deferred value (1.2)** — still no visible change, now measurable.
3. **Inspector `key` refactor (1.3)** — deletes code rather than adding it.
4. **Archive browser (2)** — first new surface, smallest risk, mostly new IPC.
5. **Command palette (3)** — depends on 1.1 for its action registry.
6. **Shell and OS integration (5)** — independent of 1–5, and the largest perceived jump.
7. **Tests (4)** — written alongside 4, 5, and 6, not after.
8. **React 19 adoption (1.4)** — optional, last, `useOptimistic` only if the rest is stable.

Steps 1–3 are pure refactors that should leave every existing test green without modification. If any test needs changing during those steps, that's a signal the refactor changed behavior and is worth stopping on.

## Explicit non-goals for this round

- Light theme and the remaining hex-literal cleanup — deliberately deferred.
- Code signing and auto-update — distribution decisions, not application work.
- Any change to the print CSS, the domain layer, or the stored report format.
