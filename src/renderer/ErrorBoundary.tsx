import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Error boundaries have no hook equivalent yet, so this stays a class component. Without this,
// any render-time crash (a malformed entry, an unexpected date, whatever) would take the whole
// window to a blank white screen with no indication that the report is still safely autosaved
// up to the last successful write.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Night Shift Report crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="crash-screen no-print">
          <section className="crash-card">
            <h1>Something went wrong</h1>
            <p>
              The app hit an unexpected error and needs to restart. Your report is still saved on
              disk up through the last successful autosave — nothing you already entered was lost.
            </p>
            <p className="crash-detail">{this.state.error.message}</p>
            <button className="primary" onClick={() => window.location.reload()}>
              Restart
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
