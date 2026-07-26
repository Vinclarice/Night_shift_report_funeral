import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function useDialogSurface(open: boolean, onClose: () => void, initialFocus?: RefObject<HTMLElement | null>) {
  const surfaceRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const surface = surfaceRef.current;
    const focusables = () => Array.from(surface?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    requestAnimationFrame(() => (initialFocus?.current ?? focusables()[0] ?? surface)?.focus());

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        surface?.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, [open, initialFocus]);

  return surfaceRef;
}
