import { useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { LayoutSettings, SectionKey } from "@/domain/types";
import { DEFAULT_LAYOUT } from "@/shared/contracts";
import { useToast } from "../ui/Toast";

export interface LayoutActions {
  saveLayout: (next: LayoutSettings) => Promise<void>;
  previewLayout: (next: LayoutSettings) => void;
  setCalibration: (value: boolean) => void;
  resetSectionWidth: (key: SectionKey) => Promise<void>;
  /** Clears every manually dragged card width. Leaves the printer calibration alone. */
  resetCardWidths: () => Promise<void>;
  /** Puts margin, scale and offsets back to the shipped values. Undoes printer calibration. */
  resetPrinterDefaults: () => Promise<void>;
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

  return useMemo<LayoutActions>(() => {
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

    return {
      saveLayout,
      previewLayout(next) {
        layoutRef.current = next;
        setLayout(next);
      },
      setCalibration,
      /**
       * Clears a manually set section width back to auto-fit. A manual width exists to make room
       * for a specific line; once that line is gone (deleted, or trimmed down to fewer deceased),
       * keeping the old width just leaves the card wider than the remaining content needs. Also
       * backs the explicit "Reset to Auto" control in Print Settings.
       */
      /**
       * The two resets are kept apart on purpose. Card widths are formatting — a choice about how
       * the sheet looks. Margin, scale and offsets are calibration, tuned to one physical printer
       * during the gate in README.md. Rolling both back together would quietly undo that
       * calibration, and it would only show up on paper.
       */
      async resetCardWidths() {
        const current = layoutRef.current;
        if (!current || !Object.keys(current.sectionWidths).length) return;
        await saveLayout({ ...current, sectionWidths: {} });
      },
      async resetPrinterDefaults() {
        const current = layoutRef.current;
        if (!current) return;
        await saveLayout({
          ...current,
          marginInches: DEFAULT_LAYOUT.marginInches,
          scale: DEFAULT_LAYOUT.scale,
          offsetXInches: DEFAULT_LAYOUT.offsetXInches,
          offsetYInches: DEFAULT_LAYOUT.offsetYInches,
        });
      },
      async resetSectionWidth(key) {
        const current = layoutRef.current;
        if (!current || current.sectionWidths[key] === undefined) return;
        const sectionWidths = { ...current.sectionWidths };
        delete sectionWidths[key];
        await saveLayout({ ...current, sectionWidths });
      },
    };
  }, [layoutRef, setLayout, setCalibration, toast]);
}
