import { useRef } from "react";
import type { FormEvent } from "react";

import type { EntryFormState, EntryKind, TextField } from "../hooks/useEntryForm";
import { IconCheck, IconPlus } from "../icons";
import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";

const FORMAT_LABELS: Record<EntryKind, string> = {
  funeral: "Funeral",
  funeralHomeOnly: "FH only",
  count: "Count",
  combined: "Combined",
  plain: "Plain",
};

/**
 * Only the formats each column actually uses. Human Remains rows name a funeral home and a
 * deceased person, or are free text; Cremated rows are a funeral home on its own, a count, or two
 * homes combined. Offering all five everywhere meant four of them were wrong on any given section.
 */
export const FORMATS_BY_CATEGORY: Record<"human" | "cremated", EntryKind[]> = {
  human: ["funeral", "plain"],
  cremated: ["funeralHomeOnly", "count", "combined"],
};

export function defaultFormatFor(category: "human" | "cremated"): EntryKind {
  return FORMATS_BY_CATEGORY[category][0];
}

/**
 * The formats to show for a section, including `current` even when the column does not normally
 * offer it — a cremated section can still hold a plain row typed straight onto the canvas, and
 * hiding its format would leave the toggle with nothing selected while editing it.
 */
export function formatsFor(category: "human" | "cremated", current: EntryKind): EntryKind[] {
  const allowed = FORMATS_BY_CATEGORY[category];
  return allowed.includes(current) ? allowed : [...allowed, current];
}

interface Props {
  form: EntryFormState;
  activeSectionTitle: string;
  category: "human" | "cremated";
  isDeliver: boolean;
  setField: (field: TextField, value: string) => void;
  setCount: (value: number) => void;
  setRush: (value: boolean) => void;
  setKeepSeparate: (value: boolean) => void;
  setEntryKind: (value: EntryKind) => void;
  reset: (entryKind?: EntryKind) => void;
  onSubmit: (event: FormEvent) => void;
}

export function EntryForm({ form, activeSectionTitle, category, isDeliver, setField, setCount, setRush, setKeepSeparate, setEntryKind, reset, onSubmit }: Props) {
  const primaryFieldRef = useRef<HTMLInputElement>(null);
  const isFuneralKind = form.entryKind === "funeral" || form.entryKind === "funeralHomeOnly";
  const formatOptions = formatsFor(category, form.entryKind).map((value) => ({ value, label: FORMAT_LABELS[value] }));

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
      <SegmentedControl label="Format" value={form.entryKind} options={formatOptions} onChange={setEntryKind} />
      <div className="dynamic-fields" key={form.entryKind}>
        {isFuneralKind && (
          <>
            <label>
              Funeral home
              {/* The options themselves are rendered once in Studio, so the canvas can use them too. */}
              <input ref={primaryFieldRef} list="funeral-home-options" value={form.funeralHome} onChange={(event) => setField("funeralHome", event.target.value)} placeholder="Start typing…" />
            </label>
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
        {/* Only once Rush is on: a deadline with no rush behind it has nowhere to print. */}
        {isFuneralKind && isDeliver && form.rush && (
          <label>Needed by<input value={form.rushBy} onChange={(event) => setField("rushBy", event.target.value)} placeholder="by 10:00 AM, or first trip" /></label>
        )}
      </div>
      <Button variant="primary" full type="submit" icon={form.editing ? <IconCheck /> : <IconPlus />}>{form.editing ? "Save changes" : "Add to report"}</Button>
    </form>
  );
}
