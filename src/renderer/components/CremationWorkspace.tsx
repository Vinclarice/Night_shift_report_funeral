import { useEffect, useMemo, useRef, useState } from "react";

import {
  createCremationBatchRow,
  DEFAULT_CREMATION_PRINT_PREFERENCE,
  deriveCremationDisplayName,
  isCremationRowBlank,
  isCremationRowComplete,
  nextCremationNumber,
} from "@/domain/cremation";
import type {
  CremationBatchRow,
  CremationDocumentKind,
  CremationFuneralHome,
  CremationPrintPreference,
  CremationPrintState,
} from "@/domain/cremation";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { CremationCertificatePage, CremationEnvelopePage, CremationPrintPages } from "./CremationPages";
import { WindowControls } from "./TitleBar";
import { WorkspaceTabs } from "./WorkspaceTabs";
import type { WorkspaceMode } from "./WorkspaceTabs";

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function stale(status: CremationPrintState): CremationPrintState {
  return status === "printed" ? "stale" : status;
}

function statusLabel(status: CremationPrintState) {
  if (status === "printed") return "Printed";
  if (status === "stale") return "Needs reprint";
  return "Not printed";
}

function statusTone(status: CremationPrintState): "neutral" | "success" | "warning" {
  return status === "printed" ? "success" : status === "stale" ? "warning" : "neutral";
}

function yieldForPrintLayout() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

interface ConfirmState {
  title: string;
  message: string;
  label: string;
  danger?: boolean;
  action: () => void | Promise<void>;
}

export function CremationWorkspace({ onBack, onNavigate = () => {} }: { onBack: () => void; onNavigate?: (mode: WorkspaceMode) => void }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(todayLocal);
  const [rows, setRows] = useState<CremationBatchRow[]>([createCremationBatchRow()]);
  const [savedFinalNumber, setSavedFinalNumber] = useState<string | null>(null);
  const [funeralHomes, setFuneralHomes] = useState<CremationFuneralHome[]>([]);
  const [directoryDraft, setDirectoryDraft] = useState({ id: "", name: "", location: "" });
  const [preferences, setPreferences] = useState<Record<CremationDocumentKind, CremationPrintPreference>>({
    certificate: { ...DEFAULT_CREMATION_PRINT_PREFERENCE },
    envelope: { ...DEFAULT_CREMATION_PRINT_PREFERENCE },
  });
  const [setupKind, setSetupKind] = useState<CremationDocumentKind>("certificate");
  const [previewKind, setPreviewKind] = useState<CremationDocumentKind>("certificate");
  const [printKind, setPrintKind] = useState<CremationDocumentKind | "label">("certificate");
  const [sidebarTab, setSidebarTab] = useState<"preview" | "printer" | "directory">("preview");
  const [labelReadiness, setLabelReadiness] = useState({ ready: false, bpacInstalled: false, driverInstalled: false, templateAvailable: false, message: "Checking Brother label printer…" });
  const [activePrint, setActivePrint] = useState<{ kind: CremationDocumentKind; rows: CremationBatchRow[] } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    let active = true;
    void window.nightShift.loadCremationWorkspace().then((data) => {
      if (!active) return;
      const firstNumber = data.savedFinalNumber ? nextCremationNumber(data.savedFinalNumber) ?? "" : "";
      setRows([createCremationBatchRow(firstNumber)]);
      setSavedFinalNumber(data.savedFinalNumber);
      setFuneralHomes(data.funeralHomes);
      setPreferences(data.printPreferences);
      setLabelReadiness(data.labelReadiness);
      setLoading(false);
      void window.nightShift.checkCremationLabelReadiness().then((readiness) => {
        if (active) setLabelReadiness(readiness);
      }).catch(() => {
        if (active) setLabelReadiness({ ready: false, bpacInstalled: false, driverInstalled: false, templateAvailable: false, message: "Label readiness could not be checked. Certificates and envelopes are still available." });
      });
    }).catch((error: Error) => {
      if (!active) return;
      setLoading(false);
      toast.error(error.message);
    });
    return () => { active = false; };
  }, [toast]);

  const completeRows = useMemo(() => rows.filter(isCremationRowComplete), [rows]);
  const selectedRows = useMemo(() => completeRows.filter((row) => row.selected), [completeRows]);
  const invalidRows = useMemo(() => rows.filter((row, index) => !(index === rows.length - 1 && isCremationRowBlank(row)) && !isCremationRowComplete(row)), [rows]);
  const finalCompleteNumber = completeRows.at(-1)?.number ?? null;
  const hasUnsavedSequence = Boolean(finalCompleteNumber && finalCompleteNumber !== savedFinalNumber);
  const previewRow = selectedRows[0] ?? completeRows[0] ?? rows[0];

  function matchingFuneralHome(value: string) {
    const clean = value.trim();
    if (!clean) return undefined;
    return funeralHomes.find((home) => home.name.localeCompare(clean, undefined, { sensitivity: "base" }) === 0);
  }

  function unselectWhenAllOutputsPrinted(row: CremationBatchRow) {
    return row.certificateStatus === "printed" && row.envelopeStatus === "printed" && row.labelStatus === "printed"
      ? { ...row, selected: false }
      : row;
  }

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedSequence) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedSequence]);

  function updateRow(id: string, field: "number" | "fullName" | "displayName" | "funeralHome" | "location", value: string) {
    setRows((current) => {
      const index = current.findIndex((row) => row.id === id);
      if (index < 0) return current;
      const next = current.map((row) => ({ ...row }));
      const row = next[index];
      if (field === "number") {
        row.number = value;
        row.certificateStatus = stale(row.certificateStatus);
        let following = nextCremationNumber(value);
        for (let cursor = index + 1; cursor < next.length; cursor += 1) {
          next[cursor].number = following ?? "";
          next[cursor].certificateStatus = stale(next[cursor].certificateStatus);
          following = following ? nextCremationNumber(following) : null;
        }
      } else if (field === "fullName") {
        row.fullName = value;
        row.certificateStatus = stale(row.certificateStatus);
        if (!row.displayNameManuallyEdited) {
          row.displayName = deriveCremationDisplayName(value);
          row.envelopeStatus = stale(row.envelopeStatus);
          row.labelStatus = stale(row.labelStatus);
        }
      } else if (field === "displayName") {
        row.displayName = value;
        row.displayNameManuallyEdited = true;
        row.envelopeStatus = stale(row.envelopeStatus);
        row.labelStatus = stale(row.labelStatus);
      } else if (field === "funeralHome") {
        const previousMatch = matchingFuneralHome(row.funeralHome);
        const nextMatch = matchingFuneralHome(value);
        row.funeralHome = nextMatch?.name ?? value;
        if (nextMatch) row.location = nextMatch.location;
        else if (previousMatch && row.location === previousMatch.location) row.location = "";
        row.envelopeStatus = stale(row.envelopeStatus);
      } else {
        row[field] = value;
        row.envelopeStatus = stale(row.envelopeStatus);
      }
      return next;
    });
  }

  function chooseFuneralHome(id: string) {
    setRows((current) => current.map((row) => {
      if (row.id !== id) return row;
      const match = matchingFuneralHome(row.funeralHome);
      return match ? { ...row, funeralHome: match.name, location: match.location, envelopeStatus: stale(row.envelopeStatus) } : row;
    }));
  }

  function handleRowEnter(row: CremationBatchRow, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !isCremationRowComplete(row)) return;
    event.preventDefault();
    const index = rows.findIndex((candidate) => candidate.id === row.id);
    if (index === rows.length - 1) {
      const next = createCremationBatchRow(nextCremationNumber(row.number) ?? "");
      setRows((current) => [...current, next]);
      requestAnimationFrame(() => nameInputs.current.get(next.id)?.focus());
    } else {
      nameInputs.current.get(rows[index + 1].id)?.focus();
    }
  }

  function validateBatch(requireDisplayName = false) {
    if (invalidRows.length) {
      toast.error(`${invalidRows.length} row${invalidRows.length === 1 ? " is" : "s are"} incomplete. Each used row needs a valid number, full name, and funeral home.`);
      return false;
    }
    if (!selectedRows.length) {
      toast.warning("Select at least one complete cremation row.");
      return false;
    }
    if (requireDisplayName && selectedRows.some((row) => !row.displayName.trim())) {
      toast.error("Every selected envelope or label needs a first-and-last display name.");
      return false;
    }
    return true;
  }

  async function printDocuments(kind: CremationDocumentKind) {
    if (!validateBatch(kind === "envelope")) return;
    setBusy(true);
    setActivePrint({ kind, rows: selectedRows.map((row) => ({ ...row })) });
    document.body.dataset.printTarget = `cremation-${kind}`;
    try {
      await yieldForPrintLayout();
      const result = await window.nightShift.printCremationDocument(kind);
      if (!result.success) {
        toast.error(result.failureReason || `The ${kind} print job was canceled or failed.`);
        return;
      }
      const ids = new Set(selectedRows.map((row) => row.id));
      const key = kind === "certificate" ? "certificateStatus" : "envelopeStatus";
      setRows((current) => current.map((row) => ids.has(row.id) ? unselectWhenAllOutputsPrinted({ ...row, [key]: "printed" }) : row));
      toast.success(`${selectedRows.length} ${kind}${selectedRows.length === 1 ? "" : "s"} sent to the printer. You can print the remaining items for the same selected rows next.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `The ${kind} print job failed.`);
    } finally {
      delete document.body.dataset.printTarget;
      setActivePrint(null);
      setBusy(false);
    }
  }

  async function printLabels() {
    if (!validateBatch(true)) return;
    setBusy(true);
    try {
      const result = await window.nightShift.printCremationLabels(selectedRows.map((row) => ({ id: row.id, displayName: row.displayName })));
      const printed = new Set(result.printedIds);
      setRows((current) => current.map((row) => printed.has(row.id) ? unselectWhenAllOutputsPrinted({ ...row, labelStatus: "printed" }) : row));
      if (result.failureReason) toast.error(`${result.printedIds.length} label${result.printedIds.length === 1 ? " was" : "s were"} accepted. ${result.failureReason}`);
      else toast.success(`${result.printedIds.length} label${result.printedIds.length === 1 ? "" : "s"} printed and cut.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Label printing failed.");
    } finally { setBusy(false); }
  }

  function requestSaveFinal() {
    if (invalidRows.length) {
      toast.error("Finish or clear incomplete rows before saving the final cremation number.");
      return;
    }
    if (!finalCompleteNumber) {
      toast.warning("There is no complete cremation row to save yet.");
      return;
    }
    setConfirm({
      title: "Save final cremation number?",
      message: `${finalCompleteNumber} will become the starting point for the next batch. The current rows will stay visible for reprints.`,
      label: "Save final number",
      action: async () => {
        setBusy(true);
        try {
          const saved = await window.nightShift.saveCremationFinalNumber(finalCompleteNumber);
          setSavedFinalNumber(saved);
          setConfirm(null);
          toast.success(`Saved ${saved} as the final cremation number.`);
        } catch (error) { toast.error(error instanceof Error ? error.message : "The number could not be saved."); }
        finally { setBusy(false); }
      },
    });
  }

  function clearBatch() {
    const reset = () => {
      const number = savedFinalNumber ? nextCremationNumber(savedFinalNumber) ?? "" : "";
      setRows([createCremationBatchRow(number)]);
      setDate(todayLocal());
      setConfirm(null);
    };
    if (!hasUnsavedSequence) return reset();
    setConfirm({ title: "Clear this unsaved batch?", message: "The final cremation number has not been saved. Clearing now will discard the batch rows and names.", label: "Clear batch", danger: true, action: reset });
  }

  function navigateWorkspace(mode: WorkspaceMode) {
    if (mode === "cremation") return;
    const navigate = () => mode === "report" ? onBack() : onNavigate(mode);
    if (!hasUnsavedSequence) return navigate();
    setConfirm({
      title: "Leave without saving the final number?",
      message: "The cremation sequence has advanced beyond the saved number. Names and batch rows are never stored and will be lost when you leave.",
      label: mode === "firstCall" ? "Open First Call" : "Leave workspace",
      danger: true,
      action: navigate,
    });
  }

  function addRow() {
    const last = rows.at(-1);
    if (last && isCremationRowBlank(last)) return nameInputs.current.get(last.id)?.focus();
    const next = createCremationBatchRow(last ? nextCremationNumber(last.number) ?? "" : "");
    setRows((current) => [...current, next]);
    requestAnimationFrame(() => nameInputs.current.get(next.id)?.focus());
  }

  function printSelected() {
    if (printKind === "label") return void printLabels();
    return void printDocuments(printKind);
  }

  async function saveDirectory() {
    if (!directoryDraft.name.trim()) return toast.warning("Enter a funeral home name first.");
    setBusy(true);
    try {
      const saved = await window.nightShift.saveCremationFuneralHome({ id: directoryDraft.id || undefined, name: directoryDraft.name, location: directoryDraft.location });
      setFuneralHomes(saved);
      setDirectoryDraft({ id: "", name: "", location: "" });
      toast.success("Cremation funeral-home directory updated.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "The funeral home could not be saved."); }
    finally { setBusy(false); }
  }

  async function deleteDirectory(id: string) {
    setBusy(true);
    try {
      setFuneralHomes(await window.nightShift.deleteCremationFuneralHome(id));
      if (directoryDraft.id === id) setDirectoryDraft({ id: "", name: "", location: "" });
      toast.success("Directory record deleted. Current batch rows were not changed.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "The directory record could not be deleted."); }
    finally { setBusy(false); }
  }

  async function savePreference(kind: CremationDocumentKind) {
    try {
      const saved = await window.nightShift.saveCremationPrintPreference(kind, preferences[kind]);
      setPreferences((current) => ({ ...current, [kind]: saved }));
      toast.success(`${kind === "certificate" ? "Certificate" : "Envelope"} calibration saved.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Calibration could not be saved."); }
  }

  async function refreshLabels() {
    setBusy(true);
    try { setLabelReadiness(await window.nightShift.checkCremationLabelReadiness()); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Label readiness could not be checked."); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="loading-screen"><div className="loading-card"><span className="spinner" /><div><strong>Opening Cremation Batch</strong><small>Checking numbering and print setup…</small></div></div></main>;

  const pref = preferences[setupKind];
  return (
    <main className="cremation-shell">
      <header className="cremation-commandbar no-print">
        <div className="command-report-meta"><div><p>Cremation Batch</p><strong>{completeRows.length} complete · {selectedRows.length} selected</strong></div></div>
        <WorkspaceTabs active="cremation" onNavigate={navigateWorkspace} />
        <div className="command-drag-region" />
        <div className="cremation-header-actions">
          <Button variant="quiet" onClick={clearBatch}>Clear batch</Button>
          <Button variant="secondary" onClick={requestSaveFinal}>Save final number</Button>
          <WindowControls />
        </div>
      </header>

      <div className="cremation-workspace no-print">
        <section className="cremation-main-panel">
          <div className="cremation-batch-toolbar">
            <label>Certificate date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setRows((current) => current.map((row) => ({ ...row, certificateStatus: stale(row.certificateStatus) }))); }} /></label>
            <div className="cremation-sequence-note"><small>Last saved number</small><strong>{savedFinalNumber ?? "Not set — enter the first number manually"}</strong></div>
            <div className="cremation-print-actions">
              <div className="cremation-output-picker" role="group" aria-label="Print output">
                {(["certificate", "envelope", "label"] as const).map((kind) => <button
                  key={kind}
                  type="button"
                  className={printKind === kind ? "active" : ""}
                  aria-pressed={printKind === kind}
                  onClick={() => {
                    setPrintKind(kind);
                    if (kind !== "label") { setSetupKind(kind); setPreviewKind(kind); }
                  }}
                >{kind === "certificate" ? "Certificates" : kind === "envelope" ? "Envelopes" : "Labels"}</button>)}
              </div>
              <Button variant="print" busy={busy} disabled={printKind === "label" && !labelReadiness.ready} title={printKind === "label" ? labelReadiness.message : undefined} onClick={printSelected}>Print selected</Button>
            </div>
          </div>

          <div className="cremation-table-wrap">
            <table className="cremation-table">
              <thead><tr><th><input type="checkbox" aria-label="Select all complete rows" checked={completeRows.length > 0 && selectedRows.length === completeRows.length} onChange={(event) => setRows((current) => current.map((row) => isCremationRowComplete(row) ? { ...row, selected: event.target.checked } : row))} /></th><th>#</th><th>Full name</th><th>Envelope & label name</th><th>Funeral home</th><th>City / State</th><th>Outputs</th></tr></thead>
              <tbody>{rows.map((row, index) => <tr key={row.id} className={!isCremationRowBlank(row) && !isCremationRowComplete(row) ? "incomplete" : ""}>
                <td><input type="checkbox" aria-label={`Select row ${index + 1}`} checked={row.selected} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, selected: event.target.checked } : item))} /></td>
                <td><input className="cremation-number-input" aria-label={`Cremation number ${index + 1}`} placeholder="6-063-01" value={row.number} onChange={(event) => updateRow(row.id, "number", event.target.value)} onKeyDown={(event) => handleRowEnter(row, event)} /></td>
                <td><input ref={(element) => { if (element) nameInputs.current.set(row.id, element); else nameInputs.current.delete(row.id); }} aria-label={`Full name ${index + 1}`} placeholder="First Middle Last" value={row.fullName} onChange={(event) => updateRow(row.id, "fullName", event.target.value)} onKeyDown={(event) => handleRowEnter(row, event)} /></td>
                <td><input aria-label={`Display name ${index + 1}`} placeholder="First Last" value={row.displayName} onChange={(event) => updateRow(row.id, "displayName", event.target.value)} onKeyDown={(event) => handleRowEnter(row, event)} /></td>
                <td><input list="cremation-funeral-homes" aria-label={`Funeral home ${index + 1}`} value={row.funeralHome} onChange={(event) => updateRow(row.id, "funeralHome", event.target.value)} onBlur={() => chooseFuneralHome(row.id)} onKeyDown={(event) => handleRowEnter(row, event)} /></td>
                <td><input aria-label={`City and state ${index + 1}`} placeholder="Optional" value={row.location} onChange={(event) => updateRow(row.id, "location", event.target.value)} onKeyDown={(event) => handleRowEnter(row, event)} /></td>
                <td className="cremation-output-statuses">
                  <Badge tone={statusTone(row.certificateStatus)}><b>C</b><span>{statusLabel(row.certificateStatus)}</span></Badge>
                  <Badge tone={statusTone(row.envelopeStatus)}><b>E</b><span>{statusLabel(row.envelopeStatus)}</span></Badge>
                  <Badge tone={statusTone(row.labelStatus)}><b>L</b><span>{statusLabel(row.labelStatus)}</span></Badge>
                </td>
              </tr>)}</tbody>
            </table>
            <datalist id="cremation-funeral-homes">{funeralHomes.map((home) => <option key={home.id} value={home.name}>{home.location}</option>)}</datalist>
          </div>
          <div className="cremation-table-footer"><Button variant="quiet" onClick={addRow}>+ Add cremation</Button><span>Press Enter on a complete row to continue with the next number.</span></div>
        </section>

        <aside className="cremation-sidebar">
          <nav className="cremation-sidebar-tabs" role="tablist" aria-label="Cremation tools">
            <button role="tab" aria-selected={sidebarTab === "preview"} className={sidebarTab === "preview" ? "active" : ""} onClick={() => setSidebarTab("preview")}>Preview</button>
            <button role="tab" aria-selected={sidebarTab === "printer"} className={sidebarTab === "printer" ? "active" : ""} onClick={() => setSidebarTab("printer")}>Printer</button>
            <button role="tab" aria-selected={sidebarTab === "directory"} className={sidebarTab === "directory" ? "active" : ""} onClick={() => setSidebarTab("directory")}>Funeral homes</button>
          </nav>
          <section hidden={sidebarTab !== "preview"}>
            <div className="cremation-section-heading"><div><strong>Print preview & calibration</strong><small>A5 certificate and C5 envelope are calibrated separately.</small></div></div>
            <div className="cremation-tabs"><button className={setupKind === "certificate" ? "active" : ""} onClick={() => { setSetupKind("certificate"); setPreviewKind("certificate"); }}>Certificate</button><button className={setupKind === "envelope" ? "active" : ""} onClick={() => { setSetupKind("envelope"); setPreviewKind("envelope"); }}>Envelope</button></div>
            <div className="cremation-preview"><div className={`cremation-preview-scale ${previewKind}`}>{previewKind === "certificate" ? <CremationCertificatePage row={previewRow} date={date} preference={preferences.certificate} /> : <CremationEnvelopePage row={previewRow} preference={preferences.envelope} />}</div></div>
            <div className="cremation-calibration">
              {(["scale", "offsetXInches", "offsetYInches"] as const).map((field) => <label key={field}>{field === "scale" ? "Scale" : field === "offsetXInches" ? "Move left / right (inches)" : "Move up / down (inches)"}<input type="number" min={field === "scale" ? .9 : -.5} max={field === "scale" ? 1.1 : .5} step={field === "scale" ? .005 : .01} value={pref[field]} onChange={(event) => setPreferences((current) => ({ ...current, [setupKind]: { ...current[setupKind], [field]: Number(event.target.value) } }))} /></label>)}
              <div><Button variant="secondary" onClick={() => void savePreference(setupKind)}>Save calibration</Button><Button variant="quiet" onClick={() => setPreferences((current) => ({ ...current, [setupKind]: { ...DEFAULT_CREMATION_PRINT_PREFERENCE } }))}>Reset</Button></div>
            </div>
          </section>

          <section hidden={sidebarTab !== "printer"}>
            <div className="cremation-section-heading"><div><strong>Brother label printer</strong><small>{labelReadiness.message}</small></div><Badge tone={labelReadiness.ready ? "success" : "warning"}>{labelReadiness.ready ? "Ready" : "Setup needed"}</Badge></div>
            <div className="cremation-readiness"><span className={labelReadiness.bpacInstalled ? "ready" : ""}>b-PAC</span><span className={labelReadiness.driverInstalled ? "ready" : ""}>PT-D610BT</span><span className={labelReadiness.templateAvailable ? "ready" : ""}>12 mm template</span></div>
            <Button variant="quiet" busy={busy} onClick={() => void refreshLabels()}>Check again</Button>
          </section>

          <section hidden={sidebarTab !== "directory"}>
            <div className="cremation-section-heading"><div><strong>Cremation funeral homes</strong><small>Saving this directory is explicit. Batch names are never stored.</small></div></div>
            <label>Name<input value={directoryDraft.name} onChange={(event) => setDirectoryDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>City / State<input value={directoryDraft.location} onChange={(event) => setDirectoryDraft((current) => ({ ...current, location: event.target.value }))} /></label>
            <div className="cremation-directory-actions"><Button variant="secondary" busy={busy} onClick={() => void saveDirectory()}>{directoryDraft.id ? "Update record" : "Save record"}</Button>{directoryDraft.id && <Button variant="quiet" onClick={() => setDirectoryDraft({ id: "", name: "", location: "" })}>Cancel</Button>}</div>
            <div className="cremation-directory-list">{funeralHomes.map((home) => <div key={home.id}><button onClick={() => setDirectoryDraft(home)}><strong>{home.name}</strong><small>{home.location || "No city/state"}</small></button><button className="cremation-delete-record" aria-label={`Delete ${home.name}`} onClick={() => void deleteDirectory(home.id)}>×</button></div>)}</div>
          </section>
        </aside>
      </div>

      <div className="cremation-print-only" aria-hidden={!activePrint}>
        {activePrint && <CremationPrintPages kind={activePrint.kind} rows={activePrint.rows} date={date} preference={preferences[activePrint.kind]} />}
      </div>
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel={confirm.label} danger={confirm.danger} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void confirm.action()} />}
    </main>
  );
}
