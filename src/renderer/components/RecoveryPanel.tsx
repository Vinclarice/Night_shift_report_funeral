import type { BackupSummary } from "@/shared/contracts";

function formatBytes(size: number) {
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  backups: BackupSummary[];
  revisions: Array<{ id: string; revisionNumber: number; finalizedAt: string }>;
  onLoadRevisions: () => void;
  onRestoreRevision: (id: string) => void;
}

export function RecoveryPanel({ backups, revisions, onLoadRevisions, onRestoreRevision }: Props) {
  return (
    <section className="panel-section settings-panel">
      <p className="eyebrow">Recovery</p>
      <h2>Revisions and backups</h2>
      <button className="secondary full" onClick={onLoadRevisions}>Load report revisions</button>
      {revisions.map((revision) => (
        <div className="recovery-row" key={revision.id}>
          <span>Revision {revision.revisionNumber}<small>{new Date(revision.finalizedAt).toLocaleString()}</small></span>
          <button onClick={() => onRestoreRevision(revision.id)}>Restore</button>
        </div>
      ))}
      <h3>Database backups</h3>
      {backups.map((backup) => (
        <div className="recovery-row" key={backup.name}>
          <span>{new Date(backup.createdAt).toLocaleString()}<small>{formatBytes(backup.size)}</small></span>
          <button onClick={() => { if (confirm("Restore this backup and restart the app?")) void window.nightShift.restoreBackup(backup.name); }}>Restore</button>
        </div>
      ))}
    </section>
  );
}
