import { access, appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, shell } from "electron";
import { z } from "zod";

import { ReportService } from "../application/reportService";
import type { LayoutSettings, NightReport } from "../domain/types";
import { normalizeFirstCallDirectoryName } from "../domain/firstCall";
import type { FirstCallLookupCandidate, FirstCallLookupKind, FirstCallSearchSettings } from "../domain/firstCall";
import { nextReportDate } from "../domain/report";
import { BackupManager, PrismaReportRepository } from "../infrastructure/prismaRepository";
import { formatFirstCallDirectoryCsv, parseFirstCallDirectoryCsv } from "../infrastructure/firstCallDirectoryCsv";
import { searchTomTom } from "../infrastructure/tomTomSearch";

const hasLock = process.env.NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE === "1" || app.requestSingleInstanceLock();
if (!hasLock) app.quit();

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const localDataRoot = process.env.LOCALAPPDATA ?? app.getPath("userData");
const userDataPath = process.env.NIGHT_SHIFT_REPORT_DATA_DIR ?? join(localDataRoot, "Night Shift Report");
app.setPath("userData", userDataPath);
if (app.isPackaged && !process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = join(process.resourcesPath, "prisma", "query_engine-windows.dll.node");
}

let mainWindow: BrowserWindow | null = null;
let repository: PrismaReportRepository;
let service: ReportService;
let backups: BackupManager;

const STUDIO_BACKGROUND = "#080b10";
const windowStatePath = join(userDataPath, "window-state.json");
const logDirectory = join(userDataPath, "logs");

/**
 * console.error goes nowhere in a packaged build, so anything that fails overnight leaves no trace.
 * Failures here are swallowed deliberately: logging must never be the reason an operation fails.
 */
async function logError(scope: string, error: unknown) {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[${scope}]`, error);
  try {
    await mkdir(logDirectory, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    await appendFile(join(logDirectory, `main-${day}.log`), `${new Date().toISOString()} [${scope}] ${detail}\n`, "utf8");
  } catch { /* logging must not throw */ }
}

const windowStateSchema = z.object({
  width: z.number().int().min(640),
  height: z.number().int().min(480),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  maximized: z.boolean(),
});
type WindowState = z.infer<typeof windowStateSchema>;

async function readWindowState(): Promise<WindowState | null> {
  try {
    const parsed = windowStateSchema.parse(JSON.parse(await readFile(windowStatePath, "utf8")));
    // A saved position is only usable if it still lands on a display that is currently attached —
    // otherwise unplugging a second monitor would reopen the window off-screen.
    if (parsed.x === undefined || parsed.y === undefined) return parsed;
    const visible = screen.getAllDisplays().some(({ workArea }) =>
      parsed.x! >= workArea.x - 16 && parsed.y! >= workArea.y - 16 &&
      parsed.x! < workArea.x + workArea.width && parsed.y! < workArea.y + workArea.height);
    return visible ? parsed : { ...parsed, x: undefined, y: undefined };
  } catch {
    return null;
  }
}

async function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const maximized = mainWindow.isMaximized();
    const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    await writeFile(windowStatePath, JSON.stringify({ ...bounds, maximized } satisfies WindowState), "utf8");
  } catch (error) {
    await logError("window-state", error);
  }
}

const deceasedPersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  locationCode: z.string(),
  specialRequest: z.string(),
});

const baseEntryFields = {
  id: z.string(),
  rush: z.boolean(),
  keepSeparate: z.boolean(),
  // Defaulted rather than required so a report saved by an older build still validates.
  pinnedBottom: z.boolean().default(false),
  createdAt: z.string(),
};

const reportEntrySchema = z.discriminatedUnion("type", [
  z.object({ ...baseEntryFields, type: z.literal("funeral"), funeralHome: z.string(), deceased: z.array(deceasedPersonSchema) }),
  z.object({ ...baseEntryFields, type: z.literal("funeralHomeOnly"), funeralHome: z.string() }),
  z.object({ ...baseEntryFields, type: z.literal("count"), text: z.string(), count: z.number().int() }),
  z.object({ ...baseEntryFields, type: z.literal("combined"), leftText: z.string(), rightText: z.string(), count: z.number().int() }),
  z.object({ ...baseEntryFields, type: z.literal("plain"), text: z.string() }),
]);

const sectionKeySchema = z.enum([
  "human-deliver",
  "human-airport",
  "human-fdp",
  "human-pending",
  "human-ship-outs",
  "cremated-deliver",
  "cremated-mail",
  "cremated-fdp",
  "cremated-certs",
]);

const reportSectionSchema = z.object({
  key: sectionKeySchema,
  category: z.enum(["human", "cremated"]),
  title: z.string(),
  entries: z.array(reportEntrySchema),
});

const reportSchema = z.object({ id: z.string(), reportDate: z.string(), status: z.enum(["draft", "finalized"]), version: z.number().int(), finalizedAt: z.string().nullable(), sections: z.array(reportSectionSchema) });
const layoutSchema = z.object({ sectionWidths: z.record(z.string(), z.number()).default({}), marginInches: z.number().min(0.15).max(0.75), scale: z.number().min(0.8).max(1.05), offsetXInches: z.number().min(-0.5).max(0.5), offsetYInches: z.number().min(-0.5).max(0.5) });
const firstCallFuneralHomeSchema = z.object({
  id: z.string().optional(), name: z.string().trim().min(1).max(160), address: z.string().max(300),
  phone: z.string().max(80), fax: z.string().max(80), email: z.string().max(160),
  aliases: z.array(z.string().trim().min(1).max(160)).max(20).optional(), favorite: z.boolean().optional(),
});
const firstCallFacilitySchema = z.object({
  id: z.string().optional(), name: z.string().trim().min(1).max(160).refine((name) => normalizeFirstCallDirectoryName(name) !== "residence", "Residence information is never saved."),
  address: z.string().max(300), phone: z.string().max(80),
  aliases: z.array(z.string().trim().min(1).max(160)).max(20).optional(), favorite: z.boolean().optional(),
});
const firstCallPrintPreferenceSchema = z.object({
  scale: z.number().min(0.9).max(1.1), offsetXInches: z.number().min(-0.5).max(0.5), offsetYInches: z.number().min(-0.5).max(0.5),
});
const firstCallDirectoryKindSchema = z.enum(["funeralHome", "facility"]);
const firstCallLookupKindSchema = z.enum(["funeralHome", "facility", "residence"]);
const TOMTOM_KEY_SETTING = "firstCallTomTomApiKey";

async function readSavedTomTomApiKey(): Promise<string> {
  const encrypted = await repository.readAppSetting(TOMTOM_KEY_SETTING);
  if (!encrypted) return "";
  if (!safeStorage.isEncryptionAvailable()) return "";
  try { return safeStorage.decryptString(Buffer.from(encrypted, "base64")); }
  catch { return ""; }
}

async function tomTomSearchSettings(): Promise<FirstCallSearchSettings> {
  if (process.env.NIGHT_SHIFT_REPORT_TOMTOM_API_KEY?.trim()) return { provider: "tomtom", configured: true, source: "environment" };
  const savedKey = await readSavedTomTomApiKey();
  return { provider: "tomtom", configured: Boolean(savedKey), source: savedKey ? "saved" : "none" };
}

async function saveTomTomApiKey(rawKey: string): Promise<FirstCallSearchSettings> {
  const apiKey = z.string().trim().max(200).parse(rawKey);
  if (!apiKey) {
    await repository.deleteAppSetting(TOMTOM_KEY_SETTING);
    return tomTomSearchSettings();
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable, so the TomTom key was not saved.");
  await repository.writeAppSetting(TOMTOM_KEY_SETTING, safeStorage.encryptString(apiKey).toString("base64"));
  return { provider: "tomtom", configured: true, source: "saved" };
}

async function searchFirstCallPlaces(kind: FirstCallLookupKind, rawQuery: string): Promise<FirstCallLookupCandidate[]> {
  const query = z.string().trim().min(2).max(kind === "residence" ? 300 : 160).parse(rawQuery);
  const queryKey = kind === "residence" ? "" : `tomtom:${kind}:${normalizeFirstCallDirectoryName(query)}`;
  if (kind !== "residence") {
    const cached = await repository.readFirstCallLookupCache(kind, queryKey);
    if (cached) return cached;
  }

  const apiKey = process.env.NIGHT_SHIFT_REPORT_TOMTOM_API_KEY?.trim() || await readSavedTomTomApiKey();
  if (!apiKey) throw new Error("TomTom search is not set up. Save a free TomTom API key in Online search first.");

  const endpoint = process.env.NIGHT_SHIFT_REPORT_TOMTOM_SEARCH_URL ?? "https://api.tomtom.com/search/2/search";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const results = await searchTomTom(query, apiKey, endpoint, controller.signal, kind === "residence");
    if (kind !== "residence") await repository.writeFirstCallLookupCache(kind, queryKey, results);
    return results;
  } finally {
    clearTimeout(timeout);
  }
}

function validateSender(event: Electron.IpcMainInvokeEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Untrusted application request.");
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return nextReportDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1));
}

async function bootstrap() {
  await repository.purgeOlderThan(dateDaysAgo(90));
  await backups.purge(14);
  const [report, latestFinalized, resumableDraft, layout, funeralHomes, backupItems] = await Promise.all([
    service.loadTonight(), service.latestFinalized(), service.resumableDraft(), repository.loadLayout(), repository.listFuneralHomes(), backups.list(),
  ]);
  return { report, latestFinalized, resumableDraft, layout, funeralHomes, backups: backupItems };
}

function registerIpc() {
  const handle = <T extends unknown[]>(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: T) => unknown) => {
    ipcMain.handle(channel, async (event, ...args) => { validateSender(event); return handler(event, ...(args as T)); });
  };
  handle("workspace:bootstrap", () => bootstrap());
  handle("report:create", (_event, mode: "empty" | "clone") => service.createTonight(z.enum(["empty", "clone"]).parse(mode)));
  handle("report:save", (_event, report: NightReport, expectedVersion: number) => service.save(reportSchema.parse(report) as NightReport, z.number().int().parse(expectedVersion)));
  handle("report:finalize", async (_event, report: NightReport, expectedVersion: number) => {
    const final = await service.finalize(reportSchema.parse(report) as NightReport, z.number().int().parse(expectedVersion));
    // The finalize write above is the durable, user-facing operation, and it already succeeded.
    // Backups and retention are best-effort maintenance from here on — if either fails, the
    // renderer should still see finalize as successful rather than an error for a report that's
    // already safely finalized on disk.
    try {
      await backups.create("finalized");
      await repository.purgeOlderThan(dateDaysAgo(90));
      await backups.purge(14);
    } catch (error) {
      await logError("post-finalize-maintenance", error);
    }
    return final;
  });
  handle("report:reopen", (_event, report: NightReport, expectedVersion: number) => service.reopen(reportSchema.parse(report) as NightReport, z.number().int().parse(expectedVersion)));
  handle("revision:list", (_event, reportId: string) => service.listRevisions(z.string().parse(reportId)));
  handle("revision:restore", (_event, reportId: string, revisionId: string, expectedVersion: number) => service.restoreRevision(z.string().parse(reportId), z.string().parse(revisionId), z.number().int().parse(expectedVersion)));
  handle("layout:save", (_event, layout: LayoutSettings) => repository.saveLayout(layoutSchema.parse(layout)));
  handle("funeral:rename", (_event, id: string, name: string) => repository.renameFuneralHome(z.string().parse(id), z.string().min(1).parse(name)));
  handle("funeral:merge", (_event, sourceId: string, targetId: string) => repository.mergeFuneralHomes(z.string().parse(sourceId), z.string().parse(targetId)));
  handle("funeral:delete", (_event, id: string) => repository.deleteFuneralHome(z.string().parse(id)));
  handle("backup:list", () => backups.list());
  handle("backup:restore", async (_event, name: string) => { await backups.restore(z.string().parse(name)); app.relaunch(); app.exit(0); });
  handle("report:print", async () => {
    if (!mainWindow) return { success: false, failureReason: "The report window is unavailable." };
    return new Promise<{ success: boolean; failureReason?: string }>((resolve) => {
      mainWindow!.webContents.print({ silent: false, printBackground: true, margins: { marginType: "none" }, pageSize: "Letter" }, (success, failureReason) => resolve({ success, failureReason: failureReason || undefined }));
    });
  });
  handle("first-call:load", async () => ({
    ...(await repository.listFirstCallDirectories()),
    printPreference: await repository.loadFirstCallPrintPreference(),
    searchSettings: await tomTomSearchSettings(),
  }));
  handle("first-call:funeral-home:save", (_event, input: unknown) => repository.saveFirstCallFuneralHome(firstCallFuneralHomeSchema.parse(input)));
  handle("first-call:funeral-home:delete", (_event, id: string) => repository.deleteFirstCallFuneralHome(z.string().min(1).parse(id)));
  handle("first-call:facility:save", (_event, input: unknown) => repository.saveFirstCallFacility(firstCallFacilitySchema.parse(input)));
  handle("first-call:facility:delete", (_event, id: string) => repository.deleteFirstCallFacility(z.string().min(1).parse(id)));
  handle("first-call:directory:use", (_event, kind: unknown, id: unknown) => repository.useFirstCallDirectory(firstCallDirectoryKindSchema.parse(kind), z.string().min(1).parse(id)));
  handle("first-call:directory:merge", (_event, kind: unknown, sourceId: unknown, targetId: unknown) => repository.mergeFirstCallDirectory(firstCallDirectoryKindSchema.parse(kind), z.string().min(1).parse(sourceId), z.string().min(1).parse(targetId)));
  handle("first-call:directory:export", async () => {
    if (!mainWindow) return { canceled: true };
    const chosen = await dialog.showSaveDialog(mainWindow, { title: "Export First Call directories", defaultPath: join(app.getPath("documents"), "First Call Directories.csv"), filters: [{ name: "CSV files", extensions: ["csv"] }] });
    if (chosen.canceled || !chosen.filePath) return { canceled: true };
    await writeFile(chosen.filePath, formatFirstCallDirectoryCsv(await repository.listFirstCallDirectories()), "utf8");
    return { canceled: false, path: chosen.filePath };
  });
  handle("first-call:directory:import", async () => {
    if (!mainWindow) return { ...(await repository.listFirstCallDirectories()), canceled: true, imported: 0 };
    const chosen = await dialog.showOpenDialog(mainWindow, { title: "Import First Call directories", properties: ["openFile"], filters: [{ name: "CSV files", extensions: ["csv"] }] });
    if (chosen.canceled || !chosen.filePaths[0]) return { ...(await repository.listFirstCallDirectories()), canceled: true, imported: 0 };
    const contents = await readFile(chosen.filePaths[0], "utf8");
    if (Buffer.byteLength(contents, "utf8") > 2_000_000) throw new Error("The directory CSV is too large to import.");
    const rows = parseFirstCallDirectoryCsv(contents);
    for (const row of rows) {
      if (row.kind === "funeralHome") await repository.saveFirstCallFuneralHome(row);
      else await repository.saveFirstCallFacility(row);
    }
    return { ...(await repository.listFirstCallDirectories()), canceled: false, imported: rows.length };
  });
  handle("first-call:search", (_event, kind: unknown, query: string) => searchFirstCallPlaces(firstCallLookupKindSchema.parse(kind), query));
  handle("first-call:tomtom-key:save", (_event, apiKey: unknown) => saveTomTomApiKey(z.string().parse(apiKey)));
  handle("first-call:print-preference:save", (_event, preference: unknown) => repository.saveFirstCallPrintPreference(firstCallPrintPreferenceSchema.parse(preference)));
  handle("first-call:print", async () => {
    if (!mainWindow) return { success: false, failureReason: "The First Call window is unavailable." };
    return new Promise<{ success: boolean; failureReason?: string }>((resolve) => {
      mainWindow!.webContents.print({ silent: false, printBackground: true, margins: { marginType: "none" }, pageSize: "Letter" }, (success, failureReason) => resolve({ success, failureReason: failureReason || undefined }));
    });
  });
  handle("report:list", () => repository.listReports());
  handle("report:load", (_event, id: string) => repository.findById(z.string().min(1).parse(id)));
  handle("window:control", (_event, action: string) => {
    if (!mainWindow) return;
    switch (z.enum(["minimize", "maximize", "close"]).parse(action)) {
      case "minimize": return mainWindow.minimize();
      case "maximize": return mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
      case "close": return mainWindow.close();
    }
  });
  handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false);
}

async function createWindow() {
  const saved = await readWindowState();
  const iconPath = join(currentDirectory, "../../resources/icon.png");
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1500,
    height: saved?.height ?? 960,
    x: saved?.x,
    y: saved?.y,
    minWidth: 1180,
    minHeight: 760,
    title: "Night Shift Report",
    show: false,
    // The studio chrome draws its own title bar, so the OS frame is removed entirely. Without a
    // matching background colour the window paints white for a frame before React mounts, which
    // reads as a flash against a near-black UI.
    frame: false,
    backgroundColor: STUDIO_BACKGROUND,
    icon: iconPath,
    webPreferences: {
      preload: join(currentDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (saved?.maximized) mainWindow.maximize();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith("https://")) void shell.openExternal(url); return { action: "deny" }; });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await mainWindow.loadFile(join(currentDirectory, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  const emitMaximize = () => mainWindow?.webContents.send("window:maximize-changed", mainWindow.isMaximized());
  mainWindow.on("maximize", emitMaximize);
  mainWindow.on("unmaximize", emitMaximize);
  // Bounds are captured on close rather than on every resize event: a drag fires hundreds of
  // resize events and none of the intermediate ones are worth a disk write.
  mainWindow.on("close", () => { void saveWindowState(); });
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

app.whenReady().then(async () => {
  // The default Electron menu ships File/Edit/View/Window/Help — including Toggle DevTools — in
  // packaged builds. The app has no menu commands of its own, so it is removed rather than rebuilt.
  Menu.setApplicationMenu(null);
  await mkdir(userDataPath, { recursive: true });
  const databasePath = join(userDataPath, "night-shift-report.db");
  const backupDirectory = join(userDataPath, "backups");
  try { await access(databasePath); await mkdir(backupDirectory, { recursive: true }); await copyFile(databasePath, join(backupDirectory, `${new Date().toISOString().replace(/[:.]/g, "-")}-pre-migration.db`)); } catch { /* first launch */ }
  repository = new PrismaReportRepository(databasePath);
  await repository.initialize();
  service = new ReportService(repository);
  backups = new BackupManager(repository, backupDirectory);
  registerIpc();
  await createWindow();
});

app.on("window-all-closed", () => app.quit());
