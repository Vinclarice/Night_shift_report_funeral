import { createEmptyReport, shiftReportDate } from "@/domain/report";
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

  get tonightDate() { return shiftReportDate(this.clock()); }

  /**
   * Resolves the report that should be open right now, creating or cloning one if needed, so the
   * app always has something ready to edit with no manual "start a report" step. Because
   * shiftReportDate names the whole shift the same thing on both sides of midnight, reopening the
   * app mid-shift finds that shift's own report and resumes it in place.
   */
  async resolveTonight(): Promise<{ report: NightReport; created: boolean }> {
    const tonightDate = this.tonightDate;
    const existing = await this.repository.findByDate(tonightDate);
    if (existing) return { report: existing, created: false };

    const report = createEmptyReport(tonightDate);
    const prior = await this.repository.mostRecent();
    if (prior) {
      // Carried over like a card width rather than reset like the notes: a run of nights that want
      // the same sheet is set up once, and changing it back is one click.
      report.hiddenSections = [...prior.hiddenSections];
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
