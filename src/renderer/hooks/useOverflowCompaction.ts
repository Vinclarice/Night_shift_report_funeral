import { useEffect, useMemo, useState } from "react";

import type { LayoutSettings, NightReport } from "@/domain/types";

/**
 * Watches the live print preview for page overflow. Wrapping and each section's own natural
 * height are expected to handle almost every real report; this hook only escalates to a
 * single, light compaction pass as a rare last-resort fallback when the page still doesn't
 * fit after that, and reports `overflow` so printing can be paused if it truly never fits.
 */
export function useOverflowCompaction(report: NightReport | null, layout: LayoutSettings | null) {
  const [compaction, setCompaction] = useState<{ key: string; level: 0 | 1 }>({ key: "", level: 0 });
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

  const compactLevel = compaction.key === compactionKey ? compaction.level : 0;

  useEffect(() => {
    const page = document.querySelector<HTMLElement>('[data-role="live-report-page"]');
    const content = page?.querySelector<HTMLElement>(".report-content");
    const columns = page ? [...page.querySelectorAll<HTMLElement>(".report-column")] : [];
    if (!page || !content) return;
    const check = () => {
      const contentBottom = Math.max(content.getBoundingClientRect().bottom, ...columns.map((column) => column.getBoundingClientRect().bottom));
      const exceedsPage = contentBottom > page.getBoundingClientRect().bottom - 12;
      if (exceedsPage && compactLevel < 1) {
        setCompaction({ key: compactionKey, level: 1 });
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
