import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach } from "vitest";

import { createEmptyReport } from "@/domain/report";
import type { NightReport } from "@/domain/types";
import { DEFAULT_LAYOUT } from "@/shared/contracts";
import type { NightShiftApi } from "@/shared/contracts";
import { App } from "./App";

function mockApi(initialReport: NightReport): NightShiftApi {
  let current = initialReport;
  return {
    bootstrap: async () => ({ report: current, latestFinalized: null, resumableDraft: null, layout: DEFAULT_LAYOUT, funeralHomes: [], backups: [] }),
    createDraft: async () => current,
    saveReport: async (report, expectedVersion) => {
      current = { ...report, version: expectedVersion + 1 };
      return current;
    },
    finalizeReport: async (report, expectedVersion) => {
      current = { ...report, status: "finalized", version: expectedVersion + 1 };
      return current;
    },
    reopenReport: async (report, expectedVersion) => {
      current = { ...report, status: "draft", version: expectedVersion + 1 };
      return current;
    },
    listRevisions: async () => [],
    restoreRevision: async () => current,
    saveLayout: async (layout) => layout,
    renameFuneralHome: async () => [],
    mergeFuneralHomes: async () => [],
    deleteFuneralHome: async () => [],
    listBackups: async () => [],
    restoreBackup: async () => {},
    printReport: async () => ({ success: true }),
    listReports: async () => [],
    loadReport: async () => current,
    windowControl: async () => {},
    isWindowMaximized: async () => false,
    onWindowMaximizeChange: () => () => {},
  };
}

describe("resuming a draft stranded by the date rollover", () => {
  function strandedDraft() {
    const draft = createEmptyReport("2026-07-28");
    draft.sections.find((section) => section.key === "human-deliver")!.entries.push({
      id: "carried", type: "plain", text: "Started before midnight", rush: false, keepSeparate: false, pinnedBottom: false, createdAt: "2026-07-27T22:00:00.000Z",
    });
    return draft;
  }

  beforeEach(() => {
    window.localStorage.clear();
    const draft = strandedDraft();
    // No report for tonight, because the calendar day advanced mid-shift.
    window.nightShift = { ...mockApi(createEmptyReport("2026-07-29")), bootstrap: async () => ({ report: null, latestFinalized: null, resumableDraft: draft, layout: DEFAULT_LAYOUT, funeralHomes: [], backups: [] }) };
  });

  it("surfaces the stranded draft on the start screen with its date and size", async () => {
    render(<App />);

    expect(await screen.findByText(/Unfinished report for/)).toHaveTextContent("Tuesday, Jul 28");
    expect(screen.getByText(/1 entry/)).toBeInTheDocument();
  });

  it("opens that draft rather than creating a new report", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume that report" }));

    // The editor opens on the resumed draft, with the entry made earlier in the shift intact.
    await screen.findByText("Night Shift Report");
    expect(screen.getByRole("complementary", { name: "Report inspector" })).toHaveTextContent("Started before midnight");
  });

  it("still allows starting fresh instead", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Resume that report" });

    expect(screen.getByRole("button", { name: "Start empty" })).toBeEnabled();
  });
});

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

  it("rejects a count entry with blank text instead of silently adding an empty line", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");

    fireEvent.click(screen.getByRole("button", { name: "Count" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to report" }));

    await screen.findByText(/Text is required/);
    expect(screen.getByText("No entries yet — add one above.")).toBeInTheDocument();
  });

  it("rejects a count entry with a non-positive count instead of saving NaN", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");

    fireEvent.click(screen.getByRole("button", { name: "Count" }));
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Reese" } });
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to report" }));

    await screen.findByText(/Count must be a positive number/);
    expect(screen.getByText("No entries yet — add one above.")).toBeInTheDocument();
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

  it("keeps the navigator and contextual inspector synchronized", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");

    fireEvent.click(screen.getByRole("button", { name: "Human remains FDP" }));

    const inspector = screen.getByRole("complementary", { name: "Report inspector" });
    expect(inspector).toHaveTextContent("FDP");
    expect(inspector).toHaveTextContent("No entries yet");
  });

  it("opens secondary tools in an accessible utility sheet", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");

    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Print setup/ }));

    expect(screen.getByRole("dialog", { name: "Print setup" })).toBeInTheDocument();
  });

  it("places the inspector between the navigator and the canvas", async () => {
    const { container } = render(<App />);
    await screen.findByText("Night Shift Report");

    // Section list and entry form are used on every entry, so they sit adjacent; asserting DOM
    // order because the grid places these three in source order.
    const columns = [...container.querySelectorAll(".studio-workspace > *")].map((element) => element.className.split(" ")[0]);

    expect(columns).toEqual(["report-navigator", "studio-inspector", "studio-canvas"]);
  });

  it("switches the inspector to read-only after finalization", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");

    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

    await screen.findByText("This report is locked");
    expect(screen.getByRole("button", { name: "Reopen" })).toBeEnabled();
  });
});
