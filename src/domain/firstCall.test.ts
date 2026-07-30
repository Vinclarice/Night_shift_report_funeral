import { describe, expect, it } from "vitest";

import { createFirstCallDraft, deriveDeceasedLastName, hasFirstCallContent, rankFirstCallDirectoryMatches, sanitizeFirstCallDraftForPersistence } from "./firstCall";

describe("First Call defaults and surname derivation", () => {
  it("defaults the date and taken-by value without treating them as user content", () => {
    const draft = createFirstCallDraft(new Date(2026, 6, 28, 23, 30));
    expect(draft.values.dateOfCall).toBe("July 28, 2026");
    expect(draft.values.takenBy).toBe("Vincent");
    expect(draft.values.timeOfCall).toBe("");
    expect(draft.highlights).toEqual([]);
    expect(hasFirstCallContent(draft)).toBe(false);
  });

  it("treats a manual highlight as temporary sheet content", () => {
    const draft = createFirstCallDraft();
    draft.highlights.push({ id: "highlight-1", x: 10, y: 10, width: 20, height: 10, color: "yellow" });
    expect(hasFirstCallContent(draft)).toBe(true);
  });

  it.each([
    ["Mary Smith", "SMITH"],
    ["Smith, Mary A.", "SMITH"],
    ["Anne Van Buren Jr.", "BUREN"],
    ["Jordan Smith-Jones III", "SMITH-JONES"],
  ])("derives %s as %s", (name, expected) => {
    expect(deriveDeceasedLastName(name)).toBe(expected);
  });
});

describe("First Call persistence privacy", () => {
  it("strips the Residence address and phone before the sheet is persisted", () => {
    const draft = createFirstCallDraft();
    draft.placeOfDeathKind = "residence";
    draft.values.placeOfDeathName = "Residence";
    draft.values.placeOfDeathAddress = "123 Main St";
    draft.values.placeOfDeathPhone = "555-0100";
    draft.values.decedentName = "Jordan Smith";
    const sanitized = sanitizeFirstCallDraftForPersistence(draft);
    expect(sanitized.values.placeOfDeathAddress).toBe("");
    expect(sanitized.values.placeOfDeathPhone).toBe("");
    expect(sanitized.values.placeOfDeathName).toBe("Residence");
    expect(sanitized.values.decedentName).toBe("Jordan Smith");
  });

  it("leaves a Facility place of death untouched", () => {
    const draft = createFirstCallDraft();
    draft.values.placeOfDeathName = "Sibley Memorial Hospital";
    draft.values.placeOfDeathAddress = "5255 Loughboro Rd";
    const sanitized = sanitizeFirstCallDraftForPersistence(draft);
    expect(sanitized).toEqual(draft);
  });
});

describe("First Call saved-directory matching", () => {
  const facilities = [
    { id: "1", name: "MedStar Washington Hospital Center", address: "10 Irving St", phone: "", aliases: ["WHC"], favorite: false, useCount: 5, lastUsedAt: null },
    { id: "2", name: "Virginia Hospital Center", address: "1701 George Mason Dr", phone: "", aliases: ["VHC"], favorite: true, useCount: 1, lastUsedAt: null },
    { id: "3", name: "Sibley Memorial Hospital", address: "5255 Loughboro Rd", phone: "", aliases: [], favorite: false, useCount: 0, lastUsedAt: null },
  ];

  it("matches partial names, aliases, and abbreviations", () => {
    expect(rankFirstCallDirectoryMatches(facilities, "Sibley").map((item) => item.id)).toEqual(["3"]);
    expect(rankFirstCallDirectoryMatches(facilities, "WHC").map((item) => item.id)).toEqual(["1"]);
    expect(rankFirstCallDirectoryMatches(facilities, "VHC").map((item) => item.id)).toEqual(["2"]);
  });

  it("shows favorites and used locations first when the field is empty", () => {
    expect(rankFirstCallDirectoryMatches(facilities, "").map((item) => item.id)).toEqual(["2", "1"]);
  });
});
