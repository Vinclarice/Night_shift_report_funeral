import type { LayoutSettings, NightReport, SectionKey } from "@/domain/types";
import type {
  FirstCallDirectories,
  FirstCallFacility,
  FirstCallFuneralHome,
  FirstCallLookupCandidate,
  FirstCallLookupKind,
  FirstCallDirectoryKind,
  FirstCallPrintPreference,
  FirstCallSearchSettings,
} from "@/domain/firstCall";
import type { RevisionSummary } from "@/application/repository";

export interface FuneralHomeOption { id: string; name: string }
export interface BackupSummary { name: string; createdAt: string; size: number }

export type FirstCallFuneralHomeInput = Pick<FirstCallFuneralHome, "name" | "address" | "phone" | "fax" | "email"> & Partial<Pick<FirstCallFuneralHome, "aliases" | "favorite">> & { id?: string };
export type FirstCallFacilityInput = Pick<FirstCallFacility, "name" | "address" | "phone"> & Partial<Pick<FirstCallFacility, "aliases" | "favorite">> & { id?: string };
export interface FirstCallDirectoryImportResult extends FirstCallDirectories { canceled: boolean; imported: number }
export interface FirstCallDirectoryExportResult { canceled: boolean; path?: string }
export interface FirstCallWorkspaceData extends FirstCallDirectories {
  printPreference: FirstCallPrintPreference;
  searchSettings: FirstCallSearchSettings;
}

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
  /**
   * An unfinalized draft for an earlier date, present only when there is no report for tonight.
   * Set after the report date rolls over mid-shift so the draft can be resumed rather than stranded.
   */
  resumableDraft: NightReport | null;
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
  loadFirstCallWorkspace(): Promise<FirstCallWorkspaceData>;
  saveFirstCallFuneralHome(input: FirstCallFuneralHomeInput): Promise<FirstCallDirectories>;
  deleteFirstCallFuneralHome(id: string): Promise<FirstCallDirectories>;
  saveFirstCallFacility(input: FirstCallFacilityInput): Promise<FirstCallDirectories>;
  deleteFirstCallFacility(id: string): Promise<FirstCallDirectories>;
  useFirstCallDirectory(kind: FirstCallDirectoryKind, id: string): Promise<FirstCallDirectories>;
  mergeFirstCallDirectory(kind: FirstCallDirectoryKind, sourceId: string, targetId: string): Promise<FirstCallDirectories>;
  exportFirstCallDirectories(): Promise<FirstCallDirectoryExportResult>;
  importFirstCallDirectories(): Promise<FirstCallDirectoryImportResult>;
  searchFirstCallPlaces(kind: FirstCallLookupKind, query: string): Promise<FirstCallLookupCandidate[]>;
  saveFirstCallTomTomApiKey(apiKey: string): Promise<FirstCallSearchSettings>;
  saveFirstCallPrintPreference(preference: FirstCallPrintPreference): Promise<FirstCallPrintPreference>;
  printFirstCall(): Promise<{ success: boolean; failureReason?: string }>;
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
