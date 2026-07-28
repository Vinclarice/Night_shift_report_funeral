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
  viewingStart: false,
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
    const zoomed = workspaceReducer(initial, { type: "SET_ZOOM", zoom: 1.5 });
    expect(zoomed).toMatchObject({ zoomMode: "manual", zoom: 0.95 });
    expect(workspaceReducer(zoomed, { type: "FIT_ZOOM" }).zoomMode).toBe("fit");
  });

  it("toggles the welcome-screen peek independently of the rest of the workspace", () => {
    const peeking = workspaceReducer(initial, { type: "SET_VIEWING_START", viewing: true });
    expect(peeking.viewingStart).toBe(true);
    expect(workspaceReducer(peeking, { type: "SET_VIEWING_START", viewing: false }).viewingStart).toBe(false);
  });
});
