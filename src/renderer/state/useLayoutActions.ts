import { useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { LayoutSettings } from "@/domain/types";
import { useToast } from "../ui/Toast";

export interface LayoutActions {
  saveLayout: (next: LayoutSettings) => Promise<void>;
  previewLayout: (next: LayoutSettings) => void;
  setCalibration: (value: boolean) => void;
}

/**
 * Print-layout persistence: section widths, margins, and the calibration overlay toggle. Kept
 * separate from draft/archive actions since it never touches the report itself, only the
 * independent layout preference row.
 */
export function useLayoutActions(params: {
  layoutRef: MutableRefObject<LayoutSettings | null>;
  setLayout: Dispatch<SetStateAction<LayoutSettings | null>>;
  setCalibration: Dispatch<SetStateAction<boolean>>;
}): LayoutActions {
  const { layoutRef, setLayout, setCalibration } = params;
  const toast = useToast();

  return useMemo<LayoutActions>(() => ({
    async saveLayout(next) {
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
    previewLayout(next) {
      layoutRef.current = next;
      setLayout(next);
    },
    setCalibration,
  }), [layoutRef, setLayout, setCalibration, toast]);
}
