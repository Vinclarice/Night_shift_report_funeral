import { useDeferredValue, useEffect, useMemo, useState } from "react";

import type { LayoutSettings, NightReport } from "@/domain/types";

/**
 * Watches the live print preview for page overflow. Wrapping and each section's own natural
 * height are expected to handle almost every real report; this hook only escalates to a
 * single, light compaction pass as a rare last-resort fallback when the page still doesn't
 * fit after that, and reports `overflow` so printing can be paused if it truly never fits.
 */
/**
 * Clear space required between the bottom of the content and the paper's edge, in inches of page
 * space. Expressed in the page's own units on purpose: the canvas renders the page under a
 * user-controlled preview zoom, so a tolerance in screen pixels would mean a different tolerance on
 * paper at every zoom level.
 */
export type CompactLevel = 0 | 1 | 2 | 3 | 4;

const BOTTOM_GUTTER_INCHES = 0.18;
const PAGE_DPI = 96;

const MAX_COMPACT_LEVEL = 4;

export function useOverflowCompaction(report: NightReport | null, layout: LayoutSettings | null) {
  // Deferred in step with the canvas, which renders a deferred copy of the report. Keyed off the
  // live one, this hook reset itself a render before the DOM caught up and measured a page that
  // still had the old content on it — taking the ROAD TRIPS card away read as an overflow that was
  // not there, and the level it climbed to in response could never come back down.
  const deferredReport = useDeferredValue(report);
  const deferredLayout = useDeferredValue(layout);
  // `floor` is the lowest level not yet proved too loose: every level below it has been measured
  // and overflowed. The search settles when the current level fits and is the floor, so the answer
  // is the smallest level that fits rather than whatever the page happened to climb to.
  const [compaction, setCompaction] = useState<{ key: string; level: CompactLevel; floor: number }>({ key: "", level: 0, floor: 0 });
  const [overflow, setOverflow] = useState(false);

  // Everything that changes how much room the content needs. The level only ever climbs, and it is
  // this key changing that puts it back to nothing — so anything missing here is a page that
  // tightened once and then stayed tightened. roadTripsVisible was exactly that: adding the card
  // compacted the sheet correctly, and taking it away left the sheet compacted for a card that was
  // no longer on it.
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

  const matches = compaction.key === compactionKey;
  const compactLevel: CompactLevel = matches ? compaction.level : 0;
  const searchFloor = matches ? compaction.floor : 0;

  useEffect(() => {
    const page = document.querySelector<HTMLElement>('[data-role="live-report-page"]');
    const content = page?.querySelector<HTMLElement>(".report-content");
    const columns = page ? [...page.querySelectorAll<HTMLElement>(".report-column")] : [];
    if (!page || !content) return;
    const check = () => {
      // The print stylesheet hides the whole workspace, so while printing the live page has no
      // layout at all. Measuring then reads every rect as zero, which looks exactly like a page
      // whose content sits below its bottom edge — the hook would escalate to compact-1 and the
      // print-only copy would render compacted mid-print. Hold the current level instead.
      if (page.offsetHeight === 0) return;
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
      // Four steps, each one giving back type and spacing only — the blank writing rows are never
      // reclaimed, because a row disappearing is the one compaction the crew actually sees and it
      // takes away somewhere they were about to write. The first two are barely noticeable; the
      // third is dense; the fourth is the backstop for a night that would otherwise be refused
      // outright, and is legible at a desk under office light rather than comfortable.
      if (exceedsPage) {
        // Everything at or below this level is now known to be too loose.
        if (compactLevel >= MAX_COMPACT_LEVEL) { setOverflow(true); return; }
        setCompaction({ key: compactionKey, level: (compactLevel + 1) as CompactLevel, floor: compactLevel + 1 });
        setOverflow(false);
        return;
      }
      setOverflow(false);
      // It fits — but that does not make it the right level. Anything above the floor has not been
      // shown to be necessary, so drop back to the floor and let it prove itself.
      if (compactLevel > searchFloor) {
        setCompaction({ key: compactionKey, level: searchFloor as CompactLevel, floor: searchFloor });
      }
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(content);
    columns.forEach((column) => observer.observe(column));
    return () => observer.disconnect();
  }, [deferredReport, deferredLayout, compactLevel, searchFloor, compactionKey]);

  return { compactLevel, overflow };
}
