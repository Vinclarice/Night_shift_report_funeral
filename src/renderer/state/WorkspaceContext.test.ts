import { describe, expect, it } from "vitest";

import { workspaceReducer } from "./WorkspaceContext";
import type { WorkspaceState } from "./WorkspaceContext";

const initial: WorkspaceState = {
  selection: { kind: "section", sectionKey: "human-deliver" },
  inspectorMode: "create",
  utility: null,
  inspectorOpen: false,
  zoomMode: "fit",
  zoom: 0.72,
};

describe("workspaceReducer", () => {
  it("synchronizes section selection and opens the inspector", () => {
    const next = workspaceReducer(initial, { type: "SELECT_SECTION", sectionKey: "human-fdp", mode: "browse" });
    expect(next.selection).toEqual({ kind: "section", sectionKey: "human-fdp" });
    expect(next.inspectorMode).toBe("browse");
    expect(next.inspectorOpen).toBe(true);
  });

  it("moves entry selection into edit mode", () => {
    const next = workspaceReducer(initial, { type: "SELECT_ENTRY", sectionKey: "human-deliver", entryId: "entry-1", personId: "person-1" });
    expect(next.selection).toEqual({ kind: "entry", sectionKey: "human-deliver", entryId: "entry-1", personId: "person-1", entryIds: ["entry-1"], anchorId: "entry-1" });
    expect(next.inspectorMode).toBe("edit");
  });

  const ORDER = ["a", "b", "c", "d"];
  const selectRow = (state: WorkspaceState, entryId: string, extend?: "range" | "toggle") =>
    workspaceReducer(state, { type: "SELECT_ENTRY", sectionKey: "human-deliver", entryId, extend, orderedIds: ORDER });

  it("takes every row between the anchor and a shift-clicked one", () => {
    const selected = selectRow(selectRow(initial, "b"), "d", "range");
    expect(selected.selection).toMatchObject({ entryIds: ["b", "c", "d"], entryId: "d", anchorId: "b" });
  });

  it("measures a run of shift-clicks from the first row, not the last one landed on", () => {
    // Otherwise each shift-click would re-anchor and the range would crawl instead of resize.
    const widened = selectRow(selectRow(selectRow(initial, "b"), "d", "range"), "c", "range");
    expect(widened.selection).toMatchObject({ entryIds: ["b", "c"], anchorId: "b" });
  });

  it("selects upwards as readily as downwards", () => {
    const upwards = selectRow(selectRow(initial, "c"), "a", "range");
    expect(upwards.selection).toMatchObject({ entryIds: ["a", "b", "c"] });
  });

  it("adds and removes single rows with a toggling click", () => {
    const added = selectRow(selectRow(initial, "a"), "c", "toggle");
    expect(added.selection).toMatchObject({ entryIds: ["a", "c"] });
    expect(selectRow(added, "a", "toggle").selection).toMatchObject({ entryIds: ["c"] });
  });

  it("keeps the last row selected rather than leaving nothing selected", () => {
    const only = selectRow(initial, "a");
    expect(selectRow(only, "a", "toggle").selection).toMatchObject({ entryIds: ["a"] });
  });

  it("starts a new selection when the shift-click lands in another section", () => {
    // A range across two cards would need an order between the columns that the sheet has not got.
    const first = selectRow(initial, "b");
    const elsewhere = workspaceReducer(first, { type: "SELECT_ENTRY", sectionKey: "cremated-fdp", entryId: "z", extend: "range", orderedIds: ["y", "z"] });
    expect(elsewhere.selection).toMatchObject({ sectionKey: "cremated-fdp", entryIds: ["z"] });
  });

  it("clamps manual zoom and can return to fit mode", () => {
    // Actual size and above are the useful settings when checking small print, so 1.5 is kept
    // rather than clipped; only the 0.5–2 bounds bite.
    const zoomed = workspaceReducer(initial, { type: "SET_ZOOM", zoom: 1.5 });
    expect(zoomed).toMatchObject({ zoomMode: "manual", zoom: 1.5 });
    expect(workspaceReducer(initial, { type: "SET_ZOOM", zoom: 4 }).zoom).toBe(2);
    expect(workspaceReducer(initial, { type: "SET_ZOOM", zoom: 0.1 }).zoom).toBe(0.5);
    // Repeated 0.05 steps otherwise drift into 0.7500000000000001 and print as 75.00000000000001%.
    expect(workspaceReducer(initial, { type: "SET_ZOOM", zoom: 0.1 + 0.65 }).zoom).toBe(0.75);
    expect(workspaceReducer(zoomed, { type: "FIT_ZOOM" }).zoomMode).toBe("fit");
  });
});
