import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { formatEntryLine } from "@/domain/entries";
import type { LayoutSettings, NightReport, ReportEntry, ReportSection } from "@/domain/types";

interface Props {
  report: NightReport;
  layout: LayoutSettings;
  compactLevel?: 0 | 1;
  calibration?: boolean;
  interactive?: boolean;
  onWidthChange?: (key: ReportSection["key"], width: number) => void;
  onWidthCommit?: (key: ReportSection["key"], width: number) => void;
  onLineCommit?: (key: ReportSection["key"], entryId: string | null, value: string) => void;
  onEntryMove?: (sourceKey: ReportSection["key"], targetKey: ReportSection["key"], entryId: string) => void;
}

const THREE_FREE_ROW_SECTIONS = new Set<ReportSection["key"]>([
  "human-deliver",
  "human-fdp",
  "human-pending",
  "human-ship-outs",
]);

function displayDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
    .format(new Date(year, month - 1, day))
    .toUpperCase();
}

function EntryLine({ entry }: { entry: ReportEntry }) {
  if (entry.type === "funeral") {
    return (
      <>
        <strong>{entry.funeralHome}</strong>
        {" – "}
        {entry.deceased.map((person, index) => (
          <span key={person.id}>
            {index > 0 && " + "}
            {person.name}
            {person.locationCode && ` (${person.locationCode})`}
            {person.specialRequest && <strong>{` (${person.specialRequest.toUpperCase()})`}</strong>}
          </span>
        ))}
      </>
    );
  }
  if (entry.type === "funeralHomeOnly") {
    return (
      <>
        <strong>{entry.funeralHome}</strong>
        {entry.rush && <strong> (RUSH DELIVERY)</strong>}
      </>
    );
  }
  if (entry.type === "count") return <>{entry.text} x {entry.count}</>;
  if (entry.type === "combined") return <>{entry.leftText} // {entry.rightText} x {entry.count}</>;
  return <>{entry.text}</>;
}

function EditableReportRow({ section, entry, onLineCommit, autoWidth, freeRowIndex = 0, onEntryMove }: { section: ReportSection; entry?: ReportEntry; onLineCommit: NonNullable<Props["onLineCommit"]>; autoWidth: boolean; freeRowIndex?: number; onEntryMove?: Props["onEntryMove"] }) {
  const original = entry ? formatEntryLine(entry) : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(original);
  const inputRef = useRef<HTMLInputElement>(null);
  const category = section.category === "human" ? "Human Remains" : "Cremated Remains";
  const rowLabel = `${category} ${section.title}`;
  const inputWidth = Math.min(3.53, Math.max(2.4, draft.length * 0.075 + 0.25));

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function finish() {
    setEditing(false);
    const clean = draft.trim();
    if (clean !== original.trim()) onLineCommit(section.key, entry?.id ?? null, clean);
  }

  function handleKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(original);
      setEditing(false);
    }
  }

  function beginDrag(event: ReactDragEvent<HTMLButtonElement>) {
    if (!entry || !onEntryMove) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-night-shift-entry", JSON.stringify({ sectionKey: section.key, entryId: entry.id }));
  }

  if (editing) {
    return <input ref={inputRef} className="report-row inline-row-input no-print" style={autoWidth ? { width: `${inputWidth}in` } : undefined} aria-label={`Edit ${rowLabel}`} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKey} onBlur={finish} />;
  }

  return (
    <button type="button" draggable={Boolean(entry && onEntryMove)} className={`report-row inline-row-button no-print${entry ? " draggable-row" : " blank-row"}`} aria-label={`${entry ? "Edit" : "Type in"} ${rowLabel}${!entry && freeRowIndex > 0 ? ` free row ${freeRowIndex + 1}` : ""}`} onDragStart={beginDrag} onClick={() => { setDraft(original); setEditing(true); }} title={entry ? "Click to edit or drag to another section" : "Click to type directly in the report"}>
      {entry ? <EntryLine entry={entry} /> : <>&nbsp;</>}
    </button>
  );
}

function SectionCard({
  section,
  width,
  interactive,
  onWidthChange,
  onWidthCommit,
  onLineCommit,
  onEntryMove,
}: {
  section: ReportSection;
  width?: number;
  interactive?: boolean;
  onWidthChange?: Props["onWidthChange"];
  onWidthCommit?: Props["onWidthCommit"];
  onLineCommit?: Props["onLineCommit"];
  onEntryMove?: Props["onEntryMove"];
}) {
  const [dropActive, setDropActive] = useState(false);
  const freeRows = THREE_FREE_ROW_SECTIONS.has(section.key) ? 3 : 1;

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const card = event.currentTarget.closest(".section-card") as HTMLElement;
    const startX = event.clientX;
    const startWidth = card.getBoundingClientRect().width / 96;
    let latest = startWidth;
    const move = (moveEvent: PointerEvent) => {
      latest = Math.min(3.55, Math.max(2.05, startWidth + (moveEvent.clientX - startX) / 96));
      onWidthChange?.(section.key, Number(latest.toFixed(2)));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      onWidthCommit?.(section.key, Number(latest.toFixed(2)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  }

  function receiveDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    setDropActive(false);
    if (!onEntryMove) return;
    try {
      const payload = JSON.parse(event.dataTransfer.getData("application/x-night-shift-entry")) as { sectionKey: ReportSection["key"]; entryId: string };
      if (payload.sectionKey && payload.entryId) onEntryMove(payload.sectionKey, section.key, payload.entryId);
    } catch { /* Ignore unrelated dragged content. */ }
  }

  return (
    <section
      className={`section-card${dropActive ? " drop-active" : ""}`}
      data-testid="section-card"
      data-section-key={section.key}
      style={width ? { width: `${width}in` } : undefined}
      onDragEnter={onEntryMove ? (event) => { event.preventDefault(); setDropActive(true); } : undefined}
      onDragOver={onEntryMove ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } : undefined}
      onDragLeave={onEntryMove ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); } : undefined}
      onDrop={onEntryMove ? receiveDrop : undefined}
    >
      <h3>{section.title}</h3>
      {section.entries.map((entry) => (
        onLineCommit
          ? <EditableReportRow key={entry.id} section={section} entry={entry} onLineCommit={onLineCommit} autoWidth={!width} onEntryMove={onEntryMove} />
          : <div className="report-row" key={entry.id}><EntryLine entry={entry} /></div>
      ))}
      {Array.from({ length: freeRows }, (_, index) => (
        onLineCommit
          ? <EditableReportRow key={`free-${index}`} section={section} onLineCommit={onLineCommit} autoWidth={!width} freeRowIndex={index} />
          : <div className="report-row blank-row" data-testid="free-row" aria-label={`${section.title} free row ${index + 1}`} key={`free-${index}`}>&nbsp;</div>
      ))}
      {interactive && (
        <button className="width-handle no-print" type="button" onPointerDown={beginResize} aria-label={`Resize ${section.title}`} title="Drag to resize" />
      )}
    </section>
  );
}

export function ReportPage({ report, layout, compactLevel = 0, calibration = false, interactive = false, onWidthChange, onWidthCommit, onLineCommit, onEntryMove }: Props) {
  const pageStyle = {
    "--report-margin": `${layout.marginInches}in`,
    "--report-scale": String(layout.scale),
    "--report-offset-x": `${layout.offsetXInches}in`,
    "--report-offset-y": `${layout.offsetYInches}in`,
  } as CSSProperties;
  const human = report.sections.filter((section) => section.category === "human");
  const cremated = report.sections.filter((section) => section.category === "cremated");

  return (
    <article className={`report-page compact-${compactLevel}`} style={pageStyle} data-calibration={calibration || undefined}>
      {report.status === "draft" && <div className="draft-watermark">DRAFT</div>}
      <div className="report-content">
        <header className="report-header">
          <h1>NIGHT SHIFT REPORT</h1>
          <div><strong>DATE:</strong> <span>{displayDate(report.reportDate)}</span></div>
        </header>
        <div className="report-columns">
          <div className="report-column human-column">
            <h2>HUMAN REMAINS</h2>
            {human.map((section) => (
              <SectionCard key={section.key} section={section} width={layout.sectionWidths[section.key]} interactive={interactive} onWidthChange={onWidthChange} onWidthCommit={onWidthCommit} onLineCommit={onLineCommit} onEntryMove={onEntryMove} />
            ))}
          </div>
          <div className="report-column cremated-column">
            <h2>CREMATED REMAINS</h2>
            {cremated.map((section) => (
              <SectionCard key={section.key} section={section} width={layout.sectionWidths[section.key]} interactive={interactive} onWidthChange={onWidthChange} onWidthCommit={onWidthCommit} onLineCommit={onLineCommit} onEntryMove={onEntryMove} />
            ))}
          </div>
        </div>
      </div>
      {calibration && <div className="calibration-label">CALIBRATION — all four border edges should be visible</div>}
    </article>
  );
}
