import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { IconX } from "../icons";

interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A single slide-over shell for the app's secondary panels (funeral-home directory, recovery,
 * print setup). These used to render inline in the sidebar, stacking under the entry list and
 * pushing it further down the page each time one opened; now there's one drawer whose content
 * swaps based on which panel is active, and the primary entry workflow never moves.
 */
export function Drawer({ open, title, onClose, children }: DrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-backdrop no-print" onClick={onClose}>
      <section className="drawer" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <h2>{title}</h2>
          <button ref={closeRef} aria-label={`Close ${title}`} onClick={onClose}>
            <IconX />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </section>
    </div>
  );
}
