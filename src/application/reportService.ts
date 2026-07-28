import { createEmptyReport, nextReportDate } from "@/domain/report";
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

  loadTonight() { return this.repository.findByDate(this.tonightDate); }

  latestFinalized() { return this.repository.latestFinalized(); }

  /**
   * A shift runs across midnight, so the "next calendar day" that names the report changes partway
   * through it. If the app is restarted after midnight, no report exists for the new tonight-date
   * and the draft built earlier in the same shift would otherwise be unreachable — it stays in the
   * database but the editor only ever looks up by date. This surfaces that draft so it can be
   * resumed. Only drafts dated on or before tonight qualify: a later date would be a real future
   * report rather than a stranded one.
   */
  async resumableDraft(): Promise<NightReport | null> {
    if (await this.loadTonight()) return null;
    return this.repository.latestDraft(this.tonightDate);
  }

  async createTonight(mode: "empty" | "clone"): Promise<NightReport> {
    const report = createEmptyReport(this.tonightDate);
    if (mode === "clone") {
      const prior = await this.repository.latestFinalized();
      if (prior) {
        report.sections = report.sections.map((section) => {
          const old = prior.sections.find((candidate) => candidate.key === section.key);
          return { ...section, entries: (old?.entries ?? []).map(cloneEntry) };
        });
      }
    }
    return this.repository.create(report);
  }

  save(report: NightReport, expectedVersion: number) {
    return this.repository.save(report, expectedVersion);
  }

  finalize(report: NightReport, expectedVersion: number) {
    return this.repository.finalize(report, expectedVersion, this.clock());
  }

  reopen(report: NightReport, expectedVersion: number) {
    return this.repository.save({ ...report, status: "draft", finalizedAt: null }, expectedVersion);
  }

  listRevisions(reportId: string) { return this.repository.listRevisions(reportId); }

  restoreRevision(reportId: string, revisionId: string, expectedVersion: number) {
    return this.repository.restoreRevision(reportId, revisionId, expectedVersion);
  }
}
