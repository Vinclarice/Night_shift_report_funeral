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

  it("undo restores the report to its state before the last edit", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    await screen.findByRole("heading", { name: "None" });

    fireEvent.change(screen.getByLabelText("Funeral home"), { target: { value: "Greene" } });
    fireEvent.change(screen.getByLabelText("Deceased"), { target: { value: "Johnson" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to report" }));

    await screen.findByRole("heading", { name: "1" });
    const undoButton = await screen.findByRole("button", { name: "Undo" });
    expect(undoButton).toBeEnabled();

    fireEvent.click(undoButton);

    await screen.findByRole("heading", { name: "None" });
    // Undoing pushes the state it just replaced back onto the stack (the same mechanism as any
    // other edit), so pressing Undo again toggles back to the edited state rather than leaving
    // nothing left to undo.
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByRole("heading", { name: "1" });
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
