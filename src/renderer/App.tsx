import { useEffect, useMemo, useRef, useState } from "react";

import { MutationQueue } from "@/application/mutationQueue";
import { addEntry, formatEntryLine, moveEntry, normalizeFuneralHome, parsePastedLines, titleCaseName } from "@/domain/entries";
import { REPORT_SECTIONS } from "@/domain/report";
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
import { useOverflowCompaction } from "./hooks/useOverflowCompaction";
import { useEntryForm } from "./hooks/useEntryForm";
import type { EntryKind } from "./hooks/useEntryForm";

function baseEntry() {
  return { id: crypto.randomUUID(), rush: false, keepSeparate: false, createdAt: new Date().toISOString() };
}

function entrySummary(entry: ReportEntry): string {
  // Deliberately terser than formatEntryLine's print-ready text for the funeral case only: the
  // sidebar already lists each deceased person's location code and special request directly
  // beneath this line (see the person-actions rows below), so repeating that detail here would
  // just be noise. Every other entry type has nothing extra to omit, so it delegates to the
  // single canonical formatter instead of re-implementing the same formatting a second time.
  if (entry.type === "funeral") return `${entry.funeralHome} – ${entry.deceased.map((person) => person.name).join(" + ")}`;
  return formatEntryLine(entry);
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [report, setReport] = useState<NightReport | null>(null);
  const [layout, setLayout] = useState<LayoutSettings | null>(null);
  const [status, setStatus] = useState<"loading" | "saved" | "saving" | "error">("loading");
  const [message, setMessage] = useState("");
  const [selectedSection, setSelectedSection] = useState<SectionKey>("human-deliver");
  const { form, setField, setCount, setRush, setKeepSeparate, setEntryKind, reset, loadEntry } = useEntryForm();
  const [pasteText, setPasteText] = useState("");
  const [pasteReview, setPasteReview] = useState<Array<ParsedLine & { include: boolean }> | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDirectory, setShowDirectory] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [calibration, setCalibration] = useState(false);
  const [revisions, setRevisions] = useState<Array<{ id: string; revisionNumber: number; finalizedAt: string }>>([]);
  const queue = useMemo(() => new MutationQueue(), []);
  const versionRef = useRef(0);
  const reportRef = useRef<NightReport | null>(null);
  const layoutRef = useRef<LayoutSettings | null>(null);
  const undoStackRef = useRef<NightReport[]>([]);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const undoRef = useRef<() => void>(() => {});
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
    }).catch((error: Error) => { setStatus("error"); setMessage(error.message); });
    return () => { active = false; };
  }, []);

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
    setUndoAvailable(false);
  }

  function pushUndo(previous: NightReport) {
    undoStackRef.current = [...undoStackRef.current, structuredClone(previous)].slice(-UNDO_HISTORY_LIMIT);
    setUndoAvailable(undoStackRef.current.length > 0);
  }

  function undo() {
    const current = reportRef.current;
    if (!current || current.status !== "draft" || !undoStackRef.current.length) return;
    const stack = undoStackRef.current;
    const previous = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    setUndoAvailable(undoStackRef.current.length > 0);
    void persist(previous);
  }
  undoRef.current = undo;

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditableField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isEditableField || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      undoRef.current();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function persist(next: NightReport) {
    // Every mutating action funnels through here, so this is the single point that captures
    // undo history — a snapshot of what the report looked like right before this change.
    if (reportRef.current) pushUndo(reportRef.current);
    reportRef.current = next;
    setReport(next);
    setStatus("saving");
    setMessage("");
    return queue.enqueue(async () => {
      setStatus("saving");
      const saved = await window.nightShift.saveReport(next, versionRef.current);
      versionRef.current = saved.version;
      setReport((current) => current ? { ...current, version: saved.version } : saved);
      if (reportRef.current) reportRef.current.version = saved.version;
      setStatus("saved");
      await refreshSupportingData();
      return saved;
    }).catch((error: Error) => { setStatus("error"); setMessage(error.message); return null; });
  }

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
    if (form.entryKind === "count") return { ...base, type: "count", text: form.text.trim(), count: Math.max(1, form.count) };
    if (form.entryKind === "combined") return { ...base, type: "combined", leftText: form.text.trim(), rightText: form.rightText.trim(), count: Math.max(1, form.count) };
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
    } catch (error) { setMessage((error as Error).message); }
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
    const saved = await window.nightShift.finalizeReport(current, versionRef.current);
    reportRef.current = saved; setReport(saved); versionRef.current = saved.version; setStatus("saved");
    resetUndoHistory();
    setRevisions(await window.nightShift.listRevisions(saved.id));
    await refreshSupportingData();
  }

  async function reopen() {
    const current = reportRef.current!;
    const saved = await window.nightShift.reopenReport(current, versionRef.current);
    reportRef.current = saved; setReport(saved); versionRef.current = saved.version;
    resetUndoHistory();
    setRevisions(await window.nightShift.listRevisions(saved.id));
  }

  function beginPasteReview() {
    setPasteReview(parsePastedLines(pasteText).map((line) => ({ ...line, include: true })));
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
    if (parseWarning) setMessage(parseWarning);
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
    try { const saved = await window.nightShift.saveLayout(next); layoutRef.current = saved; setLayout(saved); } catch (error) { setMessage((error as Error).message); }
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
          {bootstrap.latestFinalized && <button className="primary" onClick={() => void createDraft("clone")}>New copy from last report</button>}
          <button className={bootstrap.latestFinalized ? "secondary" : "primary"} onClick={() => void createDraft("empty")}>Start empty</button>
        </div>
      </section>
    </main>
  );

  const activeSection = report.sections.find((section) => section.key === selectedSection)!;
  const isDeliver = selectedSection === "human-deliver" || selectedSection === "cremated-deliver";

  return (
    <main className="app-shell">
      <header className="app-header no-print">
        <div><p className="eyebrow">Night operations</p><h1>Night Shift Report</h1></div>
        <div className="header-actions">
          <span className={`save-state ${status}`}>{status === "saving" ? "Saving…" : status === "error" ? "Save error" : "Saved"}</span>
          {report.status === "draft" && <button className="quiet" disabled={!undoAvailable} title="Undo last change (Ctrl+Z)" onClick={undo}>Undo</button>}
          <button className="quiet" onClick={() => setShowDirectory(!showDirectory)}>Funeral homes</button>
          <button className="quiet" onClick={() => setShowRecovery(!showRecovery)}>Recovery</button>
          <button className="quiet" onClick={() => setShowAdvanced(!showAdvanced)}>Print setup</button>
          {report.status === "draft" ? <button className="primary" onClick={() => void finalize()}>Finalize</button> : <button className="secondary" onClick={() => void reopen()}>Reopen</button>}
          <button className="print-button" disabled={overflow} title={overflow ? "Fit the report on one page before printing." : undefined} onClick={() => void window.nightShift.printReport()}>{report.status === "draft" ? "Print draft" : "Print report"}</button>
        </div>
      </header>

      {message && <div className="message-bar no-print">{message}<button onClick={() => setMessage("")}>×</button></div>}
      {overflow && <div className="overflow-warning no-print">Printing is paused because this report still exceeds one page after automatic compaction. Reduce card widths, adjust print scale, or trim entries.</div>}

      <div className="workspace no-print">
        <aside className="editor-panel">
          <section className="panel-section">
            <label>Section<select value={selectedSection} onChange={(event) => {
              const key = event.target.value as SectionKey; setSelectedSection(key);
              reset(key === "cremated-deliver" ? "funeralHomeOnly" : "funeral");
            }}>{REPORT_SECTIONS.map((section) => <option key={section.key} value={section.key}>{section.category === "human" ? "Human" : "Cremated"} — {section.title}</option>)}</select></label>
          </section>

          <form className="entry-form panel-section" onSubmit={submitEntry}>
            <div className="section-heading"><div><p className="eyebrow">{form.editing ? "Editing" : "Add entry"}</p><h2>{activeSection.title}</h2></div>{form.editing && <button type="button" className="text-button" onClick={() => reset()}>Cancel</button>}</div>
            <label>Format<select value={form.entryKind} onChange={(event) => setEntryKind(event.target.value as EntryKind)}>
              <option value="funeral">Funeral home + deceased</option>
              <option value="funeralHomeOnly">Funeral home only</option>
              <option value="count">Simple count</option>
              <option value="combined">Combined line</option>
              <option value="plain">Plain text</option>
            </select></label>
            {(form.entryKind === "funeral" || form.entryKind === "funeralHomeOnly") && <>
              <label>Funeral home<input list="funeral-home-options" value={form.funeralHome} onChange={(event) => setField("funeralHome", event.target.value)} placeholder="Start typing…" /></label>
              <datalist id="funeral-home-options">{bootstrap.funeralHomes.map((home) => <option key={home.id} value={home.name} />)}</datalist>
            </>}
            {form.entryKind === "funeral" && <div className="two-field"><label>Deceased<input value={form.deceasedName} onChange={(event) => setField("deceasedName", event.target.value)} /></label><label>Location / code<input value={form.locationCode} onChange={(event) => setField("locationCode", event.target.value)} placeholder="13A" /></label></div>}
            {form.entryKind === "funeral" && <label>Special request<input value={form.specialRequest} onChange={(event) => setField("specialRequest", event.target.value)} placeholder="Optional — prints bold" /></label>}
            {(form.entryKind === "plain" || form.entryKind === "count" || form.entryKind === "combined") && <label>{form.entryKind === "combined" ? "Left name" : "Text"}<input value={form.text} onChange={(event) => setField("text", event.target.value)} /></label>}
            {form.entryKind === "combined" && <label>Right name<input value={form.rightText} onChange={(event) => setField("rightText", event.target.value)} /></label>}
            {(form.entryKind === "count" || form.entryKind === "combined") && <label>Count<input type="number" min="1" value={form.count} onChange={(event) => setCount(Number(event.target.value))} /></label>}
            {(form.entryKind === "funeral" || form.entryKind === "funeralHomeOnly") && <div className="check-row">{isDeliver && <label><input type="checkbox" checked={form.rush} onChange={(event) => setRush(event.target.checked)} /> Rush — list first</label>}<label><input type="checkbox" checked={form.keepSeparate} onChange={(event) => setKeepSeparate(event.target.checked)} /> Keep as separate line</label></div>}
            <button className="primary full" type="submit">{form.editing ? "Save changes" : "Add to report"}</button>
          </form>

          <section className="panel-section current-entries">
            <div className="section-heading"><div><p className="eyebrow">Current entries</p><h2>{activeSection.entries.length || "None"}</h2></div></div>
            {activeSection.entries.map((entry) => <div className="entry-item" key={entry.id}>
              <div className="entry-item-title">{entry.rush && <span className="rush-pill">Rush</span>}{entrySummary(entry)}</div>
              {entry.type === "funeral" ? <div className="person-actions">{entry.deceased.map((person) => <div key={person.id}><span>{person.name}{person.locationCode && ` (${person.locationCode})`}</span><button onClick={() => loadEntry(entry, person.id)}>Edit</button><button onClick={() => deleteEntry(entry.id, person.id)}>Remove</button></div>)}</div> : <div className="item-actions"><button onClick={() => loadEntry(entry)}>Edit</button><button onClick={() => deleteEntry(entry.id)}>Delete</button></div>}
            </div>)}
          </section>

          <section className="panel-section paste-panel">
            <p className="eyebrow">Quick paste</p><h2>Review multiple lines</h2>
            <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="Paste one entry per line…" rows={4} />
            <button className="secondary full" disabled={!pasteText.trim()} onClick={beginPasteReview}>Review paste</button>
          </section>

          {showAdvanced && <PrintSettings layout={layout} calibration={calibration} onCalibration={setCalibration} onChange={(next) => void saveLayout(next)} onResetSection={() => { const next = { ...layout, sectionWidths: { ...layout.sectionWidths } }; delete next.sectionWidths[selectedSection]; void saveLayout(next); }} />}
          {showDirectory && <FuneralHomeManager homes={bootstrap.funeralHomes} onUpdate={(homes) => setBootstrap({ ...bootstrap, funeralHomes: homes })} />}
          {showRecovery && <RecoveryPanel backups={bootstrap.backups} revisions={revisions} onLoadRevisions={async () => setRevisions(await window.nightShift.listRevisions(report.id))} onRestoreRevision={async (id) => { const restored = await window.nightShift.restoreRevision(report.id, id, versionRef.current); reportRef.current = restored; setReport(restored); versionRef.current = restored.version; resetUndoHistory(); }} />}
        </aside>

        <section className="preview-panel">
          <div className="preview-toolbar"><div><p className="eyebrow">Live print preview</p><span>Click a ruled line to type · 8.5 × 11 in</span></div><span>{report.status === "finalized" ? "Finalized" : "Draft"}</span></div>
          <div className="page-stage"><ReportPage report={report} layout={layout} compactLevel={compactLevel} calibration={calibration} interactive onLineCommit={report.status === "draft" ? commitPreviewLine : undefined} onEntryMove={report.status === "draft" ? movePreviewEntry : undefined} onWidthChange={(key, width) => setLayout((current) => { if (!current) return current; const next = { ...current, sectionWidths: { ...current.sectionWidths, [key]: width } }; layoutRef.current = next; return next; })} onWidthCommit={(key, width) => { const current = layoutRef.current; if (current) void saveLayout({ ...current, sectionWidths: { ...current.sectionWidths, [key]: width } }); }} /></div>
        </section>
      </div>

      <div className="print-only"><ReportPage report={report} layout={layout} compactLevel={compactLevel} calibration={calibration} /></div>

      {pasteReview && <div className="modal-backdrop no-print"><section className="modal"><div className="modal-header"><div><p className="eyebrow">Paste review</p><h2>Confirm parsed entries</h2></div><button onClick={() => setPasteReview(null)}>×</button></div><div className="review-list">{pasteReview.map((line, index) => <label className="review-row" key={`${line.source}-${index}`}><input type="checkbox" checked={line.include} onChange={(event) => setPasteReview((current) => current!.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, include: event.target.checked } : candidate))} /><span><strong>{line.entry.type}</strong>{entrySummary(line.entry)}{line.warning && <em>{line.warning}</em>}</span></label>)}</div><div className="modal-actions"><button className="secondary" onClick={() => setPasteReview(null)}>Cancel</button><button className="primary" onClick={commitPaste}>Add selected lines</button></div></section></div>}
    </main>
  );
}
