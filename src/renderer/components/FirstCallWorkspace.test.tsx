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
      funeralHomes: [{ id: "fh-1", name: "Example Funeral", address: "1 Main St", phone: "202-555-0100", fax: "202-555-0101", email: "office@example.test" }],
      facilities: [{ id: "pod-1", name: "Example Hospital", address: "2 Health Way", phone: "202-555-0200" }],
      printPreference: { scale: 1, offsetXInches: 0, offsetYInches: 0 },
      searchSettings: { provider: "tomtom", configured: true, source: "saved" },
    }),
    saveFirstCallFuneralHome: vi.fn(async () => ({ funeralHomes: [], facilities: [] })),
    deleteFirstCallFuneralHome: vi.fn(async () => ({ funeralHomes: [], facilities: [] })),
    saveFirstCallFacility: vi.fn(async () => ({ funeralHomes: [], facilities: [] })),
    deleteFirstCallFacility: vi.fn(async () => ({ funeralHomes: [], facilities: [] })),
    searchFirstCallPlaces: vi.fn(async () => []),
    saveFirstCallTomTomApiKey: vi.fn(async () => ({ provider: "tomtom" as const, configured: true, source: "saved" as const })),
    saveFirstCallPrintPreference: async (preference) => preference,
    printFirstCall: vi.fn(async () => ({ success: true })),
    windowControl: async () => {}, isWindowMaximized: async () => false, onWindowMaximizeChange: () => () => {},
  };
}

function renderWorkspace(api = mockApi()) {
  window.nightShift = api;
  render(<ToastProvider><FirstCallWorkspace onBack={() => {}} /></ToastProvider>);
  return api;
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
    renderWorkspace();
    const funeralSelect = await screen.findByLabelText("Saved First Call funeral home");
    fireEvent.change(funeralSelect, { target: { value: "Example Funeral" } });
    expect(screen.getByLabelText("Funeral home address")).toHaveValue("1 Main St");
    expect(screen.getByLabelText("Funeral home fax number")).toHaveValue("202-555-0101");

    fireEvent.change(screen.getByLabelText("Saved place of death facility"), { target: { value: "Example Hospital" } });
    expect(screen.getByLabelText("Place of death address")).toHaveValue("2 Health Way");
    expect(screen.getByLabelText("Place of death phone")).toHaveValue("202-555-0200");
  });

  it("requires review and an explicit Remember action for online suggestions", async () => {
    const api = mockApi();
    api.searchFirstCallPlaces = vi.fn(async () => [{
      sourceId: "tomtom-1", name: "Suggested Funeral", address: "10 Suggested Ave", phone: "202-555-0300",
      fax: "", email: "", attribution: "TomTom" as const,
    }]);
    renderWorkspace(api);
    const funeralSelect = await screen.findByLabelText("Saved First Call funeral home");
    const funeralSection = funeralSelect.closest("section")!;
    fireEvent.change(screen.getByLabelText("Funeral home"), { target: { value: "Suggested" } });
    fireEvent.click(within(funeralSection).getByRole("button", { name: "Search online" }));
    fireEvent.click(await screen.findByRole("button", { name: /Suggested Funeral/ }));

    expect(screen.getByLabelText("Funeral home address")).toHaveValue("10 Suggested Ave");
    expect(api.saveFirstCallFuneralHome).not.toHaveBeenCalled();
    fireEvent.click(within(funeralSection).getByRole("button", { name: "Remember" }));
    await waitFor(() => expect(api.saveFirstCallFuneralHome).toHaveBeenCalledWith(expect.objectContaining({ name: "Suggested Funeral", address: "10 Suggested Ave" })));
  });

  it("keeps all Residence information in memory and exposes no persistence or lookup action", async () => {
    const api = renderWorkspace();
    const residence = await screen.findByRole("button", { name: "Residence" });
    fireEvent.click(residence);
    const placeSection = residence.closest("section")!;
    expect(within(placeSection).queryByRole("button", { name: "Remember" })).not.toBeInTheDocument();
    expect(within(placeSection).queryByRole("button", { name: "Search online" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Place of death address"), { target: { value: "Private residence address" } });
    fireEvent.change(screen.getByLabelText("Place of death phone"), { target: { value: "Private phone" } });

    expect(api.saveFirstCallFacility).not.toHaveBeenCalled();
    expect(api.searchFirstCallPlaces).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector(".first-call-print-only")).toHaveTextContent("Private residence address"));
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
    });
    renderWorkspace(api);
    const keyInput = await screen.findByLabelText("TomTom API key");
    const searchButtons = screen.getAllByRole("button", { name: "Search online" });
    expect(searchButtons.every((button) => button.hasAttribute("disabled"))).toBe(true);

    fireEvent.change(keyInput, { target: { value: "test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(api.saveFirstCallTomTomApiKey).toHaveBeenCalledWith("test-key"));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Search online" }).every((button) => !button.hasAttribute("disabled"))).toBe(true));
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
