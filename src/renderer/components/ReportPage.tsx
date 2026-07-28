import { memo, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CSSProperties } from "react";

import { formatEntryLine } from "@/domain/entries";
import type { LayoutSettings, NightReport, ReportEntry, ReportSection } from "@/domain/types";
import { useEntryDrag, useSectionDropZone } from "../hooks/useEntryDrag";

interface Props {
  report: NightReport;
  layout: LayoutSettings;
  compactLevel?: 0 | 1;
  calibration?: boolean;
  interactive?: boolean;
  onWidthChange?: (key: ReportSection["key"], width: number) => void;
  onWidthCommit?: (key: ReportSection["key"], width: number) => void;
  onLineCommit?: (key: ReportSection["key"], entryId: string | null, value: string) => void;
  /**
   * `beforeEntryId` is the row to land above, `null` means the end of the section (which pins the
   * entry there), and omitting it means no particular position — used for a drop on the card body.
   */
  onEntryMove?: (sourceKey: ReportSection["key"], targetKey: ReportSection["key"], entryId: string, beforeEntryId?: string | null) => void;
  selectedSectionKey?: ReportSection["key"];
  selectedEntryId?: string;
  onSelectSection?: (key: ReportSection["key"]) => void;
  onSelectEntry?: (key: ReportSection["key"], entryId: string) => void;
  onEntryContextMenu?: (key: ReportSection["key"], entryId: string, x: number, y: number) => void;
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

const EntryLine = memo(function EntryLine({ entry }: { entry: ReportEntry }) {
  if (entry.type === "funeral") {
    const hasVisibleRush = entry.deceased.some((person) => /rush/i.test(person.specialRequest));
    return (
      <span className="entry-line-content">
        <strong className="entry-primary">{entry.funeralHome}</strong>
        <span className="entry-separator" aria-hidden="true"> – </span>
        {entry.deceased.map((person, index) => (
          <span className="deceased-person" key={person.id}>
            {index > 0 && <span className="entry-separator" aria-hidden="true"> + </span>}
            <span className="deceased-name">{person.name}</span>
            {person.locationCode && <span className="location-code">{person.locationCode}</span>}
            {person.specialRequest && <strong className={`special-request${/rush/i.test(person.specialRequest) ? " rush-request" : ""}`}>{person.specialRequest.toUpperCase()}</strong>}
          </span>
        ))}
        {entry.rush && !hasVisibleRush && <strong className="special-request rush-request">RUSH</strong>}
      </span>
    );
  }
  if (entry.type === "funeralHomeOnly") {
    return (
      <span className="entry-line-content">
        <strong className="entry-primary">{entry.funeralHome}</strong>
        {entry.rush && <strong className="special-request rush-request">RUSH DELIVERY</strong>}
      </span>
    );
  }
  if (entry.type === "count") return <span className="entry-line-content"><span>{entry.text}</span><strong className="entry-count">x {entry.count}</strong></span>;
  if (entry.type === "combined") return <span className="entry-line-content"><span>{entry.leftText}</span><span className="entry-separator"> // </span><span>{entry.rightText}</span><strong className="entry-count">x {entry.count}</strong></span>;
  return <span className="entry-line-content"><span>{entry.text}</span></span>;
});

function EditableReportRow({ section, entry, onLineCommit, autoWidth, freeRowIndex = 0, onEntryMove, selected, onSelectSection, onSelectEntry, onEntryContextMenu, dropBefore, onDropBeforeChange }: { section: ReportSection; entry?: ReportEntry; onLineCommit: NonNullable<Props["onLineCommit"]>; autoWidth: boolean; freeRowIndex?: number; onEntryMove?: Props["onEntryMove"]; selected?: boolean; onSelectSection?: Props["onSelectSection"]; onSelectEntry?: Props["onSelectEntry"]; onEntryContextMenu?: Props["onEntryContextMenu"]; dropBefore?: boolean; onDropBeforeChange?: (entryId: string | null) => void }) {
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

  const { beginDrag, dragProps } = useEntryDrag(section, entry, onEntryMove, onDropBeforeChange);

  function handleContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    // Blank/free rows have nothing to act on, so the browser's default menu is left alone there.
    // Selection is left untouched until a menu item is actually chosen, so opening the menu to
    // look at the options doesn't itself jump the inspector to this entry.
    if (!entry || !onEntryContextMenu) return;
    event.preventDefault();
    onEntryContextMenu(section.key, entry.id, event.clientX, event.clientY);
  }

  if (editing) {
    return <input ref={inputRef} className="report-row inline-row-input no-print" style={autoWidth ? { width: `${inputWidth}in` } : undefined} aria-label={`Edit ${rowLabel}`} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKey} onBlur={finish} />;
  }

  return (
    <button
      type="button"
      draggable={Boolean(entry && onEntryMove)}
      className={`report-row inline-row-button no-print${entry ? " draggable-row" : " blank-row"}${entry?.rush ? " rush-row" : ""}${entry?.pinnedBottom ? " pinned-row" : ""}${selected ? " selected" : ""}${dropBefore ? " drop-before" : ""}`}
      aria-label={`${entry ? "Edit" : "Type in"} ${rowLabel}${!entry && freeRowIndex > 0 ? ` free row ${freeRowIndex + 1}` : ""}`}
      onDragStart={beginDrag}
      onClick={() => { if (entry) onSelectEntry?.(section.key, entry.id); else onSelectSection?.(section.key); setDraft(original); setEditing(true); }}
      onContextMenu={handleContextMenu}
      title={entry ? "Click to edit, or drag to reorder or move to another section" : "Click to type directly in the report"}
      {...dragProps}
    >
      {entry ? <EntryLine entry={entry} /> : <>&nbsp;</>}
    </button>
  );
}

const SectionCard = memo(function SectionCard({
  section,
  width,
  interactive,
  onWidthChange,
  onWidthCommit,
  onLineCommit,
  onEntryMove,
  selected,
  selectedEntryId,
  onSelectSection,
  onSelectEntry,
  onEntryContextMenu,
}: {
  section: ReportSection;
  width?: number;
  interactive?: boolean;
  onWidthChange?: Props["onWidthChange"];
  onWidthCommit?: Props["onWidthCommit"];
  onLineCommit?: Props["onLineCommit"];
  onEntryMove?: Props["onEntryMove"];
  selected?: boolean;
  selectedEntryId?: string;
  onSelectSection?: Props["onSelectSection"];
  onSelectEntry?: Props["onSelectEntry"];
  onEntryContextMenu?: Props["onEntryContextMenu"];
}) {
  const { dropActive, dropBefore, setDropBefore, cardDragProps } = useSectionDropZone(section, onEntryMove);
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

  return (
    <section
      className={`section-card${dropActive ? " drop-active" : ""}${selected ? " studio-selected" : ""}`}
      data-testid="section-card"
      data-section-key={section.key}
      style={width ? { width: `${width}in` } : undefined}
      {...cardDragProps}
    >
      <h3>{section.title}</h3>
      {section.entries.map((entry) => (
        onLineCommit
          ? <EditableReportRow key={entry.id} section={section} entry={entry} onLineCommit={onLineCommit} autoWidth={!width} onEntryMove={onEntryMove} selected={entry.id === selectedEntryId} onSelectSection={onSelectSection} onSelectEntry={onSelectEntry} onEntryContextMenu={onEntryContextMenu} dropBefore={dropBefore === entry.id} onDropBeforeChange={setDropBefore} />
          : <div className={`report-row${entry.rush ? " rush-row" : ""}${entry.pinnedBottom ? " pinned-row" : ""}`} key={entry.id}><EntryLine entry={entry} /></div>
      ))}
      {Array.from({ length: freeRows }, (_, index) => (
        onLineCommit
          ? <EditableReportRow key={`free-${index}`} section={section} onLineCommit={onLineCommit} autoWidth={!width} freeRowIndex={index} onEntryMove={index === 0 ? onEntryMove : undefined} onSelectSection={onSelectSection} onSelectEntry={onSelectEntry} dropBefore={index === 0 && dropBefore === "__end__"} onDropBeforeChange={setDropBefore} />
          : <div className="report-row blank-row" data-testid="free-row" aria-label={`${section.title} free row ${index + 1}`} key={`free-${index}`}>&nbsp;</div>
      ))}
      {interactive && (
        <button className="width-handle no-print" type="button" onPointerDown={beginResize} aria-label={`Resize ${section.title}`} title="Drag to resize" />
      )}
    </section>
  );
});

/**
 * Memoized because the live canvas re-renders on every keystroke elsewhere in the studio. The
 * handler props it receives from PreviewCanvas are defined inline there, so memo only pays off in
 * combination with those being stable — see PreviewCanvas, where they are wrapped in useCallback.
 */
export const ReportPage = memo(function ReportPage({ report, layout, compactLevel = 0, calibration = false, interactive = false, onWidthChange, onWidthCommit, onLineCommit, onEntryMove, selectedSectionKey, selectedEntryId, onSelectSection, onSelectEntry, onEntryContextMenu }: Props) {
  const pageStyle = {
    "--report-margin": `${layout.marginInches}in`,
    "--report-scale": String(layout.scale),
    "--report-offset-x": `${layout.offsetXInches}in`,
    "--report-offset-y": `${layout.offsetYInches}in`,
  } as CSSProperties;
  const human = report.sections.filter((section) => section.category === "human");
  const cremated = report.sections.filter((section) => section.category === "cremated");

  return (
    <article
      className={`report-page compact-${compactLevel}`}
      style={pageStyle}
      data-calibration={calibration || undefined}
      // Marks the one instance meant to be measured for page overflow — the interactive canvas
      // copy, never the hidden print-only one. useOverflowCompaction looks for this attribute
      // directly instead of relying on an ancestor's layout class, so renaming that class can't
      // silently break overflow detection.
      data-role={interactive ? "live-report-page" : undefined}
    >
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
              <SectionCard key={section.key} section={section} width={layout.sectionWidths[section.key]} interactive={interactive} onWidthChange={onWidthChange} onWidthCommit={onWidthCommit} onLineCommit={onLineCommit} onEntryMove={onEntryMove} selected={selectedSectionKey === section.key} selectedEntryId={selectedEntryId} onSelectSection={onSelectSection} onSelectEntry={onSelectEntry} onEntryContextMenu={onEntryContextMenu} />
            ))}
          </div>
          <div className="report-column cremated-column">
            <h2>CREMATED REMAINS</h2>
            {cremated.map((section) => (
              <SectionCard key={section.key} section={section} width={layout.sectionWidths[section.key]} interactive={interactive} onWidthChange={onWidthChange} onWidthCommit={onWidthCommit} onLineCommit={onLineCommit} onEntryMove={onEntryMove} selected={selectedSectionKey === section.key} selectedEntryId={selectedEntryId} onSelectSection={onSelectSection} onSelectEntry={onSelectEntry} onEntryContextMenu={onEntryContextMenu} />
            ))}
          </div>
        </div>
      </div>
      {calibration && <div className="calibration-label">CALIBRATION — all four border edges should be visible</div>}
    </article>
  );
});
