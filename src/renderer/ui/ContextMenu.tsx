import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  onSelect: () => void;
}

interface ContextMenuProps {
  /** Viewport coordinates of the click that opened the menu (clientX/clientY). */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Fixed-position popover anchored to a right-click point, used for row actions in the preview
 * canvas. Closes on an outside pointerdown, Escape, scroll, or window blur — the same dismissal
 * rules as the tools popover in Studio, just triggered from a click point instead of a button.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Start at the click point; nudged back on-screen once the menu's real size is known.
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(x, window.innerWidth - rect.width - margin);
    const top = Math.min(y, window.innerHeight - rect.height - margin);
    setPosition({ left: Math.max(margin, left), top: Math.max(margin, top) });
  }, [x, y]);

  useLayoutEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div className="row-context-menu no-print" style={position} role="menu" ref={ref}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={item.tone === "danger" ? "danger" : undefined}
          onClick={() => { onClose(); item.onSelect(); }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
