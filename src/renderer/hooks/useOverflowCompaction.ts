import { useDeferredValue, useEffect, useMemo, useState } from "react";

import type { LayoutSettings, NightReport } from "@/domain/types";

/**
 * Watches the live print preview for page overflow and decides how hard the sheet has to be
 * squeezed to fit one page, reporting `overflow` so printing can be paused if it never does.
 *
 * The squeeze is a single number, 0 to 1, handed to the page as --tighten: 0 draws the sheet at its
 * natural size, 1 is the tightest it is ever drawn. The stylesheet interpolates every measurement
 * between those two ends, so this hook is looking for the smallest value that fits rather than
 * picking from a handful of fixed settings — one extra row no longer drops the whole sheet a size.
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
 * this is a deliberate trade: 1/64 of the total travel is well under a printed point of body type,
 * and the search reaches it in six measurements after the two that bracket it.
 */
const TIGHTEN_PRECISION = 1 / 64;
/**
 * How far the search steps while it is still looking for any value that fits. It could bracket in
 * one move by jumping straight to the tightest setting, but the page is on screen while this
 * happens: that would flash the sheet down to 7.2pt and back on every edit that needs squeezing.
 * Walking up in quarters looks like the page tightening, which is what it is doing.
 */
const TIGHTEN_COARSE_STEP = 0.25;

interface Search {
  key: string;
  /** What the page is currently drawn at. */
  tighten: number;
  /** Largest value measured that still overflowed, or null if none has yet. */
  tooLoose: number | null;
  /** Smallest value measured that fitted, or null if none has yet. */
  fits: number | null;
  settled: boolean;
}

const START: Search = { key: "", tighten: 0, tooLoose: null, fits: null, settled: false };

export function useOverflowCompaction(report: NightReport | null, layout: LayoutSettings | null) {
  // Deferred in step with the canvas, which renders a deferred copy of the report. Keyed off the
  // live one, this hook reset itself a render before the DOM caught up and measured a page that
  // still had the old content on it — taking the ROAD TRIPS card away read as an overflow that was
  // not there, and the sheet stayed squeezed for a card no longer on it.
  const deferredReport = useDeferredValue(report);
  const deferredLayout = useDeferredValue(layout);
  const [search, setSearch] = useState<Search>(START);
  const [overflow, setOverflow] = useState(false);

  // Everything that changes how much room the content needs. It is this key changing that starts
  // the search over, so anything missing here is a sheet that tightens once and stays tightened.
  const compactionKey = useMemo(
    () =>
      JSON.stringify({
        sections: deferredReport?.sections,
        roadTrips: deferredReport?.roadTripsVisible,
        margin: deferredLayout?.marginInches,
        scale: deferredLayout?.scale,
        offsetY: deferredLayout?.offsetYInches,
      }),
    [deferredReport?.sections, deferredReport?.roadTripsVisible, deferredLayout?.marginInches, deferredLayout?.scale, deferredLayout?.offsetYInches],
  );

  // Memoised: a fresh object on every render would re-run the measuring effect on every render,
  // and the effect sets state, which renders again.
  const current: Search = useMemo(
    () => (search.key === compactionKey ? search : { ...START, key: compactionKey }),
    [search, compactionKey],
  );
  const tighten = current.tighten;

  useEffect(() => {
    const page = document.querySelector<HTMLElement>('[data-role="live-report-page"]');
    const content = page?.querySelector<HTMLElement>(".report-content");
    const columns = page ? [...page.querySelectorAll<HTMLElement>(".report-column")] : [];
    if (!page || !content) return;
    const check = () => {
      // The print stylesheet hides the whole workspace, so while printing the live page has no
      // layout at all. Measuring then reads every rect as zero, which looks exactly like a page
      // whose content sits below its bottom edge — the hook would squeeze the sheet and the
      // print-only copy would render compacted mid-print. Hold the current value instead.
      if (page.offsetHeight === 0) return;
      if (current.settled) return;
      // Only the columns are measured. `.report-content` is absolutely positioned with a fixed
      // inset, so its own box never grows with the entries and tells us nothing.
      const contentBottom = Math.max(...columns.map((column) => column.getBoundingClientRect().bottom));
      const pageRect = page.getBoundingClientRect();
      // getBoundingClientRect reports post-transform pixels, and the canvas scales the page by the
      // preview zoom. Scaling the gutter by the same factor keeps the comparison in page space, so
      // a report compacts (and therefore prints) identically whatever zoom the preview is at.
      // Measured against page.offsetHeight, which is the untransformed 11in.
      const previewScale = page.offsetHeight > 0 ? pageRect.height / page.offsetHeight : 1;
      const gutter = BOTTOM_GUTTER_INCHES * PAGE_DPI * previewScale;
      // The notes block sits at the foot of the content box, well above the paper's edge, so once
      // it exists it — not the page bottom — is what the columns must stay clear of.
      const notes = page.querySelector<HTMLElement>(".notes-block");
      const floor = notes ? notes.getBoundingClientRect().top : pageRect.bottom;
      const exceedsPage = contentBottom > floor - gutter;

      const tooLoose = exceedsPage ? Math.max(current.tooLoose ?? tighten, tighten) : current.tooLoose;
      const fits = exceedsPage ? current.fits : Math.min(current.fits ?? tighten, tighten);

      // Nothing has been found to fit yet, so keep stepping up. Running out of room at the tightest
      // setting means the report genuinely does not fit one page.
      if (fits === null) {
        if (tighten >= 1) {
          setOverflow(true);
          setSearch({ key: compactionKey, tighten: 1, tooLoose, fits, settled: true });
          return;
        }
        setOverflow(false);
        setSearch({ key: compactionKey, tighten: Math.min(1, tighten + TIGHTEN_COARSE_STEP), tooLoose, fits, settled: false });
        return;
      }

      setOverflow(false);
      // A fitting value is known. Anything looser has not been ruled out, so halve the gap between
      // the two brackets until they are close enough to stop caring, then draw the fitting one.
      const looser = tooLoose ?? 0;
      if (fits - looser <= TIGHTEN_PRECISION) {
        setSearch({ key: compactionKey, tighten: fits, tooLoose, fits, settled: true });
        return;
      }
      setSearch({ key: compactionKey, tighten: (looser + fits) / 2, tooLoose, fits, settled: false });
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(content);
    columns.forEach((column) => observer.observe(column));
    return () => observer.disconnect();
  }, [deferredReport, deferredLayout, compactionKey, current, tighten]);

  return { tighten, overflow };
}
