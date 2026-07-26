import { useState } from "react";

import type { BackupSummary } from "@/shared/contracts";
import { ConfirmDialog } from "./ConfirmDialog";

function formatBytes(size: number) {
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  backups: BackupSummary[];
  revisions: Array<{ id: string; revisionNumber: number; finalizedAt: string }>;
  onLoadRevisions: () => Promise<void>;
  onRestoreRevision: (id: string) => Promise<void>;
}

export function RecoveryPanel({ backups, revisions, onLoadRevisions, onRestoreRevision }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingBackup, setPendingBackup] = useState<BackupSummary | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-section settings-panel">
      <p className="eyebrow">Recovery</p>
      <h2>Revisions and backups</h2>
      <button className="secondary full" disabled={busy} onClick={() => void run(onLoadRevisions)}>
        {busy ? "Loading…" : "Load report revisions"}
      </button>
      {error && <p className="muted" role="alert">{error}</p>}
      {revisions.map((revision) => (
        <div className="recovery-row" key={revision.id}>
          <span>Revision {revision.revisionNumber}<small>{new Date(revision.finalizedAt).toLocaleString()}</small></span>
          <button disabled={busy} onClick={() => void run(() => onRestoreRevision(revision.id))}>Restore</button>
        </div>
      ))}
      <h3>Database backups</h3>
      {backups.map((backup) => (
        <div className="recovery-row" key={backup.name}>
          <span>{new Date(backup.createdAt).toLocaleString()}<small>{formatBytes(backup.size)}</small></span>
          <button disabled={busy} onClick={() => setPendingBackup(backup)}>Restore</button>
        </div>
      ))}
      {pendingBackup && (
        <ConfirmDialog
          title="Restore this backup?"
          message={`This replaces the current database with the backup from ${new Date(pendingBackup.createdAt).toLocaleString()} and restarts the app. This can't be undone.`}
          confirmLabel="Restore and restart"
          danger
          busy={busy}
          onCancel={() => setPendingBackup(null)}
          onConfirm={() => {
            const backup = pendingBackup;
            setPendingBackup(null);
            void run(() => window.nightShift.restoreBackup(backup.name));
          }}
        />
      )}
    </section>
  );
}
