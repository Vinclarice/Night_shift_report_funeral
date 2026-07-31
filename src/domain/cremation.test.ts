import { describe, expect, it } from "vitest";

import {
  DEFAULT_CREMATION_PRINT_PREFERENCE,
  buildCremationCertificateFields,
  buildCremationEnvelopeFields,
  buildCremationPrintPageGeometry,
  deriveCremationDisplayName,
  createCremationBatchRow,
  formatCremationNumber,
  nextCremationNumber,
  parseCremationNumber,
  isCremationRowBlank,
} from "./cremation";

describe("cremation numbering", () => {
  it("increments the final segment through 38", () => {
    expect(nextCremationNumber("6-063-37")).toBe("6-063-38");
  });

  it("rolls the middle segment and then the major segment", () => {
    expect(nextCremationNumber("6-063-38")).toBe("6-064-01");
    expect(nextCremationNumber("6-999-38")).toBe("7-001-01");
  });

  it("rejects malformed and out-of-range numbers", () => {
    expect(parseCremationNumber("6-000-01")).toBeNull();
    expect(parseCremationNumber("6-063-39")).toBeNull();
    expect(parseCremationNumber("6-63-01")).toBeNull();
    expect(formatCremationNumber({ major: 8, middle: 2, minor: 3 })).toBe("8-002-03");
  });
});

describe("cremation label names", () => {
  it("keeps only first and last names", () => {
    expect(deriveCremationDisplayName("Caroll Milton Bush")).toBe("Caroll Bush");
    expect(deriveCremationDisplayName("Bush, Caroll Milton")).toBe("Caroll Bush");
  });

  it("drops common suffixes and preserves a hyphenated last name", () => {
    expect(deriveCremationDisplayName("John Allen Smith Jr.")).toBe("John Smith");
    expect(deriveCremationDisplayName("Smith Jr., John Allen")).toBe("John Smith");
    expect(deriveCremationDisplayName("Mary Anne Rivera-Lopez")).toBe("Mary Rivera-Lopez");
  });

  it("treats a comma before a suffix as a suffix separator, not a Last, First swap", () => {
    expect(deriveCremationDisplayName("John Smith, Jr")).toBe("John Smith");
    expect(deriveCremationDisplayName("John Allen Smith, III")).toBe("John Smith");
  });

  it("treats a successor-only trailing row as unused", () => {
    expect(isCremationRowBlank(createCremationBatchRow("6-064-01"))).toBe(true);
  });
});

describe("cremation print engine geometry", () => {
  const row = { ...createCremationBatchRow("6-063-01"), fullName: "Mary Ann Smith", displayName: "Mary Smith", funeralHome: "Example Funeral", location: "Baltimore, MD" };

  it("builds certificate fields from the row and formatted date", () => {
    const fields = buildCremationCertificateFields(row, "2026-03-05");
    expect(fields.map((field) => field.text)).toEqual(["March 5, 2026", "6-063-01", "Mary Ann Smith"]);
  });

  it("omits the location field on the envelope when it is blank", () => {
    const withLocation = buildCremationEnvelopeFields(row);
    expect(withLocation.map((field) => field.text)).toEqual(["Certificate of Cremation", "Mary Smith", "Example Funeral", "Baltimore, MD"]);

    const withoutLocation = buildCremationEnvelopeFields({ ...row, location: "" });
    expect(withoutLocation.map((field) => field.text)).toEqual(["Certificate of Cremation", "Mary Smith", "Example Funeral"]);
  });

  it("converts millimeters to hundredths-of-an-inch and applies calibration", () => {
    const fields = [{ text: "X", xMm: 25.4, yMm: 50.8, widthMm: 12.7, fontPt: 12, italic: false, bold: false, align: "center" as const }];
    const geometry = buildCremationPrintPageGeometry("certificate", fields, DEFAULT_CREMATION_PRINT_PREFERENCE);
    expect(geometry.landscape).toBe(true);
    expect(geometry.fields[0]).toMatchObject({ xHundredths: 100, yHundredths: 200, widthHundredths: 50 });

    const calibrated = buildCremationPrintPageGeometry("certificate", fields, { scale: 2, offsetXInches: 1, offsetYInches: 0 });
    expect(calibrated.fields[0].xHundredths).toBe(300);
  });
});
