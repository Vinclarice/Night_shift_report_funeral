import { useEffect, useState } from "react";

import { IconChromeClose, IconChromeMaximize, IconChromeMinimize, IconChromeRestore } from "../icons";

/**
 * Window controls for the frameless shell. The OS frame is removed in the main process so the
 * studio's own chrome runs to the top edge; these buttons replace what the frame provided.
 *
 * Everything in the title bar is inert to dragging by default (`-webkit-app-region: no-drag` in
 * CSS) with the drag region applied to the empty space instead, so a click on a control never
 * starts a window drag.
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
      <button type="button" aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"} onClick={() => void window.nightShift.windowControl("maximize")}>
        {maximized ? <IconChromeRestore /> : <IconChromeMaximize />}
      </button>
      <button type="button" className="window-close" aria-label="Close" title="Close" onClick={() => void window.nightShift.windowControl("close")}>
        <IconChromeClose />
      </button>
    </div>
  );
}
