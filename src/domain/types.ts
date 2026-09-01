export type SectionKey =
  | "human-deliver"
  | "human-airport"
  | "human-road-trips"
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
  /**
   * Holds this entry at the end of its section regardless of the section's normal ordering, for
   * lines that belong to a section but sit apart from its list — a road trip in Deliver, say.
   * Set by dragging an entry below the last row; cleared by dragging it back up.
   */
  pinnedBottom: boolean;
  /**
   * When this rush is needed by, in the operator's own words — "by 10:00 AM", "first trip".
   * Printed inside the rush chip. Empty or absent prints the plain RUSH label.
   */
  rushBy?: string;
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
  version: number;
  /**
   * Free text printed in the footer, typed on the canvas. Belongs to the night, so a new report
   * starts empty rather than inheriting the previous one's — see ReportService.resolveTonight,
   * which clones only the sections.
   */
  notes: string;
  /**
   * The optional cards put away for this night — ROAD TRIPS unless asked for, and AIRPORT DROPS or
   * CERTS/OTHER TO DEL on a night they are not wanted. Carried over to the next night the way card
   * widths are, so a run of nights that want the same sheet is set up once rather than every
   * evening. Putting a card away does not discard its entries; they come back with it.
   */
  hiddenSections: SectionKey[];
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

