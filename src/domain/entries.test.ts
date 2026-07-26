import {
  addEntry,
  formatEntryLine,
  moveEntry,
  normalizeFuneralHome,
  parsePastedLines,
  sortEntriesForSection,
  titleCaseName,
} from "./entries";
import { createEmptyReport } from "./report";
import type { FuneralEntry } from "./types";

function funeral(overrides: Partial<FuneralEntry> = {}): FuneralEntry {
  return {
    id: crypto.randomUUID(),
    type: "funeral",
    funeralHome: "McGuire",
    deceased: [{ id: crypto.randomUUID(), name: "Smith", locationCode: "13A", specialRequest: "" }],
    rush: false,
    keepSeparate: false,
    createdAt: "2026-07-25T12:00:00.000Z",
    ...overrides,
  };
}

describe("funeral-home rules", () => {
  it("normalizes only case and whitespace for safe exact matching", () => {
    expect(normalizeFuneralHome("  McGuire   Funeral ")).toBe("mcguire funeral");
  });

  it("merges deceased into the same funeral home and priority bucket", () => {
    const report = createEmptyReport("2026-07-26");
    const section = report.sections.find((item) => item.key === "human-deliver")!;
    const first = funeral();
    const second = funeral({
      id: crypto.randomUUID(),
      funeralHome: " mcguire ",
      deceased: [{ id: crypto.randomUUID(), name: "Jones", locationCode: "17B", specialRequest: "" }],
    });

    addEntry(section, first);
    addEntry(section, second);

    expect(section.entries).toHaveLength(1);
    expect((section.entries[0] as FuneralEntry).deceased.map((person) => person.name)).toEqual([
      "Smith",
      "Jones",
    ]);
  });

  it("keeps explicit separate and rush lines apart", () => {
    const report = createEmptyReport("2026-07-26");
    const section = report.sections.find((item) => item.key === "human-deliver")!;
    addEntry(section, funeral());
    addEntry(section, funeral({ id: crypto.randomUUID(), keepSeparate: true }));
    addEntry(section, funeral({ id: crypto.randomUUID(), rush: true }));
    expect(section.entries).toHaveLength(3);
  });

  it("places rush deliveries first while preserving stable order", () => {
    const normal = funeral({ funeralHome: "Normal" });
    const rushA = funeral({ funeralHome: "Rush A", rush: true });
    const rushB = funeral({ funeralHome: "Rush B", rush: true });
    expect(sortEntriesForSection("human-deliver", [normal, rushA, rushB])).toEqual([
      rushA,
      rushB,
      normal,
    ]);
  });

  it("moves an entry between sections without losing its structured data", () => {
    const report = createEmptyReport("2026-07-26");
    const pending = report.sections.find((item) => item.key === "human-pending")!;
    const deliver = report.sections.find((item) => item.key === "human-deliver")!;
    const entry = funeral({ funeralHome: "Beltway Crem" });
    pending.entries.push(entry);

    expect(moveEntry(report, "human-pending", "human-deliver", entry.id)).toBe(true);
    expect(pending.entries).toHaveLength(0);
    expect(deliver.entries).toEqual([entry]);
  });
});

describe("paste parsing", () => {
  it("recognizes combined, count, funeral, and plain lines for review", () => {
    expect(
      parsePastedLines(
        "McGuire – Smith (13A) + Jones (17B)\nMcGuire // JFC x 2\nReese x 3\nCall Ron",
      ).map((item) => item.entry.type),
    ).toEqual(["funeral", "combined", "count", "plain"]);
  });

  it("formats structured entries back into an editable report line", () => {
    expect(formatEntryLine(funeral({
      deceased: [
        { id: "one", name: "Smith", locationCode: "13A", specialRequest: "" },
        { id: "two", name: "Jones", locationCode: "17B", specialRequest: "Call Ron" },
      ],
    }))).toBe("McGuire \u2013 Smith (13A) + Jones (17B) (Call Ron)");
  });

  it("capitalizes each word of lower-case funeral-home and deceased names", () => {
    expect(titleCaseName("mcguire funeral")).toBe("Mcguire Funeral");
    const parsed = parsePastedLines("mcguire funeral \u2013 john o'connor-smith (13a)")[0].entry as FuneralEntry;
    expect(parsed.funeralHome).toBe("Mcguire Funeral");
    expect(parsed.deceased[0].name).toBe("John O'Connor-Smith");
  });
});
