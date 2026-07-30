import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { NightShiftApi } from "@/shared/contracts";
import { DEFAULT_LAYOUT } from "@/shared/contracts";
import { createEmptyReport } from "@/domain/report";
import { ToastProvider } from "../ui/Toast";
import { CremationWorkspace } from "./CremationWorkspace";

function mockApi(): NightShiftApi {
  const report = createEmptyReport("2026-07-29");
  return {
    bootstrap: async () => ({ report, latestFinalized: null, resumableDraft: null, layout: DEFAULT_LAYOUT, funeralHomes: [], backups: [] }),
    createDraft: async () => report, saveReport: async () => report, finalizeReport: async () => report, reopenReport: async () => report,
    listRevisions: async () => [], restoreRevision: async () => report, saveLayout: async (layout) => layout,
    renameFuneralHome: async () => [], mergeFuneralHomes: async () => [], deleteFuneralHome: async () => [],
    listBackups: async () => [], restoreBackup: async () => {}, printReport: async () => ({ success: true }),
    loadFirstCallWorkspace: async () => ({ funeralHomes: [], facilities: [], printPreference: { scale: 1, offsetXInches: 0, offsetYInches: 0 }, searchSettings: { provider: "tomtom", configured: false, source: "none" } }),
    saveFirstCallFuneralHome: async () => ({ funeralHomes: [], facilities: [] }), deleteFirstCallFuneralHome: async () => ({ funeralHomes: [], facilities: [] }),
    saveFirstCallFacility: async () => ({ funeralHomes: [], facilities: [] }), deleteFirstCallFacility: async () => ({ funeralHomes: [], facilities: [] }),
    useFirstCallDirectory: async () => ({ funeralHomes: [], facilities: [] }), mergeFirstCallDirectory: async () => ({ funeralHomes: [], facilities: [] }),
    exportFirstCallDirectories: async () => ({ canceled: true }), importFirstCallDirectories: async () => ({ funeralHomes: [], facilities: [], canceled: true, imported: 0 }),
    searchFirstCallPlaces: async () => [], saveFirstCallTomTomApiKey: async () => ({ provider: "tomtom", configured: false, source: "none" }),
    saveFirstCallPrintPreference: async (preference) => preference, printFirstCall: async () => ({ success: true }),
    loadCremationWorkspace: vi.fn(async () => ({
      funeralHomes: [{ id: "home-1", name: "Example Funeral", location: "Baltimore, MD" }],
      savedFinalNumber: "6-063-36",
      printPreferences: { certificate: { scale: 1, offsetXInches: 0, offsetYInches: 0 }, envelope: { scale: 1, offsetXInches: 0, offsetYInches: 0 } },
      labelReadiness: { ready: true, bpacInstalled: true, driverInstalled: true, templateAvailable: true, printerName: "Brother PT-D610BT", message: "Ready" },
    })),
    saveCremationFuneralHome: vi.fn(async (input) => [{ id: input.id ?? "home-2", name: input.name, location: input.location }]),
    deleteCremationFuneralHome: vi.fn(async () => []),
    saveCremationFinalNumber: vi.fn(async (value) => value),
    saveCremationPrintPreference: vi.fn(async (_kind, preference) => preference),
    printCremationDocument: vi.fn(async () => ({ success: true })),
    checkCremationLabelReadiness: vi.fn(async () => ({ ready: true, bpacInstalled: true, driverInstalled: true, templateAvailable: true, printerName: "Brother PT-D610BT", message: "Ready" })),
    printCremationLabels: vi.fn(async (items: Array<{ id: string; displayName: string }>) => ({ printedIds: items.map((item) => item.id) })),
    listReports: async () => [], loadReport: async () => report,
    windowControl: async () => {}, isWindowMaximized: async () => false, onWindowMaximizeChange: () => () => {},
  };
}

function renderWorkspace(api = mockApi()) {
  window.nightShift = api;
  render(<ToastProvider><CremationWorkspace onBack={() => {}} /></ToastProvider>);
  return api;
}

function printOutput(output: "Certificates" | "Envelopes" | "Labels") {
  fireEvent.click(screen.getByRole("button", { name: output }));
  fireEvent.click(screen.getByRole("button", { name: "Print selected" }));
}

async function completeFirstRow() {
  expect(await screen.findByLabelText("Cremation number 1")).toHaveValue("6-063-37");
  fireEvent.change(screen.getByLabelText("Full name 1"), { target: { value: "Mary Ann Smith Jr." } });
  expect(screen.getByLabelText("Display name 1")).toHaveValue("Mary Smith");
  fireEvent.change(screen.getByLabelText("Funeral home 1"), { target: { value: "Example Funeral" } });
  expect(screen.getByLabelText("City and state 1")).toHaveValue("Baltimore, MD");
  fireEvent.blur(screen.getByLabelText("Funeral home 1"));
  expect(screen.getByLabelText("City and state 1")).toHaveValue("Baltimore, MD");
}

describe("CremationWorkspace", () => {
  it("continues the saved sequence, derives first-and-last name, and rolls over after 38", async () => {
    renderWorkspace();
    await completeFirstRow();

    fireEvent.keyDown(screen.getByLabelText("Funeral home 1"), { key: "Enter" });
    expect(await screen.findByLabelText("Cremation number 2")).toHaveValue("6-063-38");
    await waitFor(() => expect(screen.getByLabelText("Full name 2")).toHaveFocus());

    fireEvent.change(screen.getByLabelText("Cremation number 1"), { target: { value: "6-063-38" } });
    expect(screen.getByLabelText("Cremation number 2")).toHaveValue("6-064-01");
  });

  it("prints independently, invalidates changed output, and saves the final number without clearing rows", async () => {
    const api = renderWorkspace();
    await completeFirstRow();

    printOutput("Certificates");
    await waitFor(() => expect(api.printCremationDocument).toHaveBeenCalledWith("certificate"));
    await waitFor(() => expect(screen.getByText("Printed")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Full name 1"), { target: { value: "Mary Jane Smith" } });
    expect(screen.getByText("Needs reprint")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save final number" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save final number" }));
    await waitFor(() => expect(api.saveCremationFinalNumber).toHaveBeenCalledWith("6-063-37"));
    expect(screen.getByLabelText("Full name 1")).toHaveValue("Mary Jane Smith");
  });

  it("only stores a funeral home after the explicit directory action", async () => {
    const api = renderWorkspace();
    fireEvent.click(await screen.findByRole("tab", { name: "Funeral homes" }));
    await screen.findByText("Cremation funeral homes");
    const section = screen.getByText("Cremation funeral homes").closest("section")!;
    fireEvent.change(within(section).getByLabelText("Name"), { target: { value: "New Home" } });
    fireEvent.change(within(section).getByLabelText("City / State"), { target: { value: "Laurel, MD" } });
    expect(api.saveCremationFuneralHome).not.toHaveBeenCalled();
    fireEvent.click(within(section).getByRole("button", { name: "Save record" }));
    await waitFor(() => expect(api.saveCremationFuneralHome).toHaveBeenCalledWith({ id: undefined, name: "New Home", location: "Laurel, MD" }));
  });

  it("keeps a batch selected across all output jobs, then leaves a new row selected separately", async () => {
    const api = renderWorkspace();
    await completeFirstRow();

    printOutput("Certificates");
    await waitFor(() => expect(api.printCremationDocument).toHaveBeenCalledWith("certificate"));
    expect(screen.getByLabelText("Select row 1")).toBeChecked();

    printOutput("Envelopes");
    await waitFor(() => expect(api.printCremationDocument).toHaveBeenCalledWith("envelope"));
    expect(screen.getByLabelText("Select row 1")).toBeChecked();

    printOutput("Labels");
    await waitFor(() => expect(api.printCremationLabels).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Select row 1")).not.toBeChecked());

    fireEvent.keyDown(screen.getByLabelText("Funeral home 1"), { key: "Enter" });
    expect(await screen.findByLabelText("Select row 2")).toBeChecked();
    expect(screen.getByLabelText("Select row 1")).not.toBeChecked();
  });

  it("allows an unknown funeral home to keep optional city and state blank", async () => {
    const api = renderWorkspace();
    expect(await screen.findByLabelText("Cremation number 1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Full name 1"), { target: { value: "Unknown Home Decedent" } });
    fireEvent.change(screen.getByLabelText("Funeral home 1"), { target: { value: "Unknown Out of State Home" } });

    expect(screen.getByLabelText("City and state 1")).toHaveValue("");
    printOutput("Certificates");
    await waitFor(() => expect(api.printCremationDocument).toHaveBeenCalledWith("certificate"));
  });

  it("marks only labels accepted before a partial Brother failure", async () => {
    const api = mockApi();
    api.printCremationLabels = vi.fn(async (items) => ({ printedIds: [items[0].id], failureReason: "The second label was rejected." }));
    renderWorkspace(api);
    await completeFirstRow();
    fireEvent.keyDown(screen.getByLabelText("Funeral home 1"), { key: "Enter" });
    await screen.findByLabelText("Full name 2");
    fireEvent.change(screen.getByLabelText("Full name 2"), { target: { value: "John Q Public" } });
    fireEvent.change(screen.getByLabelText("Funeral home 2"), { target: { value: "Example Funeral" } });

    printOutput("Labels");
    await waitFor(() => expect(api.printCremationLabels).toHaveBeenCalledOnce());
    const firstRow = screen.getByLabelText("Full name 1").closest("tr")!;
    const secondRow = screen.getByLabelText("Full name 2").closest("tr")!;
    expect(within(firstRow).getAllByText("Printed")).toHaveLength(1);
    expect(within(secondRow).getAllByText("Not printed")).toHaveLength(3);
  });

  it("warns before leaving after the sequence advances", async () => {
    const onBack = vi.fn();
    window.nightShift = mockApi();
    render(<ToastProvider><CremationWorkspace onBack={onBack} /></ToastProvider>);
    await completeFirstRow();
    fireEvent.click(screen.getByRole("button", { name: "Night Shift" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("sequence has advanced");
    expect(onBack).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave workspace" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
