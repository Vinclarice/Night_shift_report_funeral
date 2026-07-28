import type {
  CombinedEntry,
  CountEntry,
  DeceasedPerson,
  FuneralEntry,
  NightReport,
  ParsedLine,
  PlainEntry,
  ReportEntry,
  ReportSection,
  SectionKey,
} from "./types";

const DELIVER_SECTIONS: SectionKey[] = ["human-deliver", "cremated-deliver"];

function baseEntry() {
  return {
    id: crypto.randomUUID(),
    rush: false,
    keepSeparate: false,
    pinnedBottom: false,
    createdAt: new Date().toISOString(),
  };
}

export function normalizeFuneralHome(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function titleCaseName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s\-/'\u2019(])([a-z])/g, (_match, boundary: string, letter: string) => `${boundary}${letter.toUpperCase()}`);
}

export function formatEntryLine(entry: ReportEntry): string {
  if (entry.type === "funeral") {
    const deceased = entry.deceased.map((person) => {
      const location = person.locationCode ? ` (${person.locationCode})` : "";
      const special = person.specialRequest ? ` (${person.specialRequest})` : "";
      return `${person.name}${location}${special}`;
    }).join(" + ");
    return `${entry.funeralHome} \u2013 ${deceased}`;
  }
  if (entry.type === "funeralHomeOnly") return entry.funeralHome;
  if (entry.type === "count") return `${entry.text} x ${entry.count}`;
  if (entry.type === "combined") return `${entry.leftText} // ${entry.rightText} x ${entry.count}`;
  return entry.text;
}

export function isExactDuplicate(entry: FuneralEntry, person: DeceasedPerson): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return entry.deceased.some(
    (candidate) =>
      normalize(candidate.name) === normalize(person.name) &&
      normalize(candidate.locationCode) === normalize(person.locationCode) &&
      normalize(candidate.specialRequest) === normalize(person.specialRequest),
  );
}

export function addEntry(section: ReportSection, entry: ReportEntry): void {
  if (entry.type === "funeral" && !entry.keepSeparate) {
    // A pinned entry never merges into an unpinned one (or vice versa): pinning exists precisely to
    // hold a line apart from the section's main list, so folding them together would undo it.
    const existing = section.entries.find(
      (candidate): candidate is FuneralEntry =>
        candidate.type === "funeral" &&
        !candidate.keepSeparate &&
        candidate.rush === entry.rush &&
        candidate.pinnedBottom === entry.pinnedBottom &&
        normalizeFuneralHome(candidate.funeralHome) === normalizeFuneralHome(entry.funeralHome),
    );
    if (existing) {
      for (const person of entry.deceased) {
        if (!isExactDuplicate(existing, person)) existing.deceased.push(person);
      }
      return;
    }
  }

  if (entry.type === "funeralHomeOnly" && !entry.keepSeparate) {
    const exists = section.entries.some(
      (candidate) =>
        candidate.type === "funeralHomeOnly" &&
        !candidate.keepSeparate &&
        candidate.rush === entry.rush &&
        candidate.pinnedBottom === entry.pinnedBottom &&
        normalizeFuneralHome(candidate.funeralHome) === normalizeFuneralHome(entry.funeralHome),
    );
    if (exists) return;
  }

  section.entries.push(entry);
  section.entries = sortEntriesForSection(section.key, section.entries);
}

/**
 * Moves an entry between sections, or reorders it inside one when source and target match.
 * `beforeEntryId` is the row the entry should land above; null means the end of the section.
 */
export function moveEntry(report: NightReport, sourceKey: SectionKey, targetKey: SectionKey, entryId: string, beforeEntryId?: string | null): boolean {
  const source = report.sections.find((section) => section.key === sourceKey);
  const target = report.sections.find((section) => section.key === targetKey);
  if (!source || !target) return false;

  if (sourceKey === targetKey) {
    // A drop with no explicit target row inside the same section is a no-op rather than a move to
    // the end, so releasing on the card's padding never silently pins an entry.
    if (beforeEntryId === undefined) return false;
    return reorderEntry(source, entryId, beforeEntryId);
  }

  const index = source.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return false;
  const [entry] = source.entries.splice(index, 1);

  if (beforeEntryId === null) {
    entry.pinnedBottom = true;
    addEntry(target, entry);
    return true;
  }

  if (beforeEntryId) {
    entry.pinnedBottom = false;
    const at = target.entries.findIndex((candidate) => candidate.id === beforeEntryId);
    if (at >= 0) {
      target.entries.splice(at, 0, entry);
      target.entries = sortEntriesForSection(target.key, target.entries);
      return true;
    }
  }
  addEntry(target, entry);
  return true;
}

/**
 * Ordering has three bands, applied as a stable sort so manual drag order survives inside each:
 *
 *   1. rush entries (Deliver sections only — elsewhere rush does not reorder anything)
 *   2. everything else
 *   3. entries pinned to the bottom
 *
 * Pinning wins over rush: a pinned rush entry still sits last, because pinning is an explicit
 * instruction from the operator and rush-first is an automatic convenience.
 */
function orderBand(key: SectionKey, entry: ReportEntry): number {
  if (entry.pinnedBottom) return 2;
  if (DELIVER_SECTIONS.includes(key) && entry.rush) return 0;
  return 1;
}

export function sortEntriesForSection(key: SectionKey, entries: ReportEntry[]): ReportEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => orderBand(key, a.entry) - orderBand(key, b.entry) || a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * Moves an entry to sit immediately before `beforeEntryId`, or to the very end when that is null.
 * Dropping onto a row therefore pushes that row down, which is what dragging a line onto another
 * line looks like it should do. Landing at the end pins the entry there so later additions do not
 * jump above it; moving it anywhere else clears the pin.
 */
export function reorderEntry(section: ReportSection, entryId: string, beforeEntryId: string | null): boolean {
  const from = section.entries.findIndex((entry) => entry.id === entryId);
  if (from < 0 || entryId === beforeEntryId) return false;

  const [entry] = section.entries.splice(from, 1);
  const target = beforeEntryId ? section.entries.findIndex((candidate) => candidate.id === beforeEntryId) : -1;
  if (beforeEntryId && target < 0) {
    section.entries.splice(from, 0, entry);
    return false;
  }

  entry.pinnedBottom = beforeEntryId === null;
  if (target < 0) section.entries.push(entry);
  else section.entries.splice(target, 0, entry);
  section.entries = sortEntriesForSection(section.key, section.entries);
  return true;
}

function parsePerson(value: string): DeceasedPerson {
  const matches = [...value.trim().matchAll(/\(([^)]+)\)/g)].map((match) => match[1].trim());
  const name = titleCaseName(value.replace(/\s*\([^)]+\)/g, ""));
  const rushIndex = matches.findIndex((detail) => /rush/i.test(detail));
  const specialRequest = rushIndex >= 0 ? matches[rushIndex] : matches[1] ?? "";
  const locationCode = matches.find((_, index) => index !== rushIndex) ?? "";
  return { id: crypto.randomUUID(), name, locationCode, specialRequest };
}

export function parsePastedLines(value: string): ParsedLine[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((source): ParsedLine => {
      const combined = source.match(/^(.+?)\s*\/\/\s*(.+?)\s+x\s+(\d+)$/i);
      if (combined) {
        const entry: CombinedEntry = {
          ...baseEntry(),
          type: "combined",
          leftText: combined[1].trim(),
          rightText: combined[2].trim(),
          count: Number(combined[3]),
        };
        return { source, entry };
      }

      const count = source.match(/^(.+?)\s+x\s+(\d+)$/i);
      if (count) {
        const entry: CountEntry = {
          ...baseEntry(),
          type: "count",
          text: count[1].trim(),
          count: Number(count[2]),
        };
        return { source, entry };
      }

      const funeral = source.match(/^(.+?)\s+[\u2013\u2014-]\s+(.+)$/);
      if (funeral) {
        const deceased = funeral[2].split(/\s*\+\s*/).map(parsePerson);
        const rush = deceased.some((person) => /rush/i.test(person.specialRequest));
        const entry: FuneralEntry = {
          ...baseEntry(),
          type: "funeral",
          funeralHome: titleCaseName(funeral[1]),
          deceased,
          rush,
        };
        return { source, entry };
      }

      const entry: PlainEntry = { ...baseEntry(), type: "plain", text: source };
      return { source, entry, warning: "Kept as plain text; review before adding." };
    });
}
