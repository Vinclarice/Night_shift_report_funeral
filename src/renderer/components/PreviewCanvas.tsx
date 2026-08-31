import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { addEntry, moveEntry, movePerson, parsePastedLines, removeEntry, replaceEntryInPlace, toggleEntryRush } from "@/domain/entries";
import type { NightReport, SectionKey } from "@/domain/types";
import { IconFlag, IconMinus, IconPencil, IconPlus, IconTrash } from "../icons";
import { useReportController } from "../state/ReportController";
import { useWorkspaceDispatch, useWorkspaceState } from "../state/WorkspaceContext";
import { ContextMenu } from "../ui/ContextMenu";
import { IconButton } from "../ui/IconButton";
import { useToast } from "../ui/Toast";
import { ReportPage } from "./ReportPage";

/**
 * The live, editable page preview: click-to-type rows, drag-and-drop between sections, and a
 * right-click menu for editing/rushing/deleting an entry in place. Everything here reads and
 * writes through `report`, the draft passed down from Studio — this component owns none of the
 * report state itself, only the interactions that turn a click or drop into a `controller.persist`
 * call.
 */
export function PreviewCanvas({ report }: { report: NightReport }) {
  const controller = useReportController();
  const workspace = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();
  const toast = useToast();
  const canvasRef = useRef<HTMLElement>(null);
  const [fitZoom, setFitZoom] = useState(0.72);
  const [contextMenu, setContextMenu] = useState<{ sectionKey: SectionKey; entryId: string; x: number; y: number } | null>(null);
  const zoom = workspace.zoomMode === "fit" ? fitZoom : workspace.zoom;
  // The page is the most expensive thing in the app to render. Deferring it lets a keystroke in the
  // inspector paint immediately and the canvas catch up a frame later, rather than the two
  // competing for the same commit.
  const deferredReport = useDeferredValue(report);
  const deferredLayout = useDeferredValue(controller.layout!);
  const entryCount = report.sections.reduce((total, section) => total + section.entries.length, 0);
  const compacted = controller.compactLevel > 0;
  // Spelled out rather than left to the bare "1/3", so the readout answers the question the number
  // raises — what got smaller, and whether anything was taken away. Nothing is: the writing rows
  // hold at every step, and only type and spacing give.
  const fitTitle = controller.overflow
    ? "This report is longer than one page. Adjust card widths, print scale, or entries."
    : compacted
      ? `Type and spacing were tightened (step ${controller.compactLevel} of 4) to keep this on one page. The blank writing rows are unaffected.`
      : "This report fits one page at its normal size.";
  // Coarser above actual size, so reaching 200% is a few clicks rather than twenty.
  const zoomStep = zoom >= 1 ? 0.1 : 0.05;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const widthScale = (canvas.clientWidth - 72) / 816;
      const heightScale = (canvas.clientHeight - 104) / 1056;
      // Fit means the whole page in view; capping it below actual size left a big monitor
      // showing a needlessly small page.
      setFitZoom(Math.min(1.5, Math.max(0.5, Math.min(widthScale, heightScale))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const commitPreviewLine = useCallback(function commitPreviewLine(sectionKey: SectionKey, entryId: string | null, value: string) {
    const next = structuredClone(report);
    const section = next.sections.find((item) => item.key === sectionKey)!;
    const existingIndex = entryId ? section.entries.findIndex((entry) => entry.id === entryId) : -1;
    const existing = existingIndex >= 0 ? section.entries[existingIndex] : null;
    const clean = value.trim();
    let parseWarning: string | undefined;
    let removedExisting = false;
    if (!clean) {
      // Cleared back to blank: this is a genuine delete, not an edit, so there's no position to
      // preserve.
      if (existingIndex >= 0) {
        section.entries.splice(existingIndex, 1);
        removedExisting = true;
      }
    } else {
      const parsedLine = parsePastedLines(clean)[0];
      let parsed = parsedLine.entry;
      if (parsed.type === "plain" && (sectionKey === "cremated-deliver" || existing?.type === "funeralHomeOnly")) parsed = { ...parsed, type: "funeralHomeOnly", funeralHome: controller.canonicalFuneralHome(parsed.text) };
      if (parsed.type === "funeral" || parsed.type === "funeralHomeOnly") parsed.funeralHome = controller.canonicalFuneralHome(parsed.funeralHome);
      if (parsed.type === "plain") parseWarning = parsedLine.warning;
      if (existing) {
        // rushBy has no representation in the editable line, so it is carried across explicitly
        // rather than dropped every time a rush row is retyped on the canvas.
        parsed = { ...parsed, id: existing.id, createdAt: existing.createdAt, rush: existing.rush || parsed.rush, rushBy: existing.rushBy, keepSeparate: existing.keepSeparate };
        // Editing an existing line stays at its current position instead of moving to the end.
        replaceEntryInPlace(section, existing.id, parsed);
      } else {
        addEntry(section, parsed);
      }
    }
    dispatch({ type: "SELECT_SECTION", sectionKey, mode: "create" });
    void controller.persist(next);
    if (removedExisting) void controller.resetSectionWidth(sectionKey);
    if (parseWarning) toast.warning(parseWarning);
  }, [report, controller, dispatch, toast]);

  const movePreviewEntry = useCallback(function movePreviewEntry(sourceKey: SectionKey, targetKey: SectionKey, entryId: string, beforeEntryId?: string | null, personId?: string) {
    const next = structuredClone(report);
    const moved = personId
      ? movePerson(next, sourceKey, targetKey, entryId, personId, beforeEntryId)
      : moveEntry(next, sourceKey, targetKey, entryId, beforeEntryId);
    if (!moved) return;
    dispatch({ type: "SELECT_SECTION", sectionKey: targetKey, mode: "browse" });
    void controller.persist(next);
  }, [report, controller, dispatch]);

  const handleEntryContextMenu = useCallback((sectionKey: SectionKey, entryId: string, x: number, y: number) => {
    setContextMenu({ sectionKey, entryId, x, y });
  }, []);

  const editContextEntry = useCallback((sectionKey: SectionKey, entryId: string) => {
    dispatch({ type: "SELECT_ENTRY", sectionKey, entryId });
  }, [dispatch]);

  const toggleContextEntryRush = useCallback((sectionKey: SectionKey, entryId: string) => {
    const next = structuredClone(report);
    if (!toggleEntryRush(next.sections.find((item) => item.key === sectionKey)!, entryId)) return;
    void controller.persist(next);
  }, [report, controller]);

  const deleteContextEntry = useCallback((sectionKey: SectionKey, entryId: string) => {
    const next = structuredClone(report);
    if (!removeEntry(next.sections.find((item) => item.key === sectionKey)!, entryId)) return;
    void controller.persist(next);
    void controller.resetSectionWidth(sectionKey);
  }, [report, controller]);

  const contextMenuEntry = contextMenu
    ? report.sections.find((section) => section.key === contextMenu.sectionKey)?.entries.find((entry) => entry.id === contextMenu.entryId)
    : undefined;

  const commitNotes = useCallback((value: string) => {
    const next = structuredClone(report);
    next.notes = value;
    void controller.persist(next);
  }, [report, controller]);

  const handleSelectSection = useCallback((sectionKey: SectionKey) => dispatch({ type: "SELECT_SECTION", sectionKey, mode: "create" }), [dispatch]);
  const handleSelectEntry = useCallback((sectionKey: SectionKey, entryId: string) => dispatch({ type: "SELECT_ENTRY", sectionKey, entryId }), [dispatch]);
  const handleWidthChange = useCallback((key: SectionKey, width: number) => {
    const current = controller.layout!;
    controller.previewLayout({ ...current, sectionWidths: { ...current.sectionWidths, [key]: width } });
  }, [controller]);
  const handleWidthCommit = useCallback((key: SectionKey, width: number) => {
    const current = controller.layout!;
    void controller.saveLayout({ ...current, sectionWidths: { ...current.sectionWidths, [key]: width } });
  }, [controller]);

  return (
    <section className="studio-canvas" ref={canvasRef}>
      <div className="canvas-toolbar no-print">
        <div><p className="studio-kicker">Live canvas</p><span>Click a ruled line to type · drag entries between cards · right-click for more</span></div>
        <div className="canvas-controls">
          {/* Whether the report still fits one page, stated continuously. Previously this only
              surfaced as the red banner above, which appears after the report has already
              overflowed — by which point entries have to be cut rather than placed differently.
              Compaction is named here too: the page quietly shrinks its own type to keep fitting,
              and without saying so the only evidence is that the sheet looks subtly different from
              last night's, which reads as a glitch rather than as the page doing its job. */}
          <span className={`canvas-fit${controller.overflow ? " over" : compacted ? " tight" : ""}`} role="status" aria-live="polite" title={fitTitle}>
            {entryCount} {entryCount === 1 ? "entry" : "entries"} <em>·</em> {controller.overflow ? "Over one page" : "Fits one page"}
            {!controller.overflow && compacted && <> <em>·</em> tightened {controller.compactLevel}/4</>}
          </span>
          <div className="zoom-control" aria-label="Preview zoom">
            <IconButton icon={<IconMinus />} aria-label="Zoom out" title="Zoom out" onClick={() => dispatch({ type: "SET_ZOOM", zoom: zoom - (zoom > 1 ? 0.1 : 0.05) })} />
            <button type="button" className={workspace.zoomMode === "fit" ? "active" : ""} onClick={() => dispatch({ type: "FIT_ZOOM" })}>{workspace.zoomMode === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}</button>
            <IconButton icon={<IconPlus />} aria-label="Zoom in" title="Zoom in" onClick={() => dispatch({ type: "SET_ZOOM", zoom: zoom + zoomStep })} />
          </div>
        </div>
      </div>
      <div className="canvas-scroll">
        <div className="page-stage" style={{ "--preview-scale": zoom } as CSSProperties}>
          <div className="page-stage-frame">
            <ReportPage
              report={deferredReport} layout={deferredLayout} dateOverride={controller.dateOverride} printedAt={controller.printedAt} compactLevel={controller.compactLevel} calibration={controller.calibration} interactive
              selectedSectionKey={workspace.selection.sectionKey}
              selectedEntryId={workspace.selection.kind === "entry" ? workspace.selection.entryId : undefined}
              onSelectSection={handleSelectSection}
              onSelectEntry={handleSelectEntry}
              onLineCommit={commitPreviewLine}
              onNotesCommit={commitNotes}
              onEntryMove={movePreviewEntry}
              onEntryContextMenu={handleEntryContextMenu}
              onWidthChange={handleWidthChange}
              onWidthCommit={handleWidthCommit}
            />
          </div>
        </div>
      </div>
      {contextMenu && contextMenuEntry && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { key: "edit", label: "Edit entry", icon: <IconPencil />, onSelect: () => editContextEntry(contextMenu.sectionKey, contextMenu.entryId) },
            { key: "rush", label: contextMenuEntry.rush ? "Remove rush" : "Mark as rush", icon: <IconFlag />, onSelect: () => toggleContextEntryRush(contextMenu.sectionKey, contextMenu.entryId) },
            { key: "delete", label: "Delete entry", icon: <IconTrash />, tone: "danger", onSelect: () => deleteContextEntry(contextMenu.sectionKey, contextMenu.entryId) },
          ]}
        />
      )}
    </section>
  );
}
