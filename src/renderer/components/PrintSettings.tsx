import type { LayoutSettings } from "@/domain/types";

interface Props {
  layout: LayoutSettings;
  calibration: boolean;
  onCalibration: (value: boolean) => void;
  onChange: (layout: LayoutSettings) => void;
  onResetSection: () => void;
}

export function PrintSettings({ layout, calibration, onCalibration, onChange, onResetSection }: Props) {
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
    </>
  );
}
