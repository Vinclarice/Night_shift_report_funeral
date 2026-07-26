import type { NightReport, ReportSection, SectionKey } from "./types";

export const REPORT_SECTIONS: ReadonlyArray<{
  key: SectionKey;
  category: "human" | "cremated";
  title: string;
}> = [
  { key: "human-deliver", category: "human", title: "DELIVER" },
  { key: "human-airport", category: "human", title: "AIRPORT DROPS" },
  { key: "human-fdp", category: "human", title: "FDP" },
  { key: "human-pending", category: "human", title: "HR DEL – PENDING" },
  { key: "human-ship-outs", category: "human", title: "SHIP-OUTS – NFS" },
  { key: "cremated-deliver", category: "cremated", title: "DELIVER" },
  { key: "cremated-mail", category: "cremated", title: "MAIL" },
  { key: "cremated-fdp", category: "cremated", title: "FDP" },
  { key: "cremated-certs", category: "cremated", title: "CERTS/OTHER TO DEL" },
];

export function nextReportDate(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const year = String(next.getFullYear()).padStart(4, "0");
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createEmptyReport(reportDate: string): NightReport {
  const sections: ReportSection[] = REPORT_SECTIONS.map((section) => ({
    ...section,
    entries: [],
  }));
  return {
    id: crypto.randomUUID(),
    reportDate,
    status: "draft",
    version: 0,
    finalizedAt: null,
    sections,
  };
}

