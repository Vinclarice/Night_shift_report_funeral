import { createEmptyReport, nextReportDate, previousReportDate } from "@/domain/report";
import type { NightReport, ReportEntry } from "@/domain/types";
import type { ReportRepository } from "./repository";

export class VersionConflictError extends Error {
  constructor() { super("This report changed since it was loaded. Reload before saving again."); }
}

function cloneEntry(entry: ReportEntry): ReportEntry {
  const cloned = structuredClone(entry);
  cloned.id = crypto.randomUUID();
  cloned.createdAt = new Date().toISOString();
  if (cloned.type === "funeral") {
    cloned.deceased = cloned.deceased.map((person) => ({ ...person, id: crypto.randomUUID() }));
  }
  return cloned;
}

export class ReportService {
  constructor(
    private readonly repository: ReportRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  get tonightDate() { return nextReportDate(this.clock()); }

  /**
   * Resolves the report that should be open right now, creating or cloning one if needed, so the
   * app always has something ready to edit with no manual "start a report" step.
   */
  async resolveTonight(): Promise<{ report: NightReport; created: boolean }> {
    const tonightDate = this.tonightDate;
    const existing = await this.repository.findByDate(tonightDate);
    if (existing) return { report: existing, created: false };

    // A shift runs across midnight, so the "next calendar day" that names the report changes
    // partway through it. A report dated exactly "yesterday" relative to a fresh tonightDate is
    // almost certainly this same shift's unfinished work from before midnight rolled the date
    // over (reports are always dated "tomorrow" from creation time) — resume it in place,
    // unchanged, rather than cloning it into a duplicate.
    const stranded = await this.repository.findByDate(previousReportDate(tonightDate));
    if (stranded) return { report: stranded, created: false };

    const report = createEmptyReport(tonightDate);
    const prior = await this.repository.mostRecent();
    if (prior) {
      report.sections = report.sections.map((section) => {
        const old = prior.sections.find((candidate) => candidate.key === section.key);
        return { ...section, entries: (old?.entries ?? []).map(cloneEntry) };
      });
    }
    return { report: await this.repository.create(report), created: true };
  }

  save(report: NightReport, expectedVersion: number) {
    return this.repository.save(report, expectedVersion);
  }
}
