import { useEffect, useMemo, useRef, useState } from "react";

import { MutationQueue } from "@/application/mutationQueue";
import { addEntry, moveEntry, normalizeFuneralHome, parsePastedLines, titleCaseName } from "@/domain/entries";
import { REPORT_SECTIONS } from "@/domain/report";
import type {
  LayoutSettings,
  NightReport,
  ParsedLine,
  ReportEntry,
  SectionKey,
} from "@/domain/types";
import type { BackupSummary, BootstrapData, FuneralHomeOption } from "@/shared/contracts";
import { ReportPage } from "./components/ReportPage";

type EntryKind = ReportEntry["type"];
type EditingTarget = { entryId: string; personId?: string } | null;

function baseEntry() {
  return { id: crypto.randomUUID(), rush: false, keepSeparate: false, createdAt: new Date().toISOString() };
}

function entrySummary(entry: ReportEntry): string {
  if (entry.type === "funeral") return `${entry.funeralHome} – ${entry.deceased.map((person) => person.name).join(" + ")}`;
  if (entry.type === "funeralHomeOnly") return entry.funeralHome;
  if (entry.type === "count") return `${entry.text} x ${entry.count}`;
  if (entry.type === "combined") return `${entry.leftText} // ${entry.rightText} x ${entry.count}`;
  return entry.text;
}

function formatBytes(size: number) {
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [report, setReport] = useState<NightReport | null>(null);
  const [layout, setLayout] = useState<LayoutSettings | null>(null);
  const [status, setStatus] = useState<"loading" | "saved" | "saving" | "error">("loading");
  const [message, setMessage] = useState("");
  const [selectedSection, setSelectedSection] = useState<SectionKey>("human-deliver");
  const [entryKind, setEntryKind] = useState<EntryKind>("funeral");
  const [funeralHome, setFuneralHome] = useState("");
  const [deceasedName, setDeceasedName] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [specialRequest, setSpecialRequest] = useState("");
  const [text, setText] = useState("");
  const [rightText, setRightText] = useState("");
  const [count, setCount] = useState(1);
  const [rush, setRush] = useState(false);
  const [keepSeparate, setKeepSeparate] = useState(false);
  const [editing, setEditing] = useState<EditingTarget>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteReview, setPasteReview] = useState<Array<ParsedLine & { include: boolean }> | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDirectory, setShowDirectory] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [calibration, setCalibration] = useState(false);
  const [compaction, setCompaction] = useState<{ key: string; level: 0 | 1 | 2 }>({ key: "", level: 0 });
  const [overflow, setOverflow] = useState(false);
  const [revisions, setRevisions] = useState<Array<{ id: string; revisionNumber: number; finalizedAt: string }>>([]);
  const queue = useMemo(() => new MutationQueue(), []);
  const versionRef = useRef(0);
  const reportRef = useRef<NightReport | null>(null);
  const layoutRef = useRef<LayoutSettings | null>(null);
  const compactionKey = useMemo(() => JSON.stringify({
    sections: report?.sections,
    margin: layout?.marginInches,
    scale: layout?.scale,
    offsetY: layout?.offsetYInches,
  }), [report?.sections, layout?.marginInches, layout?.scale, layout?.offsetYInches]);
  const compactLevel = compaction.key === compactionKey ? compaction.level : 0;

  useEffect(() => {
    let active = true;
    window.nightShift.bootstrap().then((data) => {
      if (!active) return;
      setBootstrap(data);
      setReport(data.report);
      reportRef.current = data.report;
      versionRef.current = data.report?.version ?? 0;
      setLayout(data.layout);
      layoutRef.current = data.layout;
      setStatus("saved");
    }).catch((error: Error) => { setStatus("error"); setMessage(error.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".page-stage .report-page");
    const content = page?.querySelector<HTMLElement>(".report-content");
    const columns = page ? [...page.querySelectorAll<HTMLElement>(".report-column")] : [];
    if (!page || !content) return;
    const check = () => {
      const contentBottom = Math.max(content.getBoundingClientRect().bottom, ...columns.map((column) => column.getBoundingClientRect().bottom));
      const exceedsPage = contentBottom > page.getBoundingClientRect().bottom - 12;
      if (exceedsPage && compactLevel < 2) {
        setCompaction({ key: compactionKey, level: (compactLevel + 1) as 1 | 2 });
        setOverflow(false);
      } else {
        setOverflow(exceedsPage);
      }
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(content);
    columns.forEach((column) => observer.observe(column));
    return () => observer.disconnect();
  }, [report, layout, compactLevel, compactionKey]);

  function resetForm() {
    setFuneralHome(""); setDeceasedName(""); setLocationCode(""); setSpecialRequest("");
    setText(""); setRightText(""); setCount(1); setRush(false); setKeepSeparate(false); setEditing(null);
  }

  function canonicalFuneralHome(value: string) {
    const clean = titleCaseName(value);
    return bootstrap?.funeralHomes.find((home) => normalizeFuneralHome(home.name) === normalizeFuneralHome(clean))?.name ?? clean;
  }

  async function refreshSupportingData() {
    const data = await window.nightShift.bootstrap();
    setBootstrap((current) => current ? { ...current, funeralHomes: data.funeralHomes, backups: data.backups } : data);
  }

  function persist(next: NightReport) {
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
  }

  function buildEntry(): ReportEntry {
    const base = { ...baseEntry(), rush, keepSeparate };
    if (entryKind === "funeral") {
      if (!funeralHome.trim() || !deceasedName.trim()) throw new Error("Funeral home and deceased name are required.");
      return { ...base, type: "funeral", funeralHome: canonicalFuneralHome(funeralHome), deceased: [{ id: crypto.randomUUID(), name: titleCaseName(deceasedName), locationCode: locationCode.trim(), specialRequest: specialRequest.trim() }] };
    }
    if (entryKind === "funeralHomeOnly") {
      if (!funeralHome.trim()) throw new Error("Funeral home is required.");
      return { ...base, type: "funeralHomeOnly", funeralHome: canonicalFuneralHome(funeralHome) };
    }
    if (entryKind === "count") return { ...base, type: "count", text: text.trim(), count: Math.max(1, count) };
    if (entryKind === "combined") return { ...base, type: "combined", leftText: text.trim(), rightText: rightText.trim(), count: Math.max(1, count) };
    return { ...base, type: "plain", text: text.trim() };
  }

  function removeEditingTarget(next: NightReport) {
    if (!editing) return;
    for (const section of next.sections) {
      const entryIndex = section.entries.findIndex((entry) => entry.id === editing.entryId);
      if (entryIndex < 0) continue;
      const entry = section.entries[entryIndex];
      if (entry.type === "funeral" && editing.personId) {
        entry.deceased = entry.deceased.filter((person) => person.id !== editing.personId);
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
      resetForm();
    } catch (error) { setMessage((error as Error).message); }
  }

  function beginEdit(entry: ReportEntry, personId?: string) {
    setEditing({ entryId: entry.id, personId });
    if (entry.type === "funeral") {
      const person = entry.deceased.find((candidate) => candidate.id === personId) ?? entry.deceased[0];
      setEntryKind("funeral"); setFuneralHome(entry.funeralHome); setDeceasedName(person.name); setLocationCode(person.locationCode); setSpecialRequest(person.specialRequest); setRush(entry.rush); setKeepSeparate(entry.keepSeparate);
    } else if (entry.type === "funeralHomeOnly") {
      setEntryKind("funeralHomeOnly"); setFuneralHome(entry.funeralHome); setRush(entry.rush); setKeepSeparate(entry.keepSeparate);
    } else if (entry.type === "combined") {
      setEntryKind("combined"); setText(entry.leftText); setRightText(entry.rightText); setCount(entry.count);
    } else if (entry.type === "count") {
      setEntryKind("count"); setText(entry.text); setCount(entry.count);
    } else { setEntryKind("plain"); setText(entry.text); }
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
    setRevisions(await window.nightShift.listRevisions(saved.id));
    await refreshSupportingData();
  }

  async function reopen() {
    const current = reportRef.current!;
    const saved = await window.nightShift.reopenReport(current, versionRef.current);
    reportRef.current = saved; setReport(saved); versionRef.current = saved.version;
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
    if (clean) {
      let parsed = parsePastedLines(clean)[0].entry;
      if (parsed.type === "plain" && (sectionKey === "cremated-deliver" || existing?.type === "funeralHomeOnly")) {
        parsed = { ...parsed, type: "funeralHomeOnly", funeralHome: canonicalFuneralHome(parsed.text) };
      }
      if (parsed.type === "funeral" || parsed.type === "funeralHomeOnly") parsed.funeralHome = canonicalFuneralHome(parsed.funeralHome);
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
              const key = event.target.value as SectionKey; setSelectedSection(key); resetForm();
              setEntryKind(key === "cremated-deliver" ? "funeralHomeOnly" : "funeral");
            }}>{REPORT_SECTIONS.map((section) => <option key={section.key} value={section.key}>{section.category === "human" ? "Human" : "Cremated"} — {section.title}</option>)}</select></label>
          </section>

          <form className="entry-form panel-section" onSubmit={submitEntry}>
            <div className="section-heading"><div><p className="eyebrow">{editing ? "Editing" : "Add entry"}</p><h2>{activeSection.title}</h2></div>{editing && <button type="button" className="text-button" onClick={resetForm}>Cancel</button>}</div>
            <label>Format<select value={entryKind} onChange={(event) => setEntryKind(event.target.value as EntryKind)}>
              <option value="funeral">Funeral home + deceased</option>
              <option value="funeralHomeOnly">Funeral home only</option>
              <option value="count">Simple count</option>
              <option value="combined">Combined line</option>
              <option value="plain">Plain text</option>
            </select></label>
            {(entryKind === "funeral" || entryKind === "funeralHomeOnly") && <>
              <label>Funeral home<input list="funeral-home-options" value={funeralHome} onChange={(event) => setFuneralHome(event.target.value)} placeholder="Start typing…" /></label>
              <datalist id="funeral-home-options">{bootstrap.funeralHomes.map((home) => <option key={home.id} value={home.name} />)}</datalist>
            </>}
            {entryKind === "funeral" && <div className="two-field"><label>Deceased<input value={deceasedName} onChange={(event) => setDeceasedName(event.target.value)} /></label><label>Location / code<input value={locationCode} onChange={(event) => setLocationCode(event.target.value)} placeholder="13A" /></label></div>}
            {entryKind === "funeral" && <label>Special request<input value={specialRequest} onChange={(event) => setSpecialRequest(event.target.value)} placeholder="Optional — prints bold" /></label>}
            {(entryKind === "plain" || entryKind === "count" || entryKind === "combined") && <label>{entryKind === "combined" ? "Left name" : "Text"}<input value={text} onChange={(event) => setText(event.target.value)} /></label>}
            {entryKind === "combined" && <label>Right name<input value={rightText} onChange={(event) => setRightText(event.target.value)} /></label>}
            {(entryKind === "count" || entryKind === "combined") && <label>Count<input type="number" min="1" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>}
            {(entryKind === "funeral" || entryKind === "funeralHomeOnly") && <div className="check-row">{isDeliver && <label><input type="checkbox" checked={rush} onChange={(event) => setRush(event.target.checked)} /> Rush — list first</label>}<label><input type="checkbox" checked={keepSeparate} onChange={(event) => setKeepSeparate(event.target.checked)} /> Keep as separate line</label></div>}
            <button className="primary full" type="submit">{editing ? "Save changes" : "Add to report"}</button>
          </form>

          <section className="panel-section current-entries">
            <div className="section-heading"><div><p className="eyebrow">Current entries</p><h2>{activeSection.entries.length || "None"}</h2></div></div>
            {activeSection.entries.map((entry) => <div className="entry-item" key={entry.id}>
              <div className="entry-item-title">{entry.rush && <span className="rush-pill">Rush</span>}{entrySummary(entry)}</div>
              {entry.type === "funeral" ? <div className="person-actions">{entry.deceased.map((person) => <div key={person.id}><span>{person.name}{person.locationCode && ` (${person.locationCode})`}</span><button onClick={() => beginEdit(entry, person.id)}>Edit</button><button onClick={() => deleteEntry(entry.id, person.id)}>Remove</button></div>)}</div> : <div className="item-actions"><button onClick={() => beginEdit(entry)}>Edit</button><button onClick={() => deleteEntry(entry.id)}>Delete</button></div>}
            </div>)}
          </section>

          <section className="panel-section paste-panel">
            <p className="eyebrow">Quick paste</p><h2>Review multiple lines</h2>
            <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="Paste one entry per line…" rows={4} />
            <button className="secondary full" disabled={!pasteText.trim()} onClick={beginPasteReview}>Review paste</button>
          </section>

          {showAdvanced && <PrintSettings layout={layout} calibration={calibration} onCalibration={setCalibration} onChange={(next) => void saveLayout(next)} onResetSection={() => { const next = { ...layout, sectionWidths: { ...layout.sectionWidths } }; delete next.sectionWidths[selectedSection]; void saveLayout(next); }} />}
          {showDirectory && <FuneralHomeManager homes={bootstrap.funeralHomes} onUpdate={(homes) => setBootstrap({ ...bootstrap, funeralHomes: homes })} />}
          {showRecovery && <RecoveryPanel backups={bootstrap.backups} revisions={revisions} onLoadRevisions={async () => setRevisions(await window.nightShift.listRevisions(report.id))} onRestoreRevision={async (id) => { const restored = await window.nightShift.restoreRevision(report.id, id, versionRef.current); reportRef.current = restored; setReport(restored); versionRef.current = restored.version; }} />}
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

function PrintSettings({ layout, calibration, onCalibration, onChange, onResetSection }: { layout: LayoutSettings; calibration: boolean; onCalibration: (value: boolean) => void; onChange: (layout: LayoutSettings) => void; onResetSection: () => void }) {
  return <section className="panel-section settings-panel"><p className="eyebrow">Advanced print setup</p><h2>Printer calibration</h2>
    <label>Page margin ({layout.marginInches.toFixed(2)} in)<input type="range" min="0.2" max="0.6" step="0.01" value={layout.marginInches} onChange={(event) => onChange({ ...layout, marginInches: Number(event.target.value) })} /></label>
    <label>Content scale ({Math.round(layout.scale * 100)}%)<input type="range" min="0.8" max="1.05" step="0.01" value={layout.scale} onChange={(event) => onChange({ ...layout, scale: Number(event.target.value) })} /></label>
    <div className="two-field"><label>Horizontal offset<input type="number" min="-0.5" max="0.5" step="0.01" value={layout.offsetXInches} onChange={(event) => onChange({ ...layout, offsetXInches: Number(event.target.value) })} /></label><label>Vertical offset<input type="number" min="-0.5" max="0.5" step="0.01" value={layout.offsetYInches} onChange={(event) => onChange({ ...layout, offsetYInches: Number(event.target.value) })} /></label></div>
    <label className="switch-row"><input type="checkbox" checked={calibration} onChange={(event) => onCalibration(event.target.checked)} /> Show calibration marks</label>
    <button className="secondary full" onClick={onResetSection}>Reset selected card width to Auto</button>
  </section>;
}

function FuneralHomeManager({ homes, onUpdate }: { homes: FuneralHomeOption[]; onUpdate: (homes: FuneralHomeOption[]) => void }) {
  const [source, setSource] = useState(""); const [target, setTarget] = useState("");
  return <section className="panel-section settings-panel"><p className="eyebrow">Directory</p><h2>Learned funeral homes</h2>{homes.length === 0 && <p className="muted">Names will appear here after entries are saved.</p>}{homes.map((home) => <div className="directory-row" key={home.id}><input defaultValue={home.name} onBlur={(event) => { if (event.target.value.trim() !== home.name) void window.nightShift.renameFuneralHome(home.id, event.target.value).then(onUpdate); }} /><button onClick={() => void window.nightShift.deleteFuneralHome(home.id).then(onUpdate)}>Remove</button></div>)}
    {homes.length > 1 && <div className="merge-box"><label>Merge<select value={source} onChange={(event) => setSource(event.target.value)}><option value="">Choose…</option>{homes.map((home) => <option value={home.id} key={home.id}>{home.name}</option>)}</select></label><label>Into<select value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Choose…</option>{homes.filter((home) => home.id !== source).map((home) => <option value={home.id} key={home.id}>{home.name}</option>)}</select></label><button className="secondary" disabled={!source || !target} onClick={() => void window.nightShift.mergeFuneralHomes(source, target).then(onUpdate)}>Merge</button></div>}
  </section>;
}

function RecoveryPanel({ backups, revisions, onLoadRevisions, onRestoreRevision }: { backups: BackupSummary[]; revisions: Array<{ id: string; revisionNumber: number; finalizedAt: string }>; onLoadRevisions: () => void; onRestoreRevision: (id: string) => void }) {
  return <section className="panel-section settings-panel"><p className="eyebrow">Recovery</p><h2>Revisions and backups</h2><button className="secondary full" onClick={onLoadRevisions}>Load report revisions</button>{revisions.map((revision) => <div className="recovery-row" key={revision.id}><span>Revision {revision.revisionNumber}<small>{new Date(revision.finalizedAt).toLocaleString()}</small></span><button onClick={() => onRestoreRevision(revision.id)}>Restore</button></div>)}<h3>Database backups</h3>{backups.map((backup) => <div className="recovery-row" key={backup.name}><span>{new Date(backup.createdAt).toLocaleString()}<small>{formatBytes(backup.size)}</small></span><button onClick={() => { if (confirm("Restore this backup and restart the app?")) void window.nightShift.restoreBackup(backup.name); }}>Restore</button></div>)}</section>;
}
