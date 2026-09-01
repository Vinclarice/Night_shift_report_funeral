import { useEffect, useRef, useState } from "react";

import { OPTIONAL_SECTIONS } from "@/domain/report";
import type { NightReport, SectionKey } from "@/domain/types";
import { IconBuilding, IconCheck, IconHistory, IconPrinter, IconRedo, IconRoad, IconSidebar, IconSliders, IconUndo, IconWand } from "../icons";
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
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  function toggleSection(key: SectionKey) {
    const hidden = report.hiddenSections.includes(key);
    void controller.persist({
      ...report,
      hiddenSections: hidden ? report.hiddenSections.filter((candidate) => candidate !== key) : [...report.hiddenSections, key],
    });
  }
  /**
   * Says what putting a card away would cost before it is done. A hidden card keeps its entries and
   * gives them back when it returns, but nothing on the sheet would say so once they were gone.
   */
  function sectionTitle(key: SectionKey, title: string): string {
    const entries = report.sections.find((section) => section.key === key)?.entries.length ?? 0;
    if (report.hiddenSections.includes(key)) return `Put ${title} back on the sheet.`;
    if (!entries) return `Take ${title} off the sheet.`;
    return `Take ${title} off the sheet. Its ${entries === 1 ? "entry is" : `${entries} entries are`} kept and come back with it.`;
  }
  const shownDate = controller.dateOverride ?? report.reportDate;
  const overridden = controller.dateOverride !== null && controller.dateOverride !== report.reportDate;

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false);
      if (!sectionsRef.current?.contains(event.target as Node)) setSectionsOpen(false);
      if (!dateRef.current?.contains(event.target as Node)) setDateOpen(false);
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
        {/* The date is normally set by the clock; clicking it opens the manual override for the
            nights that lands on the wrong day. The override is session-only by design — see
            ReportState.dateOverride. */}
        <div className="command-date" ref={dateRef}>
          <p>Night Shift Report</p>
          {/* The hint names the action rather than the feature. It used to read "manual date
              override", which described a setting and — sitting under a date that had not been
              overridden — read as a claim that it had. Standing rather than on-hover: whoever
              comes in mid-shift needs to see the date can be changed without going looking. */}
          <button type="button" className={`command-date-button${overridden ? " overridden" : ""}`} aria-expanded={dateOpen} title="Change the date on this report" onClick={() => setDateOpen((open) => !open)}>
            <strong>{formatReportDate(shownDate)}</strong>
            {overridden && <span className="command-date-flag">Manual</span>}
            <small className="command-date-hint">Change date</small>
          </button>
          {dateOpen && (
            <div className="date-popover">
              <label htmlFor="report-date-override">Report date</label>
              <input
                id="report-date-override"
                type="date"
                value={shownDate}
                onChange={(event) => controller.setDateOverride(event.target.value || null)}
              />
              <p>Changes the date shown on the page and on print. It is not saved — reopening the app puts it back to {formatReportDate(report.reportDate)}.</p>
              <Button variant="quiet" disabled={!overridden} onClick={() => controller.setDateOverride(null)}>Reset to {formatReportDate(report.reportDate)}</Button>
            </div>
          )}
        </div>
      </div>
      {/* Empty space between the two clusters is the window drag handle. */}
      <div className="command-drag-region" aria-hidden="true" />
      <div className="command-actions">
        <Badge className="save-state studio-save-state" tone={controller.status === "saved" ? "success" : controller.status === "saving" ? "warning" : "danger"} dot role="status" aria-live="polite">
          {controller.status === "saving" ? "Saving…" : controller.status === "error" ? "Save error" : "Saved"}
        </Badge>
        <div className="command-group"><IconButton icon={<IconUndo />} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!controller.undoAvailable} onClick={controller.undo} /><IconButton icon={<IconRedo />} aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!controller.redoAvailable} onClick={controller.redo} /></div>
        {/* Most nights have no road trip, so the card is off and this reads as an invitation to add
            it. On the nights that do, it reads as the way to put it away again. The count in the
            title is there because hiding a card with entries still in it keeps them, and someone
            should be able to see that before they do it. */}
        {/* One menu rather than a button per card. Three of them would crowd the bar, and they are
            the same kind of decision — which cards tonight's sheet carries — so they belong
            together. A tick shows what is on the sheet now; the count says what a card is holding,
            since putting one away with entries in it keeps them out of sight. */}
        <div className="tools-menu" ref={sectionsRef}>
          <Button variant="quiet" icon={<IconRoad />} aria-expanded={sectionsOpen} onClick={() => setSectionsOpen((open) => !open)}>Sections</Button>
          {sectionsOpen && (
            <div className="tools-popover" role="menu">
              {OPTIONAL_SECTIONS.map(({ key, title }) => {
                const shown = !report.hiddenSections.includes(key);
                const entries = report.sections.find((section) => section.key === key)?.entries.length ?? 0;
                return (
                  <button key={key} role="menuitemcheckbox" aria-checked={shown} title={sectionTitle(key, title)} onClick={() => toggleSection(key)}>
                    <span className="section-tick">{shown ? <IconCheck /> : null}</span>
                    <span><strong>{title}</strong><small>{shown ? (entries ? `On the sheet · ${entries} ${entries === 1 ? "entry" : "entries"}` : "On the sheet") : entries ? `Put away · ${entries} kept` : "Put away"}</small></span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
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
          <Button variant="print" icon={<IconPrinter />} disabled={controller.overflow} title={controller.overflow ? "Fit the report on one page before printing." : undefined} onClick={() => void controller.printReport()}>Print report</Button>
        </div>
        <WindowControls />
      </div>
    </header>
  );
}
