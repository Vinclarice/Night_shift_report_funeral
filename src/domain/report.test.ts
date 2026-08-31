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
    // Ten sections exist; ROAD TRIPS is one of them and is simply not drawn unless the night has
    // one, so the count here is the data model's, not the printed sheet's.
    expect(report.sections).toHaveLength(10);
  });

  it("puts road trips between airport drops and FDP, and starts it hidden", () => {
    const keys = REPORT_SECTIONS.map((section) => section.key);
    expect(keys.indexOf("human-road-trips")).toBe(keys.indexOf("human-airport") + 1);
    expect(keys.indexOf("human-fdp")).toBe(keys.indexOf("human-road-trips") + 1);
    expect(createEmptyReport("2026-07-26").roadTripsVisible).toBe(false);
  });
});

