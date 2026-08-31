import type { NightReport, ReportSection, SectionKey } from "./types";

export const REPORT_SECTIONS: ReadonlyArray<{
  key: SectionKey;
  category: "human" | "cremated";
  title: string;
}> = [
  { key: "human-deliver", category: "human", title: "DELIVER" },
  { key: "human-airport", category: "human", title: "AIRPORT DROPS" },
  // Shown only when the night has one; see NightReport.roadTripsVisible. It sits in the section
  // list unconditionally so its entries survive the card being hidden and come back with it.
  { key: "human-road-trips", category: "human", title: "ROAD TRIPS" },
  { key: "human-fdp", category: "human", title: "FDP" },
  { key: "human-pending", category: "human", title: "HR DEL – PENDING" },
  { key: "human-ship-outs", category: "human", title: "SHIP-OUTS – NFS" },
  { key: "cremated-deliver", category: "cremated", title: "DELIVER" },
  { key: "cremated-mail", category: "cremated", title: "MAIL" },
  { key: "cremated-fdp", category: "cremated", title: "FDP" },
  { key: "cremated-certs", category: "cremated", title: "CERTS/OTHER TO DEL" },
];

/**
 * Local hour that ends a night shift. Before it, whoever is at the desk is still working the shift
 * that began yesterday evening; from it on, the next report anyone opens is tonight's.
 */
export const SHIFT_END_HOUR = 8;

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function nextReportDate(now: Date): string {
  return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

/**
 * The date the report belongs to for someone opening the app at `now`. A shift is named for the
 * calendar day it ends on — the evening of the 11th writes the report dated the 12th — and that
 * name has to hold steady across midnight, however far into the small hours the app is opened and
 * whether or not the report already existed before midnight.
 */
export function shiftReportDate(now: Date): string {
  return now.getHours() < SHIFT_END_HOUR ? formatLocalDate(now) : nextReportDate(now);
}

export function createEmptyReport(reportDate: string): NightReport {
  const sections: ReportSection[] = REPORT_SECTIONS.map((section) => ({
    ...section,
    entries: [],
  }));
  return {
    id: crypto.randomUUID(),
    reportDate,
    version: 0,
    notes: "",
    roadTripsVisible: false,
    sections,
  };
}

