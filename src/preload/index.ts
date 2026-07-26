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
};

contextBridge.exposeInMainWorld("nightShift", api);

