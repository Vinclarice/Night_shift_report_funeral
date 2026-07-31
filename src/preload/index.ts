import { contextBridge, ipcRenderer } from "electron";

import type { NightShiftApi } from "../shared/contracts";

const api: NightShiftApi = {
  bootstrap: () => ipcRenderer.invoke("workspace:bootstrap"),
  createDraft: (mode) => ipcRenderer.invoke("report:create", mode),
  saveReport: (report, expectedVersion) => ipcRenderer.invoke("report:save", report, expectedVersion),
  finalizeReport: (report, expectedVersion) => ipcRenderer.invoke("report:finalize", report, expectedVersion),
  reopenReport: (report, expectedVersion) => ipcRenderer.invoke("report:reopen", report, expectedVersion),
  listRevisions: (reportId) => ipcRenderer.invoke("revision:list", reportId),
  restoreRevision: (reportId, revisionId, expectedVersion) => ipcRenderer.invoke("revision:restore", reportId, revisionId, expectedVersion),
  saveLayout: (layout) => ipcRenderer.invoke("layout:save", layout),
  renameFuneralHome: (id, name) => ipcRenderer.invoke("funeral:rename", id, name),
  mergeFuneralHomes: (sourceId, targetId) => ipcRenderer.invoke("funeral:merge", sourceId, targetId),
  deleteFuneralHome: (id) => ipcRenderer.invoke("funeral:delete", id),
  listBackups: () => ipcRenderer.invoke("backup:list"),
  restoreBackup: (name) => ipcRenderer.invoke("backup:restore", name),
  printReport: () => ipcRenderer.invoke("report:print"),
  loadFirstCallWorkspace: () => ipcRenderer.invoke("first-call:load"),
  saveFirstCallFuneralHome: (input) => ipcRenderer.invoke("first-call:funeral-home:save", input),
  deleteFirstCallFuneralHome: (id) => ipcRenderer.invoke("first-call:funeral-home:delete", id),
  saveFirstCallFacility: (input) => ipcRenderer.invoke("first-call:facility:save", input),
  deleteFirstCallFacility: (id) => ipcRenderer.invoke("first-call:facility:delete", id),
  useFirstCallDirectory: (kind, id) => ipcRenderer.invoke("first-call:directory:use", kind, id),
  mergeFirstCallDirectory: (kind, sourceId, targetId) => ipcRenderer.invoke("first-call:directory:merge", kind, sourceId, targetId),
  exportFirstCallDirectories: () => ipcRenderer.invoke("first-call:directory:export"),
  importFirstCallDirectories: () => ipcRenderer.invoke("first-call:directory:import"),
  searchFirstCallPlaces: (kind, query) => ipcRenderer.invoke("first-call:search", kind, query),
  saveFirstCallTomTomApiKey: (apiKey) => ipcRenderer.invoke("first-call:tomtom-key:save", apiKey),
  saveFirstCallPrintPreference: (preference) => ipcRenderer.invoke("first-call:print-preference:save", preference),
  printFirstCall: () => ipcRenderer.invoke("first-call:print"),
  saveFirstCallDraft: (draft) => ipcRenderer.invoke("first-call:draft:save", draft),
  clearFirstCallDraft: () => ipcRenderer.invoke("first-call:draft:clear"),
  loadCremationWorkspace: () => ipcRenderer.invoke("cremation:load"),
  saveCremationFuneralHome: (input) => ipcRenderer.invoke("cremation:funeral-home:save", input),
  deleteCremationFuneralHome: (id) => ipcRenderer.invoke("cremation:funeral-home:delete", id),
  saveCremationFinalNumber: (value) => ipcRenderer.invoke("cremation:sequence:save", value),
  saveCremationPrintPreference: (kind, preference) => ipcRenderer.invoke("cremation:print-preference:save", kind, preference),
  printCremationDocument: (kind, rows, date) => ipcRenderer.invoke("cremation:print", kind, rows, date),
  listCremationPrinters: () => ipcRenderer.invoke("cremation:printers:list"),
  checkCremationPrintingReadiness: (kind) => ipcRenderer.invoke("cremation:printing:readiness", kind),
  saveCremationBatch: (snapshot) => ipcRenderer.invoke("cremation:batch:save", snapshot),
  clearCremationBatch: () => ipcRenderer.invoke("cremation:batch:clear"),
  checkCremationLabelReadiness: () => ipcRenderer.invoke("cremation:labels:readiness"),
  printCremationLabels: (items) => ipcRenderer.invoke("cremation:labels:print", items),
  listReports: () => ipcRenderer.invoke("report:list"),
  loadReport: (id) => ipcRenderer.invoke("report:load", id),
  windowControl: (action) => ipcRenderer.invoke("window:control", action),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  // Returns its own unsubscribe so the renderer never has to reach for ipcRenderer directly to
  // detach, which would mean widening the contextBridge surface beyond these named methods.
  onWindowMaximizeChange: (listener) => {
    const handler = (_event: unknown, maximized: boolean) => listener(maximized);
    ipcRenderer.on("window:maximize-changed", handler);
    return () => { ipcRenderer.off("window:maximize-changed", handler); };
  },
};

contextBridge.exposeInMainWorld("nightShift", api);
