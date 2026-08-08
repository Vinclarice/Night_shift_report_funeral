import type { NightReport } from "@/domain/types";

export interface ReportRepository {
  findByDate(date: string): Promise<NightReport | null>;
  /** The single most recently dated report, regardless of which night it belongs to. */
  mostRecent(): Promise<NightReport | null>;
  create(report: NightReport): Promise<NightReport>;
  save(report: NightReport, expectedVersion: number): Promise<NightReport>;
  /** Deletes every report except the one supplied — retention keeps only the current report. */
  purgeExcept(id: string): Promise<number>;
}
