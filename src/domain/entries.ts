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
    const existing = section.entries.find(
      (candidate): candidate is FuneralEntry =>
        candidate.type === "funeral" &&
        !candidate.keepSeparate &&
        candidate.rush === entry.rush &&
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
        normalizeFuneralHome(candidate.funeralHome) === normalizeFuneralHome(entry.funeralHome),
    );
    if (exists) return;
  }

  section.entries.push(entry);
  section.entries = sortEntriesForSection(section.key, section.entries);
}

export function moveEntry(report: NightReport, sourceKey: SectionKey, targetKey: SectionKey, entryId: string): boolean {
  if (sourceKey === targetKey) return false;
  const source = report.sections.find((section) => section.key === sourceKey);
  const target = report.sections.find((section) => section.key === targetKey);
  if (!source || !target) return false;
  const index = source.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return false;
  const [entry] = source.entries.splice(index, 1);
  addEntry(target, entry);
  return true;
}

export function sortEntriesForSection(key: SectionKey, entries: ReportEntry[]): ReportEntry[] {
  if (!DELIVER_SECTIONS.includes(key)) return [...entries];
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => Number(b.entry.rush) - Number(a.entry.rush) || a.index - b.index)
    .map(({ entry }) => entry);
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
