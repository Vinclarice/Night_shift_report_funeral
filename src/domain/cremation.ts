export type CremationDocumentKind = "certificate" | "envelope";
export type CremationPrintState = "notPrinted" | "printed" | "stale";

export interface CremationNumberParts {
  major: number;
  middle: number;
  minor: number;
}

export interface CremationFuneralHome {
  id: string;
  name: string;
  location: string;
}

export interface CremationPrintPreference {
  scale: number;
  offsetXInches: number;
  offsetYInches: number;
}

export interface CremationBatchRow {
  id: string;
  selected: boolean;
  number: string;
  fullName: string;
  displayName: string;
  displayNameManuallyEdited: boolean;
  funeralHome: string;
  location: string;
  certificateStatus: CremationPrintState;
  envelopeStatus: CremationPrintState;
  labelStatus: CremationPrintState;
}

export interface CremationLabelReadiness {
  ready: boolean;
  bpacInstalled: boolean;
  driverInstalled: boolean;
  templateAvailable: boolean;
  printerName?: string;
  message: string;
}

export const DEFAULT_CREMATION_PRINT_PREFERENCE: CremationPrintPreference = {
  scale: 1,
  offsetXInches: 0,
  offsetYInches: 0,
};

const CREMATION_NUMBER_PATTERN = /^(\d+)-(\d{3})-(\d{2})$/;
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

export function parseCremationNumber(value: string): CremationNumberParts | null {
  const match = value.trim().match(CREMATION_NUMBER_PATTERN);
  if (!match) return null;
  const parts = { major: Number(match[1]), middle: Number(match[2]), minor: Number(match[3]) };
  if (!Number.isSafeInteger(parts.major) || parts.major < 1) return null;
  if (parts.middle < 1 || parts.middle > 999) return null;
  if (parts.minor < 1 || parts.minor > 38) return null;
  return parts;
}

export function formatCremationNumber(parts: CremationNumberParts): string {
  return `${parts.major}-${String(parts.middle).padStart(3, "0")}-${String(parts.minor).padStart(2, "0")}`;
}

export function nextCremationNumber(value: string | CremationNumberParts): string | null {
  const current = typeof value === "string" ? parseCremationNumber(value) : value;
  if (!current) return null;
  if (current.minor < 38) return formatCremationNumber({ ...current, minor: current.minor + 1 });
  if (current.middle < 999) return formatCremationNumber({ major: current.major, middle: current.middle + 1, minor: 1 });
  return formatCremationNumber({ major: current.major + 1, middle: 1, minor: 1 });
}

function cleanNamePart(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/[.,]+$/g, "");
}

export function deriveCremationDisplayName(value: string): string {
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean) return "";

  if (clean.includes(",")) {
    const [rawLast, rawGiven = ""] = clean.split(",", 2);
    const givenParts = rawGiven.split(" ").map(cleanNamePart).filter(Boolean);
    const first = givenParts[0] ?? "";
    const familyParts = rawLast.split(" ").map(cleanNamePart).filter(Boolean);
    while (familyParts.length > 1 && NAME_SUFFIXES.has((familyParts.at(-1) ?? "").toLowerCase())) familyParts.pop();
    const last = familyParts.join(" ");
    return [first, last].filter(Boolean).join(" ");
  }

  const parts = clean.split(" ").map(cleanNamePart).filter(Boolean);
  while (parts.length > 2 && NAME_SUFFIXES.has((parts.at(-1) ?? "").toLowerCase())) parts.pop();
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts[0]} ${parts.at(-1)}`;
}

export function normalizeCremationFuneralHome(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function createCremationBatchRow(number = ""): CremationBatchRow {
  return {
    id: crypto.randomUUID(),
    selected: true,
    number,
    fullName: "",
    displayName: "",
    displayNameManuallyEdited: false,
    funeralHome: "",
    location: "",
    certificateStatus: "notPrinted",
    envelopeStatus: "notPrinted",
    labelStatus: "notPrinted",
  };
}

export function isCremationRowBlank(row: CremationBatchRow): boolean {
  // A generated successor number does not make a row "used". This lets the always-ready trailing
  // row stay out of validation until the operator starts entering the next cremation's details.
  return !row.fullName.trim() && !row.displayName.trim() && !row.funeralHome.trim() && !row.location.trim();
}

export function isCremationRowComplete(row: CremationBatchRow): boolean {
  return Boolean(parseCremationNumber(row.number) && row.fullName.trim() && row.funeralHome.trim());
}
