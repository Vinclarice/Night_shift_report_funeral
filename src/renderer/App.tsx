import { useEffect, useMemo, useRef, useState } from "react";

import { MutationQueue } from "@/application/mutationQueue";
import { addEntry, moveEntry, normalizeFuneralHome, parsePastedLines, titleCaseName } from "@/domain/entries";
import type {
  LayoutSettings,
  NightReport,
  ParsedLine,
  ReportEntry,
  SectionKey,
} from "@/domain/types";
import type { BootstrapData } from "@/shared/contracts";
import { ReportPage } from "./components/ReportPage";
import { PrintSettings } from "./components/PrintSettings";
import { FuneralHomeManager } from "./components/FuneralHomeManager";
import { RecoveryPanel } from "./components/RecoveryPanel";
import { PasteReviewModal } from "./components/PasteReviewModal";
import { EntryForm } from "./components/EntryForm";
import { SectionNav } from "./components/SectionNav";
import { useOverflowCompaction } from "./hooks/useOverflowCompaction";
import { useEntryForm } from "./hooks/useEntryForm";
import { entrySummary } from "./entrySummary";
import { IconBuilding, IconCheck, IconHistory, IconPencil, IconPrinter, IconRedo, IconSliders, IconTrash, IconUndo } from "./icons";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Drawer } from "./ui/Drawer";
import { IconButton } from "./ui/IconButton";
import { ToastProvider, useToast } from "./ui/Toast";

type DrawerKey = "directory" | "recovery" | "print" | null;

function baseEntry() {
  return { id: crypto.randomUUID(), rush: false, keepSeparate: false, createdAt: new Date().toISOString() };
}

// Wraps the real app in ToastProvider so every notification (including render(<App/>) in tests)
// has somewhere to go, without every consumer needing to remember to mount the provider.
export function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

function AppContent() {
  const toast = useToast();
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [report, setReport] = useState<NightReport | null>(null);
  const [layout, setLayout] = useState<LayoutSettings | null>(null);
  const [status, setStatus] = useState<"loading" | "saved" | "saving" | "error">("loading");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [selectedSection, setSelectedSection] = useState<SectionKey>("human-deliver");
  const { form, setField, setCount, setRush, setKeepSeparate, setEntryKind, reset, loadEntry } = useEntryForm();
  const [pasteText, setPasteText] = useState("");
  const [pasteReview, setPasteReview] = useState<Array<ParsedLine & { include: boolean }> | null>(null);
  const [activeDrawer, setActiveDrawer] = useState<DrawerKey>(null);
  const [calibration, setCalibration] = useState(false);
  const [revisions, setRevisions] = useState<Array<{ id: string; revisionNumber: number; finalizedAt: string }>>([]);
  const queue = useMemo(() => new MutationQueue(), []);
  const versionRef = useRef(0);
  const reportRef = useRef<NightReport | null>(null);
  const layoutRef = useRef<LayoutSettings | null>(null);
  const undoStackRef = useRef<NightReport[]>([]);
  const redoStackRef = useRef<NightReport[]>([]);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [redoAvailable, setRedoAvailable] = useState(false);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const { compactLevel, overflow } = useOverflowCompaction(report, layout);

  useEffect(() => {
    let active = true;
    window.nightShift.bootstrap().then((data) => {
      if (!active) return;
      setBootstrap(data);
      setReport(data.report);
      reportRef.current = data.report;
      versionRef.current = data.report?.version ?? 0;
      resetUndoHistory();
      setLayout(data.layout);
      layoutRef.current = data.layout;
      setStatus("saved");
    }).catch((error: Error) => { setStatus("error"); toast.error(error.message); });
    return () => { active = false; };
    // toast's identity is stable for the lifetime of the provider, so this still only runs once.
  }, [toast]);

  function canonicalFuneralHome(value: string) {
    const clean = titleCaseName(value);
    return bootstrap?.funeralHomes.find((home) => normalizeFuneralHome(home.name) === normalizeFuneralHome(clean))?.name ?? clean;
  }

  async function refreshSupportingData() {
    const data = await window.nightShift.bootstrap();
    setBootstrap((current) => current ? { ...current, funeralHomes: data.funeralHomes, backups: data.backups } : data);
  }

  const UNDO_HISTORY_LIMIT = 15;

  function resetUndoHistory() {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoAvailable(false);
    setRedoAvailable(false);
  }

  // Applies a report without touching undo/redo history. persist() (below) uses this after it
  // has already recorded history for a genuine edit; undo()/redo() use it directly, since they
  // manage the two stacks themselves and must not re-record onto the stack they just popped from.
  function applyReport(next: NightReport) {
    reportRef.current = next;
    setReport(next);
    setStatus("saving");
    return queue.enqueue(async () => {
      setStatus("saving");
      const saved = await window.nightShift.saveReport(next, versionRef.current);
      versionRef.current = saved.version;
      setReport((current) => current ? { ...current, version: saved.version } : saved);
      if (reportRef.current) reportRef.current.version = saved.version;
      setStatus("saved");
      setLastSavedAt(new Date());
      await refreshSupportingData();
      return saved;
    }).catch((error: Error) => { setStatus("error"); toast.error(error.message); return null; });
  }

  function persist(next: NightReport) {
    // Every mutating action except undo/redo themselves funnels through here: it records the
    // pre-edit state on the undo stack and clears any redo branch, matching standard undo/redo
    // semantics — making a fresh edit after undoing abandons the old "future" you undid away from.
    if (reportRef.current) {
      undoStackRef.current = [...undoStackRef.current, structuredClone(reportRef.current)].slice(-UNDO_HISTORY_LIMIT);
      setUndoAvailable(true);
    }
    redoStackRef.current = [];
    setRedoAvailable(false);
    return applyReport(next);
  }

  function undo() {
    const current = reportRef.current;
    if (!current || current.status !== "draft" || !undoStackRef.current.length) return;
    const stack = undoStackRef.current;
    const previous = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    setUndoAvailable(undoStackRef.current.length > 0);
    redoStackRef.current = [...redoStackRef.current, structuredClone(current)].slice(-UNDO_HISTORY_LIMIT);
    setRedoAvailable(true);
    void applyReport(previous);
  }
  undoRef.current = undo;

  function redo() {
    const current = reportRef.current;
    if (!current || current.status !== "draft" || !redoStackRef.current.length) return;
    const stack = redoStackRef.current;
    const next = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    setRedoAvailable(redoStackRef.current.length > 0);
    undoStackRef.current = [...undoStackRef.current, structuredClone(current)].slice(-UNDO_HISTORY_LIMIT);
    setUndoAvailable(true);
    void applyReport(next);
  }
  redoRef.current = redo;

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditableField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isEditableField || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoRef.current();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redoRef.current();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function createDraft(mode: "empty" | "clone") {
    setStatus("saving");
    const created = await window.nightShift.createDraft(mode);
    setReport(created); reportRef.current = created; versionRef.current = created.version; setStatus("saved");
    resetUndoHistory();
  }

  function buildEntry(): ReportEntry {
    const base = { ...baseEntry(), rush: form.rush, keepSeparate: form.keepSeparate };
    if (form.entryKind === "funeral") {
      if (!form.funeralHome.trim() || !form.deceasedName.trim()) throw new Error("Funeral home and deceased name are required.");
      return { ...base, type: "funeral", funeralHome: canonicalFuneralHome(form.funeralHome), deceased: [{ id: crypto.randomUUID(), name: titleCaseName(form.deceasedName), locationCode: form.locationCode.trim(), specialRequest: form.specialRequest.trim() }] };
    }
    if (form.entryKind === "funeralHomeOnly") {
      if (!form.funeralHome.trim()) throw new Error("Funeral home is required.");
      return { ...base, type: "funeralHomeOnly", funeralHome: canonicalFuneralHome(form.funeralHome) };
    }
    if (form.entryKind === "count") {
      if (!form.text.trim()) throw new Error("Text is required.");
      if (!Number.isFinite(form.count) || form.count < 1) throw new Error("Count must be a positive number.");
      return { ...base, type: "count", text: form.text.trim(), count: Math.round(form.count) };
    }
    if (form.entryKind === "combined") {
      if (!form.text.trim() || !form.rightText.trim()) throw new Error("Left and right text are both required.");
      if (!Number.isFinite(form.count) || form.count < 1) throw new Error("Count must be a positive number.");
      return { ...base, type: "combined", leftText: form.text.trim(), rightText: form.rightText.trim(), count: Math.round(form.count) };
    }
    if (!form.text.trim()) throw new Error("Text is required.");
    return { ...base, type: "plain", text: form.text.trim() };
  }

  function removeEditingTarget(next: NightReport) {
    if (!form.editing) return;
    for (const section of next.sections) {
      const entryIndex = section.entries.findIndex((entry) => entry.id === form.editing!.entryId);
      if (entryIndex < 0) continue;
      const entry = section.entries[entryIndex];
      if (entry.type === "funeral" && form.editing.personId) {
        entry.deceased = entry.deceased.filter((person) => person.id !== form.editing!.personId);
        if (!entry.deceased.length) section.entries.splice(entryIndex, 1);
      } else section.entries.splice(entryIndex, 1);
    }
  }

  function submitEntry(event: React.FormEvent) {
    event.preventDefault();
    try {
      const entry = buildEntry();
      const next = structuredClone(reportRef.current!);
      removeEditingTarget(next);
      const section = next.sections.find((item) => item.key === selectedSection)!;
      addEntry(section, entry);
      void persist(next);
      reset();
    } catch (error) { toast.warning((error as Error).message); }
  }

  function deleteEntry(entryId: string, personId?: string) {
    const next = structuredClone(reportRef.current!);
    const section = next.sections.find((item) => item.key === selectedSection)!;
    const index = section.entries.findIndex((entry) => entry.id === entryId);
    if (index < 0) return;
    const entry = section.entries[index];
    if (entry.type === "funeral" && personId) {
      entry.deceased = entry.deceased.filter((person) => person.id !== personId);
      if (!entry.deceased.length) section.entries.splice(index, 1);
    } else section.entries.splice(index, 1);
    void persist(next);
  }

  async function finalize() {
    await queue.drain();
    const current = reportRef.current!;
    setStatus("saving");
    try {
      const saved = await window.nightShift.finalizeReport(current, versionRef.current);
      reportRef.current = saved; setReport(saved); versionRef.current = saved.version; setStatus("saved");
      resetUndoHistory();
      setRevisions(await window.nightShift.listRevisions(saved.id));
      await refreshSupportingData();
    } catch (error) {
      setStatus("error");
      toast.error((error as Error).message);
    }
  }

  async function reopen() {
    const current = reportRef.current!;
    setStatus("saving");
    try {
      const saved = await window.nightShift.reopenReport(current, versionRef.current);
      reportRef.current = saved; setReport(saved); versionRef.current = saved.version;
      setStatus("saved");
      resetUndoHistory();
      setRevisions(await window.nightShift.listRevisions(saved.id));
    } catch (error) {
      setStatus("error");
      toast.error((error as Error).message);
    }
  }

  function beginPasteReview() {
    setPasteReview(parsePastedLines(pasteText).map((line) => ({ ...line, include: true })));
  }

  function togglePasteLine(index: number, include: boolean) {
    setPasteReview((current) => current!.map((candidate, itemIndex) => (itemIndex === index ? { ...candidate, include } : candidate)));
  }

  function commitPaste() {
    const next = structuredClone(reportRef.current!);
    const section = next.sections.find((item) => item.key === selectedSection)!;
    for (const line of pasteReview ?? []) if (line.include) addEntry(section, line.entry);
    void persist(next); setPasteReview(null); setPasteText("");
  }

  function commitPreviewLine(sectionKey: SectionKey, entryId: string | null, value: string) {
    const current = reportRef.current;
    if (!current || current.status !== "draft") return;
    const next = structuredClone(current);
    const section = next.sections.find((item) => item.key === sectionKey)!;
    const existingIndex = entryId ? section.entries.findIndex((entry) => entry.id === entryId) : -1;
    const existing = existingIndex >= 0 ? section.entries[existingIndex] : null;
    if (existingIndex >= 0) section.entries.splice(existingIndex, 1);

    const clean = value.trim();
    let parseWarning: string | undefined;
    if (clean) {
      const parsedLine = parsePastedLines(clean)[0];
      let parsed = parsedLine.entry;
      if (parsed.type === "plain" && (sectionKey === "cremated-deliver" || existing?.type === "funeralHomeOnly")) {
        parsed = { ...parsed, type: "funeralHomeOnly", funeralHome: canonicalFuneralHome(parsed.text) };
      }
      if (parsed.type === "funeral" || parsed.type === "funeralHomeOnly") parsed.funeralHome = canonicalFuneralHome(parsed.funeralHome);
      // Only surface the parser's warning if the line is still ambiguous plain text after the
      // section-specific coercions above; a successful funeral/funeralHomeOnly reinterpretation
      // means it was resolved, not left for review.
      if (parsed.type === "plain") parseWarning = parsedLine.warning;
      if (existing) {
        parsed = {
          ...parsed,
          id: existing.id,
          createdAt: existing.createdAt,
          rush: existing.rush || parsed.rush,
          keepSeparate: existing.keepSeparate,
        };
      }
      addEntry(section, parsed);
    }

    setSelectedSection(sectionKey);
    void persist(next);
    if (parseWarning) toast.warning(parseWarning);
  }

  function movePreviewEntry(sourceKey: SectionKey, targetKey: SectionKey, entryId: string) {
    const current = reportRef.current;
    if (!current || current.status !== "draft") return;
    const next = structuredClone(current);
    if (!moveEntry(next, sourceKey, targetKey, entryId)) return;
    setSelectedSection(targetKey);
    void persist(next);
  }

  async function saveLayout(next: LayoutSettings) {
    setLayout(next);
    layoutRef.current = next;
    try { const saved = await window.nightShift.saveLayout(next); layoutRef.current = saved; setLayout(saved); } catch (error) { toast.warning((error as Error).message); }
  }

  if (!bootstrap || !layout) return <main className="loading-screen"><div className="loading-card"><span className="spinner" />Preparing tonight’s report…</div></main>;

  if (!report) return (
    <main className="start-screen">
      <section className="start-card">
        <div className="brand-mark">NS</div>
        <p className="eyebrow">Night operations</p>
        <h1>Start tonight’s report</h1>
        <p>The report date is calculated automatically. Begin empty or carry forward the most recent finalized report.</p>
        <div className="start-actions">
          {bootstrap.latestFinalized && <Button variant="primary" onClick={() => void createDraft("clone")}>New copy from last report</Button>}
          <Button variant={bootstrap.latestFinalized ? "secondary" : "primary"} onClick={() => void createDraft("empty")}>Start empty</Button>
        </div>
      </section>
    </main>
  );

  const activeSection = report.sections.find((section) => section.key === selectedSection)!;
  const isDeliver = selectedSection === "human-deliver" || selectedSection === "cremated-deliver";
  const drawerTitle = activeDrawer === "directory" ? "Funeral homes" : activeDrawer === "recovery" ? "Recovery" : "Print setup";

  return (
    <main className="app-shell">
      <header className="app-header no-print">
        <div><p className="eyebrow">Night operations</p><h1>Night Shift Report</h1></div>
        <div className="header-actions">
          <Badge
            key={status}
            className="save-state"
            tone={status === "saved" ? "success" : status === "saving" ? "warning" : "danger"}
            dot
            role="status"
            aria-live="polite"
            title={lastSavedAt ? `Last saved ${lastSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : undefined}
          >
            {status === "saving" ? "Saving…" : status === "error" ? "Save error" : "Saved"}
            {status === "saved" && lastSavedAt && (
              <span className="save-timestamp"> · {lastSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            )}
          </Badge>

          {report.status === "draft" && (
            <div className="undo-redo-group">
              <Button variant="quiet" icon={<IconUndo />} disabled={!undoAvailable} title="Undo last change (Ctrl+Z)" onClick={undo}>Undo</Button>
              <Button variant="quiet" icon={<IconRedo />} disabled={!redoAvailable} title="Redo (Ctrl+Y)" onClick={redo}>Redo</Button>
            </div>
          )}

          <div className="header-divider" aria-hidden="true" />

          <div className="header-tools" role="group" aria-label="Panels">
            <Button variant="quiet" icon={<IconBuilding />} aria-pressed={activeDrawer === "directory"} onClick={() => setActiveDrawer(activeDrawer === "directory" ? null : "directory")}>Funeral homes</Button>
            <Button variant="quiet" icon={<IconHistory />} aria-pressed={activeDrawer === "recovery"} onClick={() => setActiveDrawer(activeDrawer === "recovery" ? null : "recovery")}>Recovery</Button>
            <Button variant="quiet" icon={<IconSliders />} aria-pressed={activeDrawer === "print"} onClick={() => setActiveDrawer(activeDrawer === "print" ? null : "print")}>Print setup</Button>
          </div>

          <div className="header-divider" aria-hidden="true" />

          <div className="header-primary">
            {report.status === "draft"
              ? <Button variant="primary" icon={<IconCheck />} disabled={status === "saving"} onClick={() => void finalize()}>Finalize</Button>
              : <Button variant="secondary" disabled={status === "saving"} onClick={() => void reopen()}>Reopen</Button>}
            <Button variant="print" icon={<IconPrinter />} disabled={overflow} title={overflow ? "Fit the report on one page before printing." : undefined} onClick={() => void window.nightShift.printReport()}>
              {report.status === "draft" ? "Print draft" : "Print report"}
            </Button>
          </div>
        </div>
      </header>

      {overflow && <div className="overflow-warning no-print">Printing is paused because this report still exceeds one page after automatic compaction. Reduce card widths, adjust print scale, or trim entries.</div>}

      <div className="workspace no-print">
        <aside className="editor-panel">
          <SectionNav
            report={report}
            selected={selectedSection}
            onSelect={(key) => {
              setSelectedSection(key);
              reset(key === "cremated-deliver" ? "funeralHomeOnly" : "funeral");
            }}
          />

          <EntryForm
            form={form}
            activeSectionTitle={activeSection.title}
            isDeliver={isDeliver}
            funeralHomes={bootstrap.funeralHomes}
            setField={setField}
            setCount={setCount}
            setRush={setRush}
            setKeepSeparate={setKeepSeparate}
            setEntryKind={setEntryKind}
            reset={reset}
            onSubmit={submitEntry}
          />

          <section className="panel-section current-entries">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Current entries</p>
                {activeSection.entries.length ? <h2>{activeSection.entries.length}</h2> : <p className="empty-hint">No entries yet — add one above.</p>}
              </div>
            </div>
            {activeSection.entries.map((entry) => (
              <Card className="entry-item" hoverable key={entry.id}>
                <div className="entry-item-title">
                  {entry.rush && <Badge tone="danger" className="rush-pill">Rush</Badge>}
                  {entrySummary(entry)}
                </div>
                {entry.type === "funeral" ? (
                  <div className="person-actions">
                    {entry.deceased.map((person) => (
                      <div key={person.id}>
                        <span>{person.name}{person.locationCode && ` (${person.locationCode})`}</span>
                        <IconButton icon={<IconPencil />} aria-label={`Edit ${person.name}`} title="Edit" onClick={() => loadEntry(entry, person.id)} />
                        <IconButton icon={<IconTrash />} tone="danger" aria-label={`Remove ${person.name}`} title="Remove" onClick={() => deleteEntry(entry.id, person.id)} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="item-actions">
                    <IconButton icon={<IconPencil />} aria-label="Edit entry" title="Edit" onClick={() => loadEntry(entry)} />
                    <IconButton icon={<IconTrash />} tone="danger" aria-label="Delete entry" title="Delete" onClick={() => deleteEntry(entry.id)} />
                  </div>
                )}
              </Card>
            ))}
          </section>

          <section className="panel-section paste-panel">
            <p className="eyebrow">Quick paste</p><h2>Review multiple lines</h2>
            <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="Paste one entry per line…" rows={4} />
            <Button variant="secondary" full disabled={!pasteText.trim()} onClick={beginPasteReview}>Review paste</Button>
          </section>
        </aside>

        <section className={`preview-panel ${report.status}`}>
          <div className="preview-toolbar">
            <div><p className="eyebrow">Live print preview</p><span>Click a ruled line to type · 8.5 × 11 in</span></div>
            <Badge tone={report.status === "finalized" ? "success" : "warning"} dot className="status-badge">{report.status === "finalized" ? "Finalized" : "Draft"}</Badge>
          </div>
          <div className="page-stage">
            <div className="page-stage-frame">
              <ReportPage
                report={report}
                layout={layout}
                compactLevel={compactLevel}
                calibration={calibration}
                interactive
                onLineCommit={report.status === "draft" ? commitPreviewLine : undefined}
                onEntryMove={report.status === "draft" ? movePreviewEntry : undefined}
                onWidthChange={(key, width) => setLayout((current) => { if (!current) return current; const next = { ...current, sectionWidths: { ...current.sectionWidths, [key]: width } }; layoutRef.current = next; return next; })}
                onWidthCommit={(key, width) => { const current = layoutRef.current; if (current) void saveLayout({ ...current, sectionWidths: { ...current.sectionWidths, [key]: width } }); }}
              />
            </div>
          </div>
        </section>
      </div>

      <div className="print-only"><ReportPage report={report} layout={layout} compactLevel={compactLevel} calibration={calibration} /></div>

      <Drawer open={activeDrawer !== null} title={drawerTitle} onClose={() => setActiveDrawer(null)}>
        {activeDrawer === "directory" && (
          <FuneralHomeManager homes={bootstrap.funeralHomes} onUpdate={(homes) => setBootstrap({ ...bootstrap, funeralHomes: homes })} />
        )}
        {activeDrawer === "recovery" && (
          <RecoveryPanel
            backups={bootstrap.backups}
            revisions={revisions}
            onLoadRevisions={async () => setRevisions(await window.nightShift.listRevisions(report.id))}
            onRestoreRevision={async (id) => { const restored = await window.nightShift.restoreRevision(report.id, id, versionRef.current); reportRef.current = restored; setReport(restored); versionRef.current = restored.version; resetUndoHistory(); }}
          />
        )}
        {activeDrawer === "print" && (
          <PrintSettings
            layout={layout}
            calibration={calibration}
            onCalibration={setCalibration}
            onChange={(next) => void saveLayout(next)}
            onResetSection={() => { const next = { ...layout, sectionWidths: { ...layout.sectionWidths } }; delete next.sectionWidths[selectedSection]; void saveLayout(next); }}
          />
        )}
      </Drawer>

      {pasteReview && (
        <PasteReviewModal lines={pasteReview} onToggle={togglePasteLine} onCancel={() => setPasteReview(null)} onConfirm={commitPaste} />
      )}
    </main>
  );
}
