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

describe("parses every line format from the reference night shift report", () => {
  it("parses single-deceased funeral lines with a location code", () => {
    const cases: Array<[string, string, string, string]> = [
      ["Greene \u2013 Johnson (TRL)", "Greene", "Johnson", "TRL"],
      ["MD Crem \u2013 Rumer (17B)", "MD Crem", "Rumer", "17B"],
      ["Crescent \u2013 Wanzer (13A)", "Crescent", "Wanzer", "13A"],
      ["McGuire \u2013 Willoughby (13A)", "McGuire", "Willoughby", "13A"],
      ["Inman \u2013 Lassahn (SSR)", "Inman", "Lassahn", "SSR"],
      ["Moloney \u2013 Rivera (SSR)", "Moloney", "Rivera", "SSR"],
      ["Alfirdaus \u2013 Fall (PR)", "Alfirdaus", "Fall", "PR"],
    ];
    for (const [source, funeralHome, name, locationCode] of cases) {
      const entry = parsePastedLines(source)[0].entry as FuneralEntry;
      expect(entry.type).toBe("funeral");
      expect(entry.funeralHome).toBe(funeralHome);
      expect(entry.deceased).toHaveLength(1);
      expect(entry.deceased[0].name).toBe(name);
      expect(entry.deceased[0].locationCode).toBe(locationCode);
      expect(entry.deceased[0].specialRequest).toBe("");
    }
  });

  it("parses multiple deceased for one funeral home joined by '+' with no parens", () => {
    const entry = parsePastedLines("NMS \u2013 Nicholas + Zhang")[0].entry as FuneralEntry;
    expect(entry.funeralHome).toBe("NMS");
    expect(entry.deceased.map((person) => person.name)).toEqual(["Nicholas", "Zhang"]);
    expect(entry.deceased.every((person) => person.locationCode === "" && person.specialRequest === "")).toBe(true);
  });

  it("captures a single free-text parenthetical as the location code, including punctuation", () => {
    // The sheet uses a single paren for two different things in practice: a short location
    // code (13A, TRL, SSR) and a longer free-text note (a question, a callback instruction).
    // parsePerson has no way to distinguish these \u2014 a lone paren is always read as the location
    // code, never the (bolded, uppercased-on-print) special request. That's arguably a real
    // ambiguity in the format itself, not something this test is asserting is ideal \u2014 it's
    // pinning down today's actual behavior so a future parser change doesn't silently misfile
    // one of these to the other.
    const curry = parsePastedLines("NMS \u2013 Curry (FDP or S/O?)")[0].entry as FuneralEntry;
    expect(curry.deceased[0]).toMatchObject({ name: "Curry", locationCode: "FDP or S/O?", specialRequest: "" });

    const hernandez = parsePastedLines("Beltway Crem \u2013 Hernandez (FH will call)")[0].entry as FuneralEntry;
    expect(hernandez.deceased[0]).toMatchObject({ name: "Hernandez", locationCode: "FH will call", specialRequest: "" });
  });

  it("keeps a note dash inside the parenthetical from being mistaken for the funeral-home separator", () => {
    // "Brown/PA \u2013 Helwig (Roadtrip \u2013 Ron OK)" has two dash-like separators; the non-greedy
    // funeral-home regex must split on the first one (right after "Brown/PA"), not get confused
    // by the second dash sitting inside the parenthetical note.
    const entry = parsePastedLines("Brown/PA \u2013 Helwig (Roadtrip \u2013 Ron OK)")[0].entry as FuneralEntry;
    expect(entry.funeralHome).toBe("Brown/PA");
    expect(entry.deceased).toHaveLength(1);
    expect(entry.deceased[0].name).toBe("Helwig");
    expect(entry.deceased[0].locationCode).toBe("Roadtrip \u2013 Ron OK");
  });

  it("parses count and combined lines", () => {
    expect(parsePastedLines("Reese x 3")[0].entry).toMatchObject({ type: "count", text: "Reese", count: 3 });
    expect(parsePastedLines("Sewell x 2")[0].entry).toMatchObject({ type: "count", text: "Sewell", count: 2 });
    expect(parsePastedLines("McGuire // JFC x 2")[0].entry).toMatchObject({ type: "combined", leftText: "McGuire", rightText: "JFC", count: 2 });
  });

  it("falls back to a flagged plain line for single names with no recognizable structure", () => {
    for (const source of ["Fraizer-Mason", "Covenant"]) {
      const line = parsePastedLines(source)[0];
      expect(line.entry).toMatchObject({ type: "plain", text: source });
      expect(line.warning).toBe("Kept as plain text; review before adding.");
    }
  });
});
