import type { LayoutSettings, NightReport, SectionKey } from "@/domain/types";
import type { RevisionSummary } from "@/application/repository";

export interface FuneralHomeOption { id: string; name: string }
export interface BackupSummary { name: string; createdAt: string; size: number }

/** A past report as listed in the read-only archive. Deliberately does not carry entries. */
export interface ReportSummary {
  id: string;
  reportDate: string;
  status: "draft" | "finalized";
  entryCount: number;
  finalizedAt: string | null;
}

export type WindowControl = "minimize" | "maximize" | "close";

export interface BootstrapData {
  report: NightReport | null;
  latestFinalized: NightReport | null;
  layout: LayoutSettings;
  funeralHomes: FuneralHomeOption[];
  backups: BackupSummary[];
}

export interface NightShiftApi {
  bootstrap(): Promise<BootstrapData>;
  createDraft(mode: "empty" | "clone"): Promise<NightReport>;
  saveReport(report: NightReport, expectedVersion: number): Promise<NightReport>;
  finalizeReport(report: NightReport, expectedVersion: number): Promise<NightReport>;
  reopenReport(report: NightReport, expectedVersion: number): Promise<NightReport>;
  listRevisions(reportId: string): Promise<RevisionSummary[]>;
  restoreRevision(reportId: string, revisionId: string, expectedVersion: number): Promise<NightReport>;
  saveLayout(layout: LayoutSettings): Promise<LayoutSettings>;
  renameFuneralHome(id: string, name: string): Promise<FuneralHomeOption[]>;
  mergeFuneralHomes(sourceId: string, targetId: string): Promise<FuneralHomeOption[]>;
  deleteFuneralHome(id: string): Promise<FuneralHomeOption[]>;
  listBackups(): Promise<BackupSummary[]>;
  restoreBackup(name: string): Promise<void>;
  printReport(): Promise<{ success: boolean; failureReason?: string }>;
  listReports(): Promise<ReportSummary[]>;
  loadReport(id: string): Promise<NightReport | null>;
  windowControl(action: WindowControl): Promise<void>;
  isWindowMaximized(): Promise<boolean>;
  onWindowMaximizeChange(listener: (maximized: boolean) => void): () => void;
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  sectionWidths: {} as Partial<Record<SectionKey, number>>,
  marginInches: 0.35,
  scale: 1,
  offsetXInches: 0,
  offsetYInches: 0,
};

