import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { MutationQueue } from "@/application/mutationQueue";
import { normalizeFuneralHome, titleCaseName } from "@/domain/entries";
import type { LayoutSettings, NightReport } from "@/domain/types";
import type { BootstrapData, ReportSummary } from "@/shared/contracts";
import { useOverflowCompaction } from "../hooks/useOverflowCompaction";
import { useToast } from "../ui/Toast";

export type SaveStatus = "loading" | "saved" | "saving" | "error";
export type RevisionSummary = { id: string; revisionNumber: number; finalizedAt: string };

/**
 * State changes on nearly every interaction; actions never do. They are split into two contexts
 * (mirroring WorkspaceContext's state/dispatch split) so that a component needing only actions —
 * the command palette, for example — does not re-render on every keystroke.
 */
export interface ReportState {
  bootstrap: BootstrapData | null;
  report: NightReport | null;
  layout: LayoutSettings | null;
  status: SaveStatus;
  lastSavedAt: Date | null;
  calibration: boolean;
  revisions: RevisionSummary[];
  undoAvailable: boolean;
  redoAvailable: boolean;
  compactLevel: 0 | 1;
  overflow: boolean;
  archive: ReportSummary[];
  archiveReport: NightReport | null;
}

export interface ReportActions {
  createDraft: (mode: "empty" | "clone") => Promise<void>;
  resumeDraft: () => void;
  persist: (next: NightReport) => Promise<NightReport | null>;
  undo: () => void;
  redo: () => void;
  finalize: () => Promise<void>;
  reopen: () => Promise<void>;
  saveLayout: (next: LayoutSettings) => Promise<void>;
  previewLayout: (next: LayoutSettings) => void;
  setCalibration: (value: boolean) => void;
  setRevisions: React.Dispatch<React.SetStateAction<RevisionSummary[]>>;
  updateFuneralHomes: (homes: BootstrapData["funeralHomes"]) => void;
  refreshSupportingData: () => Promise<void>;
  restoreRevision: (revisionId: string) => Promise<void>;
  canonicalFuneralHome: (value: string) => string;
  loadArchive: () => Promise<void>;
  openArchiveReport: (id: string) => Promise<void>;
  closeArchiveReport: () => void;
  printArchiveReport: (id: string) => Promise<void>;
}

const ReportStateContext = createContext<ReportState | null>(null);
const ReportActionsContext = createContext<ReportActions | null>(null);
const UNDO_HISTORY_LIMIT = 15;

export function ReportControllerProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [report, setReport] = useState<NightReport | null>(null);
  const [layout, setLayout] = useState<LayoutSettings | null>(null);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [calibration, setCalibration] = useState(false);
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [redoAvailable, setRedoAvailable] = useState(false);
  const [archive, setArchive] = useState<ReportSummary[]>([]);
  const [archiveReport, setArchiveReport] = useState<NightReport | null>(null);
  const queue = useMemo(() => new MutationQueue(), []);
  const versionRef = useRef(0);
  const reportRef = useRef<NightReport | null>(null);
  const layoutRef = useRef<LayoutSettings | null>(null);
  const bootstrapRef = useRef<BootstrapData | null>(null);
  const undoStackRef = useRef<NightReport[]>([]);
  const redoStackRef = useRef<NightReport[]>([]);
  const { compactLevel, overflow } = useOverflowCompaction(report, layout);

  // Every action below reads live values through refs rather than closing over state, which is what
  // lets the actions object be built exactly once. Keeping bootstrap mirrored here is what allows
  // canonicalFuneralHome to stay identity-stable despite depending on the funeral-home directory.
  useEffect(() => { bootstrapRef.current = bootstrap; }, [bootstrap]);

  const actions = useMemo<ReportActions>(() => {
    function resetUndoHistory() {
      undoStackRef.current = [];
      redoStackRef.current = [];
      setUndoAvailable(false);
      setRedoAvailable(false);
    }

    async function refreshSupportingData() {
      const data = await window.nightShift.bootstrap();
      setBootstrap((current) => current ? { ...current, funeralHomes: data.funeralHomes, backups: data.backups } : data);
    }

    function applyReport(next: NightReport) {
      reportRef.current = next;
      setReport(next);
      setStatus("saving");
      return queue.enqueue(async () => {
        const saved = await window.nightShift.saveReport(next, versionRef.current);
        versionRef.current = saved.version;
        reportRef.current = { ...saved };
        setReport(saved);
        setStatus("saved");
        setLastSavedAt(new Date());
        await refreshSupportingData();
        return saved;
      }).catch((error: Error) => {
        setStatus("error");
        toast.error(error.message);
        return null;
      });
    }

    function undo() {
      const current = reportRef.current;
      if (!current || current.status !== "draft" || !undoStackRef.current.length) return;
      const previous = undoStackRef.current.at(-1)!;
      undoStackRef.current = undoStackRef.current.slice(0, -1);
      redoStackRef.current = [...redoStackRef.current, structuredClone(current)].slice(-UNDO_HISTORY_LIMIT);
      setUndoAvailable(undoStackRef.current.length > 0);
      setRedoAvailable(true);
      void applyReport(previous);
    }

    function redo() {
      const current = reportRef.current;
      if (!current || current.status !== "draft" || !redoStackRef.current.length) return;
      const next = redoStackRef.current.at(-1)!;
      redoStackRef.current = redoStackRef.current.slice(0, -1);
      undoStackRef.current = [...undoStackRef.current, structuredClone(current)].slice(-UNDO_HISTORY_LIMIT);
      setRedoAvailable(redoStackRef.current.length > 0);
      setUndoAvailable(true);
      void applyReport(next);
    }

    return {
      persist(next: NightReport) {
        if (reportRef.current) {
          undoStackRef.current = [...undoStackRef.current, structuredClone(reportRef.current)].slice(-UNDO_HISTORY_LIMIT);
          setUndoAvailable(true);
        }
        redoStackRef.current = [];
        setRedoAvailable(false);
        return applyReport(next);
      },
      undo,
      redo,
      refreshSupportingData,
      async createDraft(mode: "empty" | "clone") {
        setStatus("saving");
        const created = await window.nightShift.createDraft(mode);
        reportRef.current = created;
        versionRef.current = created.version;
        setReport(created);
        resetUndoHistory();
        setStatus("saved");
      },
      // Opens the stranded draft that bootstrap already loaded. Nothing is written here: the report
      // is unchanged until the next edit, so resuming and then closing leaves it exactly as it was.
      resumeDraft() {
        const draft = bootstrapRef.current?.resumableDraft;
        if (!draft) return;
        reportRef.current = draft;
        versionRef.current = draft.version;
        setReport(draft);
        resetUndoHistory();
        setStatus("saved");
      },
      async finalize() {
        await queue.drain();
        const current = reportRef.current;
        if (!current) return;
        setStatus("saving");
        try {
          const saved = await window.nightShift.finalizeReport(current, versionRef.current);
          reportRef.current = saved;
          versionRef.current = saved.version;
          setReport(saved);
          setStatus("saved");
          resetUndoHistory();
          setRevisions(await window.nightShift.listRevisions(saved.id));
          await refreshSupportingData();
        } catch (error) {
          setStatus("error");
          toast.error((error as Error).message);
        }
      },
      async reopen() {
        const current = reportRef.current;
        if (!current) return;
        setStatus("saving");
        try {
          const saved = await window.nightShift.reopenReport(current, versionRef.current);
          reportRef.current = saved;
          versionRef.current = saved.version;
          setReport(saved);
          setStatus("saved");
          resetUndoHistory();
          setRevisions(await window.nightShift.listRevisions(saved.id));
        } catch (error) {
          setStatus("error");
          toast.error((error as Error).message);
        }
      },
      async saveLayout(next: LayoutSettings) {
        setLayout(next);
        layoutRef.current = next;
        try {
          const saved = await window.nightShift.saveLayout(next);
          layoutRef.current = saved;
          setLayout(saved);
        } catch (error) {
          toast.warning((error as Error).message);
        }
      },
      previewLayout(next: LayoutSettings) {
        layoutRef.current = next;
        setLayout(next);
      },
      setCalibration,
      setRevisions,
      updateFuneralHomes: (homes) => setBootstrap((current) => current ? { ...current, funeralHomes: homes } : current),
      async restoreRevision(revisionId: string) {
        const current = reportRef.current;
        if (!current) return;
        const restored = await window.nightShift.restoreRevision(current.id, revisionId, versionRef.current);
        reportRef.current = restored;
        versionRef.current = restored.version;
        setReport(restored);
        resetUndoHistory();
      },
      canonicalFuneralHome(value: string) {
        const clean = titleCaseName(value);
        return bootstrapRef.current?.funeralHomes.find((home) => normalizeFuneralHome(home.name) === normalizeFuneralHome(clean))?.name ?? clean;
      },
      async loadArchive() {
        try {
          setArchive(await window.nightShift.listReports());
        } catch (error) {
          toast.error((error as Error).message);
        }
      },
      async openArchiveReport(id: string) {
        try {
          setArchiveReport(await window.nightShift.loadReport(id));
        } catch (error) {
          toast.error((error as Error).message);
        }
      },
      closeArchiveReport() {
        setArchiveReport(null);
      },
      // Printing targets whatever currently occupies the hidden .print-only element, so an archived
      // report has to be staged there first and cleared afterwards. Without the restore in `finally`
      // an archive reprint would leave the wrong report staged for the next Print button press.
      async printArchiveReport(id: string) {
        try {
          const staged = await window.nightShift.loadReport(id);
          if (!staged) return;
          setArchiveReport(staged);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await window.nightShift.printReport();
        } catch (error) {
          toast.error((error as Error).message);
        }
      },
    };
  }, [queue, toast]);

  useEffect(() => {
    let active = true;
    window.nightShift.bootstrap().then((data) => {
      if (!active) return;
      setBootstrap(data);
      bootstrapRef.current = data;
      setReport(data.report);
      reportRef.current = data.report;
      versionRef.current = data.report?.version ?? 0;
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
    bootstrap, report, layout, status, lastSavedAt, calibration, revisions,
    undoAvailable, redoAvailable, compactLevel, overflow, archive, archiveReport,
  }), [bootstrap, report, layout, status, lastSavedAt, calibration, revisions, undoAvailable, redoAvailable, compactLevel, overflow, archive, archiveReport]);

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
