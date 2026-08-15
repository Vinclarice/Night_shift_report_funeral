import { useReportController } from "../state/ReportController";
import { useWorkspaceDispatch, useWorkspaceState } from "../state/WorkspaceContext";
import { Drawer } from "../ui/Drawer";
import { CommandBar } from "./CommandBar";
import { CommandPalette } from "./CommandPalette";
import { FuneralHomeManager } from "./FuneralHomeManager";
import { Inspector } from "./Inspector";
import { PreviewCanvas } from "./PreviewCanvas";
import { PrintSettings } from "./PrintSettings";
import { RecoveryPanel } from "./RecoveryPanel";
import { ReportPage } from "./ReportPage";

const UTILITY_TITLES: Record<string, string> = {
  directory: "Funeral home directory",
  recovery: "Recovery center",
  print: "Print setup",
};

/**
 * The shell that composes the studio's pieces once a report is open: command bar up top, then
 * inspector/canvas side by side, a hidden print-only copy of the page, and the drawer/palette
 * overlays. CommandBar and PreviewCanvas hold the actual interaction logic — this file is just
 * layout and wiring between them.
 */
export function Studio() {
  const controller = useReportController();
  const workspace = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();
  const report = controller.report!;
  const utilityTitle = UTILITY_TITLES[workspace.utility ?? ""] ?? "Tools";
  const selectedSection = workspace.selection.sectionKey;

  return (
    <main className={`studio-shell${workspace.inspectorOpen ? " inspector-visible" : ""}`}>
      <CommandBar report={report} />
      {controller.overflow && <div className="overflow-warning no-print">Printing is paused because this report exceeds one page. Adjust card widths, print scale, or entries before printing.</div>}
      {/* Inspector, canvas. Picking a section and typing into it are the two things done on every
          entry, so they sit adjacent; the canvas is mostly read and is given the rest. */}
      <div className="studio-workspace no-print">{workspace.inspectorOpen && <Inspector report={report} />}<PreviewCanvas report={report} /></div>
      <div className="print-only"><ReportPage report={report} layout={controller.layout!} dateOverride={controller.dateOverride} printedAt={controller.printedAt} compactLevel={controller.compactLevel} calibration={controller.calibration} /></div>
      <Drawer open={workspace.utility !== null} title={utilityTitle} onClose={() => dispatch({ type: "SET_UTILITY", utility: null })}>
        {workspace.utility === "directory" && <FuneralHomeManager homes={controller.bootstrap!.funeralHomes} onUpdate={controller.updateFuneralHomes} />}
        {workspace.utility === "recovery" && <RecoveryPanel backups={controller.bootstrap!.backups} />}
        {workspace.utility === "print" && <PrintSettings layout={controller.layout!} calibration={controller.calibration} onCalibration={controller.setCalibration} onChange={(next) => void controller.saveLayout(next)} onResetSection={() => void controller.resetSectionWidth(selectedSection)} />}
      </Drawer>
      <CommandPalette report={report} />
    </main>
  );
}
