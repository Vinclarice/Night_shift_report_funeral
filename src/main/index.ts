import { access, appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain, Menu, screen, shell } from "electron";
import { z } from "zod";

import { ReportService } from "../application/reportService";
import { DEFAULT_HIDDEN_SECTIONS, REPORT_SECTIONS } from "../domain/report";
import type { LayoutSettings, NightReport, SectionKey } from "../domain/types";
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

// Painted for the frame between the window appearing and React mounting, so it has to match what
// the renderer settles to — `--surface` in styles.css. This was left at the pre-2.4.0 near-black
// when the interface went light, which inverted the very flash it exists to prevent. Keep in step.
const STUDIO_BACKGROUND = "#f3f5f7";
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
  // Optional for the same reason. It must be declared: zod strips keys it does not know about, so
  // omitting it here silently dropped the field in transit even though every other layer stored it.
  rushBy: z.string().optional(),
  createdAt: z.string(),
};

const reportEntrySchema = z.discriminatedUnion("type", [
  z.object({ ...baseEntryFields, type: z.literal("funeral"), funeralHome: z.string(), deceased: z.array(deceasedPersonSchema) }),
  z.object({ ...baseEntryFields, type: z.literal("funeralHomeOnly"), funeralHome: z.string() }),
  z.object({ ...baseEntryFields, type: z.literal("count"), text: z.string(), count: z.number().int() }),
  z.object({ ...baseEntryFields, type: z.literal("combined"), leftText: z.string(), rightText: z.string(), count: z.number().int() }),
  z.object({ ...baseEntryFields, type: z.literal("plain"), text: z.string() }),
]);

// Read off the domain's own section list rather than repeated here. The two were written out
// separately once, and when ROAD TRIPS was added to one and not the other every save failed
// validation — a whole class of bug that only a running app could catch.
const sectionKeySchema = z.enum(REPORT_SECTIONS.map((section) => section.key) as [SectionKey, ...SectionKey[]]);

const reportSectionSchema = z.object({
  key: sectionKeySchema,
  category: z.enum(["human", "cremated"]),
  title: z.string(),
  entries: z.array(reportEntrySchema),
});

// notes and hiddenSections are defaulted, not required, so a report saved by an older build still
// validates — and the default is the shipped one rather than an empty list, or a report that
// predates optional cards would come back with ROAD TRIPS showing.
const reportSchema = z.object({ id: z.string(), reportDate: z.string(), version: z.number().int(), notes: z.string().default(""), hiddenSections: z.array(sectionKeySchema).default(() => [...DEFAULT_HIDDEN_SECTIONS]), sections: z.array(reportSectionSchema) });
const layoutSchema = z.object({ sectionWidths: z.record(z.string(), z.number()).default({}), marginInches: z.number().min(0.15).max(0.75), scale: z.number().min(0.8).max(1.05), offsetXInches: z.number().min(-0.5).max(0.5), offsetYInches: z.number().min(-0.5).max(0.5) });

function validateSender(event: Electron.IpcMainInvokeEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Untrusted application request.");
}

async function bootstrap() {
  const { report, created } = await service.resolveTonight();
  try {
    // A newly created report means a genuinely new night started — the one routine backup
    // checkpoint left now that finalize no longer triggers one. Retention/backup-purge are
    // best-effort maintenance from here on: if either fails, the renderer should still get the
    // report it just resolved rather than an error.
    if (created) await backups.create("nightly");
    await repository.purgeExcept(report.id);
    await backups.purge(14);
  } catch (error) {
    await logError("post-bootstrap-maintenance", error);
  }
  const [layout, funeralHomes, backupItems] = await Promise.all([
    repository.loadLayout(), repository.listFuneralHomes(), backups.list(),
  ]);
  return { report, layout, funeralHomes, backups: backupItems };
}

function registerIpc() {
  const handle = <T extends unknown[]>(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: T) => unknown) => {
    ipcMain.handle(channel, async (event, ...args) => { validateSender(event); return handler(event, ...(args as T)); });
  };
  handle("workspace:bootstrap", () => bootstrap());
  handle("report:save", (_event, report: NightReport, expectedVersion: number) => service.save(reportSchema.parse(report) as NightReport, z.number().int().parse(expectedVersion)));
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
    // The studio chrome draws its own title bar, so the OS frame is removed entirely.
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
