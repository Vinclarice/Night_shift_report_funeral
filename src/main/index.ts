import { access, appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain, Menu, screen, shell } from "electron";
import { z } from "zod";

import { ReportService } from "../application/reportService";
import type { LayoutSettings, NightReport } from "../domain/types";
import { nextReportDate } from "../domain/report";
import { BackupManager, PrismaReportRepository } from "../infrastructure/prismaRepository";

const hasLock = process.env.NIGHT_SHIFT_REPORT_ALLOW_MULTIPLE === "1" || app.requestSingleInstanceLock();
if (!hasLock) app.quit();

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const localDataRoot = process.env.LOCALAPPDATA ?? app.getPath("userData");
const userDataPath = process.env.NIGHT_SHIFT_REPORT_DATA_DIR ?? join(localDataRoot, "Night Shift Report");
app.setPath("userData", userDataPath);
if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = app.isPackaged
    ? join(process.resourcesPath, "prisma", "query_engine-windows.dll.node")
    : join(currentDirectory, "query_engine-windows.dll.node");
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
