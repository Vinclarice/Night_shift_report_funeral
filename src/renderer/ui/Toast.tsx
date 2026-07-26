import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { IconX } from "../icons";

type ToastTone = "success" | "warning" | "danger" | "info";

interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

export interface ToastApi {
  success: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used within a ToastProvider");
  return api;
}

const AUTO_DISMISS_MS = 5000;

/**
 * Floating notifications, replacing the old sticky message bar that pushed the whole layout
 * down whenever a validation error or parser warning fired. Errors stay on screen until
 * dismissed since they usually mean something didn't save; everything else clears itself so
 * transient confirmations don't pile up.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, tone, message }]);
    if (tone !== "danger") {
      timers.current.set(id, setTimeout(() => dismiss(id), AUTO_DISMISS_MS));
    }
  }, [dismiss]);

  // push is itself stable (its only dependency, dismiss, never changes identity), so this only
  // needs to be rebuilt once — plain useRef-and-read-during-render trips the rule against
  // accessing ref values at render time, so useMemo is the correct tool here instead.
  const api = useMemo<ToastApi>(() => ({
    success: (message) => push("success", message),
    warning: (message) => push("warning", message),
    error: (message) => push("danger", message),
    info: (message) => push("info", message),
  }), [push]);

  // Clear any pending auto-dismiss timers on unmount so a stray setState never fires against an
  // unmounted provider (most visible in tests, where each test mounts and unmounts a fresh App).
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((timer) => clearTimeout(timer));
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack no-print" role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === "danger" ? "alert" : "status"} aria-live="polite">
            <span>{toast.message}</span>
            <button aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>
              <IconX />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
