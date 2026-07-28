import { useState } from "react";
import type { FormEvent } from "react";

import { addEntry, parsePastedLines, titleCaseName } from "@/domain/entries";
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

  function removeEditingTarget(next: NightReport) {
    if (!form.editing) return;
    for (const candidate of next.sections) {
      const index = candidate.entries.findIndex((entry) => entry.id === form.editing!.entryId);
      if (index < 0) continue;
      const entry = candidate.entries[index];
      if (entry.type === "funeral" && form.editing.personId) {
        entry.deceased = entry.deceased.filter((person) => person.id !== form.editing!.personId);
        if (!entry.deceased.length) candidate.entries.splice(index, 1);
      } else candidate.entries.splice(index, 1);
    }
  }

  function submitEntry(event: FormEvent) {
    event.preventDefault();
    try {
      const entry = buildEntry();
      const next = structuredClone(report);
      removeEditingTarget(next);
      addEntry(next.sections.find((candidate) => candidate.key === section.key)!, entry);
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
  const readOnly = report.status === "finalized";

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
    const index = target.entries.findIndex((entry) => entry.id === entryId);
    if (index < 0) return;
    const entry = target.entries[index];
    if (entry.type === "funeral" && personId) {
      entry.deceased = entry.deceased.filter((person) => person.id !== personId);
      if (!entry.deceased.length) target.entries.splice(index, 1);
    } else target.entries.splice(index, 1);
    void controller.persist(next);
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
    <aside className={`studio-inspector no-print${workspace.inspectorOpen ? " open" : ""}`} aria-label="Report inspector">
      <header className="inspector-header">
        <div><p className="studio-kicker">{section.category} remains</p><h2>{section.title}</h2><span>{section.entries.length} {section.entries.length === 1 ? "entry" : "entries"}</span></div>
        <IconButton icon={<IconX />} aria-label="Close inspector" title="Close inspector" onClick={() => dispatch({ type: "SET_INSPECTOR_OPEN", open: false })} />
      </header>

      {readOnly ? (
        <div className="inspector-readonly"><Badge tone="success">Finalized</Badge><h3>This report is locked</h3><p>Reopen the report from the command bar to make changes.</p></div>
      ) : (
        <>
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
        </>
      )}

      {pasteReview && <PasteReviewModal lines={pasteReview} onToggle={(index, include) => setPasteReview((current) => current!.map((line, candidate) => candidate === index ? { ...line, include } : line))} onCancel={() => setPasteReview(null)} onConfirm={commitPaste} />}
    </aside>
  );
}
