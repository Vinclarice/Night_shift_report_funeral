import { useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { MutationQueue } from "@/application/mutationQueue";
import { normalizeFuneralHome, titleCaseName } from "@/domain/entries";
import type { NightReport } from "@/domain/types";
import type { BootstrapData } from "@/shared/contracts";
import { useToast } from "../ui/Toast";
import type { SaveStatus } from "./ReportController";

const UNDO_HISTORY_LIMIT = 15;

export interface DraftActions {
  persist: (next: NightReport) => Promise<NightReport | null>;
  undo: () => void;
  redo: () => void;
  updateFuneralHomes: (homes: BootstrapData["funeralHomes"]) => void;
  refreshSupportingData: () => Promise<void>;
  canonicalFuneralHome: (value: string) => string;
}

/**
 * Everything that reads or writes the open draft: saving, undo/redo history, and the bootstrap
 * data (funeral-home directory, backups) that travels alongside it.
 */
export function useDraftActions(params: {
  queue: MutationQueue;
  versionRef: MutableRefObject<number>;
  reportRef: MutableRefObject<NightReport | null>;
  bootstrapRef: MutableRefObject<BootstrapData | null>;
  undoStackRef: MutableRefObject<NightReport[]>;
  redoStackRef: MutableRefObject<NightReport[]>;
  setBootstrap: Dispatch<SetStateAction<BootstrapData | null>>;
  setReport: Dispatch<SetStateAction<NightReport | null>>;
  setStatus: Dispatch<SetStateAction<SaveStatus>>;
  setLastSavedAt: Dispatch<SetStateAction<Date | null>>;
  setUndoAvailable: Dispatch<SetStateAction<boolean>>;
  setRedoAvailable: Dispatch<SetStateAction<boolean>>;
}): DraftActions {
  const {
    queue, versionRef, reportRef, bootstrapRef, undoStackRef, redoStackRef,
    setBootstrap, setReport, setStatus, setLastSavedAt, setUndoAvailable, setRedoAvailable,
  } = params;
  const toast = useToast();

  return useMemo<DraftActions>(() => {
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
      if (!current || !undoStackRef.current.length) return;
      const previous = undoStackRef.current.at(-1)!;
      undoStackRef.current = undoStackRef.current.slice(0, -1);
      redoStackRef.current = [...redoStackRef.current, structuredClone(current)].slice(-UNDO_HISTORY_LIMIT);
      setUndoAvailable(undoStackRef.current.length > 0);
      setRedoAvailable(true);
      void applyReport(previous);
    }

    function redo() {
      const current = reportRef.current;
      if (!current || !redoStackRef.current.length) return;
      const next = redoStackRef.current.at(-1)!;
      redoStackRef.current = redoStackRef.current.slice(0, -1);
      undoStackRef.current = [...undoStackRef.current, structuredClone(current)].slice(-UNDO_HISTORY_LIMIT);
      setRedoAvailable(redoStackRef.current.length > 0);
      setUndoAvailable(true);
      void applyReport(next);
    }

    return {
      persist(next) {
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
      updateFuneralHomes: (homes) => setBootstrap((current) => current ? { ...current, funeralHomes: homes } : current),
      canonicalFuneralHome(value) {
        const clean = titleCaseName(value);
        return bootstrapRef.current?.funeralHomes.find((home) => normalizeFuneralHome(home.name) === normalizeFuneralHome(clean))?.name ?? clean;
      },
    };
  }, [queue, toast, versionRef, reportRef, bootstrapRef, undoStackRef, redoStackRef, setBootstrap, setReport, setStatus, setLastSavedAt, setUndoAvailable, setRedoAvailable]);
}
