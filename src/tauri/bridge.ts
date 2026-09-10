import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ReportService } from "@/application/reportService";
import type { ReportRepository } from "@/application/repository";
import { createEmptyReport, DEFAULT_HIDDEN_SECTIONS } from "@/domain/report";
import type { LayoutSettings, NightReport, ReportEntry, SectionKey } from "@/domain/types";
import type { BackupSummary, FuneralHomeOption, NightShiftApi, PrinterOption } from "@/shared/contracts";

/**
 * The `window.nightShift` API the interface talks to. Report logic that is plain TypeScript
 * (ReportService and the domain) runs here in the page; only storage, backups and the window cross
 * over to Rust, in src-tauri.
 */

interface StoredDeceased { id: string; name: string; locationCode: string | null; specialRequest: string | null }

interface StoredEntry {
  id: string;
  sectionKey: string;
  type: ReportEntry["type"];
  rush: boolean;
  keepSeparate: boolean;
  pinnedBottom: boolean;
  rushBy: string | null;
  funeralHomeNameSnapshot: string | null;
  text: string | null;
  leftText: string | null;
  rightText: string | null;
  count: number | null;
  /** Epoch milliseconds. */
  createdAt: number;
  deceased: StoredDeceased[];
}

interface StoredReport {
  id: string;
  reportDate: string;
  version: number;
  notes: string | null;
  hiddenSections: string | null;
  entries: StoredEntry[];
}

/** Rust rejects with a bare message string, and the interface reads `error.message`, so it is wrapped. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** Anything unreadable falls back to the shipped default rather than taking the night down. */
function parseHiddenSections(raw: string | null): SectionKey[] {
  if (!raw) return [...DEFAULT_HIDDEN_SECTIONS];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key): key is SectionKey => typeof key === "string") : [...DEFAULT_HIDDEN_SECTIONS];
  } catch {
    return [...DEFAULT_HIDDEN_SECTIONS];
  }
}

function toDomain(stored: StoredReport): NightReport {
  const report = createEmptyReport(stored.reportDate);
  report.id = stored.id;
  report.version = stored.version;
  report.notes = stored.notes ?? "";
  // Stored as JSON in one column rather than a flag per section, so adding another optional card
  // is a change to the section list and nothing else.
  report.hiddenSections = parseHiddenSections(stored.hiddenSections);
  for (const section of report.sections) {
    section.entries = stored.entries.filter((entry) => entry.sectionKey === section.key).map((entry): ReportEntry => {
      const base = { id: entry.id, rush: entry.rush, keepSeparate: entry.keepSeparate, pinnedBottom: entry.pinnedBottom, rushBy: entry.rushBy ?? undefined, createdAt: new Date(entry.createdAt).toISOString() };
      if (entry.type === "funeral") return { ...base, type: "funeral", funeralHome: entry.funeralHomeNameSnapshot ?? "", deceased: entry.deceased.map((person) => ({ id: person.id, name: person.name, locationCode: person.locationCode ?? "", specialRequest: person.specialRequest ?? "" })) };
      if (entry.type === "funeralHomeOnly") return { ...base, type: "funeralHomeOnly", funeralHome: entry.funeralHomeNameSnapshot ?? "" };
      if (entry.type === "count") return { ...base, type: "count", text: entry.text ?? "", count: entry.count ?? 1 };
      if (entry.type === "combined") return { ...base, type: "combined", leftText: entry.leftText ?? "", rightText: entry.rightText ?? "", count: entry.count ?? 1 };
      return { ...base, type: "plain", text: entry.text ?? "" };
    });
  }
  return report;
}

const repository: ReportRepository = {
  findByDate: async (date) => {
    const stored = await call<StoredReport | null>("find_report_by_date", { date });
    return stored && toDomain(stored);
  },
  mostRecent: async () => {
    const stored = await call<StoredReport | null>("most_recent_report");
    return stored && toDomain(stored);
  },
  create: async (report) => toDomain(await call<StoredReport>("create_report", { report })),
  save: async (report, expectedVersion) => toDomain(await call<StoredReport>("save_report", { report, expectedVersion })),
  purgeExcept: (id) => call<number>("purge_reports_except", { id }),
};

const service = new ReportService(repository);
const appWindow = getCurrentWindow();

const api: NightShiftApi = {
  async bootstrap() {
    const { report, created } = await service.resolveTonight();
    try {
      // A newly created report means a new night started — the one routine backup checkpoint.
      // Retention is best-effort from here on: the interface should still get the report it resolved.
      if (created) await call("create_backup", { label: "nightly" });
      await repository.purgeExcept(report.id);
      await call("purge_backups", { days: 14 });
    } catch (error) {
      void call("log_error", { scope: "post-bootstrap-maintenance", detail: String(error) }).catch(() => undefined);
    }
    const [layout, funeralHomes, backups] = await Promise.all([
      call<LayoutSettings>("load_layout"),
      call<FuneralHomeOption[]>("list_funeral_homes"),
      call<BackupSummary[]>("list_backups"),
    ]);
    return { report, layout, funeralHomes, backups };
  },
  saveReport: (report, expectedVersion) => repository.save(report, expectedVersion),
  saveLayout: (layout) => call<LayoutSettings>("save_layout", { layout }),
  renameFuneralHome: (id, name) => call<FuneralHomeOption[]>("rename_funeral_home", { id, name }),
  mergeFuneralHomes: (sourceId, targetId) => call<FuneralHomeOption[]>("merge_funeral_homes", { sourceId, targetId }),
  deleteFuneralHome: (id) => call<FuneralHomeOption[]>("delete_funeral_home", { id }),
  listBackups: () => call<BackupSummary[]>("list_backups"),
  // Rust relaunches the app once the backup is in place, so on success this never resolves.
  restoreBackup: (name) => call<void>("restore_backup", { name }),
  printReport: (printerName) => printerName
    ? call<{ success: boolean; failureReason?: string }>("print_report", { printerName })
    // The page cannot tell a printed sheet from a cancelled dialog, so this path always reports success.
    : new Promise((resolve) => {
      // Registered before print() because WebView2 may fire afterprint before print() returns.
      window.addEventListener("afterprint", () => resolve({ success: true }), { once: true });
      window.print();
    }),
  listPrinters: () => call<PrinterOption[]>("list_printers"),
  async windowControl(action) {
    if (action === "minimize") await appWindow.minimize();
    else if (action === "maximize") await appWindow.toggleMaximize();
    else await appWindow.close();
  },
  isWindowMaximized: () => appWindow.isMaximized(),
  onWindowMaximizeChange(listener) {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void appWindow.onResized(async () => listener(await appWindow.isMaximized())).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  },
};

window.nightShift = api;

// WebView2 offers the browser's own right-click menu (Back, Refresh, Print…), none of which belongs
// in the report. Text fields keep theirs for cut, copy and paste.
document.addEventListener("contextmenu", (event) => {
  if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
  event.preventDefault();
});

// WebView2 also answers browser shortcuts. A reload mid-shift would drop the undo history, and its
// Ctrl+P prints without the printed-at stamp the Print button adds.
document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (event.key === "F5" || ((event.ctrlKey || event.metaKey) && (key === "r" || key === "p"))) event.preventDefault();
});
