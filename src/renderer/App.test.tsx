import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, vi } from "vitest";

import { createEmptyReport } from "@/domain/report";
import type { NightReport } from "@/domain/types";
import { DEFAULT_LAYOUT } from "@/shared/contracts";
import type { NightShiftApi } from "@/shared/contracts";
import { App } from "./App";

function mockApi(initialReport: NightReport): NightShiftApi {
  let current = initialReport;
  return {
    bootstrap: async () => ({ report: current, layout: DEFAULT_LAYOUT, funeralHomes: [], backups: [] }),
    saveReport: async (report, expectedVersion) => {
      current = { ...report, version: expectedVersion + 1 };
      return current;
    },
    saveLayout: async (layout) => layout,
    renameFuneralHome: async () => [],
    mergeFuneralHomes: async () => [],
    deleteFuneralHome: async () => [],
    listBackups: async () => [],
    restoreBackup: async () => {},
    printReport: async () => ({ success: true }),
    windowControl: async () => {},
    isWindowMaximized: async () => false,
    onWindowMaximizeChange: () => () => {},
  };
}

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.nightShift = mockApi(createEmptyReport("2026-07-26"));
  });

  async function addEntry(funeralHome: string, deceasedName: string) {
    fireEvent.change(screen.getByLabelText("Funeral home"), { target: { value: funeralHome } });
    fireEvent.change(screen.getByLabelText("Deceased"), { target: { value: deceasedName } });
    fireEvent.click(screen.getByRole("button", { name: "Add to report" }));
    await screen.findByRole("heading", { name: "1" });
  }

  it("opens directly into the studio with no welcome screen or click required", async () => {
    render(<App />);
    expect(await screen.findByText("Night Shift Report")).toBeVisible();
    expect(screen.getByText("No entries yet — add one above.")).toBeInTheDocument();
  });

  it("always exposes working window controls", async () => {
    const windowControl = vi.fn(async () => {});
    window.nightShift = { ...window.nightShift, windowControl };
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(windowControl).toHaveBeenCalledWith("close");
  });

  it("undo restores the report to its state before the last edit, and becomes unavailable once history is exhausted", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    await screen.findByText("No entries yet — add one above.");

    await addEntry("Greene", "Johnson");
    const undoButton = await screen.findByRole("button", { name: "Undo" });
    expect(undoButton).toBeEnabled();

    fireEvent.click(undoButton);

    await screen.findByText("No entries yet — add one above.");
    // Exactly one edit was made, so undo history should now be exhausted rather than looping
    // back to the edited state on a second press.
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("redo re-applies an undone edit, and becomes unavailable once redo history is exhausted", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    await screen.findByText("No entries yet — add one above.");

    await addEntry("Greene", "Johnson");
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await screen.findByText("No entries yet — add one above.");

    const redoButton = await screen.findByRole("button", { name: "Redo" });
    expect(redoButton).toBeEnabled();
    fireEvent.click(redoButton);

    await screen.findByRole("heading", { name: "1" });
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("clears redo history once a fresh edit is made after undoing", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    await screen.findByText("No entries yet — add one above.");

    await addEntry("Greene", "Johnson");
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await screen.findByText("No entries yet — add one above.");
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();

    await addEntry("McGuire", "Smith");

    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  /**
   * Count is a Cremated format, so these validation cases have to be driven from a Cremated
   * section — the Human column only offers Funeral and Plain.
   */
  async function selectCrematedFdp() {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const paletteInput = screen.getByRole("combobox", { name: "Search commands" });
    fireEvent.change(paletteInput, { target: { value: "Cremated remains — FDP" } });
    fireEvent.keyDown(paletteInput, { key: "Enter" });
    await screen.findByRole("button", { name: "Count" });
  }

  it("rejects a count entry with blank text instead of silently adding an empty line", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    await selectCrematedFdp();

    fireEvent.click(screen.getByRole("button", { name: "Count" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to report" }));

    await screen.findByText(/Text is required/);
    expect(screen.getByText("No entries yet — add one above.")).toBeInTheDocument();
  });

  it("rejects a count entry with a non-positive count instead of saving NaN", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    await selectCrematedFdp();

    fireEvent.click(screen.getByRole("button", { name: "Count" }));
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Reese" } });
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to report" }));

    await screen.findByText(/Count must be a positive number/);
    expect(screen.getByText("No entries yet — add one above.")).toBeInTheDocument();
  });

  it("stamps the print time onto both the screen and the print copy", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    expect(screen.queryByText(/^Printed /)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Print report" }));

    // Both copies: the canvas one is what the operator sees, the hidden print-only one is what
    // actually reaches the printer, and the stamp is worthless if it misses the latter.
    const stamps = await screen.findAllByText(/^Printed /);
    expect(stamps).toHaveLength(2);
  });

  it("walks rows with the arrow keys, carrying on into the next section", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");

    // Every typable row in the Human column, in reading order — DELIVER's rows, then AIRPORT
    // DROPS', and so on, so stepping past the end of one card lands in the next.
    const rows = screen.getAllByRole("button", { name: /Type in Human Remains/ });
    expect(rows.length).toBeGreaterThan(4);
    rows[0].focus();

    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);

    fireEvent.keyDown(rows[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[2]);

    fireEvent.keyDown(rows[2], { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[1]);

    // The first row has nowhere above it, so focus stays put rather than wrapping round.
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[0]);
  });

  it("offers only the formats each column uses", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");

    const formats = () => within(screen.getByRole("group", { name: "Format" }))
      .getAllByRole("button").map((button) => button.textContent);
    expect(formats()).toEqual(["Funeral", "Plain"]);

    await selectCrematedFdp();
    expect(formats()).toEqual(["FH only", "Count", "Combined"]);
  });

  it("surfaces the parser's ambiguous-line warning when committed directly in the preview", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");

    fireEvent.click(screen.getByRole("button", { name: "Type in Human Remains DELIVER" }));
    const input = screen.getByRole("textbox", { name: "Edit Human Remains DELIVER" });
    fireEvent.change(input, { target: { value: "Call Ron" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await screen.findByText(/Kept as plain text/);
  });

  it("keeps the command palette section jump and contextual inspector synchronized", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const paletteInput = screen.getByRole("combobox", { name: "Search commands" });
    fireEvent.change(paletteInput, { target: { value: "Human remains — FDP" } });
    fireEvent.keyDown(paletteInput, { key: "Enter" });

    const inspector = screen.getByRole("complementary", { name: "Report inspector" });
    expect(inspector).toHaveTextContent("FDP");
    expect(inspector).toHaveTextContent("No entries yet");
  });

  it("splits one person into a new funeral-home group without reassigning the others", async () => {
    const report = createEmptyReport("2026-07-26");
    report.sections.find((section) => section.key === "human-deliver")!.entries.push({
      id: "grouped", type: "funeral", funeralHome: "McGuire",
      deceased: [
        { id: "smith", name: "Smith", locationCode: "13A", specialRequest: "" },
        { id: "jones", name: "Jones", locationCode: "17B", specialRequest: "" },
      ],
      rush: false, keepSeparate: false, pinnedBottom: false, createdAt: "2026-07-25T12:00:00.000Z",
    });
    const api = mockApi(report);
    let saved: NightReport | null = null;
    const saveReport = api.saveReport;
    api.saveReport = async (next, expectedVersion) => {
      saved = structuredClone(next);
      return saveReport(next, expectedVersion);
    };
    window.nightShift = api;
    render(<App />);
    await screen.findByText("Night Shift Report");

    fireEvent.click(screen.getByRole("button", { name: "Edit Jones" }));
    fireEvent.change(screen.getByLabelText("Funeral home"), { target: { value: "Brown" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("heading", { name: "2" });

    const entries = saved!.sections.find((section) => section.key === "human-deliver")!.entries;
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "funeral", funeralHome: "McGuire", deceased: [expect.objectContaining({ name: "Smith" })] }),
      expect.objectContaining({ type: "funeral", funeralHome: "Brown", deceased: [expect.objectContaining({ name: "Jones" })] }),
    ]));
  });

  it("opens secondary tools in an accessible utility sheet", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");

    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Print setup/ }));

    expect(screen.getByRole("dialog", { name: "Print setup" })).toBeInTheDocument();
  });

  it("places the inspector beside the canvas", async () => {
    const { container } = render(<App />);
    await screen.findByText("Night Shift Report");

    const columns = [...container.querySelectorAll(".studio-workspace > *")].map((element) => element.className.split(" ")[0]);

    expect(columns).toEqual(["studio-inspector", "studio-canvas"]);
  });
});
