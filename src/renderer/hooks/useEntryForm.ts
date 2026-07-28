import { useReducer } from "react";

import type { ReportEntry } from "@/domain/types";

export type EntryKind = ReportEntry["type"];
/** `pinnedBottom` rides along so re-saving an edited entry preserves its pinned position. */
export type EditingTarget = { entryId: string; personId?: string; pinnedBottom: boolean } | null;
export type TextField = "funeralHome" | "deceasedName" | "locationCode" | "specialRequest" | "text" | "rightText";

export interface EntryFormState {
  entryKind: EntryKind;
  funeralHome: string;
  deceasedName: string;
  locationCode: string;
  specialRequest: string;
  text: string;
  rightText: string;
  count: number;
  rush: boolean;
  keepSeparate: boolean;
  editing: EditingTarget;
}

function emptyState(entryKind: EntryKind): EntryFormState {
  return {
    entryKind,
    funeralHome: "",
    deceasedName: "",
    locationCode: "",
    specialRequest: "",
    text: "",
    rightText: "",
    count: 1,
    rush: false,
    keepSeparate: false,
    editing: null,
  };
}

type EntryFormAction =
  | { type: "SET_TEXT"; field: TextField; value: string }
  | { type: "SET_COUNT"; value: number }
  | { type: "SET_RUSH"; value: boolean }
  | { type: "SET_KEEP_SEPARATE"; value: boolean }
  | { type: "SET_ENTRY_KIND"; value: EntryKind }
  | { type: "RESET"; entryKind?: EntryKind }
  | { type: "LOAD_ENTRY"; entry: ReportEntry; personId?: string };

export function loadedState(entry: ReportEntry, personId?: string): EntryFormState {
  if (entry.type === "funeral") {
    // Falls back to the first person when nothing more specific was picked (e.g. the operator
    // clicked the printed row itself rather than one person's row in the inspector list). The
    // fallback person's id is what gets tracked as the edit target below — without this, editing.
    // personId stayed undefined even though the form was showing that person's details, so
    // submitting treated the edit as "the whole entry" and wiped every other deceased person on it.
    const person = entry.deceased.find((candidate) => candidate.id === personId) ?? entry.deceased[0];
    const editing: EditingTarget = { entryId: entry.id, personId: person.id, pinnedBottom: entry.pinnedBottom };
    return {
      ...emptyState("funeral"),
      funeralHome: entry.funeralHome,
      deceasedName: person.name,
      locationCode: person.locationCode,
      specialRequest: person.specialRequest,
      rush: entry.rush,
      keepSeparate: entry.keepSeparate,
      editing,
    };
  }
  const editing: EditingTarget = { entryId: entry.id, personId, pinnedBottom: entry.pinnedBottom };
  if (entry.type === "funeralHomeOnly") {
    return { ...emptyState("funeralHomeOnly"), funeralHome: entry.funeralHome, rush: entry.rush, keepSeparate: entry.keepSeparate, editing };
  }
  if (entry.type === "combined") {
    return { ...emptyState("combined"), text: entry.leftText, rightText: entry.rightText, count: entry.count, editing };
  }
  if (entry.type === "count") {
    return { ...emptyState("count"), text: entry.text, count: entry.count, editing };
  }
  return { ...emptyState("plain"), text: entry.text, editing };
}

function entryFormReducer(state: EntryFormState, action: EntryFormAction): EntryFormState {
  switch (action.type) {
    case "SET_TEXT":
      return { ...state, [action.field]: action.value };
    case "SET_COUNT":
      return { ...state, count: action.value };
    case "SET_RUSH":
      return { ...state, rush: action.value };
    case "SET_KEEP_SEPARATE":
      return { ...state, keepSeparate: action.value };
    case "SET_ENTRY_KIND":
      return { ...state, entryKind: action.value };
    case "RESET":
      return emptyState(action.entryKind ?? state.entryKind);
    case "LOAD_ENTRY":
      return loadedState(action.entry, action.personId);
    default:
      return state;
  }
}

/** What the form should contain on first render — either a blank form of a kind, or a loaded entry. */
export type EntryFormSeed =
  | { kind: "blank"; entryKind: EntryKind }
  | { kind: "entry"; entry: ReportEntry; personId?: string };

function seedState(seed: EntryFormSeed): EntryFormState {
  return seed.kind === "entry" ? loadedState(seed.entry, seed.personId) : emptyState(seed.entryKind);
}

/**
 * Backs the guided entry form. Replaces eleven independent useState fields with a single
 * reducer so "what does editing an existing entry populate" and "what does resetting clear"
 * are each one function instead of scattered across every call site.
 *
 * The seed is applied through useReducer's lazy initializer, so the caller re-seeds the form by
 * remounting it with a new `key` rather than by syncing state in an effect.
 */
export function useEntryForm(seed: EntryFormSeed = { kind: "blank", entryKind: "funeral" }) {
  const [form, dispatch] = useReducer(entryFormReducer, seed, seedState);

  return {
    form,
    setField: (field: TextField, value: string) => dispatch({ type: "SET_TEXT", field, value }),
    setCount: (value: number) => dispatch({ type: "SET_COUNT", value }),
    setRush: (value: boolean) => dispatch({ type: "SET_RUSH", value }),
    setKeepSeparate: (value: boolean) => dispatch({ type: "SET_KEEP_SEPARATE", value }),
    setEntryKind: (value: EntryKind) => dispatch({ type: "SET_ENTRY_KIND", value }),
    reset: (entryKind?: EntryKind) => dispatch({ type: "RESET", entryKind }),
    loadEntry: (entry: ReportEntry, personId?: string) => dispatch({ type: "LOAD_ENTRY", entry, personId }),
  };
}
