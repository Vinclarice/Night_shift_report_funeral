export type WorkspaceMode = "report" | "firstCall" | "cremation";

const WORKSPACES: Array<{ mode: WorkspaceMode; label: string }> = [
  { mode: "report", label: "Night Shift" },
  { mode: "firstCall", label: "First Call" },
  { mode: "cremation", label: "Cremation" },
];

export function WorkspaceTabs({ active, onNavigate }: { active: WorkspaceMode; onNavigate: (mode: WorkspaceMode) => void }) {
  return (
    <nav className="workspace-tabs no-print" aria-label="Workspaces">
      {WORKSPACES.map((workspace) => <button
        key={workspace.mode}
        type="button"
        className={active === workspace.mode ? "active" : ""}
        aria-current={active === workspace.mode ? "page" : undefined}
        onClick={() => onNavigate(workspace.mode)}
      >{workspace.label}</button>)}
    </nav>
  );
}
