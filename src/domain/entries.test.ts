import {
  addEntry,
  formatEntryLine,
  moveEntry,
  normalizeFuneralHome,
  parsePastedLines,
  removeEntry,
  reorderEntry,
  sortEntriesForSection,
  titleCaseName,
  toggleEntryRush,
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
    pinnedBottom: false,
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

describe("removeEntry", () => {
  it("drops the whole entry when it has no personId to narrow to", () => {
    const report = createEmptyReport("2026-07-26");
    const section = report.sections.find((item) => item.key === "human-deliver")!;
    const entry = funeral();
    section.entries.push(entry);

    expect(removeEntry(section, entry.id)).toBe(true);
    expect(section.entries).toHaveLength(0);
  });

  it("removes just one deceased person from a multi-person entry, keeping the rest", () => {
    const report = createEmptyReport("2026-07-26");
    const section = report.sections.find((item) => item.key === "human-deliver")!;
    const entry = funeral({
      deceased: [
        { id: "one", name: "Smith", locationCode: "13A", specialRequest: "" },
        { id: "two", name: "Jones", locationCode: "17B", specialRequest: "" },
      ],
    });
    section.entries.push(entry);

    expect(removeEntry(section, entry.id, "one")).toBe(true);
    expect(section.entries).toHaveLength(1);
    expect((section.entries[0] as FuneralEntry).deceased.map((person) => person.id)).toEqual(["two"]);
  });

  it("drops the entry once its last deceased person is removed", () => {
    const report = createEmptyReport("2026-07-26");
    const section = report.sections.find((item) => item.key === "human-deliver")!;
    const entry = funeral({ deceased: [{ id: "only", name: "Smith", locationCode: "13A", specialRequest: "" }] });
    section.entries.push(entry);

    expect(removeEntry(section, entry.id, "only")).toBe(true);
    expect(section.entries).toHaveLength(0);
  });

  it("reports failure rather than throwing when the entry id is not found", () => {
    const report = createEmptyReport("2026-07-26");
    const section = report.sections.find((item) => item.key === "human-deliver")!;
    expect(removeEntry(section, "missing")).toBe(false);
  });
});

describe("toggleEntryRush", () => {
  it("flips the flag and re-sorts a Deliver section so the entry jumps to the rush band", () => {
    const report = createEmptyReport("2026-07-26");
    const section = report.sections.find((item) => item.key === "human-deliver")!;
    const first = funeral({ id: "first", funeralHome: "Normal", keepSeparate: true });
    const second = funeral({ id: "second", funeralHome: "ToRush", keepSeparate: true });
    section.entries.push(first, second);

    expect(toggleEntryRush(section, "second")).toBe(true);

    expect(section.entries.map((entry) => entry.id)).toEqual(["second", "first"]);
    expect(section.entries[0].rush).toBe(true);
  });

  it("flips the flag back off without erroring, though the entry keeps its new position", () => {
    // sortEntriesForSection is stable relative to the *current* array order at the time it runs,
    // not the original insertion order — so toggling rush on and back off doesn't bounce the
    // entry back to where it started. That's existing, intentional behavior; this just pins it
    // down so a future change to the sort doesn't silently alter it.
    const report = createEmptyReport("2026-07-26");
    const section = report.sections.find((item) => item.key === "human-deliver")!;
    const first = funeral({ id: "first", funeralHome: "Normal", keepSeparate: true });
    const second = funeral({ id: "second", funeralHome: "ToRush", keepSeparate: true });
    section.entries.push(first, second);

    toggleEntryRush(section, "second");
    toggleEntryRush(section, "second");

    expect(section.entries.map((entry) => entry.id)).toEqual(["second", "first"]);
    expect(section.entries.every((entry) => !entry.rush)).toBe(true);
  });

  it("reports failure rather than throwing when the entry id is not found", () => {
    const report = createEmptyReport("2026-07-26");
    const section = report.sections.find((item) => item.key === "human-deliver")!;
    expect(toggleEntryRush(section, "missing")).toBe(false);
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

describe("reorderEntry", () => {
  function section(key: "human-deliver" | "human-fdp" = "human-deliver") {
    const report = createEmptyReport("2026-07-26");
    return report.sections.find((candidate) => candidate.key === key)!;
  }

  function ids(entries: { id: string }[]) {
    return entries.map((entry) => entry.id);
  }

  function named(id: string, overrides: Partial<FuneralEntry> = {}): FuneralEntry {
    return funeral({ id, funeralHome: id, keepSeparate: true, ...overrides });
  }

  it("drops an entry above the row it was released on, pushing that row down", () => {
    const target = section("human-fdp");
    target.entries.push(named("a"), named("b"), named("c"));

    expect(reorderEntry(target, "c", "b")).toBe(true);

    expect(ids(target.entries)).toEqual(["a", "c", "b"]);
  });

  it("pins an entry to the end when dropped past the last row", () => {
    const target = section("human-fdp");
    target.entries.push(named("a"), named("b"));

    reorderEntry(target, "a", null);

    expect(ids(target.entries)).toEqual(["b", "a"]);
    expect(target.entries.at(-1)!.pinnedBottom).toBe(true);
  });

  it("holds a pinned entry at the bottom as later entries are added", () => {
    const target = section("human-fdp");
    target.entries.push(named("roadtrip"));
    reorderEntry(target, "roadtrip", null);

    addEntry(target, named("later"));

    expect(ids(target.entries)).toEqual(["later", "roadtrip"]);
  });

  it("clears the pin when the entry is moved back up", () => {
    const target = section("human-fdp");
    target.entries.push(named("a"), named("b"));
    reorderEntry(target, "a", null);

    reorderEntry(target, "a", "b");

    expect(ids(target.entries)).toEqual(["a", "b"]);
    expect(target.entries[0].pinnedBottom).toBe(false);
  });

  it("keeps rush entries above non-rush ones in Deliver while preserving manual order inside each band", () => {
    const deliver = section("human-deliver");
    deliver.entries.push(named("rush-1", { rush: true }), named("plain-1"), named("rush-2", { rush: true }), named("plain-2"));
    deliver.entries = sortEntriesForSection(deliver.key, deliver.entries);
    expect(ids(deliver.entries)).toEqual(["rush-1", "rush-2", "plain-1", "plain-2"]);

    // Reordering inside the non-rush band must not promote anything past the rush block.
    reorderEntry(deliver, "plain-2", "plain-1");

    expect(ids(deliver.entries)).toEqual(["rush-1", "rush-2", "plain-2", "plain-1"]);
  });

  it("keeps a pinned entry last even when it is also marked rush", () => {
    const deliver = section("human-deliver");
    deliver.entries.push(named("rush-1", { rush: true }), named("plain-1"));
    deliver.entries.push(named("pinned-rush", { rush: true, pinnedBottom: true }));

    deliver.entries = sortEntriesForSection(deliver.key, deliver.entries);

    expect(ids(deliver.entries)).toEqual(["rush-1", "plain-1", "pinned-rush"]);
  });

  it("does not merge a pinned entry into an identical unpinned one", () => {
    const target = section("human-fdp");
    const first = funeral({ id: "first", funeralHome: "McGuire" });
    target.entries.push(first);

    addEntry(target, funeral({ id: "second", funeralHome: "McGuire", pinnedBottom: true }));

    expect(target.entries).toHaveLength(2);
    expect(ids(target.entries)).toEqual(["first", "second"]);
  });

  it("ignores a reorder against an unknown row rather than corrupting the order", () => {
    const target = section("human-fdp");
    target.entries.push(named("a"), named("b"));

    expect(reorderEntry(target, "a", "missing")).toBe(false);

    expect(ids(target.entries)).toEqual(["a", "b"]);
  });
});

describe("moveEntry positioning", () => {
  it("inserts above a specific row when moving across sections", () => {
    const report = createEmptyReport("2026-07-26");
    const source = report.sections.find((section) => section.key === "human-airport")!;
    const target = report.sections.find((section) => section.key === "human-fdp")!;
    target.entries.push(funeral({ id: "existing", funeralHome: "Greene", keepSeparate: true }));
    source.entries.push(funeral({ id: "moving", funeralHome: "Inman", keepSeparate: true }));

    expect(moveEntry(report, "human-airport", "human-fdp", "moving", "existing")).toBe(true);

    expect(target.entries.map((entry) => entry.id)).toEqual(["moving", "existing"]);
    expect(source.entries).toHaveLength(0);
  });

  it("pins an entry dropped at the end of another section", () => {
    const report = createEmptyReport("2026-07-26");
    const source = report.sections.find((section) => section.key === "human-airport")!;
    const target = report.sections.find((section) => section.key === "human-fdp")!;
    source.entries.push(funeral({ id: "moving", funeralHome: "Inman", keepSeparate: true }));
    target.entries.push(funeral({ id: "existing", funeralHome: "Greene", keepSeparate: true }));

    expect(moveEntry(report, "human-airport", "human-fdp", "moving", null)).toBe(true);
    addEntry(target, funeral({ id: "later", funeralHome: "McGuire", keepSeparate: true }));

    expect(target.entries.map((entry) => entry.id)).toEqual(["existing", "later", "moving"]);
    expect(target.entries.at(-1)!.pinnedBottom).toBe(true);
  });

  it("treats a same-section drop with no target row as a no-op so nothing is pinned by accident", () => {
    const report = createEmptyReport("2026-07-26");
    const target = report.sections.find((section) => section.key === "human-fdp")!;
    target.entries.push(funeral({ id: "a", keepSeparate: true }), funeral({ id: "b", keepSeparate: true }));

    expect(moveEntry(report, "human-fdp", "human-fdp", "a")).toBe(false);

    expect(target.entries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(target.entries[0].pinnedBottom).toBe(false);
  });
});
