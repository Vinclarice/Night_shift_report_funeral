import {
  createEmptyReport,
  DEFAULT_HIDDEN_SECTIONS,
  OPTIONAL_SECTIONS,
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

  it("puts road trips between airport drops and FDP, and starts it put away", () => {
    const keys = REPORT_SECTIONS.map((section) => section.key);
    expect(keys.indexOf("human-road-trips")).toBe(keys.indexOf("human-airport") + 1);
    expect(keys.indexOf("human-fdp")).toBe(keys.indexOf("human-road-trips") + 1);
    expect(createEmptyReport("2026-07-26").hiddenSections).toEqual(["human-road-trips"]);
  });
  it("offers exactly the three cards that can be put away", () => {
    // Every other section is part of the sheet unconditionally; these are the ones a night can do
    // without. Only ROAD TRIPS starts put away — the other two are on the sheet as it has always
    // printed, and hiding them by default would change the report rather than offer to.
    expect(OPTIONAL_SECTIONS.map((section) => section.key)).toEqual(["human-airport", "human-road-trips", "cremated-certs"]);
    expect(DEFAULT_HIDDEN_SECTIONS).toEqual(["human-road-trips"]);
  });
});
