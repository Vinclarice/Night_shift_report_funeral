import { useRef } from "react";
import type { FormEvent } from "react";

import type { EntryFormState, EntryKind, TextField } from "../hooks/useEntryForm";
import type { FuneralHomeOption } from "@/shared/contracts";
import { IconCheck, IconPlus } from "../icons";

const FORMAT_OPTIONS: Array<{ value: EntryKind; label: string }> = [
  { value: "funeral", label: "Funeral" },
  { value: "funeralHomeOnly", label: "FH only" },
  { value: "count", label: "Count" },
  { value: "combined", label: "Combined" },
  { value: "plain", label: "Plain" },
];

interface Props {
  form: EntryFormState;
  activeSectionTitle: string;
  isDeliver: boolean;
  funeralHomes: FuneralHomeOption[];
  setField: (field: TextField, value: string) => void;
  setCount: (value: number) => void;
  setRush: (value: boolean) => void;
  setKeepSeparate: (value: boolean) => void;
  setEntryKind: (value: EntryKind) => void;
  reset: (entryKind?: EntryKind) => void;
  onSubmit: (event: FormEvent) => void;
}

export function EntryForm({ form, activeSectionTitle, isDeliver, funeralHomes, setField, setCount, setRush, setKeepSeparate, setEntryKind, reset, onSubmit }: Props) {
  const primaryFieldRef = useRef<HTMLInputElement>(null);
  const isFuneralKind = form.entryKind === "funeral" || form.entryKind === "funeralHomeOnly";

  function handleSubmit(event: FormEvent) {
    onSubmit(event);
    // Keep focus in the form after adding an entry so a fast typist doesn't need to reach for
    // the mouse between entries. Harmless if the submit instead failed validation — the message
    // bar reports the error and the fields stay populated, this just also keeps the cursor handy.
    requestAnimationFrame(() => primaryFieldRef.current?.focus());
  }

  return (
    <form className="entry-form panel-section" onSubmit={handleSubmit} noValidate>
      <div className="section-heading sticky-section-heading">
        <div>
          <p className="eyebrow">{form.editing ? "Editing" : "Add entry"}</p>
          <h2>{activeSectionTitle}</h2>
        </div>
        {form.editing && <button type="button" className="text-button" onClick={() => reset()}>Cancel</button>}
      </div>
      <p className="format-label">Format</p>
      <div className="format-toggle" role="group" aria-label="Format">
        {FORMAT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={form.entryKind === option.value}
            onClick={() => setEntryKind(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="dynamic-fields" key={form.entryKind}>
        {isFuneralKind && (
          <>
            <label>
              Funeral home
              <input ref={primaryFieldRef} list="funeral-home-options" value={form.funeralHome} onChange={(event) => setField("funeralHome", event.target.value)} placeholder="Start typing…" />
            </label>
            <datalist id="funeral-home-options">{funeralHomes.map((home) => <option key={home.id} value={home.name} />)}</datalist>
          </>
        )}
        {form.entryKind === "funeral" && (
          <div className="two-field">
            <label>Deceased<input value={form.deceasedName} onChange={(event) => setField("deceasedName", event.target.value)} /></label>
            <label>Location / code<input value={form.locationCode} onChange={(event) => setField("locationCode", event.target.value)} placeholder="13A" /></label>
          </div>
        )}
        {form.entryKind === "funeral" && (
          <label>Special request<input value={form.specialRequest} onChange={(event) => setField("specialRequest", event.target.value)} placeholder="Optional — prints bold" /></label>
        )}
        {(form.entryKind === "plain" || form.entryKind === "count" || form.entryKind === "combined") && (
          <label>
            {form.entryKind === "combined" ? "Left name" : "Text"}
            <input ref={!isFuneralKind ? primaryFieldRef : undefined} value={form.text} onChange={(event) => setField("text", event.target.value)} />
          </label>
        )}
        {form.entryKind === "combined" && <label>Right name<input value={form.rightText} onChange={(event) => setField("rightText", event.target.value)} /></label>}
        {(form.entryKind === "count" || form.entryKind === "combined") && (
          <label>Count<input type="number" min="1" value={form.count} onChange={(event) => { const parsed = Number(event.target.value); setCount(Number.isFinite(parsed) ? parsed : 0); }} /></label>
        )}
        {isFuneralKind && (
          <div className="check-row">
            {isDeliver && <label><input type="checkbox" checked={form.rush} onChange={(event) => setRush(event.target.checked)} /> Rush — list first</label>}
            <label><input type="checkbox" checked={form.keepSeparate} onChange={(event) => setKeepSeparate(event.target.checked)} /> Keep as separate line</label>
          </div>
        )}
      </div>
      <button className="primary full btn-icon" type="submit">{form.editing ? <IconCheck /> : <IconPlus />}{form.editing ? "Save changes" : "Add to report"}</button>
    </form>
  );
}
