import { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import type { ReactNode } from "react";

import type { SectionKey } from "@/domain/types";

export type InspectorMode = "browse" | "create" | "edit" | "paste";
export type UtilityKey = "directory" | "recovery" | "print" | null;
export type WorkspaceSelection =
  | { kind: "section"; sectionKey: SectionKey }
  /**
   * `entryId` is the row the inspector is pointed at and `entryIds` is everything selected, which
   * is usually just that one. `anchorId` is where a shift-click measures its range from, so a run
   * of them all extend from the row first clicked rather than from the last one landed on.
   */
  | { kind: "entry"; sectionKey: SectionKey; entryId: string; personId?: string; entryIds: string[]; anchorId: string };

export interface WorkspacePreferences {
  inspectorOpen: boolean;
  zoomMode: "fit" | "manual";
  zoom: number;
}

export interface WorkspaceState extends WorkspacePreferences {
  selection: WorkspaceSelection;
  inspectorMode: InspectorMode;
  utility: UtilityKey;
}

export type WorkspaceAction =
  | { type: "SELECT_SECTION"; sectionKey: SectionKey; mode?: InspectorMode }
  /**
   * `extend` is the modifier the click carried: "range" for shift, adding every row between the
   * anchor and this one, "toggle" for ctrl, adding or removing this row alone. `orderedIds` is the
   * section's rows in the order they are drawn, which is what a range is measured along.
   */
  | { type: "SELECT_ENTRY"; sectionKey: SectionKey; entryId: string; personId?: string; extend?: "range" | "toggle"; orderedIds?: string[] }
  | { type: "SET_INSPECTOR_MODE"; mode: InspectorMode }
  | { type: "SET_INSPECTOR_OPEN"; open: boolean }
  | { type: "SET_UTILITY"; utility: UtilityKey }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "FIT_ZOOM" };

/**
 * Manual zoom range. The old ceiling of 0.95 stopped just short of actual size, which is the one
 * setting worth having when checking a 7.5pt location code against the paper.
 */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));

const PREFERENCES_KEY = "night-shift-workspace-v1";

function readPreferences(): WorkspacePreferences {
  const fallback: WorkspacePreferences = { inspectorOpen: true, zoomMode: "fit", zoom: 0.72 };
  try {
    const stored = window.localStorage.getItem(PREFERENCES_KEY);
    if (!stored) return fallback;
    const value = JSON.parse(stored) as Partial<WorkspacePreferences>;
    return {
      inspectorOpen: value.inspectorOpen ?? fallback.inspectorOpen,
      zoomMode: value.zoomMode === "manual" ? "manual" : "fit",
      zoom: typeof value.zoom === "number" ? clampZoom(value.zoom) : fallback.zoom,
    };
  } catch {
    return fallback;
  }
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "SELECT_SECTION":
      return {
        ...state,
        selection: { kind: "section", sectionKey: action.sectionKey },
        inspectorMode: action.mode ?? "create",
        inspectorOpen: true,
      };
    case "SELECT_ENTRY": {
      const previous = state.selection;
      // Extending only means anything within one section: a range that crossed cards would have to
      // invent an order between two columns that the sheet does not have.
      const continuing = previous.kind === "entry" && previous.sectionKey === action.sectionKey ? previous : null;
      let entryIds = [action.entryId];
      let anchorId = action.entryId;
      if (continuing && action.extend === "toggle") {
        entryIds = continuing.entryIds.includes(action.entryId)
          ? continuing.entryIds.filter((id) => id !== action.entryId)
          : [...continuing.entryIds, action.entryId];
        // Ctrl-clicking the last selected row leaves it selected rather than nothing: the inspector
        // is pointed at a row either way, and an empty selection has no meaning here.
        if (!entryIds.length) entryIds = [action.entryId];
        anchorId = action.entryId;
      } else if (continuing && action.extend === "range" && action.orderedIds) {
        const from = action.orderedIds.indexOf(continuing.anchorId);
        const to = action.orderedIds.indexOf(action.entryId);
        if (from >= 0 && to >= 0) {
          entryIds = action.orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1);
          anchorId = continuing.anchorId;
        }
      }
      return {
        ...state,
        selection: { kind: "entry", sectionKey: action.sectionKey, entryId: action.entryId, personId: action.personId, entryIds, anchorId },
        inspectorMode: "edit",
        inspectorOpen: true,
      };
    }
    case "SET_INSPECTOR_MODE":
      return { ...state, inspectorMode: action.mode, inspectorOpen: true };
    case "SET_INSPECTOR_OPEN":
      return { ...state, inspectorOpen: action.open };
    case "SET_UTILITY":
      return { ...state, utility: action.utility };
    case "SET_ZOOM":
      return { ...state, zoomMode: "manual", zoom: clampZoom(action.zoom) };
    case "FIT_ZOOM":
      return { ...state, zoomMode: "fit" };
    default:
      return state;
  }
}

const WorkspaceStateContext = createContext<WorkspaceState | null>(null);
const WorkspaceDispatchContext = createContext<React.Dispatch<WorkspaceAction> | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const preferences = useMemo(() => readPreferences(), []);
  const [state, dispatch] = useReducer(workspaceReducer, {
    ...preferences,
    selection: { kind: "section", sectionKey: "human-deliver" },
    inspectorMode: "create",
    utility: null,
  });

  useEffect(() => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
      inspectorOpen: state.inspectorOpen,
      zoomMode: state.zoomMode,
      zoom: state.zoom,
    } satisfies WorkspacePreferences));
  }, [state.inspectorOpen, state.zoomMode, state.zoom]);

  return (
    <WorkspaceStateContext.Provider value={state}>
      <WorkspaceDispatchContext.Provider value={dispatch}>{children}</WorkspaceDispatchContext.Provider>
    </WorkspaceStateContext.Provider>
  );
}

export function useWorkspaceState() {
  const state = useContext(WorkspaceStateContext);
  if (!state) throw new Error("useWorkspaceState must be used within WorkspaceProvider");
  return state;
}

export function useWorkspaceDispatch() {
  const dispatch = useContext(WorkspaceDispatchContext);
  if (!dispatch) throw new Error("useWorkspaceDispatch must be used within WorkspaceProvider");
  return dispatch;
}
