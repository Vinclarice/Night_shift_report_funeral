import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { NightReport } from "@/domain/types";
import type { ReportSummary } from "@/shared/contracts";
import { useToast } from "../ui/Toast";

export interface ArchiveActions {
  loadArchive: () => Promise<void>;
  openArchiveReport: (id: string) => Promise<void>;
  closeArchiveReport: () => void;
  printArchiveReport: (id: string) => Promise<void>;
}

/**
 * Browsing and reprinting past finalized reports. Independent of the open draft — these read
 * other reports without ever touching `reportRef`/`versionRef`, so they're safe to split out on
 * their own.
 */
export function useArchiveActions(params: {
  setArchive: Dispatch<SetStateAction<ReportSummary[]>>;
  setArchiveReport: Dispatch<SetStateAction<NightReport | null>>;
}): ArchiveActions {
  const { setArchive, setArchiveReport } = params;
  const toast = useToast();

  return useMemo<ArchiveActions>(() => ({
    async loadArchive() {
      try {
        setArchive(await window.nightShift.listReports());
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
    async openArchiveReport(id) {
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
    async printArchiveReport(id) {
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
  }), [setArchive, setArchiveReport, toast]);
}
