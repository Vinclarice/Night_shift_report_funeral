import { useState } from "react";

import type { LayoutSettings } from "@/domain/types";
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
  return (
    <>
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
      <p className="muted">Card widths are formatting. Margin, scale and offsets are calibrated to this printer, so they reset separately.</p>
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
