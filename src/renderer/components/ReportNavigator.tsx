import type { NightReport, ReportSection, SectionKey } from "@/domain/types";
import { useWorkspaceDispatch, useWorkspaceState } from "../state/WorkspaceContext";
import { Badge } from "../ui/Badge";

function hasRush(section: ReportSection) {
  return section.entries.some((entry) => entry.rush);
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}

export function ReportNavigator({ report }: { report: NightReport }) {
  const workspace = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();
  const selected = workspace.selection.sectionKey;
  const total = report.sections.reduce((count, section) => count + section.entries.length, 0);
  const groups: Array<{ label: string; category: ReportSection["category"] }> = [
    { label: "Human remains", category: "human" },
    { label: "Cremated remains", category: "cremated" },
  ];

  function select(sectionKey: SectionKey) {
    dispatch({ type: "SELECT_SECTION", sectionKey, mode: "create" });
  }

  return (
    <aside className="report-navigator no-print">
      <div className="navigator-brand">
        <span className="navigator-mark">NS</span>
        <div><p>Night shift</p><strong>Report studio</strong></div>
      </div>
      <div className="navigator-summary">
        <p className="studio-kicker">Report date</p>
        <strong>{displayDate(report.reportDate)}</strong>
        <div className="summary-stats">
          <span><b>{total}</b> entries</span>
          <span><b>9</b> sections</span>
        </div>
      </div>
      <nav className="navigator-sections" aria-label="Report sections">
        {groups.map((group) => (
          <div className="navigator-group" key={group.category}>
            <p className="navigator-group-label">{group.label}</p>
            {report.sections.filter((section) => section.category === group.category).map((section) => {
              const active = selected === section.key;
              return (
                <button type="button" className={`navigator-row${active ? " active" : ""}`} key={section.key} aria-label={`${group.label} ${section.title}`} aria-current={active ? "page" : undefined} onClick={() => select(section.key)}>
                  <span className="navigator-row-copy">
                    <span className={`section-orb${hasRush(section) ? " rush" : ""}`} aria-hidden="true" />
                    <span>{section.title}</span>
                  </span>
                  <Badge tone={active ? "success" : "neutral"}>{section.entries.length}</Badge>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="navigator-footer">
        <span className={`navigator-status ${report.status}`} aria-hidden="true" />
        <div><small>Report state</small><strong>{report.status === "draft" ? "Draft in progress" : "Finalized"}</strong></div>
      </div>
    </aside>
  );
}
