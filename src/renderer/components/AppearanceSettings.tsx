import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { Backdrop } from "../state/WorkspaceContext";

interface Look {
  value: Backdrop;
  label: string;
  description: string;
  /** How opaque the inspector and desk are drawn — the same figures styles.css uses. */
  panel: number;
  desk: number;
}

const LOOKS: Look[] = [
  { value: "current", label: "Current", description: "Solid panels, as the app has always looked.", panel: 1, desk: 1 },
  { value: "subtle", label: "Subtle", description: "The desk lightens a shade; Mica barely shows.", panel: 0.72, desk: 0.6 },
  { value: "strong", label: "Strong", description: "A faint wash of the wallpaper in the desk.", panel: 0.4, desk: 0.3 },
  { value: "clear", label: "Clear", description: "The wallpaper's tint across the desk and inspector.", panel: 0, desk: 0 },
];

interface Props {
  value: Backdrop;
  onChange: (backdrop: Backdrop) => void;
}

export function AppearanceSettings({ value, onChange }: Props) {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    window.nightShift.backdropSupported()
      .then((result) => { if (active) setSupported(result); })
      .catch(() => { if (active) setSupported(false); });
    return () => { active = false; };
  }, []);

  return (
    <>
      <fieldset className="backdrop-options">
        <legend>Backdrop</legend>
        {LOOKS.map((look) => (
          <label className="backdrop-option" key={look.value}>
            <input
              type="radio"
              name="backdrop"
              value={look.value}
              checked={value === look.value}
              disabled={look.value !== "current" && supported === false}
              onChange={() => onChange(look.value)}
            />
            {/* A miniature of the window: command bar, inspector and desk over a wallpaper-like tint.
                An illustration of how much shows through, not a capture of this computer. */}
            <span className="backdrop-preview" style={{ "--preview-panel": look.panel, "--preview-desk": look.desk } as CSSProperties} aria-hidden="true">
              <span className="preview-bar" />
              <span className="preview-body">
                <span className="preview-panel" />
                <span className="preview-desk"><span className="preview-sheet" /></span>
              </span>
            </span>
            <span>
              <strong>{look.label}</strong>
              <small>{look.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="muted">
        {supported === false
          ? "Mica needs Windows 11, so on this computer the panels stay solid."
          : "Mica takes its colour from the desktop wallpaper, and shows only while this window is the active one. The printed sheet never changes."}
      </p>
    </>
  );
}
