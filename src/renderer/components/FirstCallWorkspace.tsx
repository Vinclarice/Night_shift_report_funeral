import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, WheelEvent } from "react";

import {
  DEFAULT_FIRST_CALL_PRINT_PREFERENCE,
  createFirstCallDraft,
  deriveDeceasedLastName,
  hasFirstCallContent,
  normalizeFirstCallDirectoryName,
} from "@/domain/firstCall";
import type {
  FirstCallCheckField,
  FirstCallDirectories,
  FirstCallDraft,
  FirstCallHighlight,
  FirstCallHighlightColor,
  FirstCallLookupCandidate,
  FirstCallLookupKind,
  FirstCallPrintPreference,
  FirstCallSearchSettings,
  FirstCallTextField,
} from "@/domain/firstCall";
import { IconArrowLeft, IconBuilding, IconMinus, IconPlus, IconPrinter, IconSearch, IconTrash } from "../icons";
import { useToast } from "../ui/Toast";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { FirstCallPage } from "./FirstCallPage";
import { WindowControls } from "./TitleBar";

const EMPTY_DIRECTORIES: FirstCallDirectories = { funeralHomes: [], facilities: [] };
const DEFAULT_SEARCH_SETTINGS: FirstCallSearchSettings = { provider: "tomtom", configured: false, source: "none" };
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 2;
const HIGHLIGHT_COLORS: FirstCallHighlightColor[] = ["yellow", "green", "blue", "pink", "orange"];

function clampPreviewZoom(value: number) {
  return Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, Math.round(value * 20) / 20));
}

function sameName(left: string, right: string) {
  return normalizeFirstCallDirectoryName(left) === normalizeFirstCallDirectoryName(right);
}

export function FirstCallWorkspace({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<FirstCallDraft>(() => createFirstCallDraft());
  const [directories, setDirectories] = useState<FirstCallDirectories>(EMPTY_DIRECTORIES);
  const [preference, setPreference] = useState<FirstCallPrintPreference>(DEFAULT_FIRST_CALL_PRINT_PREFERENCE);
  const [searchSettings, setSearchSettings] = useState<FirstCallSearchSettings>(DEFAULT_SEARCH_SETTINGS);
  const [tomTomKey, setTomTomKey] = useState("");
  const [savingTomTomKey, setSavingTomTomKey] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(0.75);
  const [previewZoomMode, setPreviewZoomMode] = useState<"fit" | "manual">("fit");
  const [highlightColor, setHighlightColor] = useState<FirstCallHighlightColor>("yellow");
  const [pendingHighlightRects, setPendingHighlightRects] = useState<Array<Omit<FirstCallHighlight, "id" | "color">>>([]);
  const [autoHighlightChecks, setAutoHighlightChecks] = useState(true);
  const [loading, setLoading] = useState(true);
  const [lookupKind, setLookupKind] = useState<FirstCallLookupKind | null>(null);
  const [lookupResultKind, setLookupResultKind] = useState<FirstCallLookupKind>("funeralHome");
  const [lookupResults, setLookupResults] = useState<FirstCallLookupCandidate[]>([]);
  const [confirmAction, setConfirmAction] = useState<"new" | "back" | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void window.nightShift.loadFirstCallWorkspace().then((data) => {
      if (!active) return;
      setDirectories({ funeralHomes: data.funeralHomes, facilities: data.facilities });
      setPreference(data.printPreference);
      setSearchSettings(data.searchSettings);
    }).catch((error: Error) => toast.error(error.message)).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [toast]);

  const fitPreview = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
    const fitted = Math.min(
      (canvas.clientWidth - 56) / (8.5 * 96),
      (canvas.clientHeight - 56) / (11 * 96),
      1,
    );
    setPreviewZoom(clampPreviewZoom(fitted));
  }, []);

  useEffect(() => {
    if (loading || previewZoomMode !== "fit") return;
    fitPreview();
    if (typeof ResizeObserver === "undefined" || !canvasRef.current) return;
    const observer = new ResizeObserver(fitPreview);
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [fitPreview, loading, previewZoomMode]);

  function changePreviewZoom(next: number) {
    setPreviewZoomMode("manual");
    setPreviewZoom(clampPreviewZoom(next));
  }

  function handlePreviewWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    changePreviewZoom(previewZoom + (event.deltaY < 0 ? 0.1 : -0.1));
  }

  const selectedFuneralHome = useMemo(
    () => directories.funeralHomes.find((item) => sameName(item.name, draft.values.funeralHomeName)),
    [directories.funeralHomes, draft.values.funeralHomeName],
  );
  const selectedFacility = useMemo(
    () => draft.placeOfDeathKind === "facility" ? directories.facilities.find((item) => sameName(item.name, draft.values.placeOfDeathName)) : undefined,
    [directories.facilities, draft.placeOfDeathKind, draft.values.placeOfDeathName],
  );

  function patchValues(values: Partial<FirstCallDraft["values"]>) {
    setDraft((current) => ({ ...current, values: { ...current.values, ...values } }));
  }

  function selectFuneralHome(name: string) {
    const match = directories.funeralHomes.find((item) => sameName(item.name, name));
    if (!match) return;
    patchValues({
      funeralHomeName: match.name,
      funeralHomeAddress: match.address,
      funeralHomePhone: match.phone,
      funeralHomeFax: match.fax,
      funeralHomeEmail: match.email,
    });
  }

  function selectFacility(name: string) {
    if (draft.placeOfDeathKind === "residence") return;
    const match = directories.facilities.find((item) => sameName(item.name, name));
    if (!match) return;
    patchValues({ placeOfDeathName: match.name, placeOfDeathAddress: match.address, placeOfDeathPhone: match.phone });
  }

  function setText(field: FirstCallTextField, value: string) {
    setDraft((current) => {
      const values = { ...current.values, [field]: value };
      let lastNameManuallyEdited = current.lastNameManuallyEdited;
      if (field === "decedentName" && !lastNameManuallyEdited) values.deceasedLastName = deriveDeceasedLastName(value);
      if (field === "deceasedLastName") {
        values.deceasedLastName = value.toLocaleUpperCase("en-US");
        lastNameManuallyEdited = true;
      }
      return { ...current, values, lastNameManuallyEdited };
    });
    if (field === "funeralHomeName") selectFuneralHome(value);
    if (field === "placeOfDeathName") selectFacility(value);
  }

  function setCheck(field: FirstCallCheckField, value: boolean) {
    setDraft((current) => ({ ...current, checks: { ...current.checks, [field]: value } }));
  }

  function applySelectedHighlight() {
    if (!pendingHighlightRects.length) return;
    setDraft((current) => ({
      ...current,
      highlights: [
        ...current.highlights,
        ...pendingHighlightRects.map((rect, index) => ({
          ...rect,
          id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
          color: highlightColor,
        })),
      ],
    }));
    setPendingHighlightRects([]);
    window.getSelection()?.removeAllRanges();
    toast.success("Highlight applied to the selected form text.");
  }

  function undoLastHighlight() {
    setDraft((current) => ({ ...current, highlights: current.highlights.slice(0, -1) }));
  }

  function clearManualHighlights() {
    setDraft((current) => ({ ...current, highlights: [] }));
    setPendingHighlightRects([]);
    window.getSelection()?.removeAllRanges();
  }

  function setPlaceKind(kind: FirstCallDraft["placeOfDeathKind"]) {
    setLookupResults([]);
    setLookupKind(null);
    setDraft((current) => ({
      ...current,
      placeOfDeathKind: kind,
      values: {
        ...current.values,
        placeOfDeathName: kind === "residence" ? "Residence" : "",
        placeOfDeathAddress: "",
        placeOfDeathPhone: "",
      },
    }));
  }

  async function rememberFuneralHome() {
    const values = draft.values;
    try {
      const next = await window.nightShift.saveFirstCallFuneralHome({
        id: selectedFuneralHome?.id,
        name: values.funeralHomeName,
        address: values.funeralHomeAddress,
        phone: values.funeralHomePhone,
        fax: values.funeralHomeFax,
        email: values.funeralHomeEmail,
      });
      setDirectories(next);
      toast.success(selectedFuneralHome ? "Funeral home updated." : "Funeral home remembered.");
    } catch (error) { toast.error((error as Error).message); }
  }

  async function rememberFacility() {
    if (draft.placeOfDeathKind === "residence") return;
    const values = draft.values;
    try {
      const next = await window.nightShift.saveFirstCallFacility({
        id: selectedFacility?.id,
        name: values.placeOfDeathName,
        address: values.placeOfDeathAddress,
        phone: values.placeOfDeathPhone,
      });
      setDirectories(next);
      toast.success(selectedFacility ? "Facility updated." : "Facility remembered.");
    } catch (error) { toast.error((error as Error).message); }
  }

  async function removeDirectoryItem(kind: FirstCallLookupKind) {
    try {
      const next = kind === "funeralHome"
        ? await window.nightShift.deleteFirstCallFuneralHome(selectedFuneralHome!.id)
        : await window.nightShift.deleteFirstCallFacility(selectedFacility!.id);
      setDirectories(next);
      toast.success(kind === "funeralHome" ? "Funeral home removed." : "Facility removed.");
    } catch (error) { toast.error((error as Error).message); }
  }

  async function searchOnline(kind: FirstCallLookupKind) {
    if (kind === "facility" && draft.placeOfDeathKind === "residence") return;
    const query = kind === "funeralHome" ? draft.values.funeralHomeName : draft.values.placeOfDeathName;
    if (query.trim().length < 2) { toast.error("Enter at least two characters before searching."); return; }
    setLookupKind(kind);
    setLookupResultKind(kind);
    setLookupResults([]);
    try {
      const results = await window.nightShift.searchFirstCallPlaces(kind, query);
      setLookupResults(results);
      if (!results.length) toast.error("No online matches were found. You can still enter the details manually.");
    } catch (error) { toast.error((error as Error).message); }
    finally { setLookupKind(null); }
  }

  async function saveTomTomKey() {
    if (!tomTomKey.trim()) return;
    setSavingTomTomKey(true);
    try {
      setSearchSettings(await window.nightShift.saveFirstCallTomTomApiKey(tomTomKey));
      setTomTomKey("");
      toast.success("TomTom search is ready.");
    } catch (error) { toast.error((error as Error).message); }
    finally { setSavingTomTomKey(false); }
  }

  async function clearTomTomKey() {
    setSavingTomTomKey(true);
    try {
      setSearchSettings(await window.nightShift.saveFirstCallTomTomApiKey(""));
      setTomTomKey("");
      toast.success("Saved TomTom key removed. Manual entry remains available.");
    } catch (error) { toast.error((error as Error).message); }
    finally { setSavingTomTomKey(false); }
  }

  function applyLookup(candidate: FirstCallLookupCandidate, kind: FirstCallLookupKind) {
    if (kind === "facility") {
      if (draft.placeOfDeathKind === "residence") return;
      patchValues({ placeOfDeathName: candidate.name, placeOfDeathAddress: candidate.address, placeOfDeathPhone: candidate.phone });
    } else {
      patchValues({
        funeralHomeName: candidate.name,
        funeralHomeAddress: candidate.address,
        funeralHomePhone: candidate.phone,
        funeralHomeFax: candidate.fax,
        funeralHomeEmail: candidate.email,
      });
    }
    setLookupResults([]);
    toast.success("Suggestion applied. Review the details before remembering it.");
  }

  async function saveCalibration() {
    try {
      setPreference(await window.nightShift.saveFirstCallPrintPreference(preference));
      toast.success("First Call print calibration saved.");
    } catch (error) { toast.error((error as Error).message); }
  }

  function requestNew() {
    if (hasFirstCallContent(draft)) setConfirmAction("new");
    else {
      setDraft(createFirstCallDraft());
      setPendingHighlightRects([]);
    }
  }

  function requestBack() {
    if (hasFirstCallContent(draft)) setConfirmAction("back");
    else onBack();
  }

  function confirmDiscard() {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === "back") onBack();
    else {
      setDraft(createFirstCallDraft());
      setPendingHighlightRects([]);
      window.getSelection()?.removeAllRanges();
    }
  }

  return (
    <main className="first-call-shell">
      <header className="studio-commandbar no-print">
        <div className="command-report-meta">
          <span className="command-glow" aria-hidden="true" />
          <Button variant="quiet" icon={<IconArrowLeft />} onClick={requestBack}>Night Shift Report</Button>
          <div><p>Private, temporary workspace</p><strong>First Call Sheet</strong></div>
        </div>
        <div className="command-drag-region" aria-hidden="true" />
        <div className="command-actions">
          <Button variant="secondary" onClick={requestNew}>New sheet</Button>
          <Button variant="print" icon={<IconPrinter />} onClick={() => void window.nightShift.printFirstCall()}>Print sheet</Button>
          <WindowControls />
        </div>
      </header>

      <div className="first-call-workspace no-print">
        <aside className="first-call-tools" aria-label="First Call automation tools">
          <section>
            <div className="first-call-tool-heading"><IconSearch /><div><strong>Online search - TomTom</strong><small>{searchSettings.configured ? "Ready for name and address lookup" : "A free API key is required"}</small></div></div>
            {searchSettings.source !== "environment" && <>
              <label>TomTom API key<input type="password" aria-label="TomTom API key" value={tomTomKey} placeholder={searchSettings.configured ? "Saved securely" : "Paste your free key"} autoComplete="off" onChange={(event) => setTomTomKey(event.target.value)} /></label>
              <div className="first-call-tool-actions">
                <Button variant="secondary" disabled={!tomTomKey.trim()} busy={savingTomTomKey} onClick={() => void saveTomTomKey()}>Save key</Button>
                {searchSettings.configured && <Button variant="quiet" disabled={savingTomTomKey} onClick={() => void clearTomTomKey()}>Remove key</Button>}
              </div>
            </>}
            <p className="first-call-search-note">Free keys are available from TomTom Developer. Searches return the name, simple address, and main phone when available.</p>
          </section>

          <section>
            <div className="first-call-tool-heading"><IconBuilding /><div><strong>Funeral home</strong><small>Fill and remember verified details</small></div></div>
            <select aria-label="Saved First Call funeral home" value={selectedFuneralHome?.name ?? ""} onChange={(event) => selectFuneralHome(event.target.value)}>
              <option value="">Choose a saved funeral home</option>
              {directories.funeralHomes.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>
            <div className="first-call-tool-actions">
              <Button variant="secondary" disabled={!draft.values.funeralHomeName.trim()} onClick={() => void rememberFuneralHome()}>{selectedFuneralHome ? "Update" : "Remember"}</Button>
              <Button variant="quiet" icon={<IconSearch />} disabled={!searchSettings.configured} busy={lookupKind === "funeralHome"} onClick={() => void searchOnline("funeralHome")}>Search online</Button>
              {selectedFuneralHome && <Button variant="quiet" icon={<IconTrash />} aria-label="Remove saved funeral home" onClick={() => void removeDirectoryItem("funeralHome")} />}
            </div>
          </section>

          <section>
            <div className="first-call-tool-heading"><IconBuilding /><div><strong>Place of death</strong><small>Residence information is never saved</small></div></div>
            <div className="first-call-kind" role="group" aria-label="Place of death type">
              <button className={draft.placeOfDeathKind === "facility" ? "active" : ""} aria-pressed={draft.placeOfDeathKind === "facility"} onClick={() => setPlaceKind("facility")}>Facility</button>
              <button className={draft.placeOfDeathKind === "residence" ? "active" : ""} aria-pressed={draft.placeOfDeathKind === "residence"} onClick={() => setPlaceKind("residence")}>Residence</button>
            </div>
            {draft.placeOfDeathKind === "facility" ? <>
              <select aria-label="Saved place of death facility" value={selectedFacility?.name ?? ""} onChange={(event) => selectFacility(event.target.value)}>
                <option value="">Choose a saved facility</option>
                {directories.facilities.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
              <div className="first-call-tool-actions">
                <Button variant="secondary" disabled={!draft.values.placeOfDeathName.trim()} onClick={() => void rememberFacility()}>{selectedFacility ? "Update" : "Remember"}</Button>
                <Button variant="quiet" icon={<IconSearch />} disabled={!searchSettings.configured} busy={lookupKind === "facility"} onClick={() => void searchOnline("facility")}>Search online</Button>
                {selectedFacility && <Button variant="quiet" icon={<IconTrash />} aria-label="Remove saved facility" onClick={() => void removeDirectoryItem("facility")} />}
              </div>
            </> : <p className="first-call-privacy-note">The residence name, address, and phone stay only on this sheet. They are not sent online, stored, backed up, or recovered.</p>}
          </section>

          {lookupResults.length > 0 && <section className="first-call-results" aria-label="Online lookup results">
            <strong>Review online suggestions</strong>
            {lookupResults.map((candidate) => <button key={candidate.sourceId} onClick={() => applyLookup(candidate, lookupResultKind)}>
              <b>{candidate.name}</b><span>{candidate.address}</span>{candidate.phone && <small>{candidate.phone}</small>}
            </button>)}
            <small>Search results © TomTom</small>
          </section>}

          <section>
            <div className="first-call-tool-heading"><div><strong>Print calibration</strong><small>Original size, centered on Letter</small></div></div>
            <label>Scale ({Math.round(preference.scale * 100)}%)<input type="range" min="0.9" max="1.1" step="0.005" value={preference.scale} onChange={(event) => setPreference({ ...preference, scale: Number(event.target.value) })} /></label>
            <div className="two-field">
              <label>Horizontal offset<input type="number" min="-0.5" max="0.5" step="0.01" value={preference.offsetXInches} onChange={(event) => setPreference({ ...preference, offsetXInches: Number(event.target.value) })} /></label>
              <label>Vertical offset<input type="number" min="-0.5" max="0.5" step="0.01" value={preference.offsetYInches} onChange={(event) => setPreference({ ...preference, offsetYInches: Number(event.target.value) })} /></label>
            </div>
            <Button variant="secondary" full onClick={() => void saveCalibration()}>Save calibration</Button>
          </section>
        </aside>

        <section className="first-call-preview" aria-label="First Call Sheet canvas">
          <div className="canvas-toolbar first-call-canvas-toolbar">
            <div><p className="studio-kicker">First Call preview</p><span>Preview zoom never changes print size or calibration</span></div>
            <div className="canvas-controls">
              <div className="zoom-control" aria-label="Preview zoom controls">
                <IconButton icon={<IconMinus />} aria-label="Zoom out" title="Zoom out" onClick={() => changePreviewZoom(previewZoom - 0.1)} />
                <button type="button" className={previewZoomMode === "fit" ? "active" : ""} onClick={() => { setPreviewZoomMode("fit"); fitPreview(); }}>{previewZoomMode === "fit" ? `Fit ${Math.round(previewZoom * 100)}%` : `${Math.round(previewZoom * 100)}%`}</button>
                <IconButton icon={<IconPlus />} aria-label="Zoom in" title="Zoom in" onClick={() => changePreviewZoom(previewZoom + 0.1)} />
              </div>
              <Button variant="quiet" onClick={() => changePreviewZoom(1)}>100%</Button>
            </div>
          </div>
          <div className="first-call-highlight-toolbar no-print">
            <div className="first-call-highlight-help"><strong>Highlighter</strong><span>{pendingHighlightRects.length ? "Selection ready - choose a color and apply" : "Select printed form text, then apply"}</span></div>
            <div className="first-call-highlight-controls">
              <div className="first-call-color-palette" role="group" aria-label="Highlight color">
                {HIGHLIGHT_COLORS.map((color) => <button
                  key={color}
                  type="button"
                  className={`first-call-color-swatch ${color}${highlightColor === color ? " active" : ""}`}
                  aria-label={`${color[0].toUpperCase()}${color.slice(1)} highlight`}
                  aria-pressed={highlightColor === color}
                  onClick={() => setHighlightColor(color)}
                />)}
              </div>
              <Button variant="secondary" disabled={!pendingHighlightRects.length} onClick={applySelectedHighlight}>Apply</Button>
              <Button variant="quiet" aria-pressed={autoHighlightChecks} onClick={() => setAutoHighlightChecks((current) => !current)}>{autoHighlightChecks ? "Checked labels: On" : "Checked labels: Off"}</Button>
              <Button variant="quiet" disabled={!draft.highlights.length} onClick={undoLastHighlight}>Undo highlight</Button>
              <Button variant="quiet" disabled={!draft.highlights.length} onClick={clearManualHighlights}>Clear</Button>
            </div>
          </div>
          <div ref={canvasRef} className="first-call-canvas" onWheel={handlePreviewWheel}>
            {loading ? <div className="first-call-loading">Loading First Call tools…</div> : <div
              className="first-call-preview-scale"
              aria-label="First Call preview page"
              style={{ width: `${8.5 * 96 * previewZoom}px`, height: `${11 * 96 * previewZoom}px`, "--first-call-preview-zoom": String(previewZoom) } as CSSProperties}
            ><FirstCallPage
              draft={draft}
              preference={preference}
              interactive
              onTextChange={setText}
              onCheckChange={setCheck}
              autoHighlightChecks={autoHighlightChecks}
              selectionColor={highlightColor}
              onSemanticSelection={setPendingHighlightRects}
              funeralHomeNames={directories.funeralHomes.map((item) => item.name)}
              facilityNames={directories.facilities.map((item) => item.name)}
            /></div>}
          </div>
        </section>
      </div>

      <div className="print-only first-call-print-only"><FirstCallPage draft={draft} preference={preference} autoHighlightChecks={autoHighlightChecks} /></div>
      {confirmAction && <ConfirmDialog
        title={confirmAction === "back" ? "Leave this First Call Sheet?" : "Start a new First Call Sheet?"}
        message="This sheet is intentionally not saved. The information currently on it will be discarded."
        confirmLabel={confirmAction === "back" ? "Leave sheet" : "Start new sheet"}
        danger
        onConfirm={confirmDiscard}
        onCancel={() => setConfirmAction(null)}
      />}
    </main>
  );
}
