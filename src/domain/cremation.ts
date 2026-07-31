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
  /** The printer the PowerShell print engine (runPrintBridge, main/index.ts) sends the job to. */
  deviceName?: string;
  /** Tray/paper source name, matched against the printer's own reported PaperSources. */
  paperSource?: string;
}

export interface PrinterOption {
  name: string;
  displayName: string;
}

export interface PrinterCapability extends PrinterOption {
  paperSources: string[];
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

export interface CremationPrintingReadiness {
  ready: boolean;
  scriptAvailable: boolean;
  printerConfigured: boolean;
  printerInstalled: boolean;
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
    // "John Smith, Jr" uses the comma as a suffix separator, not a Last, First swap - if
    // everything after the comma is just suffix words, fall through to the plain-name parsing
    // of what's before it instead of treating "Jr" as the given name.
    if (givenParts.length && givenParts.every((part) => NAME_SUFFIXES.has(part.toLowerCase()))) {
      return deriveCremationDisplayName(rawLast);
    }
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

export function formatCertificateDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}

// --- Cremation certificate/envelope print engine geometry -----------------------------------
//
// The PowerShell print engine (resources/cremation/print-cremation.ps1, invoked from main/index.ts)
// draws these documents itself via GDI+ rather than screenshotting the on-screen HTML - Electron's
// print pipeline is what silently drops the custom A5/C5 paper size on real printer drivers in the
// first place. That means these coordinates are a second copy of the positions already expressed
// in styles.css (.certificate-date, .certificate-number, .certificate-name, .envelope-name, etc.)
// - keep both in sync by hand when calibrating either the on-screen preview or the print engine.
//
// Physical stock is portrait (certificate 148x210mm A5, envelope 162x229mm C5) but content is laid
// out in the wider "landscape" orientation, matching how the certificate/envelope pages already
// read left-to-right. The print engine is told the true portrait paper dimensions plus
// `landscape: true` and draws into that rotated coordinate space, exactly as the removed Electron
// pageSize comment in main/index.ts used to describe.

export interface CremationPrintTextField {
  text: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  fontPt: number;
  italic: boolean;
  bold: boolean;
  align: "left" | "center";
}

export interface CremationPrintPageFields {
  xHundredths: number;
  yHundredths: number;
  widthHundredths: number;
  text: string;
  fontPt: number;
  italic: boolean;
  bold: boolean;
  align: "left" | "center";
}

export interface CremationPrintPageGeometry {
  widthHundredths: number;
  heightHundredths: number;
  landscape: boolean;
  fields: CremationPrintPageFields[];
}

const MM_PER_INCH = 25.4;

function mmToHundredths(mm: number): number {
  return Math.round((mm / MM_PER_INCH) * 100);
}

const CREMATION_CERTIFICATE_STOCK_MM = { widthMm: 148, heightMm: 210 };
const CREMATION_ENVELOPE_STOCK_MM = { widthMm: 162, heightMm: 229 };

export function buildCremationCertificateFields(row: CremationBatchRow, date: string): CremationPrintTextField[] {
  return [
    { text: formatCertificateDate(date), xMm: 104, yMm: 59.5, widthMm: 65, fontPt: 12, italic: true, bold: true, align: "center" },
    { text: row.number, xMm: 146, yMm: 68, widthMm: 39, fontPt: 12, italic: true, bold: true, align: "center" },
    { text: row.fullName, xMm: 70, yMm: 85, widthMm: 91, fontPt: 12, italic: true, bold: true, align: "center" },
  ];
}

export function buildCremationEnvelopeFields(row: CremationBatchRow): CremationPrintTextField[] {
  const fields: CremationPrintTextField[] = [
    { text: "Certificate of Cremation", xMm: 18, yMm: 59, widthMm: 193, fontPt: 22, italic: false, bold: true, align: "center" },
    { text: row.displayName, xMm: 18, yMm: 74, widthMm: 193, fontPt: 22, italic: true, bold: false, align: "center" },
    { text: row.funeralHome, xMm: 18, yMm: 88, widthMm: 193, fontPt: 12, italic: false, bold: false, align: "center" },
  ];
  if (row.location.trim()) fields.push({ text: row.location, xMm: 18, yMm: 94, widthMm: 193, fontPt: 11, italic: false, bold: false, align: "center" });
  return fields;
}

/** Applies the operator's saved scale/offset calibration and converts to hundredths-of-an-inch,
 * the unit System.Drawing.Printing expects for PaperSize/point coordinates. */
export function buildCremationPrintPageGeometry(kind: CremationDocumentKind, fields: CremationPrintTextField[], preference: CremationPrintPreference): CremationPrintPageGeometry {
  const stock = kind === "certificate" ? CREMATION_CERTIFICATE_STOCK_MM : CREMATION_ENVELOPE_STOCK_MM;
  return {
    widthHundredths: mmToHundredths(stock.widthMm),
    heightHundredths: mmToHundredths(stock.heightMm),
    landscape: true,
    fields: fields.map((field) => ({
      text: field.text,
      xHundredths: mmToHundredths(field.xMm * preference.scale + preference.offsetXInches * MM_PER_INCH),
      yHundredths: mmToHundredths(field.yMm * preference.scale + preference.offsetYInches * MM_PER_INCH),
      widthHundredths: mmToHundredths(field.widthMm * preference.scale),
      fontPt: field.fontPt,
      italic: field.italic,
      bold: field.bold,
      align: field.align,
    })),
  };
}
