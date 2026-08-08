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

/**
 * Finds a special request shared by every deceased person on a funeral entry, so it can be printed
 * once instead of once per person \u2014 two people both marked "FH will call" should read
 * "Deceased 1 + Deceased 2 (FH will call)", not repeat the note on each name. Only collapses when
 * *every* person has the exact same non-empty request; a mix of requests (or some blank) still
 * prints per person so no detail is silently dropped.
 */
export function sharedSpecialRequest(deceased: DeceasedPerson[]): string | null {
  if (deceased.length < 2) return null;
  const [first, ...rest] = deceased.map((person) => person.specialRequest.trim());
  if (!first) return null;
  return rest.every((value) => value.toLocaleLowerCase() === first.toLocaleLowerCase()) ? first : null;
}

export function formatEntryLine(entry: ReportEntry): string {
  if (entry.type === "funeral") {
    const deceased = entry.deceased.map((person) => {
      const location = person.locationCode ? ` (${person.locationCode})` : "";
      // Keep the editable representation parser-safe by attaching every request to its person.
      // The printed EntryLine may collapse a shared request visually, but text placed into the
      // inline editor must round-trip through parsePastedLines without losing anyone's request.
      const special = person.specialRequest ? ` [${person.specialRequest}]` : "";
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
 * Removes an entry from a section, or — for a funeral entry with more than one deceased person —
 * just the one person named by `personId`. The entry itself is only dropped once its last person
 * is gone, mirroring how it was built up by `addEntry` merging people together in the first place.
 */
export function removeEntry(section: ReportSection, entryId: string, personId?: string): boolean {
  const index = section.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return false;
  const entry = section.entries[index];
  if (entry.type === "funeral" && personId) {
    entry.deceased = entry.deceased.filter((person) => person.id !== personId);
    if (entry.deceased.length) return true;
  }
  section.entries.splice(index, 1);
  return true;
}

/**
 * Flips an entry's rush flag and re-sorts the section, since rush status changes which ordering
 * band the entry belongs in (see `orderBand` below) — skipping the re-sort would leave the row
 * visually in its old position until some unrelated edit happened to trigger one.
 */
export function toggleEntryRush(section: ReportSection, entryId: string): boolean {
  const entry = section.entries.find((candidate) => candidate.id === entryId);
  if (!entry) return false;
  entry.rush = !entry.rush;
  section.entries = sortEntriesForSection(section.key, section.entries);
  return true;
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
 * Replaces the entry at `entryId` with `replacement`, in place at its existing array position,
 * instead of removing it and letting `addEntry` push it back onto the end of the section. That
 * remove-then-append pattern is what used to bump a freshly edited line to a new position: the
 * `sortEntriesForSection` call below is stable and keyed off each entry's current position, so it
 * only moves the edited entry if the edit itself changed which ordering band (rush/pinned) it
 * belongs in — every other row, and the edited one when its band didn't change, keeps its place.
 * Falls back to `addEntry` if the entry isn't found, so a caller can use this unconditionally.
 */
export function replaceEntryInPlace(section: ReportSection, entryId: string, replacement: ReportEntry): boolean {
  const index = section.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) {
    addEntry(section, replacement);
    return false;
  }
  section.entries[index] = replacement;
  section.entries = sortEntriesForSection(section.key, section.entries);
  return true;
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
  const trimmed = value.trim();
  const explicitRequests = [...trimmed.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].trim());
  const withoutBrackets = trimmed.replace(/\s*\[[^\]]+\]/g, "").trim();
  const parens = [...withoutBrackets.matchAll(/\(([^)]+)\)/g)];
  const parenContents = parens.map((match) => match[1].trim());
  const rushIndex = parenContents.findIndex((detail) => /rush/i.test(detail));

  // A complete line reads "deceased (loc) special request" — free text typed straight after the
  // last parenthetical, with no delimiter of its own, is that trailing special request. A lone
  // paren with nothing after it stays read as the location code: parsePerson still can't tell a
  // short code from a bracket-free note with only one paren to go on (see the "captures a single
  // free-text parenthetical..." test below), so that existing ambiguity is left alone.
  const lastParen = parens.at(-1);
  const trailingText = lastParen ? withoutBrackets.slice(lastParen.index! + lastParen[0].length).trim() : "";

  const name = titleCaseName(parens[0] ? withoutBrackets.slice(0, parens[0].index) : withoutBrackets);
  const specialRequest = explicitRequests[0] ?? (rushIndex >= 0 ? parenContents[rushIndex] : trailingText || (parenContents[1] ?? ""));
  const locationCode = parenContents.find((_, index) => index !== rushIndex) ?? "";
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
