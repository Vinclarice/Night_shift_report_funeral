import { useEffect, useState } from "react";

import type { NightReport } from "@/domain/types";
import { IconArrowLeft, IconPrinter } from "../icons";
import { useReportActions, useReportState } from "../state/ReportController";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

function formatArchiveDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    .format(new Date(year, month - 1, day));
}

function entryCount(report: NightReport) {
  return report.sections.reduce((total, section) => total + section.entries.length, 0);
}

/**
 * Read-only view over retained reports. Finalized reports stay immutable, so nothing here can edit
 * or restore — the only actions are looking at a past report and reprinting it.
 */
export function ArchivePanel() {
  const { archive, archiveReport } = useReportState();
  const { loadArchive, openArchiveReport, closeArchiveReport, printArchiveReport } = useReportActions();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void loadArchive();
    // Closing the drawer must clear the staged report, otherwise it would still be occupying
    // .print-only the next time the operator presses Print on the live report.
    return () => closeArchiveReport();
  }, [loadArchive, closeArchiveReport]);

  if (archiveReport) {
    return (
      <div className="archive-viewer">
        <div className="archive-viewer-bar">
          <Button variant="quiet" icon={<IconArrowLeft />} onClick={closeArchiveReport}>Back to list</Button>
          <Button variant="print" icon={<IconPrinter />} busy={busyId === archiveReport.id} onClick={async () => {
            setBusyId(archiveReport.id);
            try { await printArchiveReport(archiveReport.id); } finally { setBusyId(null); }
          }}>Reprint</Button>
        </div>
        <div className="archive-viewer-meta">
          <strong>{formatArchiveDate(archiveReport.reportDate)}</strong>
          <Badge tone={archiveReport.status === "finalized" ? "success" : "warning"}>
            {archiveReport.status === "finalized" ? "Finalized" : "Draft"}
          </Badge>
          <span>{entryCount(archiveReport)} {entryCount(archiveReport) === 1 ? "entry" : "entries"}</span>
        </div>
        <p className="muted">This report is read-only. Reprint sends it to the printer exactly as it was saved.</p>
      </div>
    );
  }

  if (!archive.length) {
    return <p className="muted">No past reports yet. Reports are kept for 90 days after their report date.</p>;
  }

  return (
    <div className="archive-list">
      <p className="muted">Reports are retained for 90 days. Viewing never changes a stored report.</p>
      {archive.map((item) => (
        <Card className="archive-row" hoverable key={item.id}>
          <button type="button" className="archive-row-main" onClick={() => void openArchiveReport(item.id)}>
            <strong>{formatArchiveDate(item.reportDate)}</strong>
            <small>{item.entryCount} {item.entryCount === 1 ? "entry" : "entries"}</small>
          </button>
          <Badge tone={item.status === "finalized" ? "success" : "warning"} dot>
            {item.status === "finalized" ? "Finalized" : "Draft"}
          </Badge>
        </Card>
      ))}
    </div>
  );
}
