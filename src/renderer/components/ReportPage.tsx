import { memo, useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CSSProperties } from "react";

import { formatEntryLine, sectionItemCount, sharedSpecialRequest } from "@/domain/entries";
import type { LayoutSettings, NightReport, ReportEntry, ReportSection } from "@/domain/types";
import { useEntryDrag, useSectionDropZone } from "../hooks/useEntryDrag";
import type { CompactLevel } from "../hooks/useOverflowCompaction";

interface Props {
  report: NightReport;
  layout: LayoutSettings;
  /** Hand-typed date to print instead of the report's own; see ReportState.dateOverride. */
  dateOverride?: string | null;
  /** Stamped into the footer so two printed copies of one night can be told apart. */
  printedAt?: Date | null;
  compactLevel?: CompactLevel;
  calibration?: boolean;
  interactive?: boolean;
  onWidthChange?: (key: ReportSection["key"], width: number) => void;
  onWidthCommit?: (key: ReportSection["key"], width: number) => void;
  onLineCommit?: (key: ReportSection["key"], entryId: string | null, value: string) => void;
  onNotesCommit?: (value: string) => void;
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

/**
 * Blank rows past the last entry, for typing directly onto the page. Sections not listed get one.
 *
 * These counts hold at every compaction step. Compaction used to reclaim them — they hold nothing,
 * and there are ten of them down the Human column, close to two inches, so they look like the
 * cheapest thing to give back. They are not. A row disappearing is the one compaction a person
 * watching the page actually sees, and it takes away somewhere they were about to write. Type and
 * leading shrink instead: if the sheet has to get smaller to fit, it gets smaller, and the rows
 * stay where the night crew expects to find them.
 */
const FREE_ROW_COUNTS: Partial<Record<ReportSection["key"], number>> = {
  "human-deliver": 3,
  "human-road-trips": 2,
  "human-fdp": 3,
  "human-pending": 2,
  "human-ship-outs": 1,
};

const printedTime = (value: Date): string =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(value);

/** The weekday the sheet is for. The report is dated the next calendar day, so this names the
 *  day the work is actually done. */
function weekdayName(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(year, month - 1, day)).toUpperCase();
}

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

/**
 * Every typable row in the column containing `from`, in the order they are read. Scoped to the
 * column rather than the card so Up/Down carry on into the next section, and never to the other
 * column — the two are separate destinations and drifting between them is how a line gets filed
 * against the wrong category.
 */
function columnRows(from: HTMLElement): HTMLElement[] {
  const column = from.closest(".report-column");
  // Both selectors: the row being edited is an input, not a button, and leaving it out made
  // indexOf return -1 — so "one below" resolved to row 0 and Down jumped to the top of the column.
  return column ? [...column.querySelectorAll<HTMLElement>(".inline-row-button, .inline-row-input")] : [];
}

function EditableReportRow({ section, entry, onLineCommit, onContinueEntry, autoWidth, freeRowIndex = 0, onEntryMove, selected, onSelectSection, onSelectEntry, onEntryContextMenu, dropBefore, onDropBeforeChange }: { section: ReportSection; entry?: ReportEntry; onLineCommit: NonNullable<Props["onLineCommit"]>; onContinueEntry?: () => void; autoWidth: boolean; freeRowIndex?: number; onEntryMove?: Props["onEntryMove"]; selected?: boolean; onSelectSection?: Props["onSelectSection"]; onSelectEntry?: Props["onSelectEntry"]; onEntryContextMenu?: Props["onEntryContextMenu"]; dropBefore?: boolean; onDropBeforeChange?: (entryId: string | null) => void }) {
  const original = entry ? formatEntryLine(entry) : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(original);
  const inputRef = useRef<HTMLInputElement>(null);
  const continueEntryRef = useRef(false);
  const pendingMoveRef = useRef<{ column: HTMLElement; index: number } | null>(null);
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

    // Two frames so the commit has rendered before the target is looked up again. The index is
    // taken from before the commit, so a change that re-sorts the section (marking a line Rush,
    // pinning it) can land a row away from where the arrow pointed — the same caveat Enter has.
    const move = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (move) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        [...move.column.querySelectorAll<HTMLElement>(".inline-row-button")][move.index]?.click();
      }));
    }
  }

  function handleKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      continueEntryRef.current = true;
      event.currentTarget.blur();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // Enter means "commit and start the next empty line"; the arrows mean "commit and move to
      // the line above or below", whether or not it already has something on it.
      const rows = columnRows(event.currentTarget);
      const index = rows.indexOf(event.currentTarget as HTMLElement) + (event.key === "ArrowDown" ? 1 : -1);
      const column = event.currentTarget.closest(".report-column");
      if (!column || index < 0 || index >= rows.length) return;
      event.preventDefault();
      pendingMoveRef.current = { column: column as HTMLElement, index };
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(original);
      setEditing(false);
    }
  }

  /** Arrows on a row that is merely focused just move the focus; Enter or a click opens it. */
  function handleButtonKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = columnRows(event.currentTarget);
    const target = rows[rows.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : -1)];
    if (!target) return;
    event.preventDefault();
    target.focus();
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
    // Same funeral-home list the inspector offers. A row is typed as one line — "McGuire – Smith
    // (13A)" — and the home is always its opening segment, so the names match while that is all
    // that has been typed and stop matching by themselves once the dash goes in. That is the
    // wanted behaviour rather than a limitation: nothing after the dash is a name this app knows.
    return <input ref={inputRef} className="report-row inline-row-input no-print" list="funeral-home-options" style={autoWidth ? { width: `${inputWidth}in` } : undefined} aria-label={`Edit ${rowLabel}`} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKey} onBlur={finish} />;
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
      onKeyDown={handleButtonKey}
      title={entry ? "Click to edit, or drag to reorder or move to another section" : "Click to type directly in the report"}
      {...dragProps}
    >
      {entry ? <EntryLine entry={entry} onPersonDragStart={onEntryMove ? beginPersonDrag : undefined} /> : <>&nbsp;</>}
    </button>
  );
}

/**
 * Trailing whitespace is dropped on commit, leading whitespace is kept. A note that opens with a
 * blank line is someone starting on the second rule on purpose, and trimming both ends yanked it
 * back onto the first one — which read as the second line being untypable.
 */
const trimTrailing = (value: string): string => value.replace(/\s+$/, "");

/**
 * The footer notes, typed straight on the page like the ruled rows above. Blur commits and Escape
 * cancels; Enter inserts a newline, since this is prose rather than a one-line entry. Rendered
 * read-only when no commit handler is supplied, which is how the hidden print copy gets it.
 */
function NotesBlock({ notes, printedAt, onCommit, compact }: { notes: string; printedAt: Date | null; onCommit?: (value: string) => void; compact?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) areaRef.current?.focus(); }, [editing]);

  function finish() {
    setEditing(false);
    const next = trimTrailing(draft);
    if (next !== trimTrailing(notes)) onCommit?.(next);
  }

  return (
    <div className={`notes-block${compact ? " notes-compact" : ""}`}>
      <p>NOTES{printedAt && <span>Printed {printedTime(printedAt)}</span>}</p>
      {editing ? (
        <textarea
          ref={areaRef}
          className="notes-body notes-input no-print"
          aria-label="Report notes"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finish}
          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setDraft(notes); setEditing(false); } }}
        />
      ) : onCommit ? (
        <button type="button" className="notes-body notes-button no-print" title="Click to type a note" onClick={() => { setDraft(notes); setEditing(true); }}>
          {notes}
        </button>
      ) : (
        <div className="notes-body">{notes}</div>
      )}
    </div>
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
    // The card by ref, not by walking up from the grip: the grip is the card's sibling inside the
    // shell rather than its child, so closest(".section-card") finds nothing from here.
    const card = cardRef.current;
    if (!card) return;
    const startX = event.clientX;
    const startWidth = card.getBoundingClientRect().width / 96;
    let latest = startWidth;
    // Taken from the card's own computed bounds rather than written out here. The two columns have
    // different floors — 2.42in for Human Remains, 1.62in for the narrower Cremated cards — and a
    // single hardcoded 2.05in matched neither: it stopped a Cremated card 0.43in above the width
    // CSS would allow, while letting a Human card store a width min-width then silently ignored.
    const bounds = getComputedStyle(card);
    const minWidth = (parseFloat(bounds.minWidth) || 0) / 96;
    const maxWidth = (parseFloat(bounds.maxWidth) || Infinity) / 96;
    const move = (moveEvent: PointerEvent) => {
      latest = Math.min(maxWidth, Math.max(minWidth, startWidth + (moveEvent.clientX - startX) / 96));
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
    <div className="section-card-shell">
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
          ? <EditableReportRow key={`free-${index}`} section={section} onLineCommit={onLineCommit} onContinueEntry={() => { continueFromEntriesRef.current = section.entries; }} autoWidth={!width} freeRowIndex={index} onEntryMove={onEntryMove} onSelectSection={onSelectSection} onSelectEntry={onSelectEntry} dropBefore={dropBefore === "__end__"} onDropBeforeChange={setDropBefore} />
          : <div className="report-row blank-row" data-testid="free-row" aria-label={`${section.title} free row ${index + 1}`} key={`free-${index}`}>&nbsp;</div>
      ))}
    </section>
    {/* Outside the card, not inside it: the card must stay overflow:hidden to keep a long nowrap
        header from spilling out of a narrowed card, and that clip used to eat the half of the grip
        that hangs past the edge. The shell is the unclipped box it can hang off instead. */}
    {interactive && (
      <button className="width-handle no-print" type="button" onPointerDown={beginResize} aria-label={`Resize ${section.title}`} title="Drag to resize" />
    )}
    </div>
  );
});

/**
 * Memoized because the live canvas re-renders on every keystroke elsewhere in the studio. The
 * handler props it receives from PreviewCanvas are defined inline there, so memo only pays off in
 * combination with those being stable — see PreviewCanvas, where they are wrapped in useCallback.
 */
export const ReportPage = memo(function ReportPage({ report, layout, dateOverride = null, printedAt = null, compactLevel = 0, calibration = false, interactive = false, onWidthChange, onWidthCommit, onLineCommit, onNotesCommit, onEntryMove, selectedSectionKey, selectedEntryId, onSelectSection, onSelectEntry, onEntryContextMenu }: Props) {
  const pageStyle = {
    "--report-margin": `${layout.marginInches}in`,
    "--report-scale": String(layout.scale),
    "--report-offset-x": `${layout.offsetXInches}in`,
    "--report-offset-y": `${layout.offsetYInches}in`,
  } as CSSProperties;
  // ROAD TRIPS is filtered out of the page rather than out of the report, so a night that is put
  // away with entries still in it keeps them, and they reappear with the card.
  const human = report.sections.filter((section) =>
    section.category === "human" && (section.key !== "human-road-trips" || report.roadTripsVisible));
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
          <div>
            <span className="report-weekday">{weekdayName(dateOverride ?? report.reportDate)}</span>
            <span className="report-date"><strong>DATE:</strong> {displayDate(dateOverride ?? report.reportDate)}</span>
          </div>
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
            the floor, so typing enough here compacts the columns rather than colliding with them. */}
        <NotesBlock notes={report.notes} printedAt={printedAt} onCommit={onNotesCommit} compact={compactLevel >= 2} />
      </div>
      {calibration && <div className="calibration-label">CALIBRATION — all four border edges should be visible</div>}
    </article>
  );
});
