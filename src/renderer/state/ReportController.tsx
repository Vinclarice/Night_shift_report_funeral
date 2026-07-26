import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { MutationQueue } from "@/application/mutationQueue";
import { normalizeFuneralHome, titleCaseName } from "@/domain/entries";
import type { LayoutSettings, NightReport } from "@/domain/types";
import type { BootstrapData } from "@/shared/contracts";
import { useOverflowCompaction } from "../hooks/useOverflowCompaction";
import { useToast } from "../ui/Toast";

export type SaveStatus = "loading" | "saved" | "saving" | "error";

interface ReportControllerValue {
  bootstrap: BootstrapData | null;
  report: NightReport | null;
  layout: LayoutSettings | null;
  status: SaveStatus;
  lastSavedAt: Date | null;
  calibration: boolean;
  revisions: Array<{ id: string; revisionNumber: number; finalizedAt: string }>;
  undoAvailable: boolean;
  redoAvailable: boolean;
  compactLevel: 0 | 1;
  overflow: boolean;
  createDraft: (mode: "empty" | "clone") => Promise<void>;
  persist: (next: NightReport) => Promise<NightReport | null>;
  undo: () => void;
  redo: () => void;
  finalize: () => Promise<void>;
  reopen: () => Promise<void>;
  saveLayout: (next: LayoutSettings) => Promise<void>;
  previewLayout: (next: LayoutSettings) => void;
  setCalibration: (value: boolean) => void;
  setRevisions: React.Dispatch<React.SetStateAction<Array<{ id: string; revisionNumber: number; finalizedAt: string }>>>;
  updateFuneralHomes: (homes: BootstrapData["funeralHomes"]) => void;
  refreshSupportingData: () => Promise<void>;
  restoreRevision: (revisionId: string) => Promise<void>;
  canonicalFuneralHome: (value: string) => string;
}

const ReportControllerContext = createContext<ReportControllerValue | null>(null);
const UNDO_HISTORY_LIMIT = 15;

export function ReportControllerProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [report, setReport] = useState<NightReport | null>(null);
  const [layout, setLayout] = useState<LayoutSettings | null>(null);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [calibration, setCalibration] = useState(false);
  const [revisions, setRevisions] = useState<Array<{ id: string; revisionNumber: number; finalizedAt: string }>>([]);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [redoAvailable, setRedoAvailable] = useState(false);
  const queue = useMemo(() => new MutationQueue(), []);
  const versionRef = useRef(0);
  const reportRef = useRef<NightReport | null>(null);
  const layoutRef = useRef<LayoutSettings | null>(null);
  const undoStackRef = useRef<NightReport[]>([]);
  const redoStackRef = useRef<NightReport[]>([]);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const { compactLevel, overflow } = useOverflowCompaction(report, layout);

  function resetUndoHistory() {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoAvailable(false);
    setRedoAvailable(false);
  }

  useEffect(() => {
    let active = true;
    window.nightShift.bootstrap().then((data) => {
      if (!active) return;
      setBootstrap(data);
      setReport(data.report);
      reportRef.current = data.report;
      versionRef.current = data.report?.version ?? 0;
      setLayout(data.layout);
      layoutRef.current = data.layout;
      resetUndoHistory();
      setStatus("saved");
    }).catch((error: Error) => {
      setStatus("error");
      toast.error(error.message);
    });
    return () => { active = false; };
  }, [toast]);

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

  function persist(next: NightReport) {
    if (reportRef.current) {
      undoStackRef.current = [...undoStackRef.current, structuredClone(reportRef.current)].slice(-UNDO_HISTORY_LIMIT);
      setUndoAvailable(true);
    }
    redoStackRef.current = [];
    setRedoAvailable(false);
    return applyReport(next);
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
  useEffect(() => {
    undoRef.current = undo;
    redoRef.current = redo;
  });

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editable = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (editable || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoRef.current();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redoRef.current();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function createDraft(mode: "empty" | "clone") {
    setStatus("saving");
    const created = await window.nightShift.createDraft(mode);
    reportRef.current = created;
    versionRef.current = created.version;
    setReport(created);
    resetUndoHistory();
    setStatus("saved");
  }

  async function finalize() {
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
  }

  async function reopen() {
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
  }

  async function saveLayout(next: LayoutSettings) {
    setLayout(next);
    layoutRef.current = next;
    try {
      const saved = await window.nightShift.saveLayout(next);
      layoutRef.current = saved;
      setLayout(saved);
    } catch (error) {
      toast.warning((error as Error).message);
    }
  }

  function previewLayout(next: LayoutSettings) {
    layoutRef.current = next;
    setLayout(next);
  }

  async function restoreRevision(revisionId: string) {
    const current = reportRef.current;
    if (!current) return;
    const restored = await window.nightShift.restoreRevision(current.id, revisionId, versionRef.current);
    reportRef.current = restored;
    versionRef.current = restored.version;
    setReport(restored);
    resetUndoHistory();
  }

  function canonicalFuneralHome(value: string) {
    const clean = titleCaseName(value);
    return bootstrap?.funeralHomes.find((home) => normalizeFuneralHome(home.name) === normalizeFuneralHome(clean))?.name ?? clean;
  }

  const value: ReportControllerValue = {
    bootstrap, report, layout, status, lastSavedAt, calibration, revisions,
    undoAvailable, redoAvailable, compactLevel, overflow,
    createDraft, persist, undo, redo, finalize, reopen, saveLayout, previewLayout,
    setCalibration, setRevisions,
    updateFuneralHomes: (homes) => setBootstrap((current) => current ? { ...current, funeralHomes: homes } : current),
    refreshSupportingData, restoreRevision, canonicalFuneralHome,
  };

  return <ReportControllerContext.Provider value={value}>{children}</ReportControllerContext.Provider>;
}

export function useReportController() {
  const value = useContext(ReportControllerContext);
  if (!value) throw new Error("useReportController must be used within ReportControllerProvider");
  return value;
}
