import { useEffect, useRef } from "react";

import { entrySummary } from "../entrySummary";
import type { ParsedLine } from "@/domain/types";

interface Props {
  lines: Array<ParsedLine & { include: boolean }>;
  onToggle: (index: number, include: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function PasteReviewModal({ lines, onToggle, onCancel, onConfirm }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop no-print">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="paste-review-heading">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Paste review</p>
            <h2 id="paste-review-heading">Confirm parsed entries</h2>
          </div>
          <button ref={closeButtonRef} onClick={onCancel} aria-label="Close paste review">×</button>
        </div>
        <div className="review-list">
          {lines.map((line, index) => (
            <label className="review-row" key={`${line.source}-${index}`}>
              <input type="checkbox" checked={line.include} onChange={(event) => onToggle(index, event.target.checked)} />
              <span>
                <strong>{line.entry.type}</strong>
                {entrySummary(line.entry)}
                {line.warning && <em>{line.warning}</em>}
              </span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={onConfirm}>Add selected lines</button>
        </div>
      </section>
    </div>
  );
}
