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
    expect(next.selection).toEqual({ kind: "entry", sectionKey: "human-deliver", entryId: "entry-1", personId: "person-1" });
    expect(next.inspectorMode).toBe("edit");
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
