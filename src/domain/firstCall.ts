export type PlaceOfDeathKind = "facility" | "residence";

export const FIRST_CALL_TEXT_FIELDS = [
  "deceasedLastName", "dateOfCall", "timeOfCall", "takenBy", "contactAtFuneralHome", "caseNumber",
  "decedentName", "funeralHomeName", "funeralHomeAddress", "funeralHomePhone", "funeralHomeFax", "funeralHomeEmail",
  "placeOfDeathName", "placeOfDeathAddress", "placeOfDeathPhone", "shipOutTo", "internationalShipOutTo", "otherService",
  "call1DateTime", "call1CalledBy", "call1SpokeTo", "call1Comments",
  "call2DateTime", "call2CalledBy", "call2SpokeTo", "call2Comments",
  "call3DateTime", "call3CalledBy", "call3SpokeTo", "call3Comments",
  "certifiedCount", "recorderDate", "physicianName", "physicianAddress1", "physicianAddress2", "physicianPhone",
  "dateOfDeath", "timeOfDeath", "certificateToPhysician", "physicianMailed", "physicianByHand",
  "certificateToHealthDepartment", "healthDepartmentMailed", "healthDepartmentByHand",
  "copiesToFuneralHome", "copiesFuneralHomeMailed",
  "copiesToFamily", "copiesFamilyMailed", "familyMailingAddress",
  "caseNote1", "caseNote2", "caseNote3",
] as const;

export type FirstCallTextField = typeof FIRST_CALL_TEXT_FIELDS[number];

export const FIRST_CALL_CHECK_FIELDS = [
  "metropolitan", "nms", "inman", "removalOnly", "removeAndEmbalm", "fdp", "removeAndHold", "cremationServiceOnly",
  "certificateYes", "certificateNo", "needsVaMedicalExaminerAuthorization", "needsDcStamp",
] as const;

export type FirstCallCheckField = typeof FIRST_CALL_CHECK_FIELDS[number];

export type FirstCallHighlightColor = "yellow" | "green" | "blue" | "pink" | "orange";

export interface FirstCallHighlight {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: FirstCallHighlightColor;
}

export interface FirstCallDraft {
  placeOfDeathKind: PlaceOfDeathKind;
  values: Record<FirstCallTextField, string>;
  checks: Record<FirstCallCheckField, boolean>;
  highlights: FirstCallHighlight[];
  lastNameManuallyEdited: boolean;
}

export interface FirstCallFuneralHome {
  id: string;
  name: string;
  address: string;
  phone: string;
  fax: string;
  email: string;
  aliases: string[];
  favorite: boolean;
  useCount: number;
  lastUsedAt: string | null;
}

export interface FirstCallFacility {
  id: string;
  name: string;
  address: string;
  phone: string;
  aliases: string[];
  favorite: boolean;
  useCount: number;
  lastUsedAt: string | null;
}

export interface FirstCallDirectories {
  funeralHomes: FirstCallFuneralHome[];
  facilities: FirstCallFacility[];
}

export interface FirstCallPrintPreference {
  scale: number;
  offsetXInches: number;
  offsetYInches: number;
}

export interface FirstCallLookupCandidate {
  sourceId: string;
  name: string;
  address: string;
  phone: string;
  fax: string;
  email: string;
  attribution: "TomTom";
}

export type FirstCallDirectoryKind = "funeralHome" | "facility";
export type FirstCallLookupKind = FirstCallDirectoryKind | "residence";

export interface FirstCallSearchSettings {
  provider: "tomtom";
  configured: boolean;
  source: "saved" | "environment" | "none";
}

export const DEFAULT_FIRST_CALL_PRINT_PREFERENCE: FirstCallPrintPreference = {
  scale: 1,
  offsetXInches: 0,
  offsetYInches: 0,
};

function formatCallDate(now: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(now);
}

export function createFirstCallDraft(now = new Date()): FirstCallDraft {
  const values = Object.fromEntries(FIRST_CALL_TEXT_FIELDS.map((field) => [field, ""])) as Record<FirstCallTextField, string>;
  values.dateOfCall = formatCallDate(now);
  values.takenBy = "Vincent";
  return {
    placeOfDeathKind: "facility",
    values,
    checks: Object.fromEntries(FIRST_CALL_CHECK_FIELDS.map((field) => [field, false])) as Record<FirstCallCheckField, boolean>,
    highlights: [],
    lastNameManuallyEdited: false,
  };
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

export function deriveDeceasedLastName(value: string): string {
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  if (clean.includes(",")) return clean.split(",", 1)[0].trim().toLocaleUpperCase("en-US");
  const parts = clean.split(" ");
  while (parts.length > 1 && NAME_SUFFIXES.has(parts.at(-1)!.replace(/[.,]/g, "").toLowerCase())) parts.pop();
  return (parts.at(-1) ?? "").toLocaleUpperCase("en-US");
}

export function normalizeFirstCallDirectoryName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

type SearchableDirectory = FirstCallFuneralHome | FirstCallFacility;

function initials(value: string) {
  return normalizeFirstCallDirectoryName(value).split(/[^a-z0-9]+/).filter(Boolean).map((part) => part[0]).join("");
}

export function rankFirstCallDirectoryMatches<T extends SearchableDirectory>(items: T[], query: string, limit = 5): T[] {
  const normalized = normalizeFirstCallDirectoryName(query);
  return items.map((item) => {
    const terms = [item.name, ...item.aliases];
    let match = -1;
    for (const term of terms) {
      const candidate = normalizeFirstCallDirectoryName(term);
      if (!normalized) match = Math.max(match, item.favorite || item.lastUsedAt || item.useCount ? 1 : -1);
      else if (candidate === normalized) match = Math.max(match, 80);
      else if (candidate.startsWith(normalized)) match = Math.max(match, 60);
      else if (candidate.includes(normalized)) match = Math.max(match, 40);
      else if (initials(term).startsWith(normalized.replace(/[^a-z0-9]/g, ""))) match = Math.max(match, 30);
    }
    const recency = item.lastUsedAt ? Math.max(0, 10 - (Date.now() - new Date(item.lastUsedAt).getTime()) / 86_400_000) : 0;
    return { item, match, score: match + (item.favorite ? 100 : 0) + Math.min(item.useCount, 20) + recency };
  }).filter(({ match }) => match >= 0).sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name)).slice(0, limit).map(({ item }) => item);
}

export function hasFirstCallContent(draft: FirstCallDraft) {
  return draft.highlights.length > 0 || FIRST_CALL_CHECK_FIELDS.some((field) => draft.checks[field]) || FIRST_CALL_TEXT_FIELDS.some((field) => {
    if (field === "dateOfCall" || field === "takenBy") return false;
    return Boolean(draft.values[field].trim());
  });
}
