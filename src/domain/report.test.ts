import {
  createEmptyReport,
  nextReportDate,
  REPORT_SECTIONS,
} from "./report";

describe("report calendar and fixed sections", () => {
  it("uses the next real calendar day across year boundaries", () => {
    expect(nextReportDate(new Date(2026, 11, 31, 23, 30))).toBe("2027-01-01");
  });

  it("creates every section in the required print order", () => {
    const report = createEmptyReport("2026-07-26");
    expect(report.sections.map((section) => section.key)).toEqual(
      REPORT_SECTIONS.map((section) => section.key),
    );
    expect(report.sections).toHaveLength(9);
  });
});

