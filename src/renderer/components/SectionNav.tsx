import type { NightReport, ReportSection, SectionKey } from "@/domain/types";
import { Badge } from "../ui/Badge";

interface Props {
  report: NightReport;
  selected: SectionKey;
  onSelect: (key: SectionKey) => void;
}

function hasRush(section: ReportSection) {
  return section.entries.some((entry) => entry.rush);
}

/**
 * Replaces the plain "Section" <select>. A dropdown hides everything except the one section
 * you're currently looking at; this shows all eight at once, grouped by category, with an
 * entry-count badge and a rush indicator so the report's overall status is visible without
 * switching sections one at a time.
 */
export function SectionNav({ report, selected, onSelect }: Props) {
  const groups: Array<{ label: string; category: ReportSection["category"] }> = [
    { label: "Human Remains", category: "human" },
    { label: "Cremated Remains", category: "cremated" },
  ];

  return (
    <nav className="section-nav" aria-label="Report sections">
      {groups.map((group) => (
        <div className="section-nav-group" key={group.category}>
          <p className="section-nav-label">{group.label}</p>
          {report.sections
            .filter((section) => section.category === group.category)
            .map((section) => {
              const active = section.key === selected;
              return (
                <button
                  key={section.key}
                  type="button"
                  className={`section-nav-row${active ? " active" : ""}`}
                  aria-current={active || undefined}
                  aria-label={`${group.label} ${section.title}`}
                  onClick={() => onSelect(section.key)}
                >
                  <span className="section-nav-title">
                    {hasRush(section) && <span className="section-nav-rush-dot" aria-hidden="true" title="Contains a rush entry" />}
                    {section.title}
                  </span>
                  <Badge tone="neutral">{section.entries.length}</Badge>
                </button>
              );
            })}
        </div>
      ))}
    </nav>
  );
}
