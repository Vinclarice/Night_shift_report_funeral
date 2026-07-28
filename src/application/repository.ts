import type { NightReport } from "@/domain/types";

export interface RevisionSummary {
  id: string;
  revisionNumber: number;
  finalizedAt: string;
}

export interface ReportRepository {
  findByDate(date: string): Promise<NightReport | null>;
  latestFinalized(): Promise<NightReport | null>;
  /** Newest unfinalized report, used to recover a draft stranded by the date rolling over. */
  latestDraft(): Promise<NightReport | null>;
  create(report: NightReport): Promise<NightReport>;
  save(report: NightReport, expectedVersion: number): Promise<NightReport>;
  finalize(report: NightReport, expectedVersion: number, finalizedAt: Date): Promise<NightReport>;
  listRevisions(reportId: string): Promise<RevisionSummary[]>;
  restoreRevision(reportId: string, revisionId: string, expectedVersion: number): Promise<NightReport>;
  purgeOlderThan(cutoffDate: string): Promise<number>;
}

