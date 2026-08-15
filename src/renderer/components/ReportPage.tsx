import { memo, useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CSSProperties } from "react";

import { formatEntryLine, sectionItemCount, sharedSpecialRequest } from "@/domain/entries";
import type { LayoutSettings, NightReport, ReportEntry, ReportSection } from "@/domain/types";
import { useEntryDrag, useSectionDropZone } from "../hooks/useEntryDrag";

interface Props {
  report: NightReport;
  layout: LayoutSettings;
  /** Hand-typed date to print instead of the report's own; see ReportState.dateOverride. */
  dateOverride?: string | null;
  compactLevel?: 0 | 1;
  calibration?: boolean;
  interactive?: boolean;
  onWidthChange?: (key: ReportSection["key"], width: number) => void;
  onWidthCommit?: (key: ReportSection["key"], width: number) => void;
  onLineCommit?: (key: ReportSection["key"], entryId: string | null, value: string) => void;
  /**
   * `beforeEntryId` is the row to land above, `null` means the end of the section (which pins the
   * entry there), and omitting it means no particular position — used for a drop on the card body.
   * `personId` is present only when just one deceased person was dragged off a multi-person entry
   * rather than the whole row.
   */
  onEntryMove?: (sourceKey: ReportSection["key"], targetKey: ReportSection["key"], entryId: string, beforeEntryId?: string | null, personId?: string) => void;
  selectedSectionKey?: ReportSection["key"];
  selectedEntryId?: string;
  onSelectSection?: (key: ReportSection["key"]) => void;
  onSelectEntry?: (key: ReportSection["key"], entryId: string) => void;
  onEntryContextMenu?: (key: ReportSection["key"], entryId: string, x: number, y: number) => void;
}

/** Blank rows past the last entry, for typing directly onto the page. Sections not listed get one. */
const FREE_ROW_COUNTS: Partial<Record<ReportSection["key"], number>> = {
  "human-deliver": 3,
  "human-fdp": 3,
  "human-pending": 2,
  "human-ship-outs": 1,
};

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

/**
 * The rush chip's text. A deadline replaces the bare label rather than sitting beside it, so a
 * rush line reads "RUSH BY 10:00 AM" or "RUSH FIRST TRIP" in one chip instead of two.
 */
function rushLabel(entry: ReportEntry, fallback: string): string {
  const note = entry.rushBy?.trim();
  return note ? `RUSH ${note}`.toUpperCase() : fallback;
}

const EntryLine = memo(function EntryLine({ entry, onPersonDragStart }: { entry: ReportEntry; onPersonDragStart?: (personId: string) => (event: ReactDragEvent<HTMLElement>) => void }) {
  if (entry.type === "funeral") {
    const hasVisibleRush = entry.deceased.some((person) => /rush/i.test(person.specialRequest));
    const shared = sharedSpecialRequest(entry.deceased);
    // Only worth grabbing a single name apart from the row when there's more than one person to
    // split it from — with just one, dragging them is exactly the same as dragging the whole row.
    const draggablePersons = onPersonDragStart && entry.deceased.length > 1;
    return (
      <span className="entry-line-content">
        <strong className="entry-primary">{entry.funeralHome}</strong>
        <span className="entry-separator" aria-hidden="true"> – </span>
        {entry.deceased.map((person, index) => (
          <span
            className={`deceased-person${draggablePersons ? " draggable-person" : ""}`}
            key={person.id}
            draggable={draggablePersons}
            onDragStart={draggablePersons ? onPersonDragStart(person.id) : undefined}
            title={draggablePersons ? "Drag to move just this person to another section" : undefined}
          >
            {index > 0 && <span className="entry-separator" aria-hidden="true"> + </span>}
            <span className="deceased-name">{person.name}</span>
            {person.locationCode && <span className="location-code">{person.locationCode}</span>}
            {!shared && person.specialRequest && <strong className={`special-request${/rush/i.test(person.specialRequest) ? " rush-request" : ""}`}>{person.specialRequest.toUpperCase()}</strong>}
          </span>
        ))}
        {shared && <strong className={`special-request${/rush/i.test(shared) ? " rush-request" : ""}`}>{shared.toUpperCase()}</strong>}
        {entry.rush && (entry.rushBy?.trim() || !hasVisibleRush) && <strong className="special-request rush-request">{rushLabel(entry, "RUSH")}</strong>}
      </span>
    );
  }
  if (entry.type === "funeralHomeOnly") {
    return (
      <span className="entry-line-content">
        <strong className="entry-primary">{entry.funeralHome}</strong>
        {entry.rush && <strong className="special-request rush-request">{rushLabel(entry, "RUSH DELIVERY")}</strong>}
      </span>
    );
  }
  // A count of one is what a bare line already means, so the "x 1" chip only adds noise.
  if (entry.type === "count") return <span className="entry-line-content"><span>{entry.text}</span>{entry.count > 1 && <strong className="entry-count">x {entry.count}</strong>}</span>;
  if (entry.type === "combined") return <span className="entry-line-content"><span>{entry.leftText}</span><span className="entry-separator combined-separator"> // </span><span>{entry.rightText}</span>{entry.count > 1 && <strong className="entry-count">x {entry.count}</strong>}</span>;
  return <span className="entry-line-content"><span>{entry.text}</span></span>;
});

function EditableReportRow({ section, entry, onLineCommit, onContinueEntry, autoWidth, freeRowIndex = 0, onEntryMove, selected, onSelectSection, onSelectEntry, onEntryContextMenu, dropBefore, onDropBeforeChange }: { section: ReportSection; entry?: ReportEntry; onLineCommit: NonNullable<Props["onLineCommit"]>; onContinueEntry?: () => void; autoWidth: boolean; freeRowIndex?: number; onEntryMove?: Props["onEntryMove"]; selected?: boolean; onSelectSection?: Props["onSelectSection"]; onSelectEntry?: Props["onSelectEntry"]; onEntryContextMenu?: Props["onEntryContextMenu"]; dropBefore?: boolean; onDropBeforeChange?: (entryId: string | null) => void }) {
  const original = entry ? formatEntryLine(entry) : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(original);
  const inputRef = useRef<HTMLInputElement>(null);
  const continueEntryRef = useRef(false);
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
    const changed = clean !== original.trim();
    if (changed && continueEntryRef.current && !entry && clean) onContinueEntry?.();
    continueEntryRef.current = false;
    if (changed) onLineCommit(section.key, entry?.id ?? null, clean);
  }

  function handleKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      continueEntryRef.current = true;
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(original);
      setEditing(false);
    }
  }

  const { beginDrag, beginPersonDrag, dragProps } = useEntryDrag(section, entry, onEntryMove, onDropBeforeChange);

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
      {entry ? <EntryLine entry={entry} onPersonDragStart={onEntryMove ? beginPersonDrag : undefined} /> : <>&nbsp;</>}
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
  const itemCount = sectionItemCount(section);
  const freeRows = FREE_ROW_COUNTS[section.key] ?? 1;
  const cardRef = useRef<HTMLElement>(null);
  const continueFromEntriesRef = useRef<ReportEntry[] | null>(null);

  useEffect(() => {
    if (!continueFromEntriesRef.current || section.entries === continueFromEntriesRef.current) return;
    continueFromEntriesRef.current = null;
    cardRef.current?.querySelector<HTMLButtonElement>(".inline-row-button.blank-row")?.click();
  }, [section.entries]);

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
      ref={cardRef}
      className={`section-card${dropActive ? " drop-active" : ""}${selected ? " studio-selected" : ""}`}
      data-testid="section-card"
      data-section-key={section.key}
      style={width ? { width: `${width}in` } : undefined}
      {...cardDragProps}
    >
      {/* Selecting a section otherwise means clicking one of its rows, which also opens that row
          for editing — so there was no way to just point the inspector at a section. The header
          does that. Interactive canvas only; the print copy keeps a plain heading. Keyboard users
          reach the same selection by tabbing to any row in the card. */}
      <h3 onClick={interactive ? () => onSelectSection?.(section.key) : undefined} title={interactive ? `Show ${section.title} in the inspector` : undefined}>
        {section.title}
        {itemCount > 0 && <em aria-label={`${itemCount} in this section`}>{itemCount}</em>}
      </h3>
      {section.entries.map((entry) => (
        onLineCommit
          ? <EditableReportRow key={entry.id} section={section} entry={entry} onLineCommit={onLineCommit} autoWidth={!width} onEntryMove={onEntryMove} selected={entry.id === selectedEntryId} onSelectSection={onSelectSection} onSelectEntry={onSelectEntry} onEntryContextMenu={onEntryContextMenu} dropBefore={dropBefore === entry.id} onDropBeforeChange={setDropBefore} />
          : <div className={`report-row${entry.rush ? " rush-row" : ""}${entry.pinnedBottom ? " pinned-row" : ""}`} key={entry.id}><EntryLine entry={entry} /></div>
      ))}
      {Array.from({ length: freeRows }, (_, index) => (
        onLineCommit
          ? <EditableReportRow key={`free-${index}`} section={section} onLineCommit={onLineCommit} onContinueEntry={() => { continueFromEntriesRef.current = section.entries; }} autoWidth={!width} freeRowIndex={index} onEntryMove={index === 0 ? onEntryMove : undefined} onSelectSection={onSelectSection} onSelectEntry={onSelectEntry} dropBefore={index === 0 && dropBefore === "__end__"} onDropBeforeChange={setDropBefore} />
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
export const ReportPage = memo(function ReportPage({ report, layout, dateOverride = null, compactLevel = 0, calibration = false, interactive = false, onWidthChange, onWidthCommit, onLineCommit, onEntryMove, selectedSectionKey, selectedEntryId, onSelectSection, onSelectEntry, onEntryContextMenu }: Props) {
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
      <div className="report-content">
        <header className="report-header">
          <h1>NIGHT SHIFT REPORT</h1>
          <div><strong>DATE:</strong> <span>{displayDate(dateOverride ?? report.reportDate)}</span></div>
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
        {/* Anchored to the foot of the content box so it lands in the same place every night
            rather than riding up after a quiet one. useOverflowCompaction treats its top edge as
            the floor, so a heavy night compacts instead of running the columns through it. */}
        <div className="notes-block">
          <p>NOTES</p>
          <span /><span />
        </div>
      </div>
      {calibration && <div className="calibration-label">CALIBRATION — all four border edges should be visible</div>}
    </article>
  );
});
