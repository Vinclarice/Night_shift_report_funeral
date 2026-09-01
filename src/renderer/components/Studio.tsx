import { useSecondPageSplit } from "../hooks/useSecondPageSplit";
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
  // Where each section is cut between the two sheets, measured off the live canvas.
  const entryLimits = useSecondPageSplit(controller.allowSecondPage, report);

  return (
    <main className={`studio-shell${workspace.inspectorOpen ? " inspector-visible" : ""}`}>
      <CommandBar report={report} />
      {/* One list for the whole studio rather than one per input. It used to live inside the
          inspector's entry form, which meant the canvas could not offer the same names — the
          list simply was not in the document unless the inspector happened to be open on a
          funeral-shaped entry. Rendered here it is always there for anything that wants it. */}
      <datalist id="funeral-home-options">
        {(controller.bootstrap?.funeralHomes ?? []).map((home) => <option key={home.id} value={home.name} />)}
      </datalist>
      {controller.overflow && (
        <div className="overflow-warning no-print">
          <span>Printing is paused because this report exceeds one page even at its smallest. Adjust card widths, print scale, or entries — or print it across two sheets.</span>
          <button type="button" onClick={() => controller.setAllowSecondPage(true)}>Print on two sheets</button>
        </div>
      )}
      {controller.allowSecondPage && !controller.overflow && (
        <div className="overflow-warning second-page no-print">
          <span>This report is printing across two sheets. Everything that does not fit the first carries on overleaf.</span>
          <button type="button" onClick={() => controller.setAllowSecondPage(false)}>Back to one sheet</button>
        </div>
      )}
      {/* Inspector, canvas. Picking a section and typing into it are the two things done on every
          entry, so they sit adjacent; the canvas is mostly read and is given the rest. */}
      <div className="studio-workspace no-print">{workspace.inspectorOpen && <Inspector report={report} />}<PreviewCanvas report={report} /></div>
      {/* The sheet that actually reaches the printer. Split in two only when a night has been
          allowed a second one: the first keeps what fits, the second carries the rest, and each is
          a full sheet of its own because .report-page already breaks the page after itself. */}
      <div className="print-only">
        <ReportPage report={report} layout={controller.layout!} dateOverride={controller.dateOverride} printedAt={controller.printedAt} tighten={controller.tighten} calibration={controller.calibration} entryLimits={entryLimits ?? undefined} pageLabel={entryLimits ? "PAGE 1 OF 2" : undefined} />
        {entryLimits && <ReportPage report={report} layout={controller.layout!} dateOverride={controller.dateOverride} printedAt={controller.printedAt} tighten={controller.tighten} calibration={controller.calibration} entryLimits={entryLimits} continuation pageLabel="PAGE 2 OF 2" />}
      </div>
      <Drawer open={workspace.utility !== null} title={utilityTitle} onClose={() => dispatch({ type: "SET_UTILITY", utility: null })}>
        {workspace.utility === "directory" && <FuneralHomeManager homes={controller.bootstrap!.funeralHomes} onUpdate={controller.updateFuneralHomes} />}
        {workspace.utility === "recovery" && <RecoveryPanel backups={controller.bootstrap!.backups} />}
        {workspace.utility === "print" && <PrintSettings layout={controller.layout!} calibration={controller.calibration} onCalibration={controller.setCalibration} onChange={(next) => void controller.saveLayout(next)} onResetSection={() => void controller.resetSectionWidth(selectedSection)} onResetCardWidths={() => void controller.resetCardWidths()} onResetPrinterDefaults={() => void controller.resetPrinterDefaults()} customCardWidths={Object.keys(controller.layout!.sectionWidths).length} />}
      </Drawer>
      <CommandPalette report={report} />
    </main>
  );
}
