import { useEffect, useState } from "react";

import type { LayoutSettings } from "@/domain/types";
import type { PrinterOption } from "@/shared/contracts";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  layout: LayoutSettings;
  calibration: boolean;
  onCalibration: (value: boolean) => void;
  onChange: (layout: LayoutSettings) => void;
  onResetSection: () => void;
  onResetCardWidths: () => void;
  onResetPrinterDefaults: () => void;
  customCardWidths: number;
}

export function PrintSettings({ layout, calibration, onCalibration, onChange, onResetSection, onResetCardWidths, onResetPrinterDefaults, customCardWidths }: Props) {
  const [confirmingPrinterReset, setConfirmingPrinterReset] = useState(false);
  const [printers, setPrinters] = useState<PrinterOption[] | null>(null);

  // Asked for each time the panel opens rather than once at startup, so a printer added since shows up.
  useEffect(() => {
    let active = true;
    window.nightShift.listPrinters()
      .then((list) => { if (active) setPrinters(list); })
      .catch(() => { if (active) setPrinters([]); });
    return () => { active = false; };
  }, []);

  const chosen = layout.printerName ?? "";
  // A saved printer that is not installed any more stays selectable, and says so, rather than the
  // choice silently falling back to the dialog.
  const chosenUnlisted = Boolean(chosen) && !(printers ?? []).some((printer) => printer.name === chosen);

  return (
    <>
      <label>
        Printer
        <select value={chosen} onChange={(event) => onChange({ ...layout, printerName: event.target.value || null })}>
          <option value="">Ask each time (print dialog)</option>
          {printers?.map((printer) => (
            <option key={printer.name} value={printer.name}>{printer.isDefault ? `${printer.name} (Windows default)` : printer.name}</option>
          ))}
          {chosenUnlisted && <option value={chosen}>{printers ? `${chosen} (not found)` : chosen}</option>}
        </select>
      </label>
      <p className="muted">
        {chosen
          ? "Print report sends the sheet straight to this printer — Letter, no margins, backgrounds on — with no dialog. To print somewhere else once, use Print with dialog in the command palette (Ctrl+K)."
          : "Choose a printer and Print report prints in one click. Until then it opens the print dialog."}
      </p>
      <label>
        Page margin ({layout.marginInches.toFixed(2)} in)
        <input type="range" min="0.2" max="0.6" step="0.01" value={layout.marginInches} onChange={(event) => onChange({ ...layout, marginInches: Number(event.target.value) })} />
      </label>
      <label>
        Content scale ({Math.round(layout.scale * 100)}%)
        <input type="range" min="0.8" max="1.05" step="0.01" value={layout.scale} onChange={(event) => onChange({ ...layout, scale: Number(event.target.value) })} />
      </label>
      <div className="two-field">
        <label>Horizontal offset<input type="number" min="-0.5" max="0.5" step="0.01" value={layout.offsetXInches} onChange={(event) => onChange({ ...layout, offsetXInches: Number(event.target.value) })} /></label>
        <label>Vertical offset<input type="number" min="-0.5" max="0.5" step="0.01" value={layout.offsetYInches} onChange={(event) => onChange({ ...layout, offsetYInches: Number(event.target.value) })} /></label>
      </div>
      <label className="switch-row"><input type="checkbox" checked={calibration} onChange={(event) => onCalibration(event.target.checked)} /> Show calibration marks</label>
      <button className="secondary full" onClick={onResetSection}>Reset selected card width to Auto</button>
      <h3>Start over</h3>
      <button className="secondary full" disabled={!customCardWidths} onClick={onResetCardWidths}>
        {customCardWidths ? `Reset all ${customCardWidths} widened card${customCardWidths === 1 ? "" : "s"} to Auto` : "No card widths to reset"}
      </button>
      <button className="secondary full" onClick={() => setConfirmingPrinterReset(true)}>Restore print defaults</button>
      <p className="muted">Card widths are formatting. Margin, scale and offsets are calibrated to this printer, so they reset separately. The chosen printer is kept either way.</p>
      {confirmingPrinterReset && (
        <ConfirmDialog
          title="Restore print defaults?"
          message="Page margin, content scale and both printer offsets go back to their shipped values. Any calibration done for this printer is lost, and the report will need re-checking on paper. Card widths and report content are untouched."
          confirmLabel="Restore defaults"
          danger
          onConfirm={() => { setConfirmingPrinterReset(false); onResetPrinterDefaults(); }}
          onCancel={() => setConfirmingPrinterReset(false)}
        />
      )}
    </>
  );
}
