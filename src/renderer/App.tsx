import { Studio } from "./components/Studio";
import { ReportControllerProvider, useReportController } from "./state/ReportController";
import { WorkspaceProvider } from "./state/WorkspaceContext";
import { Button } from "./ui/Button";
import { ToastProvider, useToast } from "./ui/Toast";

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
    return (
      <main className="start-screen">
        <section className="start-card">
          <div className="start-aurora" aria-hidden="true" />
          <div className="brand-mark">NS</div>
          <p className="studio-kicker">Night operations · Report studio</p>
          <h1>Build tonight’s report with confidence.</h1>
          <p>A focused workspace for preparing, reviewing, and printing the next shift report. Your data stays on this computer.</p>
          <div className="start-actions">
            {controller.bootstrap.latestFinalized && <Button variant="primary" onClick={() => void controller.createDraft("clone").catch((error: Error) => toast.error(error.message))}>Continue from last report</Button>}
            <Button variant={controller.bootstrap.latestFinalized ? "secondary" : "primary"} onClick={() => void controller.createDraft("empty").catch((error: Error) => toast.error(error.message))}>Start empty</Button>
          </div>
          <div className="start-assurance"><span>Local-first</span><span>Autosaved</span><span>Print-ready</span></div>
        </section>
      </main>
    );
  }

  return <Studio />;
}
