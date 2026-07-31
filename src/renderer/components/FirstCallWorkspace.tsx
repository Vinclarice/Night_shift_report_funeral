import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, WheelEvent } from "react";

import {
  DEFAULT_FIRST_CALL_PRINT_PREFERENCE,
  createFirstCallDraft,
  deriveDeceasedLastName,
  hasFirstCallContent,
  normalizeFirstCallDirectoryName,
  rankFirstCallDirectoryMatches,
  sanitizeFirstCallDraftForPersistence,
} from "@/domain/firstCall";
import type {
  FirstCallCheckField,
  FirstCallDirectories,
  FirstCallDirectoryKind,
  FirstCallDraft,
  FirstCallHighlight,
  FirstCallHighlightColor,
  FirstCallLookupCandidate,
  FirstCallLookupKind,
  FirstCallPrintPreference,
  FirstCallSearchSettings,
  FirstCallTextField,
} from "@/domain/firstCall";
import type { FirstCallFacilityInput, FirstCallFuneralHomeInput } from "@/shared/contracts";
import { IconBuilding, IconMinus, IconPlus, IconPrinter, IconSearch, IconSliders, IconTrash } from "../icons";
import { useToast } from "../ui/Toast";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { FirstCallPage } from "./FirstCallPage";
import { FirstCallDirectoryManager } from "./FirstCallDirectoryManager";
import { WindowControls } from "./TitleBar";
import { WorkspaceTabs } from "./WorkspaceTabs";
import type { WorkspaceMode } from "./WorkspaceTabs";

const EMPTY_DIRECTORIES: FirstCallDirectories = { funeralHomes: [], facilities: [] };
const DEFAULT_SEARCH_SETTINGS: FirstCallSearchSettings = { provider: "tomtom", configured: false, source: "none" };
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 2;
const HIGHLIGHT_COLORS: FirstCallHighlightColor[] = ["yellow", "green", "blue", "pink", "orange"];

type PendingDuplicate =
  | { kind: "funeralHome"; input: FirstCallFuneralHomeInput; existing: FirstCallDirectories["funeralHomes"][number] }
  | { kind: "facility"; input: FirstCallFacilityInput; existing: FirstCallDirectories["facilities"][number] };

function clampPreviewZoom(value: number) {
  return Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, Math.round(value * 20) / 20));
}

function sameName(left: string, right: string) {
  return normalizeFirstCallDirectoryName(left) === normalizeFirstCallDirectoryName(right);
}

export function FirstCallWorkspace({ onBack, onNavigate = () => {} }: { onBack: () => void; onNavigate?: (mode: WorkspaceMode) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<FirstCallDraft>(() => createFirstCallDraft());
  const [directories, setDirectories] = useState<FirstCallDirectories>(EMPTY_DIRECTORIES);
  const [preference, setPreference] = useState<FirstCallPrintPreference>(DEFAULT_FIRST_CALL_PRINT_PREFERENCE);
  const [searchSettings, setSearchSettings] = useState<FirstCallSearchSettings>(DEFAULT_SEARCH_SETTINGS);
  const [tomTomKey, setTomTomKey] = useState("");
  const [savingTomTomKey, setSavingTomTomKey] = useState(false);
  const [tomTomSettingsOpen, setTomTomSettingsOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(0.75);
  const [previewZoomMode, setPreviewZoomMode] = useState<"fit" | "manual">("fit");
  const [highlightColor, setHighlightColor] = useState<FirstCallHighlightColor>("yellow");
  const [pendingHighlightRects, setPendingHighlightRects] = useState<Array<Omit<FirstCallHighlight, "id" | "color">>>([]);
  const [autoHighlightChecks, setAutoHighlightChecks] = useState(true);
  const [loading, setLoading] = useState(true);
  const [lookupKind, setLookupKind] = useState<FirstCallLookupKind | null>(null);
  const [lookupResultKind, setLookupResultKind] = useState<FirstCallLookupKind>("funeralHome");
  const [lookupResults, setLookupResults] = useState<FirstCallLookupCandidate[]>([]);
  const [confirmAction, setConfirmAction] = useState<"new" | null>(null);
  const [directoryManagerOpen, setDirectoryManagerOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<"funeralHome" | "placeOfDeath" | "settings">("funeralHome");
  const [activeSuggestions, setActiveSuggestions] = useState<FirstCallDirectoryKind | null>(null);
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicate | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const lookupResultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void window.nightShift.loadFirstCallWorkspace().then((data) => {
      if (!active) return;
      setDirectories({ funeralHomes: data.funeralHomes, facilities: data.facilities });
      setPreference(data.printPreference);
      setSearchSettings(data.searchSettings);
      setTomTomSettingsOpen(!data.searchSettings.configured && data.searchSettings.source !== "environment");
      if (data.savedDraft) setDraft(data.savedDraft);
    }).catch((error: Error) => toast.error(error.message)).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [toast]);

  // The sheet now persists on its own until the operator explicitly clears it (New sheet). Residence
  // details are stripped out by sanitizeFirstCallDraftForPersistence before they ever reach the save
  // call, so that carve-out holds regardless of what triggers this effect.
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      void window.nightShift.saveFirstCallDraft(sanitizeFirstCallDraftForPersistence(draft)).catch((error: Error) => toast.error(error.message));
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, loading, toast]);

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

  useEffect(() => {
    if (!lookupResults.length) return;
    lookupResultsRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [lookupResults]);

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
  const funeralHomeSuggestions = useMemo(
    () => rankFirstCallDirectoryMatches(directories.funeralHomes, draft.values.funeralHomeName),
    [directories.funeralHomes, draft.values.funeralHomeName],
  );
  const facilitySuggestions = useMemo(
    () => rankFirstCallDirectoryMatches(directories.facilities, draft.values.placeOfDeathName),
    [directories.facilities, draft.values.placeOfDeathName],
  );

  function patchValues(values: Partial<FirstCallDraft["values"]>) {
    setDraft((current) => ({ ...current, values: { ...current.values, ...values } }));
  }

  function selectFuneralHome(name: string, trackUsage = true) {
    const match = directories.funeralHomes.find((item) => sameName(item.name, name));
    if (!match) return;
    patchValues({
      funeralHomeName: match.name,
      funeralHomeAddress: match.address,
      funeralHomePhone: match.phone,
      funeralHomeFax: match.fax,
      funeralHomeEmail: match.email,
    });
    setActiveSuggestions(null);
    if (trackUsage) void window.nightShift.useFirstCallDirectory("funeralHome", match.id).then(setDirectories).catch((error: Error) => toast.error(error.message));
  }

  function selectFacility(name: string, trackUsage = true) {
    if (draft.placeOfDeathKind === "residence") return;
    const match = directories.facilities.find((item) => sameName(item.name, name));
    if (!match) return;
    patchValues({ placeOfDeathName: match.name, placeOfDeathAddress: match.address, placeOfDeathPhone: match.phone });
    setActiveSuggestions(null);
    if (trackUsage) void window.nightShift.useFirstCallDirectory("facility", match.id).then(setDirectories).catch((error: Error) => toast.error(error.message));
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
    if (field === "funeralHomeName" && directories.funeralHomes.some((item) => sameName(item.name, value))) selectFuneralHome(value, false);
    if (field === "placeOfDeathName" && directories.facilities.some((item) => sameName(item.name, value))) selectFacility(value, false);
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

  function toggleLabelHighlight(rect: Omit<FirstCallHighlight, "id" | "color">) {
    setDraft((current) => {
      const existingIndex = current.highlights.findIndex((highlight) =>
        Math.abs(highlight.x - rect.x) < 2 && Math.abs(highlight.y - rect.y) < 2 && Math.abs(highlight.width - rect.width) < 2 && Math.abs(highlight.height - rect.height) < 2,
      );
      if (existingIndex >= 0) return { ...current, highlights: current.highlights.filter((_, index) => index !== existingIndex) };
      return {
        ...current,
        highlights: [...current.highlights, { ...rect, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, color: highlightColor }],
      };
    });
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

  async function saveFuneralHome(input: FirstCallFuneralHomeInput, message?: string) {
    try {
      const next = await window.nightShift.saveFirstCallFuneralHome(input);
      setDirectories(next);
      toast.success(message ?? (input.id ? "Funeral home updated." : "Funeral home saved."));
    } catch (error) { toast.error((error as Error).message); }
  }

  async function saveFacility(input: FirstCallFacilityInput, message?: string) {
    try {
      const next = await window.nightShift.saveFirstCallFacility(input);
      setDirectories(next);
      toast.success(message ?? (input.id ? "Facility updated." : "Facility saved."));
    } catch (error) { toast.error((error as Error).message); }
  }

  function potentialDuplicate<T extends { id: string; name: string; address: string }>(items: T[], id: string | undefined, name: string, address: string) {
    const normalizedName = normalizeFirstCallDirectoryName(name);
    const normalizedAddress = normalizeFirstCallDirectoryName(address);
    return items.find((item) => item.id !== id && (
      normalizeFirstCallDirectoryName(item.name) === normalizedName ||
      (normalizedAddress.length >= 6 && normalizeFirstCallDirectoryName(item.address) === normalizedAddress)
    ));
  }

  function rememberFuneralHome() {
    const values = draft.values;
    const input: FirstCallFuneralHomeInput = {
      id: selectedFuneralHome?.id, name: values.funeralHomeName, address: values.funeralHomeAddress, phone: values.funeralHomePhone,
      fax: values.funeralHomeFax, email: values.funeralHomeEmail, aliases: selectedFuneralHome?.aliases ?? [], favorite: selectedFuneralHome?.favorite ?? false,
    };
    const duplicate = potentialDuplicate(directories.funeralHomes, input.id, input.name, input.address);
    if (duplicate) setPendingDuplicate({ kind: "funeralHome", input, existing: duplicate });
    else void saveFuneralHome(input);
  }

  function rememberFacility() {
    if (draft.placeOfDeathKind === "residence") return;
    const values = draft.values;
    const input: FirstCallFacilityInput = {
      id: selectedFacility?.id, name: values.placeOfDeathName, address: values.placeOfDeathAddress, phone: values.placeOfDeathPhone,
      aliases: selectedFacility?.aliases ?? [], favorite: selectedFacility?.favorite ?? false,
    };
    const duplicate = potentialDuplicate(directories.facilities, input.id, input.name, input.address);
    if (duplicate) setPendingDuplicate({ kind: "facility", input, existing: duplicate });
    else void saveFacility(input);
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
    if (kind === "residence" && draft.placeOfDeathKind !== "residence") return;
    const query = kind === "funeralHome" ? draft.values.funeralHomeName : kind === "facility" ? draft.values.placeOfDeathName : draft.values.placeOfDeathAddress;
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
      setTomTomSettingsOpen(false);
      toast.success("TomTom search is ready.");
    } catch (error) { toast.error((error as Error).message); }
    finally { setSavingTomTomKey(false); }
  }

  async function clearTomTomKey() {
    setSavingTomTomKey(true);
    try {
      setSearchSettings(await window.nightShift.saveFirstCallTomTomApiKey(""));
      setTomTomKey("");
      setTomTomSettingsOpen(true);
      toast.success("Saved TomTom key removed. Manual entry remains available.");
    } catch (error) { toast.error((error as Error).message); }
    finally { setSavingTomTomKey(false); }
  }

  function applyLookup(candidate: FirstCallLookupCandidate, kind: FirstCallLookupKind) {
    if (kind === "residence") {
      if (draft.placeOfDeathKind !== "residence") return;
      patchValues({ placeOfDeathAddress: candidate.address });
      setLookupResults([]);
      toast.success("Residence address applied for this sheet only.");
      return;
    }
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

  function onlineLookupResults(kind: FirstCallLookupKind) {
    if (lookupResultKind !== kind || lookupResults.length === 0) return null;
    return <div ref={lookupResultsRef} className="first-call-results" aria-label="Online lookup results">
      <strong>Review online suggestions</strong>
      {lookupResults.map((candidate) => <button key={candidate.sourceId} onClick={() => applyLookup(candidate, kind)}>
        <b>{candidate.name}</b><span>{candidate.address}</span>{candidate.phone && <small>{candidate.phone}</small>}
      </button>)}
      <small>Search results © TomTom</small>
    </div>;
  }

  async function removeManagedDirectoryItem(kind: FirstCallDirectoryKind, id: string) {
    try {
      const next = kind === "funeralHome" ? await window.nightShift.deleteFirstCallFuneralHome(id) : await window.nightShift.deleteFirstCallFacility(id);
      setDirectories(next);
      toast.success("Saved directory record removed.");
    } catch (error) { toast.error((error as Error).message); }
  }

  async function mergeDirectoryItems(kind: FirstCallDirectoryKind, sourceId: string, targetId: string) {
    try {
      setDirectories(await window.nightShift.mergeFirstCallDirectory(kind, sourceId, targetId));
      toast.success("Directory records merged.");
    } catch (error) { toast.error((error as Error).message); }
  }

  async function exportDirectories() {
    try {
      const result = await window.nightShift.exportFirstCallDirectories();
      if (!result.canceled) toast.success("Directory CSV exported.");
    } catch (error) { toast.error((error as Error).message); }
  }

  async function importDirectories() {
    try {
      const result = await window.nightShift.importFirstCallDirectories();
      setDirectories({ funeralHomes: result.funeralHomes, facilities: result.facilities });
      if (!result.canceled) toast.success(`${result.imported} directory ${result.imported === 1 ? "record" : "records"} imported.`);
    } catch (error) { toast.error((error as Error).message); }
  }

  function resolveDuplicate(useExisting: boolean) {
    const pending = pendingDuplicate;
    setPendingDuplicate(null);
    if (!pending) return;
    if (!useExisting) {
      if (pending.kind === "funeralHome") void saveFuneralHome(pending.input, "Funeral home saved as a separate record.");
      else void saveFacility(pending.input, "Facility saved as a separate record.");
      return;
    }
    const aliases = [...new Set([...pending.existing.aliases, pending.input.name])];
    if (pending.kind === "funeralHome") void saveFuneralHome({ ...pending.input, id: pending.existing.id, name: pending.existing.name, aliases, favorite: pending.existing.favorite }, "Existing funeral home updated and the alternate name was saved as an alias.");
    else void saveFacility({ ...pending.input, id: pending.existing.id, name: pending.existing.name, aliases, favorite: pending.existing.favorite }, "Existing facility updated and the alternate name was saved as an alias.");
  }

  async function saveCalibration() {
    try {
      setPreference(await window.nightShift.saveFirstCallPrintPreference(preference));
      toast.success("First Call print calibration saved.");
    } catch (error) { toast.error((error as Error).message); }
  }

  function requestNew() {
    if (hasFirstCallContent(draft)) setConfirmAction("new");
    else void clearDraft();
  }

  // Leaving or switching workspaces no longer discards anything - the sheet autosaves - so this
  // navigates directly instead of confirming first. Only "New sheet" is still destructive.
  function navigateWorkspace(mode: WorkspaceMode) {
    if (mode === "firstCall") return;
    if (mode === "report") return onBack();
    onNavigate(mode);
  }

  async function clearDraft() {
    setDraft(createFirstCallDraft());
    setPendingHighlightRects([]);
    setLookupResults([]);
    setLookupKind(null);
    window.getSelection()?.removeAllRanges();
    try { await window.nightShift.clearFirstCallDraft(); } catch (error) { toast.error((error as Error).message); }
  }

  function confirmDiscard() {
    setConfirmAction(null);
    void clearDraft();
  }

  return (
    <main className="first-call-shell">
      <header className="studio-commandbar no-print">
        <div className="command-report-meta">
          <span className="command-glow" aria-hidden="true" />
          <div><p>Saved until you clear it</p><strong>First Call Sheet</strong></div>
        </div>
        <WorkspaceTabs active="firstCall" onNavigate={navigateWorkspace} />
        <div className="command-drag-region" aria-hidden="true" />
        <div className="command-actions">
          <Button variant="quiet" onClick={() => setDirectoryManagerOpen(true)}>Manage directories</Button>
          <Button variant="secondary" onClick={requestNew}>New sheet</Button>
          <Button variant="print" icon={<IconPrinter />} onClick={() => void window.nightShift.printFirstCall()}>Print sheet</Button>
          <WindowControls />
        </div>
      </header>

      <div className="first-call-workspace no-print">
        <aside className="first-call-tools" aria-label="First Call automation tools">
          <nav className="first-call-tool-nav" role="tablist" aria-label="First Call tools">
            <button role="tab" aria-selected={activeTool === "funeralHome"} className={activeTool === "funeralHome" ? "active" : ""} onClick={() => setActiveTool("funeralHome")}><IconBuilding /><span>Funeral home</span></button>
            <button role="tab" aria-selected={activeTool === "placeOfDeath"} className={activeTool === "placeOfDeath" ? "active" : ""} onClick={() => setActiveTool("placeOfDeath")}><IconBuilding /><span>Place of death</span></button>
            <button role="tab" aria-selected={activeTool === "settings"} className={activeTool === "settings" ? "active" : ""} onClick={() => setActiveTool("settings")}><IconSliders /><span>Settings</span>{!searchSettings.configured && <b>Setup</b>}</button>
          </nav>

          <section className="first-call-settings-section first-call-tool-panel" hidden={activeTool !== "settings"}>
            <button type="button" className="first-call-settings-toggle" aria-expanded={tomTomSettingsOpen} onClick={() => setTomTomSettingsOpen((current) => !current)}>
              <IconSliders />
              <span><strong>TomTom search settings</strong><small>{searchSettings.configured ? "API key saved securely" : "Setup required for online search"}</small></span>
              <b aria-hidden="true">{tomTomSettingsOpen ? "−" : "+"}</b>
            </button>
            {tomTomSettingsOpen && <div className="first-call-settings-menu">
              {searchSettings.source !== "environment" ? <>
                <label>TomTom API key<input type="password" aria-label="TomTom API key" value={tomTomKey} placeholder={searchSettings.configured ? "Enter a replacement key" : "Paste your free key"} autoComplete="off" onChange={(event) => setTomTomKey(event.target.value)} /></label>
                <div className="first-call-tool-actions">
                  <Button variant="secondary" disabled={!tomTomKey.trim()} busy={savingTomTomKey} onClick={() => void saveTomTomKey()}>{searchSettings.configured ? "Replace key" : "Save key"}</Button>
                  {searchSettings.configured && <Button variant="quiet" disabled={savingTomTomKey} onClick={() => void clearTomTomKey()}>Remove key</Button>}
                </div>
              </> : <p className="first-call-search-note">The TomTom key is supplied by the application environment.</p>}
              <p className="first-call-search-note">Searches return the name, simple address, and main phone when available.</p>
            </div>}
          </section>

          <section className="first-call-tool-panel" hidden={activeTool !== "funeralHome"}>
            <div className="first-call-tool-heading"><IconBuilding /><div><strong>Funeral home</strong><small>Enter details here or choose a saved record</small></div></div>
            <div className="first-call-direct-entry" aria-label="Direct funeral home entry">
              <div className="first-call-suggest-field">
                <label>Name<input type="text" aria-label="Direct funeral home name" autoComplete="off" value={draft.values.funeralHomeName} onFocus={() => setActiveSuggestions("funeralHome")} onChange={(event) => { setText("funeralHomeName", event.target.value); setActiveSuggestions("funeralHome"); }} /></label>
                {activeSuggestions === "funeralHome" && funeralHomeSuggestions.length > 0 && <div className="first-call-suggestions" role="listbox" aria-label="Saved funeral home suggestions">
                  {funeralHomeSuggestions.map((item) => <button key={item.id} role="option" aria-selected={selectedFuneralHome?.id === item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectFuneralHome(item.name)}>
                    <span><strong>{item.favorite && "★ "}{item.name}</strong><small>{item.address || "No address saved"}</small></span>{item.aliases.length > 0 && <em>{item.aliases.join(" · ")}</em>}
                  </button>)}
                </div>}
                {activeSuggestions === "funeralHome" && draft.values.funeralHomeName.trim().length >= 2 && funeralHomeSuggestions.length === 0 && <small className="first-call-no-match">No saved match. Use Search TomTom below.</small>}
              </div>
              <label>Address<input type="text" aria-label="Direct funeral home address" value={draft.values.funeralHomeAddress} onChange={(event) => setText("funeralHomeAddress", event.target.value)} /></label>
              <div className="two-field">
                <label>Telephone<input type="tel" aria-label="Direct funeral home telephone" value={draft.values.funeralHomePhone} onChange={(event) => setText("funeralHomePhone", event.target.value)} /></label>
                <label>Fax<input type="tel" aria-label="Direct funeral home fax" value={draft.values.funeralHomeFax} onChange={(event) => setText("funeralHomeFax", event.target.value)} /></label>
              </div>
              <label>Email<input type="email" aria-label="Direct funeral home email" value={draft.values.funeralHomeEmail} onChange={(event) => setText("funeralHomeEmail", event.target.value)} /></label>
            </div>
            <div className="first-call-tool-actions">
              <Button variant="secondary" disabled={!draft.values.funeralHomeName.trim()} onClick={() => void rememberFuneralHome()}>{selectedFuneralHome ? "Update saved" : "Save to directory"}</Button>
              <Button variant="quiet" icon={<IconSearch />} disabled={!searchSettings.configured} busy={lookupKind === "funeralHome"} onClick={() => void searchOnline("funeralHome")}>Search TomTom</Button>
              {selectedFuneralHome && <Button variant="quiet" icon={<IconTrash />} aria-label="Remove saved funeral home" onClick={() => void removeDirectoryItem("funeralHome")} />}
            </div>
            {onlineLookupResults("funeralHome")}
          </section>

          <section className="first-call-tool-panel" hidden={activeTool !== "placeOfDeath"}>
            <div className="first-call-tool-heading"><IconBuilding /><div><strong>Place of death</strong><small>Residence information is never saved</small></div></div>
            <div className="first-call-kind" role="group" aria-label="Place of death type">
              <button className={draft.placeOfDeathKind === "facility" ? "active" : ""} aria-pressed={draft.placeOfDeathKind === "facility"} onClick={() => setPlaceKind("facility")}>Facility</button>
              <button className={draft.placeOfDeathKind === "residence" ? "active" : ""} aria-pressed={draft.placeOfDeathKind === "residence"} onClick={() => setPlaceKind("residence")}>Residence</button>
            </div>
            {draft.placeOfDeathKind === "facility" ? <>
              <div className="first-call-direct-entry" aria-label="Direct facility entry">
                <div className="first-call-suggest-field">
                  <label>Name<input type="text" aria-label="Direct facility name" autoComplete="off" value={draft.values.placeOfDeathName} onFocus={() => setActiveSuggestions("facility")} onChange={(event) => { setText("placeOfDeathName", event.target.value); setActiveSuggestions("facility"); }} /></label>
                  {activeSuggestions === "facility" && facilitySuggestions.length > 0 && <div className="first-call-suggestions" role="listbox" aria-label="Saved facility suggestions">
                  {facilitySuggestions.map((item) => <button key={item.id} role="option" aria-selected={selectedFacility?.id === item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectFacility(item.name)}>
                      <span><strong>{item.favorite && "★ "}{item.name}</strong><small>{item.address || "No address saved"}</small></span>{item.aliases.length > 0 && <em>{item.aliases.join(" · ")}</em>}
                    </button>)}
                  </div>}
                  {activeSuggestions === "facility" && draft.values.placeOfDeathName.trim().length >= 2 && facilitySuggestions.length === 0 && <small className="first-call-no-match">No saved match. Use Search TomTom below.</small>}
                </div>
                <label>Address<input type="text" aria-label="Direct facility address" value={draft.values.placeOfDeathAddress} onChange={(event) => setText("placeOfDeathAddress", event.target.value)} /></label>
                <label>Telephone<input type="tel" aria-label="Direct facility telephone" value={draft.values.placeOfDeathPhone} onChange={(event) => setText("placeOfDeathPhone", event.target.value)} /></label>
              </div>
              <div className="first-call-tool-actions">
                <Button variant="secondary" disabled={!draft.values.placeOfDeathName.trim()} onClick={() => void rememberFacility()}>{selectedFacility ? "Update saved" : "Save to directory"}</Button>
                <Button variant="quiet" icon={<IconSearch />} disabled={!searchSettings.configured} busy={lookupKind === "facility"} onClick={() => void searchOnline("facility")}>Search TomTom</Button>
                {selectedFacility && <Button variant="quiet" icon={<IconTrash />} aria-label="Remove saved facility" onClick={() => void removeDirectoryItem("facility")} />}
              </div>
              {onlineLookupResults("facility")}
            </> : <>
              <div className="first-call-direct-entry" aria-label="Direct residence entry">
                <label>Address<input type="text" aria-label="Direct residence address" value={draft.values.placeOfDeathAddress} onChange={(event) => setText("placeOfDeathAddress", event.target.value)} /></label>
                <label>Telephone<input type="tel" aria-label="Direct residence telephone" value={draft.values.placeOfDeathPhone} onChange={(event) => setText("placeOfDeathPhone", event.target.value)} /></label>
              </div>
              <Button variant="quiet" icon={<IconSearch />} disabled={!searchSettings.configured || draft.values.placeOfDeathAddress.trim().length < 2} busy={lookupKind === "residence"} onClick={() => void searchOnline("residence")}>Search address with TomTom</Button>
              {onlineLookupResults("residence")}
              <p className="first-call-privacy-note">Only an address you explicitly search is sent to TomTom. Residence details are never cached, saved, recommended, logged, backed up, or recovered.</p>
            </>}
          </section>

          <section className="first-call-tool-panel" hidden={activeTool !== "settings"}>
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
              onSemanticLabelClick={toggleLabelHighlight}
              funeralHomeNames={directories.funeralHomes.map((item) => item.name)}
              facilityNames={directories.facilities.map((item) => item.name)}
            /></div>}
          </div>
        </section>
      </div>

      <div className="print-only first-call-print-only"><FirstCallPage draft={draft} preference={preference} autoHighlightChecks={autoHighlightChecks} /></div>
      {confirmAction && <ConfirmDialog
        title="Start a new First Call Sheet?"
        message="This sheet is saved automatically, but starting a new one clears it for good. Print or note anything you still need first."
        confirmLabel="Start new sheet"
        danger
        onConfirm={confirmDiscard}
        onCancel={() => setConfirmAction(null)}
      />}
      {directoryManagerOpen && <FirstCallDirectoryManager
        directories={directories}
        onClose={() => setDirectoryManagerOpen(false)}
        onSaveFuneralHome={(input) => saveFuneralHome(input)}
        onSaveFacility={(input) => saveFacility(input)}
        onDelete={removeManagedDirectoryItem}
        onMerge={mergeDirectoryItems}
        onExport={exportDirectories}
        onImport={importDirectories}
      />}
      {pendingDuplicate && <div className="modal-backdrop" role="presentation">
        <section className="modal first-call-duplicate-modal" role="dialog" aria-modal="true" aria-labelledby="first-call-duplicate-title">
          <header className="modal-header"><div><p className="studio-kicker">Possible duplicate</p><h2 id="first-call-duplicate-title">A similar location is already saved</h2></div></header>
          <div className="modal-body">
            <p><strong>{pendingDuplicate.existing.name}</strong><br />{pendingDuplicate.existing.address || "No saved address"}</p>
            <p>Update that record and keep the entered name as an alias, or save this as a separate location.</p>
          </div>
          <footer className="modal-actions">
            <Button variant="quiet" onClick={() => setPendingDuplicate(null)}>Cancel</Button>
            <Button variant="secondary" onClick={() => resolveDuplicate(false)}>Keep both</Button>
            <Button variant="primary" onClick={() => resolveDuplicate(true)}>Update existing</Button>
          </footer>
        </section>
      </div>}
    </main>
  );
}
