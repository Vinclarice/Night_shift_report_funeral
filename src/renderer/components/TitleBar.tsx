import { useEffect, useState } from "react";

import { IconChromeClose, IconChromeMaximize, IconChromeMinimize, IconChromeRestore } from "../icons";

/**
 * Window controls for the frameless shell. The OS frame is removed (`decorations: false` in
 * src-tauri/tauri.conf.json) so the studio's own chrome runs to the top edge; these buttons replace
 * what the frame provided.
 *
 * Only the empty stretch of the command bar drags the window — it carries `data-tauri-drag-region`
 * and nothing else does — so a click on a control never starts a window drag.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    void window.nightShift.isWindowMaximized().then((value) => { if (active) setMaximized(value); });
    const unsubscribe = window.nightShift.onWindowMaximizeChange(setMaximized);
    return () => { active = false; unsubscribe(); };
  }, []);

  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <button type="button" aria-label="Minimize" title="Minimize" onClick={() => void window.nightShift.windowControl("minimize")}>
        <IconChromeMinimize />
      </button>
      {/* data-snap-layout: the bridge lays a native overlay over this button so Windows 11 offers its
          snap grid on hover — see src-tauri/src/snap.rs. The overlay takes the pointer, so the hover
          style also answers to .is-hovered. */}
      <button type="button" data-snap-layout aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"} onClick={() => void window.nightShift.windowControl("maximize")}>
        {maximized ? <IconChromeRestore /> : <IconChromeMaximize />}
      </button>
      <button type="button" className="window-close" aria-label="Close" title="Close" onClick={() => void window.nightShift.windowControl("close")}>
        <IconChromeClose />
      </button>
    </div>
  );
}
