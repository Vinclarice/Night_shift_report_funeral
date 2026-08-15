import { useState } from "react";
import type { FormEvent } from "react";

import { addEntry, normalizeFuneralHome, parsePastedLines, removeEntry, replaceEntryInPlace, sortEntriesForSection, titleCaseName } from "@/domain/entries";
import type { NightReport, ParsedLine, ReportEntry, ReportSection } from "@/domain/types";
import { entrySummary } from "../entrySummary";
import { useEntryForm } from "../hooks/useEntryForm";
import type { EntryFormSeed } from "../hooks/useEntryForm";
import { IconPencil, IconPlus, IconTrash, IconX } from "../icons";
import { useReportController } from "../state/ReportController";
import { useWorkspaceDispatch, useWorkspaceState } from "../state/WorkspaceContext";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { IconButton } from "../ui/IconButton";
import { useToast } from "../ui/Toast";
import { EntryForm } from "./EntryForm";
import { PasteReviewModal } from "./PasteReviewModal";

function baseEntry() {
  return { id: crypto.randomUUID(), rush: false, keepSeparate: false, pinnedBottom: false, createdAt: new Date().toISOString() };
}

function defaultKindFor(section: ReportSection) {
  return section.key === "cremated-deliver" ? "funeralHomeOnly" as const : "funeral" as const;
}

/**
 * Owns the entry form's reducer. The Inspector remounts this with a new `key` whenever the
 * selection changes, which is what re-seeds the form — previously an effect compared the selection
 * against a ref and called reset/loadEntry as a side effect of rendering.
 */
function EntryFormPanel({ report, section, seed }: { report: NightReport; section: ReportSection; seed: EntryFormSeed }) {
  const controller = useReportController();
  const dispatch = useWorkspaceDispatch();
  const toast = useToast();
  const { form, setField, setCount, setRush, setKeepSeparate, setEntryKind, reset } = useEntryForm(seed);
  const isDeliver = section.key === "human-deliver" || section.key === "cremated-deliver";

  function buildEntry(): ReportEntry {
    const base = { ...baseEntry(), rush: form.rush, keepSeparate: form.keepSeparate, pinnedBottom: form.editing?.pinnedBottom ?? false };
    if (form.entryKind === "funeral") {
      if (!form.funeralHome.trim() || !form.deceasedName.trim()) throw new Error("Funeral home and deceased name are required.");
      return { ...base, type: "funeral", funeralHome: controller.canonicalFuneralHome(form.funeralHome), deceased: [{ id: crypto.randomUUID(), name: titleCaseName(form.deceasedName), locationCode: form.locationCode.trim(), specialRequest: form.specialRequest.trim() }] };
    }
    if (form.entryKind === "funeralHomeOnly") {
      if (!form.funeralHome.trim()) throw new Error("Funeral home is required.");
      return { ...base, type: "funeralHomeOnly", funeralHome: controller.canonicalFuneralHome(form.funeralHome) };
    }
    if (form.entryKind === "count") {
      if (!form.text.trim()) throw new Error("Text is required.");
      if (!Number.isFinite(form.count) || form.count < 1) throw new Error("Count must be a positive number.");
      return { ...base, type: "count", text: form.text.trim(), count: Math.round(form.count) };
    }
    if (form.entryKind === "combined") {
      if (!form.text.trim() || !form.rightText.trim()) throw new Error("Left and right text are both required.");
      if (!Number.isFinite(form.count) || form.count < 1) throw new Error("Count must be a positive number.");
      return { ...base, type: "combined", leftText: form.text.trim(), rightText: form.rightText.trim(), count: Math.round(form.count) };
    }
    if (!form.text.trim()) throw new Error("Text is required.");
    return { ...base, type: "plain", text: form.text.trim() };
  }

  /**
   * Applies a submitted edit in place, at the entry's existing position, instead of removing the
   * old entry and adding the new one back (which is what used to bump an edited line to the end of
   * its section — see EntryLine/ReportPage's ordering). For a funeral entry, only the targeted
   * person is touched, so editing one deceased person on a multi-person entry never drops the
   * others the way replacing the whole entry did.
   */
  function applyEdit(target: ReportSection, entry: ReportEntry) {
    if (!form.editing) return;
    const index = target.entries.findIndex((candidate) => candidate.id === form.editing!.entryId);
    const existing = index >= 0 ? target.entries[index] : null;
    if (existing?.type === "funeral" && entry.type === "funeral" && form.editing.personId) {
      const personIndex = existing.deceased.findIndex((person) => person.id === form.editing!.personId);
      const groupingChanged =
        normalizeFuneralHome(existing.funeralHome) !== normalizeFuneralHome(entry.funeralHome) ||
        existing.rush !== entry.rush ||
        existing.keepSeparate !== entry.keepSeparate;
      if (personIndex < 0) {
        addEntry(target, entry);
      } else if (existing.deceased.length > 1 && groupingChanged) {
        // Funeral home, rush, and keep-separate belong to the entry as a whole. When just one
        // person in a merged entry changes one of them, split that person into the appropriate
        // group rather than reassigning every other person alongside them.
        removeEntry(target, existing.id, existing.deceased[personIndex].id);
        addEntry(target, entry);
      } else if (existing.deceased.length === 1) {
        replaceEntryInPlace(target, existing.id, { ...entry, id: existing.id, createdAt: existing.createdAt });
      } else {
        existing.deceased[personIndex] = { ...entry.deceased[0], id: existing.deceased[personIndex].id };
      }
      // Re-sorting after an in-place edit is a no-op unless the edit actually changed which band
      // the entry belongs in (e.g. toggling rush) — every other entry keeps its current array
      // position as the tiebreaker, so this only ever moves the edited entry itself.
      target.entries = sortEntriesForSection(target.key, target.entries);
    } else if (existing) {
      replaceEntryInPlace(target, existing.id, { ...entry, id: existing.id, createdAt: existing.createdAt });
    } else {
      addEntry(target, entry);
    }
  }

  function submitEntry(event: FormEvent) {
    event.preventDefault();
    try {
      const entry = buildEntry();
      const next = structuredClone(report);
      const target = next.sections.find((candidate) => candidate.key === section.key)!;
      if (form.editing) applyEdit(target, entry);
      else addEntry(target, entry);
      void controller.persist(next);
      reset(section.key === "cremated-deliver" ? "funeralHomeOnly" : form.entryKind);
      dispatch({ type: "SELECT_SECTION", sectionKey: section.key, mode: "create" });
    } catch (error) {
      toast.warning((error as Error).message);
    }
  }

  return (
    <EntryForm
      form={form} activeSectionTitle={section.title} isDeliver={isDeliver} funeralHomes={controller.bootstrap?.funeralHomes ?? []}
      setField={setField} setCount={setCount} setRush={setRush} setKeepSeparate={setKeepSeparate} setEntryKind={setEntryKind}
      reset={() => { reset(defaultKindFor(section)); dispatch({ type: "SELECT_SECTION", sectionKey: section.key, mode: "create" }); }}
      onSubmit={submitEntry}
    />
  );
}

export function Inspector({ report }: { report: NightReport }) {
  const controller = useReportController();
  const workspace = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();
  const section = report.sections.find((candidate) => candidate.key === workspace.selection.sectionKey)!;
  const [pasteText, setPasteText] = useState("");
  const [pasteReview, setPasteReview] = useState<Array<ParsedLine & { include: boolean }> | null>(null);

  const selection = workspace.selection;
  const selectedEntry = selection.kind === "entry"
    ? section.entries.find((candidate) => candidate.id === selection.entryId)
    : undefined;
  const formKey = selectedEntry
    ? `entry:${selectedEntry.id}:${selection.kind === "entry" ? selection.personId ?? "" : ""}`
    : `section:${section.key}:${workspace.inspectorMode}`;
  const formSeed: EntryFormSeed = selectedEntry
    ? { kind: "entry", entry: selectedEntry, personId: selection.kind === "entry" ? selection.personId : undefined }
    : { kind: "blank", entryKind: defaultKindFor(section) };

  function deleteEntry(entryId: string, personId?: string) {
    const next = structuredClone(report);
    const target = next.sections.find((candidate) => candidate.key === section.key)!;
    if (!removeEntry(target, entryId, personId)) return;
    void controller.persist(next);
    // A manually widened card was made that way to fit content that may just have been the thing
    // removed — let it re-measure against what's actually left rather than staying stuck at the old
    // width.
    void controller.resetSectionWidth(section.key);
    dispatch({ type: "SELECT_SECTION", sectionKey: section.key, mode: "create" });
  }

  function reviewPaste() {
    setPasteReview(parsePastedLines(pasteText).map((line) => ({ ...line, include: true })));
  }

  function commitPaste() {
    const next = structuredClone(report);
    const target = next.sections.find((candidate) => candidate.key === section.key)!;
    for (const line of pasteReview ?? []) if (line.include) addEntry(target, line.entry);
    void controller.persist(next);
    setPasteReview(null);
    setPasteText("");
    dispatch({ type: "SET_INSPECTOR_MODE", mode: "create" });
  }

  return (
    // data-channel carries the section's category into CSS, which recolours the inspector's rule,
    // eyebrow, format toggle and add button to match the column the entry will land in. Filing an
    // entry under the wrong category is the expensive mistake on this form.
    <aside className={`studio-inspector no-print${workspace.inspectorOpen ? " open" : ""}`} data-channel={section.category} aria-label="Report inspector">
      <header className="inspector-header">
        <div><p className="studio-kicker">{section.category} remains</p><h2>{section.title}</h2><span>{section.entries.length} {section.entries.length === 1 ? "entry" : "entries"}</span></div>
        <IconButton icon={<IconX />} aria-label="Close inspector" title="Close inspector" onClick={() => dispatch({ type: "SET_INSPECTOR_OPEN", open: false })} />
      </header>

      {workspace.inspectorMode === "paste" ? (
        <section className="inspector-block paste-workspace">
          <div className="block-title-row"><div><p className="studio-kicker">Quick paste</p><h3>Review multiple lines</h3></div><Button variant="quiet" onClick={() => dispatch({ type: "SET_INSPECTOR_MODE", mode: "create" })}>Back</Button></div>
          <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="Paste one entry per line…" rows={8} />
          <Button variant="primary" full disabled={!pasteText.trim()} onClick={reviewPaste}>Review paste</Button>
        </section>
      ) : (
        <EntryFormPanel key={formKey} report={report} section={section} seed={formSeed} />
      )}

      <section className="inspector-block entry-browser">
        <div className="block-title-row"><div><p className="studio-kicker">Section queue</p><h3>Current entries</h3></div><Button variant="quiet" icon={<IconPlus />} onClick={() => dispatch({ type: "SET_INSPECTOR_MODE", mode: "paste" })}>Paste</Button></div>
        <h3 className="sr-only">{section.entries.length}</h3>
        {!section.entries.length && <div className="studio-empty"><span>+</span><p>No entries yet — add one above.</p><small>You can also type directly on the page.</small></div>}
        {section.entries.map((entry) => (
          <Card className={`inspector-entry${workspace.selection.kind === "entry" && workspace.selection.entryId === entry.id ? " selected" : ""}`} hoverable key={entry.id}>
            <div className="inspector-entry-title">
              <span>{entry.rush && <Badge tone="danger">Rush</Badge>}{entrySummary(entry)}</span>
              {entry.type !== "funeral" && <div><IconButton icon={<IconPencil />} aria-label="Edit entry" title="Edit" onClick={() => dispatch({ type: "SELECT_ENTRY", sectionKey: section.key, entryId: entry.id })} /><IconButton icon={<IconTrash />} tone="danger" aria-label="Delete entry" title="Delete" onClick={() => deleteEntry(entry.id)} /></div>}
            </div>
            {entry.type === "funeral" && entry.deceased.map((person) => (
              <div className="inspector-person" key={person.id}>
                <span>{person.name}{person.locationCode && ` · ${person.locationCode}`}</span>
                <div><IconButton icon={<IconPencil />} aria-label={`Edit ${person.name}`} title="Edit" onClick={() => dispatch({ type: "SELECT_ENTRY", sectionKey: section.key, entryId: entry.id, personId: person.id })} /><IconButton icon={<IconTrash />} tone="danger" aria-label={`Remove ${person.name}`} title="Remove" onClick={() => deleteEntry(entry.id, person.id)} /></div>
              </div>
            ))}
          </Card>
        ))}
      </section>

      {pasteReview && <PasteReviewModal lines={pasteReview} onToggle={(index, include) => setPasteReview((current) => current!.map((line, candidate) => candidate === index ? { ...line, include } : line))} onCancel={() => setPasteReview(null)} onConfirm={commitPaste} />}
    </aside>
  );
}
