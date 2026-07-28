import { useCallback, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";

import type { ReportEntry, ReportSection } from "@/domain/types";

const DRAG_MIME = "application/x-night-shift-entry";

interface DragPayload { sectionKey: ReportSection["key"]; entryId: string }

function readDragPayload(event: ReactDragEvent<HTMLElement>): DragPayload | null {
  try {
    const payload = JSON.parse(event.dataTransfer.getData(DRAG_MIME)) as DragPayload;
    return payload?.sectionKey && payload?.entryId ? payload : null;
  } catch {
    return null;
  }
}

type EntryMoveHandler = (sourceKey: ReportSection["key"], targetKey: ReportSection["key"], entryId: string, beforeEntryId?: string | null) => void;

/**
 * Drag-and-drop for a single report row: starting a drag on an entry row, and accepting a drop on
 * either an entry row (landing above/below it, split at the row's vertical midpoint) or a blank
 * row (landing pinned at the end of the section). Both branches funnel into the same onEntryMove
 * call with a different `beforeEntryId`, so the row rendering it doesn't need to know which case
 * it's in — see ReportPage's EditableReportRow, the only caller.
 */
export function useEntryDrag(
  section: ReportSection,
  entry: ReportEntry | undefined,
  onEntryMove: EntryMoveHandler | undefined,
  onDropBeforeChange?: (entryId: string | null) => void,
) {
  const beginDrag = useCallback((event: ReactDragEvent<HTMLButtonElement>) => {
    if (!entry || !onEntryMove) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ sectionKey: section.key, entryId: entry.id } satisfies DragPayload));
  }, [section.key, entry, onEntryMove]);

  // Dropping onto the top half of a row lands above it; the bottom half lands above the next row.
  // Without the halves, nudging an entry down by one position would be impossible.
  const pointerTarget = useCallback((event: ReactDragEvent<HTMLElement>): string | null => {
    if (!entry) return null;
    const nextEntryId = section.entries[section.entries.findIndex((candidate) => candidate.id === entry.id) + 1]?.id ?? null;
    const box = event.currentTarget.getBoundingClientRect();
    // Insert-before is the safe default when the pointer position is unavailable: it can only be
    // off by one row, whereas defaulting to the other branch could pin an entry unintentionally.
    if (!Number.isFinite(event.clientY)) return entry.id;
    return event.clientY - box.top > box.height / 2 ? nextEntryId : entry.id;
  }, [section.entries, entry]);

  // A blank row is the bottom of the section, so a drop there means "put it at the end" — which is
  // what pins the entry. Rows with entries use the half-height rule above instead.
  const dragProps = !onEntryMove ? {} : !entry ? {
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move" as const;
      onDropBeforeChange?.("__end__");
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const payload = readDragPayload(event);
      onDropBeforeChange?.(null);
      if (payload) onEntryMove(payload.sectionKey, section.key, payload.entryId, null);
    },
  } : {
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move" as const;
      onDropBeforeChange?.(pointerTarget(event));
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const payload = readDragPayload(event);
      const before = pointerTarget(event);
      onDropBeforeChange?.(null);
      if (payload && payload.entryId !== entry.id) onEntryMove(payload.sectionKey, section.key, payload.entryId, before);
    },
  };

  return { beginDrag, dragProps };
}

/**
 * Drag-and-drop for a section card as a whole: the "something is being dragged over this card"
 * highlight, and the fallback drop target for a release on the card's own padding rather than a
 * specific row. Position is left unspecified there, so a same-section drop on the card body is a
 * no-op instead of silently pinning the entry to the bottom.
 */
export function useSectionDropZone(section: ReportSection, onEntryMove: EntryMoveHandler | undefined) {
  const [dropActive, setDropActive] = useState(false);
  const [dropBefore, setDropBefore] = useState<string | null>(null);

  const receiveDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    setDropActive(false);
    setDropBefore(null);
    if (!onEntryMove) return;
    const payload = readDragPayload(event);
    if (payload) onEntryMove(payload.sectionKey, section.key, payload.entryId);
  }, [section.key, onEntryMove]);

  const cardDragProps = !onEntryMove ? {} : {
    onDragEnter: (event: ReactDragEvent<HTMLElement>) => { event.preventDefault(); setDropActive(true); },
    onDragOver: (event: ReactDragEvent<HTMLElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = "move" as const; },
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setDropActive(false); setDropBefore(null); } },
    onDrop: receiveDrop,
  };

  return { dropActive, dropBefore, setDropBefore, cardDragProps };
}
