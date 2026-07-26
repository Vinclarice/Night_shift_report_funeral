export type ReportStatus = "draft" | "finalized";

export type SectionKey =
  | "human-deliver"
  | "human-airport"
  | "human-fdp"
  | "human-pending"
  | "human-ship-outs"
  | "cremated-deliver"
  | "cremated-mail"
  | "cremated-fdp"
  | "cremated-certs";

export interface DeceasedPerson {
  id: string;
  name: string;
  locationCode: string;
  specialRequest: string;
}

interface BaseEntry {
  id: string;
  rush: boolean;
  keepSeparate: boolean;
  createdAt: string;
}

export interface FuneralEntry extends BaseEntry {
  type: "funeral";
  funeralHome: string;
  deceased: DeceasedPerson[];
}

export interface FuneralHomeOnlyEntry extends BaseEntry {
  type: "funeralHomeOnly";
  funeralHome: string;
}

export interface CountEntry extends BaseEntry {
  type: "count";
  text: string;
  count: number;
}

export interface CombinedEntry extends BaseEntry {
  type: "combined";
  leftText: string;
  rightText: string;
  count: number;
}

export interface PlainEntry extends BaseEntry {
  type: "plain";
  text: string;
}

export type ReportEntry =
  | FuneralEntry
  | FuneralHomeOnlyEntry
  | CountEntry
  | CombinedEntry
  | PlainEntry;

export interface ReportSection {
  key: SectionKey;
  category: "human" | "cremated";
  title: string;
  entries: ReportEntry[];
}

export interface NightReport {
  id: string;
  reportDate: string;
  status: ReportStatus;
  version: number;
  finalizedAt: string | null;
  sections: ReportSection[];
}

export interface LayoutSettings {
  sectionWidths: Partial<Record<SectionKey, number>>;
  marginInches: number;
  scale: number;
  offsetXInches: number;
  offsetYInches: number;
}

export interface ParsedLine {
  source: string;
  entry: ReportEntry;
  warning?: string;
}

