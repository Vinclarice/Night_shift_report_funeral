import { useDeferredValue, useEffect, useMemo, useState } from "react";

import type { LayoutSettings, NightReport } from "@/domain/types";

/**
 * Watches the live print preview for page overflow and decides how hard the sheet has to be
 * squeezed to fit one page, reporting `overflow` so printing can be paused if it never does.
 *
 * The squeeze is a number, 0 to 1, handed to the page as --tighten: 0 draws the sheet at its
 * natural size, 1 is the tightest it is ever drawn. The stylesheet interpolates every measurement
 * between those two ends, so this hook looks for the smallest value that fits rather than picking
 * from a handful of fixed settings — one extra row no longer drops the whole sheet a size.
 *
 * Each column is searched on its own. The two are independent stacks of cards side by side, and a
 * long Human column used to drag the Cremated one down with it: four cremated rows set at 7.2pt
 * because the other half of the sheet was busy. Only the column that is actually over gives
 * anything up now. The masthead spans both, so it follows whichever column is tighter — shrinking
 * it hands vertical space back to the column that needed it.
 */
/**
 * Clear space required between the bottom of the content and the paper's edge, in inches of page
 * space. Expressed in the page's own units on purpose: the canvas renders the page under a
 * user-controlled preview zoom, so a tolerance in screen pixels would mean a different tolerance on
 * paper at every zoom level.
 */
const BOTTOM_GUTTER_INCHES = 0.18;
const PAGE_DPI = 96;
/**
 * How close the search has to get before it stops. Each step costs a re-render and a measure, so
 * this is a deliberate trade: 1/64 of the total travel is well under a printed point of body type.
 */
const TIGHTEN_PRECISION = 1 / 64;
/**
 * How far the search steps while it is still looking for any value that fits. It could bracket in
 * one move by jumping straight to the tightest setting, but the page is on screen while this
 * happens: that would flash the sheet down to 7.2pt and back on every edit that needs squeezing.
 */
const TIGHTEN_COARSE_STEP = 0.25;

const COMPACTION_COLUMNS = [
  { key: "human", selector: ".human-column" },
  { key: "cremated", selector: ".cremated-column" },
] as const;

export type ColumnKey = (typeof COMPACTION_COLUMNS)[number]["key"];
/** How hard each column is squeezed. The masthead, which spans both, follows the tighter of them. */
export type ColumnTightness = Record<ColumnKey, number>;

interface Search {
  /** What the column is currently drawn at. */
  tighten: number;
  /** Largest value measured that still overflowed, or null if none has yet. */
  tooLoose: number | null;
  /** Smallest value measured that fitted, or null if none has yet. */
  fits: number | null;
  settled: boolean;
  overflows: boolean;
}

const START: Search = { tighten: 0, tooLoose: null, fits: null, settled: false, overflows: false };
const startAll = (): Record<ColumnKey, Search> => ({ human: { ...START }, cremated: { ...START } });

/** One step of the search for a single column, given whether it fitted at the value it is drawn at. */
function step(search: Search, exceedsPage: boolean): Search {
  if (search.settled) return search;
  const tooLoose = exceedsPage ? Math.max(search.tooLoose ?? search.tighten, search.tighten) : search.tooLoose;
  const fits = exceedsPage ? search.fits : Math.min(search.fits ?? search.tighten, search.tighten);

  if (exceedsPage) {
    // Nothing has been found to fit yet, so keep stepping up. Running out of room at the tightest
    // setting means this column genuinely does not fit one page.
    if (search.tighten >= 1) return { tighten: 1, tooLoose, fits, settled: true, overflows: true };
    return { tighten: Math.min(1, search.tighten + TIGHTEN_COARSE_STEP), tooLoose, fits, settled: false, overflows: false };
  }

  // A fitting value is known. Anything looser has not been ruled out, so halve the gap between the
  // two brackets until they are close enough to stop caring, then draw the fitting one.
  const looser = tooLoose ?? 0;
  const settledValue = fits ?? search.tighten;
  if (settledValue - looser <= TIGHTEN_PRECISION) {
    return { tighten: settledValue, tooLoose, fits, settled: true, overflows: false };
  }
  return { tighten: (looser + settledValue) / 2, tooLoose, fits, settled: false, overflows: false };
}

export function useOverflowCompaction(report: NightReport | null, layout: LayoutSettings | null, pages = 1) {
  // Deferred in step with the canvas, which renders a deferred copy of the report. Keyed off the
  // live one, this hook reset itself a render before the DOM caught up and measured a page that
  // still had the old content on it — taking a card away read as an overflow that was not there.
  const deferredReport = useDeferredValue(report);
  const deferredLayout = useDeferredValue(layout);
  const [state, setState] = useState<{ key: string; columns: Record<ColumnKey, Search> }>({ key: "", columns: startAll() });

  // Everything that changes how much room the content needs. It is this key changing that starts
  // the search over, so anything missing here is a sheet that tightens once and stays tightened.
  const compactionKey = useMemo(
    () =>
      JSON.stringify({
        sections: deferredReport?.sections,
        hidden: deferredReport?.hiddenSections,
        margin: deferredLayout?.marginInches,
        scale: deferredLayout?.scale,
        offsetY: deferredLayout?.offsetYInches,
        pages,
      }),
    [deferredReport?.sections, deferredReport?.hiddenSections, deferredLayout?.marginInches, deferredLayout?.scale, deferredLayout?.offsetYInches, pages],
  );

  // Memoised: a fresh object on every render would re-run the measuring effect on every render,
  // and the effect sets state, which renders again.
  const columns = useMemo(
    () => (state.key === compactionKey ? state.columns : startAll()),
    [state, compactionKey],
  );

  const tighten = useMemo<ColumnTightness>(
    () => ({ human: columns.human.tighten, cremated: columns.cremated.tighten }),
    [columns],
  );
  const overflow = columns.human.overflows || columns.cremated.overflows;

  useEffect(() => {
    const page = document.querySelector<HTMLElement>('[data-role="live-report-page"]');
    const content = page?.querySelector<HTMLElement>(".report-content");
    if (!page || !content) return;
    const measured = COMPACTION_COLUMNS
      .map(({ key, selector }) => ({ key, element: page.querySelector<HTMLElement>(selector) }))
      .filter((entry): entry is { key: ColumnKey; element: HTMLElement } => entry.element !== null);
    const check = () => {
      // The print stylesheet hides the whole workspace, so while printing the live page has no
      // layout at all. Measuring then reads every rect as zero, which looks exactly like a page
      // whose content sits below its bottom edge — the hook would squeeze the sheet and the
      // print-only copy would render compacted mid-print. Hold the current value instead.
      if (page.offsetHeight === 0) return;
      if (columns.human.settled && columns.cremated.settled) return;
      const pageRect = page.getBoundingClientRect();
      // getBoundingClientRect reports post-transform pixels, and the canvas scales the page by the
      // preview zoom. Scaling the gutter by the same factor keeps the comparison in page space, so
      // a report compacts (and therefore prints) identically whatever zoom the preview is at.
      const previewScale = page.offsetHeight > 0 ? pageRect.height / page.offsetHeight : 1;
      const gutter = BOTTOM_GUTTER_INCHES * PAGE_DPI * previewScale;
      // The notes block sits at the foot of the content box, well above the paper's edge, so once
      // it exists it — not the page bottom — is what the columns must stay clear of.
      const notes = page.querySelector<HTMLElement>(".notes-block");
      const floor = (notes ? notes.getBoundingClientRect().top : pageRect.bottom) - gutter;

      const next = { ...columns };
      let changed = false;
      for (const { key, element } of measured) {
        const box = element.getBoundingClientRect();
        // Against however many sheets are allowed. Printing across two gives a column twice the
        // room, so the search settles somewhere far looser — the point of a second sheet is to get
        // the type back, not to print the same 7.2pt twice.
        const room = (floor - box.top) * pages;
        next[key] = step(columns[key], box.height > room);
        if (next[key] !== columns[key]) changed = true;
      }
      if (changed) setState({ key: compactionKey, columns: next });
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(content);
    measured.forEach(({ element }) => observer.observe(element));
    return () => observer.disconnect();
  }, [deferredReport, deferredLayout, compactionKey, columns, pages]);

  return { tighten, overflow };
}
