import { useEffect, useRef, useState } from "react";

import type { NightReport } from "@/domain/types";
import { IconBuilding, IconHistory, IconPrinter, IconRedo, IconSidebar, IconSliders, IconUndo, IconWand } from "../icons";
import { useReportController } from "../state/ReportController";
import { useWorkspaceDispatch, useWorkspaceState } from "../state/WorkspaceContext";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { WindowControls } from "./TitleBar";

function formatReportDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

/**
 * The studio's top chrome: report identity on the left, save state and the primary actions
 * (undo/redo, inspector toggle, secondary-tools menu, print) on the right, with the empty
 * space between doubling as the frameless window's drag handle.
 */
export function CommandBar({ report }: { report: NightReport }) {
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
      </div>
      {/* Empty space between the two clusters is the window drag handle. */}
      <div className="command-drag-region" aria-hidden="true" />
      <div className="command-actions">
        <Badge className="save-state studio-save-state" tone={controller.status === "saved" ? "success" : controller.status === "saving" ? "warning" : "danger"} dot role="status" aria-live="polite">
          {controller.status === "saving" ? "Saving…" : controller.status === "error" ? "Save error" : "Saved"}
        </Badge>
        <div className="command-group"><IconButton icon={<IconUndo />} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!controller.undoAvailable} onClick={controller.undo} /><IconButton icon={<IconRedo />} aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!controller.redoAvailable} onClick={controller.redo} /></div>
        {!workspace.inspectorOpen && <Button variant="quiet" icon={<IconSidebar />} onClick={() => dispatch({ type: "SET_INSPECTOR_OPEN", open: true })}>Inspector</Button>}
        <div className="tools-menu" ref={toolsRef}>
          <Button variant="quiet" icon={<IconWand />} aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)}>Tools</Button>
          {toolsOpen && (
            <div className="tools-popover" role="menu">
              <button role="menuitem" onClick={() => openUtility("directory")}><IconBuilding /><span><strong>Funeral homes</strong><small>Manage saved directory names</small></span></button>
              <button role="menuitem" onClick={() => openUtility("recovery")}><IconHistory /><span><strong>Recovery</strong><small>Restore a database backup</small></span></button>
              <button role="menuitem" onClick={() => openUtility("print")}><IconSliders /><span><strong>Print setup</strong><small>Calibrate margins and scale</small></span></button>
            </div>
          )}
        </div>
        <div className="command-primary">
          <Button variant="print" icon={<IconPrinter />} disabled={controller.overflow} title={controller.overflow ? "Fit the report on one page before printing." : undefined} onClick={() => void window.nightShift.printReport()}>Print report</Button>
        </div>
        <WindowControls />
      </div>
    </header>
  );
}
