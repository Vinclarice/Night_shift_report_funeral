import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { NightShiftApi } from "@/shared/contracts";
import { DEFAULT_LAYOUT } from "@/shared/contracts";
import { createEmptyReport } from "@/domain/report";
import { ToastProvider } from "../ui/Toast";
import { FirstCallWorkspace } from "./FirstCallWorkspace";

function mockApi(): NightShiftApi {
  const report = createEmptyReport("2026-07-29");
  return {
    bootstrap: async () => ({ report, latestFinalized: null, resumableDraft: null, layout: DEFAULT_LAYOUT, funeralHomes: [], backups: [] }),
    createDraft: async () => report, saveReport: async () => report, finalizeReport: async () => report, reopenReport: async () => report,
    listRevisions: async () => [], restoreRevision: async () => report, saveLayout: async (layout) => layout,
    renameFuneralHome: async () => [], mergeFuneralHomes: async () => [], deleteFuneralHome: async () => [],
    listBackups: async () => [], restoreBackup: async () => {}, printReport: async () => ({ success: true }),
    listReports: async () => [], loadReport: async () => report,
    loadFirstCallWorkspace: async () => ({
      funeralHomes: [{ id: "fh-1", name: "Example Funeral", address: "1 Main St", phone: "202-555-0100", fax: "202-555-0101", email: "office@example.test", aliases: ["EFH"], favorite: true, useCount: 2, lastUsedAt: "2026-07-28T10:00:00.000Z" }],
      facilities: [{ id: "pod-1", name: "Example Hospital", address: "2 Health Way", phone: "202-555-0200", aliases: ["EH"], favorite: false, useCount: 1, lastUsedAt: null }],
      printPreference: { scale: 1, offsetXInches: 0, offsetYInches: 0 },
      searchSettings: { provider: "tomtom", configured: true, source: "saved" },
      savedDraft: null,
    }),
    saveFirstCallFuneralHome: vi.fn(async () => ({ funeralHomes: [], facilities: [] })),
    deleteFirstCallFuneralHome: vi.fn(async () => ({ funeralHomes: [], facilities: [] })),
    saveFirstCallFacility: vi.fn(async () => ({ funeralHomes: [], facilities: [] })),
    deleteFirstCallFacility: vi.fn(async () => ({ funeralHomes: [], facilities: [] })),
    useFirstCallDirectory: vi.fn(async () => ({ funeralHomes: [], facilities: [] })),
    mergeFirstCallDirectory: vi.fn(async () => ({ funeralHomes: [], facilities: [] })),
    exportFirstCallDirectories: vi.fn(async () => ({ canceled: true })),
    importFirstCallDirectories: vi.fn(async () => ({ funeralHomes: [], facilities: [], canceled: true, imported: 0 })),
    searchFirstCallPlaces: vi.fn(async () => []),
    saveFirstCallTomTomApiKey: vi.fn(async () => ({ provider: "tomtom" as const, configured: true, source: "saved" as const })),
    saveFirstCallPrintPreference: async (preference) => preference,
    printFirstCall: vi.fn(async () => ({ success: true })),
    saveFirstCallDraft: vi.fn(async () => {}),
    clearFirstCallDraft: vi.fn(async () => {}),
    loadCremationWorkspace: async () => ({ funeralHomes: [], savedFinalNumber: null, printPreferences: { certificate: { scale: 1, offsetXInches: 0, offsetYInches: 0 }, envelope: { scale: 1, offsetXInches: 0, offsetYInches: 0 } }, labelReadiness: { ready: false, bpacInstalled: true, driverInstalled: false, templateAvailable: true, message: "Printer unavailable" }, savedBatch: null }),
    saveCremationFuneralHome: async () => [], deleteCremationFuneralHome: async () => [],
    saveCremationFinalNumber: async (value) => value, saveCremationPrintPreference: async (_kind, preference) => preference,
    printCremationDocument: async () => ({ success: true }), checkCremationLabelReadiness: async () => ({ ready: false, bpacInstalled: true, driverInstalled: false, templateAvailable: true, message: "Printer unavailable" }), printCremationLabels: async () => ({ printedIds: [] }),
    saveCremationBatch: vi.fn(async () => {}),
    clearCremationBatch: vi.fn(async () => {}),
    windowControl: async () => {}, isWindowMaximized: async () => false, onWindowMaximizeChange: () => () => {},
  };
}

function renderWorkspace(api = mockApi()) {
  window.nightShift = api;
  render(<ToastProvider><FirstCallWorkspace onBack={() => {}} /></ToastProvider>);
  return api;
}

function openPlaceOfDeathTools() {
  fireEvent.click(screen.getByRole("tab", { name: "Place of death" }));
}

function openSettingsTools() {
  fireEvent.click(screen.getByRole("tab", { name: /Settings/ }));
}

describe("FirstCallWorkspace", () => {
  it("defaults Vincent and derives an editable last name", async () => {
    renderWorkspace();
    expect(await screen.findByLabelText("Taken by")).toHaveValue("Vincent");

    fireEvent.change(screen.getByLabelText("Name of decedent"), { target: { value: "Smith, Mary A." } });
    expect(screen.getByLabelText("Deceased last name")).toHaveValue("SMITH");

    fireEvent.change(screen.getByLabelText("Deceased last name"), { target: { value: "Smythe" } });
    fireEvent.change(screen.getByLabelText("Name of decedent"), { target: { value: "Mary Smith" } });
    expect(screen.getByLabelText("Deceased last name")).toHaveValue("SMYTHE");
  });

  it("fills verified details from separate local directories", async () => {
    const api = renderWorkspace();
    const funeralName = await screen.findByLabelText("Direct funeral home name");
    fireEvent.focus(funeralName);
    fireEvent.change(funeralName, { target: { value: "EF" } });
    fireEvent.click(screen.getByRole("option", { name: /Example Funeral/ }));
    expect(screen.getByLabelText("Funeral home address")).toHaveValue("1 Main St");
    expect(screen.getByLabelText("Funeral home fax number")).toHaveValue("202-555-0101");

    openPlaceOfDeathTools();
    const facilityName = screen.getByLabelText("Direct facility name");
    fireEvent.focus(facilityName);
    fireEvent.change(facilityName, { target: { value: "Example Hosp" } });
    fireEvent.click(screen.getByRole("option", { name: /Example Hospital/ }));
    expect(screen.getByLabelText("Place of death address")).toHaveValue("2 Health Way");
    expect(screen.getByLabelText("Place of death phone")).toHaveValue("202-555-0200");
    expect(api.useFirstCallDirectory).toHaveBeenCalledWith("funeralHome", "fh-1");
    expect(api.useFirstCallDirectory).toHaveBeenCalledWith("facility", "pod-1");
  });

  it("requires review and an explicit save action for online suggestions", async () => {
    const api = mockApi();
    api.searchFirstCallPlaces = vi.fn(async () => [{
      sourceId: "tomtom-1", name: "Suggested Funeral", address: "10 Suggested Ave", phone: "202-555-0300",
      fax: "", email: "", attribution: "TomTom" as const,
    }]);
    renderWorkspace(api);
    const funeralName = await screen.findByLabelText("Direct funeral home name");
    const funeralSection = funeralName.closest("section")!;
    fireEvent.change(screen.getByLabelText("Funeral home"), { target: { value: "Suggested" } });
    fireEvent.click(within(funeralSection).getByRole("button", { name: "Search TomTom" }));
    const onlineResult = await within(funeralSection).findByRole("button", { name: /Suggested Funeral/ });
    expect(within(funeralSection).getByLabelText("Online lookup results")).toContainElement(onlineResult);
    fireEvent.click(onlineResult);

    expect(screen.getByLabelText("Funeral home address")).toHaveValue("10 Suggested Ave");
    expect(api.saveFirstCallFuneralHome).not.toHaveBeenCalled();
    fireEvent.click(within(funeralSection).getByRole("button", { name: "Save to directory" }));
    await waitFor(() => expect(api.saveFirstCallFuneralHome).toHaveBeenCalledWith(expect.objectContaining({ name: "Suggested Funeral", address: "10 Suggested Ave" })));
  });

  it("copies direct sidebar entry into the form and saves verified directory details", async () => {
    const api = renderWorkspace();
    const funeralName = await screen.findByLabelText("Direct funeral home name");
    const funeralSection = funeralName.closest("section")!;
    fireEvent.change(funeralName, { target: { value: "Direct Funeral Home" } });
    fireEvent.change(screen.getByLabelText("Direct funeral home address"), { target: { value: "12 Main Street, Washington, DC 20001" } });
    fireEvent.change(screen.getByLabelText("Direct funeral home telephone"), { target: { value: "202-555-0190" } });

    expect(screen.getByLabelText("Funeral home")).toHaveValue("Direct Funeral Home");
    expect(screen.getByLabelText("Funeral home address")).toHaveValue("12 Main Street, Washington, DC 20001");
    expect(screen.getByLabelText("Funeral home telephone number")).toHaveValue("202-555-0190");
    fireEvent.click(within(funeralSection).getByRole("button", { name: "Save to directory" }));
    await waitFor(() => expect(api.saveFirstCallFuneralHome).toHaveBeenCalledWith(expect.objectContaining({
      name: "Direct Funeral Home",
      address: "12 Main Street, Washington, DC 20001",
      phone: "202-555-0190",
    })));

    openPlaceOfDeathTools();
    const facilityName = screen.getByLabelText("Direct facility name");
    const facilitySection = facilityName.closest("section")!;
    fireEvent.change(facilityName, { target: { value: "Direct Medical Center" } });
    fireEvent.change(screen.getByLabelText("Direct facility address"), { target: { value: "20 Health Way, Arlington, VA 22201" } });
    fireEvent.change(screen.getByLabelText("Direct facility telephone"), { target: { value: "703-555-0160" } });

    expect(screen.getByLabelText("Place of death")).toHaveValue("Direct Medical Center");
    expect(screen.getByLabelText("Place of death address")).toHaveValue("20 Health Way, Arlington, VA 22201");
    fireEvent.click(within(facilitySection).getByRole("button", { name: "Save to directory" }));
    await waitFor(() => expect(api.saveFirstCallFacility).toHaveBeenCalledWith(expect.objectContaining({
      name: "Direct Medical Center",
      phone: "703-555-0160",
    })));
  });

  it("reviews a duplicate address before updating the existing saved record", async () => {
    const api = renderWorkspace();
    await screen.findByRole("tab", { name: "Place of death" });
    openPlaceOfDeathTools();
    const facilityName = screen.getByLabelText("Direct facility name");
    fireEvent.change(facilityName, { target: { value: "Alternate Hospital Name" } });
    fireEvent.change(screen.getByLabelText("Direct facility address"), { target: { value: "2 Health Way" } });
    fireEvent.click(within(facilityName.closest("section")!).getByRole("button", { name: "Save to directory" }));

    expect(screen.getByRole("dialog", { name: "A similar location is already saved" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Update existing" }));
    await waitFor(() => expect(api.saveFirstCallFacility).toHaveBeenCalledWith(expect.objectContaining({
      id: "pod-1", name: "Example Hospital", aliases: expect.arrayContaining(["Alternate Hospital Name"]),
    })));
  });

  it("keeps all Residence information in memory and exposes no persistence or lookup action", async () => {
    const api = renderWorkspace();
    await screen.findByRole("tab", { name: "Place of death" });
    openPlaceOfDeathTools();
    const residence = screen.getByRole("button", { name: "Residence" });
    fireEvent.click(residence);
    const placeSection = residence.closest("section")!;
    expect(within(placeSection).queryByRole("button", { name: "Remember" })).not.toBeInTheDocument();
    expect(within(placeSection).queryByRole("button", { name: "Search TomTom" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Direct residence address"), { target: { value: "Private residence address" } });
    fireEvent.change(screen.getByLabelText("Direct residence telephone"), { target: { value: "Private phone" } });

    expect(screen.getByLabelText("Place of death address")).toHaveValue("Private residence address");
    expect(screen.getByLabelText("Place of death phone")).toHaveValue("Private phone");
    expect(api.saveFirstCallFacility).not.toHaveBeenCalled();
    expect(api.searchFirstCallPlaces).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector(".first-call-print-only")).toHaveTextContent("Private residence address"));
  });

  it("uses an explicit nonpersistent TomTom search to fill a Residence address", async () => {
    const api = mockApi();
    api.searchFirstCallPlaces = vi.fn(async () => [{
      sourceId: "address-1", name: "100 Oak Street, Washington, DC 20001", address: "100 Oak Street, Washington, DC 20001",
      phone: "", fax: "", email: "", attribution: "TomTom" as const,
    }]);
    renderWorkspace(api);
    await screen.findByRole("tab", { name: "Place of death" });
    openPlaceOfDeathTools();
    fireEvent.click(screen.getByRole("button", { name: "Residence" }));
    fireEvent.change(screen.getByLabelText("Direct residence address"), { target: { value: "100 Oak" } });
    fireEvent.click(screen.getByRole("button", { name: "Search address with TomTom" }));
    fireEvent.click(await screen.findByRole("button", { name: /100 Oak Street/ }));

    expect(api.searchFirstCallPlaces).toHaveBeenCalledWith("residence", "100 Oak");
    expect(screen.getByLabelText("Place of death address")).toHaveValue("100 Oak Street, Washington, DC 20001");
    expect(api.saveFirstCallFacility).not.toHaveBeenCalled();
  });

  it("opens searchable directory maintenance with aliases and CSV tools", async () => {
    const api = renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "Manage directories" }));
    expect(screen.getByRole("dialog", { name: "First Call directories" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search saved directory"), { target: { value: "EFH" } });
    fireEvent.click(screen.getByRole("button", { name: /Example Funeral/ }));
    expect(screen.getByLabelText("Aliases")).toHaveValue("EFH");
    fireEvent.click(screen.getByRole("button", { name: "Remove from favorites" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.saveFirstCallFuneralHome).toHaveBeenCalledWith(expect.objectContaining({ id: "fh-1", aliases: ["EFH"], favorite: false })));
    fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(api.importFirstCallDirectories).toHaveBeenCalledOnce();
    expect(api.exportFirstCallDirectories).toHaveBeenCalledOnce();
  });

  it("prints without clearing the current sheet", async () => {
    const api = renderWorkspace();
    await screen.findByLabelText("Name of decedent");
    fireEvent.change(screen.getByLabelText("Name of decedent"), { target: { value: "Mary Smith" } });
    fireEvent.click(screen.getByRole("button", { name: "Print sheet" }));

    expect(api.printFirstCall).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Name of decedent")).toHaveValue("Mary Smith");
  });

  it("saves a TomTom key before enabling explicit online search", async () => {
    const api = mockApi();
    api.loadFirstCallWorkspace = async () => ({
      funeralHomes: [], facilities: [],
      printPreference: { scale: 1, offsetXInches: 0, offsetYInches: 0 },
      searchSettings: { provider: "tomtom", configured: false, source: "none" },
      savedDraft: null,
    });
    renderWorkspace(api);
    await screen.findByRole("tab", { name: /Settings/ });
    openSettingsTools();
    const keyInput = await screen.findByLabelText("TomTom API key");

    fireEvent.change(keyInput, { target: { value: "test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(api.saveFirstCallTomTomApiKey).toHaveBeenCalledWith("test-key"));
    expect(screen.queryByLabelText("TomTom API key")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Funeral home" }));
    expect(screen.getByRole("button", { name: "Search TomTom" })).toBeEnabled();
  });

  it("keeps configured TomTom credentials inside a collapsed settings menu", async () => {
    renderWorkspace();
    await screen.findByRole("tab", { name: /Settings/ });
    openSettingsTools();
    const settingsButton = await screen.findByRole("button", { name: /TomTom search settings/ });
    expect(settingsButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("TomTom API key")).not.toBeInTheDocument();
    fireEvent.click(settingsButton);
    expect(screen.getByLabelText("TomTom API key")).toBeVisible();
  });

  it("zooms only the preview and leaves print calibration unchanged", async () => {
    renderWorkspace();
    const preview = await screen.findByLabelText("First Call preview page");
    const printPage = document.querySelector<HTMLElement>(".first-call-print-only .first-call-letter")!;
    const originalWidth = Number.parseFloat(preview.style.width);
    expect(printPage.style.getPropertyValue("--first-call-scale")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(Number.parseFloat(preview.style.width)).toBeGreaterThan(originalWidth);
    expect(printPage.style.getPropertyValue("--first-call-scale")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    expect(Number.parseFloat(preview.style.width)).toBe(8.5 * 96);
    expect(printPage.style.getPropertyValue("--first-call-scale")).toBe("1");
  });

  it("automatically highlights checked wording and can turn that behavior off", async () => {
    renderWorkspace();
    const checkbox = await screen.findByLabelText("Metropolitan");
    fireEvent.click(checkbox);
    expect(document.querySelectorAll(".first-call-interactive .first-call-highlight-auto")).toHaveLength(1);
    expect(document.querySelectorAll(".first-call-print-only .first-call-highlight-auto")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Checked labels: On" }));
    expect(document.querySelectorAll(".first-call-highlight-auto")).toHaveLength(0);
    expect(checkbox).toBeChecked();
  });
});
