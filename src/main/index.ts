import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain, shell } from "electron";
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
if (app.isPackaged && !process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = join(process.resourcesPath, "prisma", "query_engine-windows.dll.node");
}

let mainWindow: BrowserWindow | null = null;
let repository: PrismaReportRepository;
let service: ReportService;
let backups: BackupManager;

const reportSchema = z.object({ id: z.string(), reportDate: z.string(), status: z.enum(["draft", "finalized"]), version: z.number().int(), finalizedAt: z.string().nullable(), sections: z.array(z.any()) });
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
  const [report, latestFinalized, layout, funeralHomes, backupItems] = await Promise.all([
    service.loadTonight(), service.latestFinalized(), repository.loadLayout(), repository.listFuneralHomes(), backups.list(),
  ]);
  return { report, latestFinalized, layout, funeralHomes, backups: backupItems };
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
    await backups.create("finalized");
    await repository.purgeOlderThan(dateDaysAgo(90));
    await backups.purge(14);
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
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: "Night Shift Report",
    show: false,
    webPreferences: {
      preload: join(currentDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith("https://")) void shell.openExternal(url); return { action: "deny" }; });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await mainWindow.loadFile(join(currentDirectory, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

app.whenReady().then(async () => {
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
