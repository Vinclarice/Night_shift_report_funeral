import { useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { MutationQueue } from "@/application/mutationQueue";
import { normalizeFuneralHome, titleCaseName } from "@/domain/entries";
import type { NightReport } from "@/domain/types";
import type { BootstrapData } from "@/shared/contracts";
import { useToast } from "../ui/Toast";
import type { RevisionSummary, SaveStatus } from "./ReportController";

const UNDO_HISTORY_LIMIT = 15;

export interface DraftActions {
  createDraft: (mode: "empty" | "clone") => Promise<void>;
  resumeDraft: () => void;
  persist: (next: NightReport) => Promise<NightReport | null>;
  undo: () => void;
  redo: () => void;
  finalize: () => Promise<void>;
  reopen: () => Promise<void>;
  setRevisions: Dispatch<SetStateAction<RevisionSummary[]>>;
  updateFuneralHomes: (homes: BootstrapData["funeralHomes"]) => void;
  refreshSupportingData: () => Promise<void>;
  restoreRevision: (revisionId: string) => Promise<void>;
  canonicalFuneralHome: (value: string) => string;
}

/**
 * Everything that reads or writes the open draft: saving, undo/redo history, finalize/reopen, and
 * the bootstrap data (funeral-home directory, backups) that travels alongside it. This is the
 * largest slice of ReportController's old single actions object — undo/redo and persist share the
 * same history stacks and `applyReport` helper, and finalize/reopen/restoreRevision all reset that
 * history the same way, so splitting those further would just scatter tightly coupled pieces.
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
  setRevisions: Dispatch<SetStateAction<RevisionSummary[]>>;
}): DraftActions {
  const {
    queue, versionRef, reportRef, bootstrapRef, undoStackRef, redoStackRef,
    setBootstrap, setReport, setStatus, setLastSavedAt, setUndoAvailable, setRedoAvailable, setRevisions,
  } = params;
  const toast = useToast();

  return useMemo<DraftActions>(() => {
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
      async createDraft(mode) {
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
      setRevisions,
      updateFuneralHomes: (homes) => setBootstrap((current) => current ? { ...current, funeralHomes: homes } : current),
      async restoreRevision(revisionId) {
        const current = reportRef.current;
        if (!current) return;
        const restored = await window.nightShift.restoreRevision(current.id, revisionId, versionRef.current);
        reportRef.current = restored;
        versionRef.current = restored.version;
        setReport(restored);
        resetUndoHistory();
      },
      canonicalFuneralHome(value) {
        const clean = titleCaseName(value);
        return bootstrapRef.current?.funeralHomes.find((home) => normalizeFuneralHome(home.name) === normalizeFuneralHome(clean))?.name ?? clean;
      },
    };
  }, [queue, toast, versionRef, reportRef, bootstrapRef, undoStackRef, redoStackRef, setBootstrap, setReport, setStatus, setLastSavedAt, setUndoAvailable, setRedoAvailable, setRevisions]);
}
