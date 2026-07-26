import { useEffect, useRef } from "react";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A styled stand-in for the native window.confirm(), used for destructive or hard-to-undo
 * actions (like restoring a database backup) so the app doesn't drop into an unstyled system
 * dialog mid-workflow.
 */
export function ConfirmDialog({ title, message, confirmLabel = "Confirm", danger, busy, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop no-print">
      <section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-heading">
        <div className="modal-header">
          <div>
            <h2 id="confirm-dialog-heading">{title}</h2>
          </div>
        </div>
        <p className="confirm-message">{message}</p>
        <div className="modal-actions">
          <button className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} className={danger ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
