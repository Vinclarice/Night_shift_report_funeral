import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { addEntry, moveEntry, parsePastedLines } from "@/domain/entries";
import type { NightReport, SectionKey } from "@/domain/types";
import { IconBuilding, IconCheck, IconHistory, IconMinus, IconPlus, IconPrinter, IconRedo, IconSidebar, IconSliders, IconUndo, IconWand } from "../icons";
import { useReportController } from "../state/ReportController";
import { useWorkspaceDispatch, useWorkspaceState } from "../state/WorkspaceContext";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Drawer } from "../ui/Drawer";
import { IconButton } from "../ui/IconButton";
import { useToast } from "../ui/Toast";
import { FuneralHomeManager } from "./FuneralHomeManager";
import { Inspector } from "./Inspector";
import { PrintSettings } from "./PrintSettings";
import { RecoveryPanel } from "./RecoveryPanel";
import { ReportNavigator } from "./ReportNavigator";
import { ReportPage } from "./ReportPage";

function formatReportDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

function CommandBar({ report }: { report: NightReport }) {
  const controller = useReportController();
  const workspace = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false);
    }
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  function openUtility(utility: "directory" | "recovery" | "print") {
    dispatch({ type: "SET_UTILITY", utility });
    setToolsOpen(false);
  }

  return (
    <header className="studio-commandbar no-print">
      <div className="command-report-meta">
        <span className="command-glow" aria-hidden="true" />
        <div><p>Night Shift Report</p><strong>{formatReportDate(report.reportDate)}</strong></div>
        <Badge tone={report.status === "finalized" ? "success" : "warning"}>{report.status === "finalized" ? "Finalized" : "Draft"}</Badge>
      </div>
      <div className="command-actions">
        <Badge className="save-state studio-save-state" tone={controller.status === "saved" ? "success" : controller.status === "saving" ? "warning" : "danger"} dot role="status" aria-live="polite">
          {controller.status === "saving" ? "Saving…" : controller.status === "error" ? "Save error" : "Saved"}
        </Badge>
        {report.status === "draft" && <div className="command-group"><IconButton icon={<IconUndo />} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!controller.undoAvailable} onClick={controller.undo} /><IconButton icon={<IconRedo />} aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!controller.redoAvailable} onClick={controller.redo} /></div>}
        {!workspace.inspectorOpen && <Button variant="quiet" icon={<IconSidebar />} onClick={() => dispatch({ type: "SET_INSPECTOR_OPEN", open: true })}>Inspector</Button>}
        <div className="tools-menu" ref={toolsRef}>
          <Button variant="quiet" icon={<IconWand />} aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)}>Tools</Button>
          {toolsOpen && (
            <div className="tools-popover" role="menu">
              <button role="menuitem" onClick={() => openUtility("directory")}><IconBuilding /><span><strong>Funeral homes</strong><small>Manage saved directory names</small></span></button>
              <button role="menuitem" onClick={() => openUtility("recovery")}><IconHistory /><span><strong>Recovery</strong><small>Revisions and database backups</small></span></button>
              <button role="menuitem" onClick={() => openUtility("print")}><IconSliders /><span><strong>Print setup</strong><small>Calibrate margins and scale</small></span></button>
            </div>
          )}
        </div>
        <div className="command-primary">
          {report.status === "draft" ? <Button variant="primary" icon={<IconCheck />} busy={controller.status === "saving"} onClick={() => void controller.finalize()}>Finalize</Button> : <Button variant="secondary" busy={controller.status === "saving"} onClick={() => void controller.reopen()}>Reopen</Button>}
          <Button variant="print" icon={<IconPrinter />} disabled={controller.overflow} title={controller.overflow ? "Fit the report on one page before printing." : undefined} onClick={() => void window.nightShift.printReport()}>{report.status === "draft" ? "Print draft" : "Print report"}</Button>
        </div>
      </div>
    </header>
  );
}

function PreviewCanvas({ report }: { report: NightReport }) {
  const controller = useReportController();
  const workspace = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();
  const toast = useToast();
  const canvasRef = useRef<HTMLElement>(null);
  const [fitZoom, setFitZoom] = useState(0.72);
  const zoom = workspace.zoomMode === "fit" ? fitZoom : workspace.zoom;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const widthScale = (canvas.clientWidth - 72) / 816;
      const heightScale = (canvas.clientHeight - 104) / 1056;
      setFitZoom(Math.min(0.9, Math.max(0.5, Math.min(widthScale, heightScale))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  function commitPreviewLine(sectionKey: SectionKey, entryId: string | null, value: string) {
    if (report.status !== "draft") return;
    const next = structuredClone(report);
    const section = next.sections.find((item) => item.key === sectionKey)!;
    const existingIndex = entryId ? section.entries.findIndex((entry) => entry.id === entryId) : -1;
    const existing = existingIndex >= 0 ? section.entries[existingIndex] : null;
    if (existingIndex >= 0) section.entries.splice(existingIndex, 1);
    const clean = value.trim();
    let parseWarning: string | undefined;
    if (clean) {
      const parsedLine = parsePastedLines(clean)[0];
      let parsed = parsedLine.entry;
      if (parsed.type === "plain" && (sectionKey === "cremated-deliver" || existing?.type === "funeralHomeOnly")) parsed = { ...parsed, type: "funeralHomeOnly", funeralHome: controller.canonicalFuneralHome(parsed.text) };
      if (parsed.type === "funeral" || parsed.type === "funeralHomeOnly") parsed.funeralHome = controller.canonicalFuneralHome(parsed.funeralHome);
      if (parsed.type === "plain") parseWarning = parsedLine.warning;
      if (existing) parsed = { ...parsed, id: existing.id, createdAt: existing.createdAt, rush: existing.rush || parsed.rush, keepSeparate: existing.keepSeparate };
      addEntry(section, parsed);
    }
    dispatch({ type: "SELECT_SECTION", sectionKey, mode: "create" });
    void controller.persist(next);
    if (parseWarning) toast.warning(parseWarning);
  }

  function movePreviewEntry(sourceKey: SectionKey, targetKey: SectionKey, entryId: string) {
    if (report.status !== "draft") return;
    const next = structuredClone(report);
    if (!moveEntry(next, sourceKey, targetKey, entryId)) return;
    dispatch({ type: "SELECT_SECTION", sectionKey: targetKey, mode: "browse" });
    void controller.persist(next);
  }

  return (
    <section className={`studio-canvas ${report.status}`} ref={canvasRef}>
      <div className="canvas-toolbar no-print">
        <div><p className="studio-kicker">Live canvas</p><span>Click a ruled line to type · drag entries between cards</span></div>
        <div className="canvas-controls">
          <div className="zoom-control" aria-label="Preview zoom">
            <IconButton icon={<IconMinus />} aria-label="Zoom out" title="Zoom out" onClick={() => dispatch({ type: "SET_ZOOM", zoom: zoom - 0.05 })} />
            <button type="button" className={workspace.zoomMode === "fit" ? "active" : ""} onClick={() => dispatch({ type: "FIT_ZOOM" })}>{workspace.zoomMode === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}</button>
            <IconButton icon={<IconPlus />} aria-label="Zoom in" title="Zoom in" onClick={() => dispatch({ type: "SET_ZOOM", zoom: zoom + 0.05 })} />
          </div>
          <Badge tone={report.status === "finalized" ? "success" : "warning"} dot>{report.status === "finalized" ? "Finalized" : "Draft canvas"}</Badge>
        </div>
      </div>
      <div className="canvas-scroll">
        <div className="page-stage" style={{ "--preview-scale": zoom } as CSSProperties}>
          <div className="page-stage-frame">
            <ReportPage
              report={report} layout={controller.layout!} compactLevel={controller.compactLevel} calibration={controller.calibration} interactive
              selectedSectionKey={workspace.selection.sectionKey}
              selectedEntryId={workspace.selection.kind === "entry" ? workspace.selection.entryId : undefined}
              onSelectSection={(sectionKey) => dispatch({ type: "SELECT_SECTION", sectionKey, mode: "create" })}
              onSelectEntry={(sectionKey, entryId) => dispatch({ type: "SELECT_ENTRY", sectionKey, entryId })}
              onLineCommit={report.status === "draft" ? commitPreviewLine : undefined}
              onEntryMove={report.status === "draft" ? movePreviewEntry : undefined}
              onWidthChange={(key, width) => controller.previewLayout({ ...controller.layout!, sectionWidths: { ...controller.layout!.sectionWidths, [key]: width } })}
              onWidthCommit={(key, width) => void controller.saveLayout({ ...controller.layout!, sectionWidths: { ...controller.layout!.sectionWidths, [key]: width } })}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function Studio() {
  const controller = useReportController();
  const workspace = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();
  const report = controller.report!;
  const utilityTitle = workspace.utility === "directory" ? "Funeral home directory" : workspace.utility === "recovery" ? "Recovery center" : "Print setup";
  const selectedSection = workspace.selection.sectionKey;

  return (
    <main className={`studio-shell${workspace.inspectorOpen ? " inspector-visible" : ""}`}>
      <CommandBar report={report} />
      {controller.overflow && <div className="overflow-warning no-print">Printing is paused because this report exceeds one page. Adjust card widths, print scale, or entries before printing.</div>}
      <div className="studio-workspace no-print"><ReportNavigator report={report} /><PreviewCanvas report={report} />{workspace.inspectorOpen && <Inspector report={report} />}</div>
      <div className="print-only"><ReportPage report={report} layout={controller.layout!} compactLevel={controller.compactLevel} calibration={controller.calibration} /></div>
      <Drawer open={workspace.utility !== null} title={utilityTitle} onClose={() => dispatch({ type: "SET_UTILITY", utility: null })}>
        {workspace.utility === "directory" && <FuneralHomeManager homes={controller.bootstrap!.funeralHomes} onUpdate={controller.updateFuneralHomes} />}
        {workspace.utility === "recovery" && <RecoveryPanel backups={controller.bootstrap!.backups} revisions={controller.revisions} onLoadRevisions={async () => controller.setRevisions(await window.nightShift.listRevisions(report.id))} onRestoreRevision={controller.restoreRevision} />}
        {workspace.utility === "print" && <PrintSettings layout={controller.layout!} calibration={controller.calibration} onCalibration={controller.setCalibration} onChange={(next) => void controller.saveLayout(next)} onResetSection={() => void controller.saveLayout({ ...controller.layout!, sectionWidths: { ...controller.layout!.sectionWidths, [selectedSection]: undefined } })} />}
      </Drawer>
    </main>
  );
}
