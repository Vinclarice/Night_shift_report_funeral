import { Studio } from "./components/Studio";
import { ReportControllerProvider, useReportController } from "./state/ReportController";
import { WorkspaceProvider } from "./state/WorkspaceContext";
import { ToastProvider } from "./ui/Toast";

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

  if (!controller.bootstrap || !controller.layout || !controller.report) {
    return (
      <main className="loading-screen">
        <div className="loading-card"><span className="spinner" /><div><strong>Opening report studio</strong><small>Preparing tonight’s workspace…</small></div></div>
      </main>
    );
  }

  return <Studio />;
}
