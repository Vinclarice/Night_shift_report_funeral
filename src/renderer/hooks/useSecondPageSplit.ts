import { useEffect, useMemo, useState } from "react";

import type { NightReport, SectionKey } from "@/domain/types";

/**
 * Where to cut each section when a night is too big for one sheet and has been allowed a second.
 * Returns, per section, how many of its entries belong on the first — everything after that goes
 * overleaf. Null when the report fits and no second sheet is being printed.
 *
 * Measured off the live canvas rather than calculated. The canvas draws every row whatever happens
 * — the page clips what will not fit, and clipping does not move anything, so the rows past the
 * bottom still report where they would have been. That is exactly the question being asked, and it
 * avoids the loop that measuring the split page itself would cause: slicing rows off the sheet
 * being measured would change the measurement that produced the slice.
 */
const BOTTOM_GUTTER_INCHES = 0.18;
const PAGE_DPI = 96;

/**
 * How many of a section's entries stay on the first sheet. WHOLE_CARD_OVERLEAF means the card
 * itself begins below the floor, so all of it goes over — a card can need moving even with nothing
 * in it, and counting rows alone would leave an empty one behind to collide with the notes block.
 */
export const WHOLE_CARD_OVERLEAF = -1;
export type EntryLimits = Partial<Record<SectionKey, number>>;

const sameLimits = (a: EntryLimits | null, b: EntryLimits | null): boolean => {
  if (a === null || b === null) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<SectionKey>;
  return [...keys].every((key) => a[key] === b[key]);
};

export function useSecondPageSplit(active: boolean, report: NightReport | null): EntryLimits | null {
  const [limits, setLimits] = useState<EntryLimits | null>(null);

  // Recomputed whenever the rows themselves change; the ResizeObserver below covers everything else.
  const contentKey = useMemo(() => (active ? JSON.stringify(report?.sections) : ""), [active, report?.sections]);

  useEffect(() => {
    // Nothing is measured while a second sheet is not allowed; what was worked out last time is
    // simply not returned, rather than being cleared and re-derived on every toggle.
    if (!active) return;
    const page = document.querySelector<HTMLElement>('[data-role="live-report-page"]');
    const content = page?.querySelector<HTMLElement>(".report-content");
    if (!page || !content) return;
    const measure = () => {
      // Printing hides the workspace, which leaves every rect at zero and would read as though
      // nothing fits. Hold whatever was worked out before instead.
      if (page.offsetHeight === 0) return;
      const pageRect = page.getBoundingClientRect();
      const previewScale = pageRect.height / page.offsetHeight;
      const gutter = BOTTOM_GUTTER_INCHES * PAGE_DPI * previewScale;
      const notes = page.querySelector<HTMLElement>(".notes-block");
      const floor = (notes ? notes.getBoundingClientRect().top : pageRect.bottom) - gutter;

      const next: EntryLimits = {};
      for (const card of page.querySelectorAll<HTMLElement>("[data-section-key]")) {
        const key = card.dataset.sectionKey as SectionKey | undefined;
        if (!key) continue;
        if (card.getBoundingClientRect().top > floor) {
          next[key] = WHOLE_CARD_OVERLEAF;
          continue;
        }
        const rows = [...card.querySelectorAll<HTMLElement>("[data-entry-id]")];
        // The first row whose foot is past the floor is the first that belongs overleaf. Counting
        // rows rather than measuring the card means a card that straddles the cut is split at a
        // line, which is the only way a single very long section can be carried at all.
        const over = rows.findIndex((row) => row.getBoundingClientRect().bottom > floor);
        next[key] = over === -1 ? rows.length : over;
      }
      setLimits((current) => (sameLimits(current, next) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    page.querySelectorAll(".report-column").forEach((column) => observer.observe(column));
    return () => observer.disconnect();
  }, [active, contentKey]);

  return active ? limits : null;
}
