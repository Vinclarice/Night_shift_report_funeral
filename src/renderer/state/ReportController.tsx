import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { MutationQueue } from "@/application/mutationQueue";
import type { LayoutSettings, NightReport } from "@/domain/types";
import type { BootstrapData } from "@/shared/contracts";
import { useOverflowCompaction } from "../hooks/useOverflowCompaction";
import type { CompactLevel } from "../hooks/useOverflowCompaction";
import { useToast } from "../ui/Toast";
import type { DraftActions } from "./useDraftActions";
import { useDraftActions } from "./useDraftActions";
import type { LayoutActions } from "./useLayoutActions";
import { useLayoutActions } from "./useLayoutActions";

export type SaveStatus = "loading" | "saved" | "saving" | "error";

/**
 * State changes on nearly every interaction; actions never do. They are split into two contexts
 * (mirroring WorkspaceContext's state/dispatch split) so that a component needing only actions —
 * the command palette, for example — does not re-render on every keystroke.
 */
export interface ReportState {
  bootstrap: BootstrapData | null;
  report: NightReport | null;
  layout: LayoutSettings | null;
  /**
   * A hand-typed date shown in place of the report's own, for the nights when the automatic one is
   * wrong. Deliberately kept out of the report and off disk: it lives only in this provider, so
   * closing the app drops it and the report goes back to being dated by the clock.
   */
  dateOverride: string | null;
  /**
   * When the sheet was last sent to the printer, so two copies of the same night can be told
   * apart. Session-only like dateOverride: a stamp carried over from a previous launch would
   * describe a sheet nobody is holding.
   */
  printedAt: Date | null;
  status: SaveStatus;
  lastSavedAt: Date | null;
  calibration: boolean;
  undoAvailable: boolean;
  redoAvailable: boolean;
  compactLevel: CompactLevel;
  overflow: boolean;
}

/**
 * The full action surface, composed from two focused hooks below — draft persistence/undo and
 * layout. Consumers only ever see this combined interface; which hook actually owns a given
 * action is an implementation detail of the provider.
 */
export type ReportActions = DraftActions & LayoutActions & {
  /** Pass null to drop the manual date and go back to the report's own. */
  setDateOverride: (date: string | null) => void;
  /** Stamps the print time onto the page, then prints. */
  printReport: () => Promise<void>;
};

const ReportStateContext = createContext<ReportState | null>(null);
const ReportActionsContext = createContext<ReportActions | null>(null);

export function ReportControllerProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [report, setReport] = useState<NightReport | null>(null);
  const [layout, setLayout] = useState<LayoutSettings | null>(null);
  const [dateOverride, setDateOverride] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState<Date | null>(null);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [calibration, setCalibration] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [redoAvailable, setRedoAvailable] = useState(false);
  const queue = useMemo(() => new MutationQueue(), []);
  const versionRef = useRef(0);
  const reportRef = useRef<NightReport | null>(null);
  const layoutRef = useRef<LayoutSettings | null>(null);
  const bootstrapRef = useRef<BootstrapData | null>(null);
  const undoStackRef = useRef<NightReport[]>([]);
  const redoStackRef = useRef<NightReport[]>([]);
  const { compactLevel, overflow } = useOverflowCompaction(report, layout);

  // Every action below reads live values through refs rather than closing over state, which is what
  // lets each action hook's returned object be built exactly once. Keeping bootstrap mirrored here
  // is what allows canonicalFuneralHome to stay identity-stable despite depending on the
  // funeral-home directory.
  useEffect(() => { bootstrapRef.current = bootstrap; }, [bootstrap]);

  const draftActions = useDraftActions({
    queue, versionRef, reportRef, bootstrapRef, undoStackRef, redoStackRef,
    setBootstrap, setReport, setStatus, setLastSavedAt, setUndoAvailable, setRedoAvailable,
  });
  const layoutActions = useLayoutActions({ layoutRef, setLayout, setCalibration });

  // Chromium prints whatever is in the DOM when it is asked, so the stamp has to be committed
  // and painted first — hence the two frames. Owning both halves here keeps the ordering in one
  // place rather than leaving each caller to remember it.
  const printReport = useCallback(async () => {
    setPrintedAt(new Date());
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await window.nightShift.printReport();
  }, []);

  const actions = useMemo<ReportActions>(
    () => ({ ...draftActions, ...layoutActions, setDateOverride, printReport }),
    [draftActions, layoutActions, printReport],
  );

  useEffect(() => {
    let active = true;
    window.nightShift.bootstrap().then((data) => {
      if (!active) return;
      setBootstrap(data);
      bootstrapRef.current = data;
      setReport(data.report);
      reportRef.current = data.report;
      versionRef.current = data.report.version;
      setLayout(data.layout);
      layoutRef.current = data.layout;
      undoStackRef.current = [];
      redoStackRef.current = [];
      setUndoAvailable(false);
      setRedoAvailable(false);
      setStatus("saved");
    }).catch((error: Error) => {
      setStatus("error");
      toast.error(error.message);
    });
    return () => { active = false; };
  }, [toast]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editable = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (editable || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        actions.undo();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        actions.redo();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [actions]);

  const state = useMemo<ReportState>(() => ({
    bootstrap, report, layout, dateOverride, printedAt, status, lastSavedAt, calibration,
    undoAvailable, redoAvailable, compactLevel, overflow,
  }), [bootstrap, report, layout, dateOverride, printedAt, status, lastSavedAt, calibration, undoAvailable, redoAvailable, compactLevel, overflow]);

  return (
    <ReportStateContext.Provider value={state}>
      <ReportActionsContext.Provider value={actions}>{children}</ReportActionsContext.Provider>
    </ReportStateContext.Provider>
  );
}

export function useReportState() {
  const state = useContext(ReportStateContext);
  if (!state) throw new Error("useReportState must be used within ReportControllerProvider");
  return state;
}

export function useReportActions() {
  const actions = useContext(ReportActionsContext);
  if (!actions) throw new Error("useReportActions must be used within ReportControllerProvider");
  return actions;
}

/**
 * Compatibility shim for call sites that still expect the single combined object. Subscribes to
 * both contexts, so prefer useReportState / useReportActions directly in new code.
 */
export function useReportController(): ReportState & ReportActions {
  const state = useReportState();
  const actions = useReportActions();
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}
