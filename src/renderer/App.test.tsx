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
    bootstrap: async () => ({ report: current, latestFinalized: null, layout: DEFAULT_LAYOUT, funeralHomes: [], backups: [] }),
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
  };
}

describe("App", () => {
  beforeEach(() => {
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
});
