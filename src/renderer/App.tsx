import { useState } from "react";
import { Studio } from "./components/Studio";
import { FirstCallWorkspace } from "./components/FirstCallWorkspace";
import { ReportControllerProvider, useReportController } from "./state/ReportController";
import { useWorkspaceDispatch, useWorkspaceState, WorkspaceProvider } from "./state/WorkspaceContext";
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

/**
 * The welcome screen has two jobs: get a report started when there isn't one yet, and — via
 * `onBack` — let the studio "peek" back at the same branding without disturbing an already-open
 * report. `onBack` present is what distinguishes the peek from the real start flow; the
 * create-draft actions never render alongside it; since a report already exists for tonight,
 * creating another would just fail against the date's unique constraint.
 */
function WelcomeScreen({
  resumable,
  latestFinalized,
  onResume,
  onContinueFromLast,
  onStartEmpty,
  onBack,
  onOpenFirstCall,
}: {
  resumable?: { reportDate: string; entryCount: number };
  latestFinalized?: boolean;
  onResume?: () => void;
  onContinueFromLast?: () => void;
  onStartEmpty?: () => void;
  onBack?: () => void;
  onOpenFirstCall: () => void;
}) {
  return (
    <main className="start-screen">
      <section className="start-card">
        <div className="brand-mark">NS</div>
        <h1>Night Shift Report</h1>
        {/* Shown when the date rolled over mid-shift: the draft started earlier tonight is for an
            earlier date, so it would otherwise be invisible here. */}
        {resumable && (
          <div className="start-resume" role="status">
            <strong>Unfinished report for {formatResumeDate(resumable.reportDate)}</strong>
            <span>{resumable.entryCount} {resumable.entryCount === 1 ? "entry" : "entries"} — the date rolled over since you started it.</span>
          </div>
        )}
        <div className="start-actions">
          {onBack && <Button variant="primary" onClick={onBack}>Back to report</Button>}
          {!onBack && resumable && <Button variant="primary" onClick={onResume}>Resume unfinished report</Button>}
          {!onBack && <Button variant={resumable ? "secondary" : "primary"} onClick={onStartEmpty}>Open Night Shift Report</Button>}
          <Button variant="secondary" onClick={onOpenFirstCall}>New First Call Sheet</Button>
          {!onBack && latestFinalized && <Button variant="quiet" onClick={onContinueFromLast}>Continue from last report</Button>}
        </div>
      </section>
    </main>
  );
}

function AppContent() {
  const [mode, setMode] = useState<"report" | "firstCall">("report");
  const controller = useReportController();
  const workspace = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();
  const toast = useToast();

  if (!controller.bootstrap || !controller.layout) {
    return (
      <main className="loading-screen">
        <div className="loading-card"><span className="spinner" /><div><strong>Opening report studio</strong><small>Preparing tonight’s workspace…</small></div></div>
      </main>
    );
  }

  if (mode === "firstCall") return <FirstCallWorkspace onBack={() => setMode("report")} />;

  if (!controller.report) {
    const resumable = controller.bootstrap.resumableDraft;
    const entryCount = resumable?.sections.reduce((total, section) => total + section.entries.length, 0) ?? 0;
    return (
      <WelcomeScreen
        resumable={resumable ? { reportDate: resumable.reportDate, entryCount } : undefined}
        latestFinalized={Boolean(controller.bootstrap.latestFinalized)}
        onResume={controller.resumeDraft}
        onContinueFromLast={() => void controller.createDraft("clone").catch((error: Error) => toast.error(error.message))}
        onStartEmpty={() => void controller.createDraft("empty").catch((error: Error) => toast.error(error.message))}
        onOpenFirstCall={() => setMode("firstCall")}
      />
    );
  }

  if (workspace.viewingStart) {
    return <WelcomeScreen onBack={() => dispatch({ type: "SET_VIEWING_START", viewing: false })} onOpenFirstCall={() => setMode("firstCall")} />;
  }

  return <Studio onOpenFirstCall={() => setMode("firstCall")} />;
}
