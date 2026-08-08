import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEmptyReport } from "@/domain/report";
import type { NightReport } from "@/domain/types";
import { DEFAULT_LAYOUT } from "@/shared/contracts";
import type { NightShiftApi } from "@/shared/contracts";
import { App } from "../App";
import { matchScore } from "./CommandPalette";

function mockApi(initialReport: NightReport): NightShiftApi {
  let current = initialReport;
  return {
    bootstrap: async () => ({ report: current, layout: DEFAULT_LAYOUT, funeralHomes: [], backups: [] }),
    saveReport: async (report, expectedVersion) => { current = { ...report, version: expectedVersion + 1 }; return current; },
    saveLayout: async (layout) => layout,
    renameFuneralHome: async () => [],
    mergeFuneralHomes: async () => [],
    deleteFuneralHome: async () => [],
    listBackups: async () => [],
    restoreBackup: async () => {},
    printReport: vi.fn(async () => ({ success: true })),
    windowControl: async () => {},
    isWindowMaximized: async () => false,
    onWindowMaximizeChange: () => () => {},
  };
}

async function openPalette() {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  return screen.findByRole("dialog", { name: "Command palette" });
}

/** The entry form also renders a combobox, so palette queries are always scoped to the dialog. */
function paletteInput() {
  return within(screen.getByRole("dialog", { name: "Command palette" })).getByRole("combobox");
}

function paletteOptions() {
  return within(screen.getByRole("dialog", { name: "Command palette" })).getAllByRole("option");
}

describe("matchScore", () => {
  it("ranks a prefix match above a later substring match", () => {
    expect(matchScore("deliver", "DELIVER section")!).toBeGreaterThan(matchScore("deliver", "Human remains — DELIVER")!);
  });

  it("matches a subsequence so initials find a multi-word command", () => {
    expect(matchScore("hdel", "Human remains — DELIVER")).not.toBeNull();
  });

  it("returns null when a character is missing entirely", () => {
    expect(matchScore("zzz", "Human remains — DELIVER")).toBeNull();
  });

  it("treats an empty query as a neutral match so every command is listed", () => {
    expect(matchScore("", "anything")).toBe(0);
  });
});

describe("CommandPalette", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.nightShift = mockApi(createEmptyReport("2026-07-26"));
  });

  it("opens on Ctrl+K and closes on Escape", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");

    expect(await openPalette()).toBeInTheDocument();

    fireEvent.keyDown(paletteInput(), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  it("filters commands by a fuzzy query", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    await openPalette();

    fireEvent.change(paletteInput(), { target: { value: "directory" } });

    const options = paletteOptions();
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Open funeral home directory");
  });

  it("runs the selected command on Enter and closes", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    await openPalette();

    fireEvent.change(paletteInput(), { target: { value: "directory" } });
    fireEvent.keyDown(paletteInput(), { key: "Enter" });

    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "Funeral home directory" })).toBeInTheDocument();
  });

  it("moves the active option with the arrow keys", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    await openPalette();

    const input = paletteInput();
    const first = paletteOptions()[0];
    expect(first).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(paletteOptions()[0]).toHaveAttribute("aria-selected", "false");
    expect(paletteOptions()[1]).toHaveAttribute("aria-selected", "true");
  });

  it("jumps to a section, which drives the inspector to that section", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    await openPalette();

    fireEvent.change(paletteInput(), { target: { value: "FDP" } });
    fireEvent.click(paletteOptions()[0]);

    const inspector = screen.getByRole("complementary", { name: "Report inspector" });
    expect(inspector).toHaveTextContent("FDP");
  });

  it("disables a command that is unavailable rather than hiding it", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    await openPalette();

    fireEvent.change(paletteInput(), { target: { value: "undo" } });

    // Nothing has been edited yet, so Undo is present but not runnable.
    expect(paletteOptions()[0]).toBeDisabled();
  });

  it("still opens while focus is inside a text field, unlike the undo shortcut", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");

    const field = screen.getByLabelText("Funeral home");
    field.focus();
    fireEvent.keyDown(field, { key: "k", ctrlKey: true });

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("groups commands under headings so the list stays scannable", async () => {
    render(<App />);
    await screen.findByText("Night Shift Report");
    const palette = await openPalette();

    expect(within(palette).getByText("Tools")).toBeInTheDocument();
    expect(within(palette).getByText("Go to section")).toBeInTheDocument();
  });
});
