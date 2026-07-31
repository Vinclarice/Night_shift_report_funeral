import type { LayoutSettings, NightReport, SectionKey } from "@/domain/types";
import type {
  FirstCallDirectories,
  FirstCallDraft,
  FirstCallFacility,
  FirstCallFuneralHome,
  FirstCallLookupCandidate,
  FirstCallLookupKind,
  FirstCallDirectoryKind,
  FirstCallPrintPreference,
  FirstCallSearchSettings,
} from "@/domain/firstCall";
import type { RevisionSummary } from "@/application/repository";
import type {
  CremationBatchRow,
  CremationDocumentKind,
  CremationFuneralHome,
  CremationLabelReadiness,
  CremationPrintingReadiness,
  CremationPrintPreference,
  PrinterCapability,
} from "@/domain/cremation";

export interface FuneralHomeOption { id: string; name: string }
export interface BackupSummary { name: string; createdAt: string; size: number }

export type FirstCallFuneralHomeInput = Pick<FirstCallFuneralHome, "name" | "address" | "phone" | "fax" | "email"> & Partial<Pick<FirstCallFuneralHome, "aliases" | "favorite">> & { id?: string };
export type FirstCallFacilityInput = Pick<FirstCallFacility, "name" | "address" | "phone"> & Partial<Pick<FirstCallFacility, "aliases" | "favorite">> & { id?: string };
export interface FirstCallDirectoryImportResult extends FirstCallDirectories { canceled: boolean; imported: number }
export interface FirstCallDirectoryExportResult { canceled: boolean; path?: string }
export interface FirstCallWorkspaceData extends FirstCallDirectories {
  printPreference: FirstCallPrintPreference;
  searchSettings: FirstCallSearchSettings;
  /** The sheet left over from last time, or null when there is nothing saved to resume. */
  savedDraft: FirstCallDraft | null;
}

export type CremationFuneralHomeInput = Pick<CremationFuneralHome, "name" | "location"> & { id?: string };
/** The full in-progress batch, saved as one unit so it can be resumed exactly as it was left. */
export interface CremationBatchSnapshot {
  date: string;
  rows: CremationBatchRow[];
}
export interface CremationWorkspaceData {
  funeralHomes: CremationFuneralHome[];
  savedFinalNumber: string | null;
  printPreferences: Record<CremationDocumentKind, CremationPrintPreference>;
  labelReadiness: CremationLabelReadiness;
  printingReadiness: Record<CremationDocumentKind, CremationPrintingReadiness>;
  /** The batch left over from last time, or null when there is nothing saved to resume. */
  savedBatch: CremationBatchSnapshot | null;
}
export interface CremationLabelItem { id: string; displayName: string }
export interface CremationLabelPrintResult { printedIds: string[]; failureReason?: string }

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
  saveFirstCallDraft(draft: FirstCallDraft): Promise<void>;
  clearFirstCallDraft(): Promise<void>;
  loadCremationWorkspace(): Promise<CremationWorkspaceData>;
  saveCremationFuneralHome(input: CremationFuneralHomeInput): Promise<CremationFuneralHome[]>;
  deleteCremationFuneralHome(id: string): Promise<CremationFuneralHome[]>;
  saveCremationFinalNumber(value: string): Promise<string>;
  saveCremationPrintPreference(kind: CremationDocumentKind, preference: CremationPrintPreference): Promise<CremationPrintPreference>;
  saveCremationBatch(snapshot: CremationBatchSnapshot): Promise<void>;
  clearCremationBatch(): Promise<void>;
  printCremationDocument(kind: CremationDocumentKind, rows: CremationBatchRow[], date: string): Promise<CremationLabelPrintResult>;
  listCremationPrinters(): Promise<PrinterCapability[]>;
  checkCremationPrintingReadiness(kind: CremationDocumentKind): Promise<CremationPrintingReadiness>;
  checkCremationLabelReadiness(): Promise<CremationLabelReadiness>;
  printCremationLabels(items: CremationLabelItem[]): Promise<CremationLabelPrintResult>;
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
