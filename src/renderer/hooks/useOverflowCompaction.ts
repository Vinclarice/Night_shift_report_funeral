import { useEffect, useMemo, useState } from "react";

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
export type CompactLevel = 0 | 1 | 2;

const BOTTOM_GUTTER_INCHES = 0.18;
const PAGE_DPI = 96;

export function useOverflowCompaction(report: NightReport | null, layout: LayoutSettings | null) {
  const [compaction, setCompaction] = useState<{ key: string; level: CompactLevel }>({ key: "", level: 0 });
  const [overflow, setOverflow] = useState(false);

  const compactionKey = useMemo(
    () =>
      JSON.stringify({
        sections: report?.sections,
        margin: layout?.marginInches,
        scale: layout?.scale,
        offsetY: layout?.offsetYInches,
      }),
    [report?.sections, layout?.marginInches, layout?.scale, layout?.offsetYInches],
  );

  const compactLevel: CompactLevel = compaction.key === compactionKey ? compaction.level : 0;

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
      // Two steps, in order of what is cheapest to give up. The first tightens type and leading;
      // the second also gives back the blank writing rows and most of the notes area, which is
      // roughly two inches of the column that the first step never touched.
      if (exceedsPage && compactLevel < 2) {
        setCompaction({ key: compactionKey, level: (compactLevel + 1) as CompactLevel });
        setOverflow(false);
      } else {
        setOverflow(exceedsPage);
      }
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(content);
    columns.forEach((column) => observer.observe(column));
    return () => observer.disconnect();
  }, [report, layout, compactLevel, compactionKey]);

  return { compactLevel, overflow };
}
