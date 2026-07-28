import { Studio } from "./components/Studio";
import { ReportControllerProvider, useReportController } from "./state/ReportController";
import { WorkspaceProvider } from "./state/WorkspaceContext";
import { Button } from "./ui/Button";
import { ToastProvider, useToast } from "./ui/Toast";

function formatResumeDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

export function App() {
  return (
    <ToastProvider>
      <WorkspaceProvider>
        <ReportControllerProvider>
          <AppContent />
        </ReportControllerProvider>
      </WorkspaceProvider>
    </ToastProvider>
  );
}

function AppContent() {
  const controller = useReportController();
  const toast = useToast();

  if (!controller.bootstrap || !controller.layout) {
    return (
      <main className="loading-screen">
        <div className="loading-card"><span className="spinner" /><div><strong>Opening report studio</strong><small>Preparing tonight’s workspace…</small></div></div>
      </main>
    );
  }

  if (!controller.report) {
    const resumable = controller.bootstrap.resumableDraft;
    const entryCount = resumable?.sections.reduce((total, section) => total + section.entries.length, 0) ?? 0;
    return (
      <main className="start-screen">
        <section className="start-card">
          <div className="start-aurora" aria-hidden="true" />
          <div className="brand-mark">NS</div>
          <p className="studio-kicker">Night operations · Report studio</p>
          <h1>Build tonight’s report with confidence.</h1>
          <p>A focused workspace for preparing, reviewing, and printing the next shift report. Your data stays on this computer.</p>
          {/* Shown when the date rolled over mid-shift: the draft started earlier tonight is for an
              earlier date, so it would otherwise be invisible here. */}
          {resumable && (
            <div className="start-resume" role="status">
              <strong>Unfinished report for {formatResumeDate(resumable.reportDate)}</strong>
              <span>{entryCount} {entryCount === 1 ? "entry" : "entries"} — the date rolled over since you started it.</span>
            </div>
          )}
          <div className="start-actions">
            {resumable && <Button variant="primary" onClick={controller.resumeDraft}>Resume that report</Button>}
            {controller.bootstrap.latestFinalized && <Button variant={resumable ? "secondary" : "primary"} onClick={() => void controller.createDraft("clone").catch((error: Error) => toast.error(error.message))}>Continue from last report</Button>}
            <Button variant={controller.bootstrap.latestFinalized || resumable ? "secondary" : "primary"} onClick={() => void controller.createDraft("empty").catch((error: Error) => toast.error(error.message))}>Start empty</Button>
          </div>
          <div className="start-assurance"><span>Local-first</span><span>Autosaved</span><span>Print-ready</span></div>
        </section>
      </main>
    );
  }

  return <Studio />;
}
