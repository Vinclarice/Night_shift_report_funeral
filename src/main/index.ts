import { access, appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, shell } from "electron";
import { z } from "zod";

import { ReportService } from "../application/reportService";
import type { LayoutSettings, NightReport } from "../domain/types";
import { FIRST_CALL_CHECK_FIELDS, FIRST_CALL_TEXT_FIELDS, normalizeFirstCallDirectoryName, sanitizeFirstCallDraftForPersistence } from "../domain/firstCall";
import type { FirstCallDraft, FirstCallLookupCandidate, FirstCallLookupKind, FirstCallSearchSettings } from "../domain/firstCall";
import { nextReportDate } from "../domain/report";
import {
  buildCremationCertificateFields,
  buildCremationEnvelopeFields,
  buildCremationPrintPageGeometry,
  parseCremationNumber,
} from "../domain/cremation";
import type {
  CremationBatchRow,
  CremationDocumentKind,
  CremationLabelReadiness,
  CremationPrintPreference,
  CremationPrintingReadiness,
  PrinterCapability,
} from "../domain/cremation";
import type { CremationBatchSnapshot } from "../shared/contracts";
import { BackupManager, PrismaReportRepository } from "../infrastructure/prismaRepository";
import { formatFirstCallDirectoryCsv, parseFirstCallDirectoryCsv } from "../infrastructure/firstCallDirectoryCsv";
import { searchTomTom } from "../infrastructure/tomTomSearch";

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

function cremationResourcePath(name: string) {
  return app.isPackaged
    ? join(process.resourcesPath, "cremation", name)
    : join(currentDirectory, "../resources/cremation", name);
}

async function cremationLabelTemplatePath(): Promise<string | null> {
  const target = join(userDataPath, "cremation-label.lbx");
  if (await pathExists(target)) return target;
  try {
    const bundledTemplate = cremationResourcePath("cremation-label.lbx");
    if (await pathExists(bundledTemplate)) {
      await copyFile(bundledTemplate, target);
      return target;
    }
    const encoded = await readFile(cremationResourcePath("cremation-label.lbx.base64"), "utf8");
    await writeFile(target, Buffer.from(encoded.trim(), "base64"));
    return target;
  } catch {
    return null;
  }
}

async function pathExists(path: string) {
  try { await access(path); return true; }
  catch { return false; }
}

function spawnBridge(executable: string, args: string[], input: string, timeoutMs: number, timeoutMessage: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ code: -1, stdout, stderr: timeoutMessage });
    }, timeoutMs);
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => finish({ code: -1, stdout, stderr: error.message }));
    child.on("close", (code) => finish({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(input, "utf8");
  });
}

function runBpacBridge(args: string[], input = "") {
  const executable = join(process.env.WINDIR ?? "C:\\Windows", "System32", "cscript.exe");
  const script = cremationResourcePath("print-labels.vbs");
  return spawnBridge(executable, ["//nologo", script, ...args], input, 120_000, "The Brother label job timed out.");
}

// Certificates/envelopes print through this PowerShell/.NET bridge rather than Electron's
// webContents.print, because real Windows printer drivers are documented to silently drop custom
// paper sizes when the print dialog is shown (electron/electron#39702, #22066) - forcing the
// operator into Advanced settings by hand every time. System.Drawing.Printing can set the exact
// paper size and tray directly, the same reasoning that already put label printing on its own
// bridge (runBpacBridge) instead of trusting the browser's print pipeline for physical paper.
function runPrintBridge(args: string[], input = "", timeoutMs = 60_000) {
  const executable = join(process.env.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = cremationResourcePath("print-cremation.ps1");
  return spawnBridge(executable, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args], input, timeoutMs, "The certificate/envelope print job timed out.");
}

async function cremationPrintingReadiness(kind: CremationDocumentKind, preference: CremationPrintPreference): Promise<CremationPrintingReadiness> {
  const scriptAvailable = await pathExists(cremationResourcePath("print-cremation.ps1"));
  const check = scriptAvailable ? await runPrintBridge(["--check"]) : { code: -1, stdout: "", stderr: "" };
  const scriptReady = check.code === 0 && check.stdout.includes("READY");
  const executionPolicyBlocked = /disabled on this system|UnauthorizedAccess|cannot be loaded because running scripts/i.test(check.stderr);
  const printerConfigured = Boolean(preference.deviceName);
  let printerInstalled = false;
  if (printerConfigured && scriptReady) {
    const list = await runPrintBridge(["--list"]);
    try {
      const printers = JSON.parse(list.stdout || "[]") as Array<{ name: string }>;
      printerInstalled = printers.some((printer) => printer.name === preference.deviceName);
    } catch { printerInstalled = false; }
  }
  const missing = [
    !scriptAvailable && "the print-cremation.ps1 script",
    scriptAvailable && !scriptReady && (executionPolicyBlocked ? "PowerShell execution policy is blocking the print engine" : ".NET printing support"),
    !printerConfigured && "a saved printer",
    printerConfigured && scriptReady && !printerInstalled && `the configured printer ("${preference.deviceName}")`,
  ].filter((item): item is string => Boolean(item));
  const kindLabel = kind === "certificate" ? "Certificate" : "Envelope";
  return {
    ready: scriptReady && printerConfigured && printerInstalled,
    scriptAvailable,
    printerConfigured,
    printerInstalled,
    message: missing.length ? `${kindLabel} printing needs: ${missing.join(", ")}.` : `Ready to print through ${preference.deviceName}.`,
  };
}

async function cremationLabelReadiness(): Promise<CremationLabelReadiness> {
  const bridgeAvailable = await pathExists(cremationResourcePath("print-labels.vbs"));
  const templatePath = await cremationLabelTemplatePath();
  const templateAvailable = Boolean(templatePath);
  const check = bridgeAvailable ? await runBpacBridge(["--check"]) : { code: -1, stdout: "", stderr: "" };
  const bpacInstalled = check.code === 0 && check.stdout.includes("READY");
  const printers = mainWindow ? await mainWindow.webContents.getPrintersAsync().catch(() => []) : [];
  const printer = printers.find((candidate) => /(?:PT-?D610BT|D610BT)/i.test(`${candidate.name} ${candidate.description ?? ""}`));
  const driverInstalled = Boolean(printer);
  const missing = [
    !bpacInstalled && "Brother b-PAC 64-bit",
    !driverInstalled && "PT-D610BT Windows driver/USB printer",
    !templateAvailable && "cremation label template",
  ].filter(Boolean);
  return {
    ready: bpacInstalled && driverInstalled && templateAvailable,
    bpacInstalled,
    driverInstalled,
    templateAvailable,
    printerName: printer?.name,
    message: missing.length ? `Label printing needs: ${missing.join(", ")}.` : `Ready to print through ${printer!.name}.`,
  };
}

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
const cremationDocumentKindSchema = z.enum(["certificate", "envelope"]);
const cremationFuneralHomeSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(160),
  location: z.string().trim().max(160),
});
const cremationPrintPreferenceSchema = z.object({
  scale: z.number().min(0.9).max(1.1),
  offsetXInches: z.number().min(-0.5).max(0.5),
  offsetYInches: z.number().min(-0.5).max(0.5),
  deviceName: z.string().trim().min(1).optional(),
  paperSource: z.string().trim().min(1).optional(),
});
const cremationNumberSchema = z.string().trim().refine((value) => parseCremationNumber(value) !== null, "Enter a cremation number like 6-063-24.");
const cremationLabelItemsSchema = z.array(z.object({
  id: z.string().uuid(),
  displayName: z.string().trim().min(1).max(160).refine((value) => !/[\r\n\t]/.test(value), "Label names must fit on one line."),
})).min(1).max(250);
const cremationPrintStateSchema = z.enum(["notPrinted", "printed", "stale"]);
const cremationBatchRowSchema = z.object({
  id: z.string().min(1),
  selected: z.boolean(),
  number: z.string().max(20),
  fullName: z.string().max(200),
  displayName: z.string().max(200),
  displayNameManuallyEdited: z.boolean(),
  funeralHome: z.string().max(160),
  location: z.string().max(160),
  certificateStatus: cremationPrintStateSchema,
  envelopeStatus: cremationPrintStateSchema,
  labelStatus: cremationPrintStateSchema,
});
const cremationBatchSnapshotSchema = z.object({
  date: z.string().max(20),
  rows: z.array(cremationBatchRowSchema).max(500),
});
const firstCallHighlightSchema = z.object({
  id: z.string().min(1),
  x: z.number(), y: z.number(), width: z.number(), height: z.number(),
  color: z.enum(["yellow", "green", "blue", "pink", "orange"]),
});
const firstCallDraftSchema = z.object({
  placeOfDeathKind: z.enum(["facility", "residence"]),
  values: z.object(Object.fromEntries(FIRST_CALL_TEXT_FIELDS.map((field) => [field, z.string().max(4000)]))),
  checks: z.object(Object.fromEntries(FIRST_CALL_CHECK_FIELDS.map((field) => [field, z.boolean()]))),
  highlights: z.array(firstCallHighlightSchema).max(500),
  lastNameManuallyEdited: z.boolean(),
});
const FIRST_CALL_DRAFT_SETTING = "firstCallDraft";
const CREMATION_BATCH_SETTING = "cremationBatchDraft";
const TOMTOM_KEY_SETTING = "firstCallTomTomApiKey";

async function readJsonSetting<T>(key: string): Promise<T | null> {
  const raw = await repository.readAppSetting(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; }
  catch (error) { await logError(`read-json-setting:${key}`, error); return null; }
}

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
    savedDraft: await readJsonSetting<FirstCallDraft>(FIRST_CALL_DRAFT_SETTING),
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
  handle("first-call:draft:save", async (_event, rawDraft: unknown) => {
    const draft = sanitizeFirstCallDraftForPersistence(firstCallDraftSchema.parse(rawDraft) as FirstCallDraft);
    await repository.writeAppSetting(FIRST_CALL_DRAFT_SETTING, JSON.stringify(draft));
  });
  handle("first-call:draft:clear", async () => { await repository.deleteAppSetting(FIRST_CALL_DRAFT_SETTING); });
  handle("cremation:load", async () => {
    const [funeralHomes, savedFinalNumber, printPreferences, savedBatch] = await Promise.all([
      repository.listCremationFuneralHomes(),
      repository.loadCremationSequence(),
      repository.loadCremationPrintPreferences(),
      readJsonSetting<CremationBatchSnapshot>(CREMATION_BATCH_SETTING),
    ]);
    const checkingReadiness: CremationPrintingReadiness = { ready: false, scriptAvailable: false, printerConfigured: false, printerInstalled: false, message: "Checking printer…" };
    return {
      funeralHomes,
      savedFinalNumber,
      printPreferences,
      savedBatch,
      labelReadiness: { ready: false, bpacInstalled: false, driverInstalled: false, templateAvailable: false, message: "Checking Brother label printer…" },
      printingReadiness: { certificate: checkingReadiness, envelope: checkingReadiness },
    };
  });
  handle("cremation:funeral-home:save", (_event, input: unknown) => repository.saveCremationFuneralHome(cremationFuneralHomeSchema.parse(input)));
  handle("cremation:funeral-home:delete", (_event, id: unknown) => repository.deleteCremationFuneralHome(z.string().min(1).parse(id)));
  handle("cremation:sequence:save", (_event, rawValue: unknown) => {
    const value = cremationNumberSchema.parse(rawValue);
    return repository.saveCremationSequence(parseCremationNumber(value)!);
  });
  handle("cremation:print-preference:save", (_event, rawKind: unknown, rawPreference: unknown) => {
    const kind = cremationDocumentKindSchema.parse(rawKind);
    return repository.saveCremationPrintPreference(kind, cremationPrintPreferenceSchema.parse(rawPreference));
  });
  handle("cremation:batch:save", async (_event, rawSnapshot: unknown) => {
    const snapshot = cremationBatchSnapshotSchema.parse(rawSnapshot) as CremationBatchSnapshot;
    await repository.writeAppSetting(CREMATION_BATCH_SETTING, JSON.stringify(snapshot));
  });
  handle("cremation:batch:clear", async () => { await repository.deleteAppSetting(CREMATION_BATCH_SETTING); });
  handle("cremation:print", async (_event, rawKind: unknown, rawRows: unknown, rawDate: unknown) => {
    const kind = cremationDocumentKindSchema.parse(rawKind) as CremationDocumentKind;
    const rows = z.array(cremationBatchRowSchema).min(1).max(500).parse(rawRows) as CremationBatchRow[];
    const date = z.string().max(20).parse(rawDate);
    const preferences = await repository.loadCremationPrintPreferences();
    const preference = preferences[kind];
    if (!preference.deviceName) return { printedIds: [], failureReason: `No printer is configured for ${kind === "certificate" ? "certificates" : "envelopes"} yet - set one in the Printer tab.` };

    const pages = rows.map((row) => {
      const fields = kind === "certificate" ? buildCremationCertificateFields(row, date) : buildCremationEnvelopeFields(row);
      const geometry = buildCremationPrintPageGeometry(kind, fields, preference);
      return { id: row.id, fields: geometry.fields, widthHundredths: geometry.widthHundredths, heightHundredths: geometry.heightHundredths, landscape: geometry.landscape };
    });
    const payload = {
      kind,
      printerName: preference.deviceName,
      paperSource: preference.paperSource,
      widthHundredths: pages[0].widthHundredths,
      heightHundredths: pages[0].heightHundredths,
      landscape: pages[0].landscape,
      pages: pages.map(({ id, fields }) => ({ id, fields })),
    };
    const timeoutMs = Math.min(600_000, 30_000 + rows.length * 4_000);
    const result = await runPrintBridge([], JSON.stringify(payload), timeoutMs);
    const printedIds: string[] = [];
    let failureReason = result.code === 0 ? undefined : "The certificate/envelope print job did not finish.";
    for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
      const [id, status, detail] = line.split("\t");
      if (status === "OK" && rows.some((row) => row.id === id)) printedIds.push(id);
      else if (id === "FATAL") failureReason = status;
      else if (status === "ERROR") failureReason = detail || "The printer rejected a page.";
    }
    if (!failureReason && printedIds.length !== rows.length) failureReason = "The printer accepted only part of the batch.";
    return { printedIds, failureReason };
  });
  handle("cremation:printers:list", async (): Promise<PrinterCapability[]> => {
    const result = await runPrintBridge(["--list"]);
    try { return JSON.parse(result.stdout || "[]") as PrinterCapability[]; }
    catch { return []; }
  });
  handle("cremation:printing:readiness", async (_event, rawKind: unknown) => {
    const kind = cremationDocumentKindSchema.parse(rawKind) as CremationDocumentKind;
    const preferences = await repository.loadCremationPrintPreferences();
    return cremationPrintingReadiness(kind, preferences[kind]);
  });
  handle("cremation:labels:readiness", () => cremationLabelReadiness());
  handle("cremation:labels:print", async (_event, rawItems: unknown) => {
    const items = cremationLabelItemsSchema.parse(rawItems);
    const readiness = await cremationLabelReadiness();
    if (!readiness.ready || !readiness.printerName) return { printedIds: [], failureReason: readiness.message };
    const input = items.map((item) => `${item.id}\t${item.displayName}`).join("\r\n") + "\r\n";
    const templatePath = await cremationLabelTemplatePath();
    if (!templatePath) return { printedIds: [], failureReason: "The bundled cremation label template is unavailable." };
    const result = await runBpacBridge([templatePath, readiness.printerName], input);
    const printedIds: string[] = [];
    let failureReason = result.code === 0 ? undefined : "The Brother label job did not finish.";
    for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
      const [id, status, detail] = line.split("\t");
      if (status === "OK" && items.some((item) => item.id === id)) printedIds.push(id);
      else if (id === "FATAL") failureReason = status;
      else if (status === "ERROR") failureReason = detail || "The Brother printer rejected a label.";
    }
    if (!failureReason && printedIds.length !== items.length) failureReason = "The Brother printer accepted only part of the label batch.";
    return { printedIds, failureReason };
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
