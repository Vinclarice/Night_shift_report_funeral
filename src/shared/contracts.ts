import type { LayoutSettings, NightReport, SectionKey } from "@/domain/types";

export interface FuneralHomeOption { id: string; name: string }
export interface BackupSummary { name: string; createdAt: string; size: number }

export type WindowControl = "minimize" | "maximize" | "close";

export interface BootstrapData {
  report: NightReport;
  layout: LayoutSettings;
  funeralHomes: FuneralHomeOption[];
  backups: BackupSummary[];
}

export interface NightShiftApi {
  bootstrap(): Promise<BootstrapData>;
  saveReport(report: NightReport, expectedVersion: number): Promise<NightReport>;
  saveLayout(layout: LayoutSettings): Promise<LayoutSettings>;
  renameFuneralHome(id: string, name: string): Promise<FuneralHomeOption[]>;
  mergeFuneralHomes(sourceId: string, targetId: string): Promise<FuneralHomeOption[]>;
  deleteFuneralHome(id: string): Promise<FuneralHomeOption[]>;
  listBackups(): Promise<BackupSummary[]>;
  restoreBackup(name: string): Promise<void>;
  printReport(): Promise<{ success: boolean; failureReason?: string }>;
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
