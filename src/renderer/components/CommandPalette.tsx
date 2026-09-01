import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { OPTIONAL_SECTIONS } from "@/domain/report";
import type { NightReport, SectionKey } from "@/domain/types";
import { IconBuilding, IconHistory, IconPrinter, IconRedo, IconRoad, IconSearch, IconSidebar, IconSliders, IconUndo } from "../icons";
import { useReportActions, useReportState } from "../state/ReportController";
import { useWorkspaceDispatch, useWorkspaceState } from "../state/WorkspaceContext";
import type { ReactNode } from "react";

export interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  run: () => void;
}

/**
 * Subsequence match, so "hdel" finds "Human Remains DELIVER" without needing the exact substring.
 * Returns null for a miss so callers can filter and rank in one pass.
 */
export function matchScore(query: string, label: string): number | null {
  if (!query) return 0;
  const needle = query.toLowerCase();
  const hay = label.toLowerCase();
  const direct = hay.indexOf(needle);
  if (direct >= 0) return direct === 0 ? 1000 : 500 - direct;
  let index = 0;
  let score = 0;
  for (const char of needle) {
    const found = hay.indexOf(char, index);
    if (found < 0) return null;
    score += found === index ? 2 : 1;
    index = found + 1;
  }
  return score;
}

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable));
}

export function useCommands(report: NightReport | null): Command[] {
  const state = useReportState();
  const actions = useReportActions();
  const workspace = useWorkspaceState();
  const dispatch = useWorkspaceDispatch();

  return useMemo(() => {
    if (!report) return [];
    const sectionCommands: Command[] = report.sections.map((section) => ({
      id: `section:${section.key}`,
      label: `${section.category === "human" ? "Human remains" : "Cremated remains"} — ${section.title}`,
      group: "Go to section",
      hint: `${section.entries.length} ${section.entries.length === 1 ? "entry" : "entries"}`,
      run: () => dispatch({ type: "SELECT_SECTION", sectionKey: section.key as SectionKey, mode: "create" }),
    }));

    const actionCommands: Command[] = [
      { id: "utility:directory", label: "Open funeral home directory", group: "Tools", icon: <IconBuilding />, run: () => dispatch({ type: "SET_UTILITY", utility: "directory" }) },
      { id: "utility:recovery", label: "Open recovery center", group: "Tools", icon: <IconHistory />, run: () => dispatch({ type: "SET_UTILITY", utility: "recovery" }) },
      { id: "utility:print", label: "Open print setup", group: "Tools", icon: <IconSliders />, run: () => dispatch({ type: "SET_UTILITY", utility: "print" }) },
      {
        id: "view:inspector",
        label: workspace.inspectorOpen ? "Hide inspector" : "Show inspector",
        group: "View",
        icon: <IconSidebar />,
        run: () => dispatch({ type: "SET_INSPECTOR_OPEN", open: !workspace.inspectorOpen }),
      },
      { id: "view:fit", label: "Fit report to window", group: "View", hint: "Zoom", run: () => dispatch({ type: "FIT_ZOOM" }) },
      ...OPTIONAL_SECTIONS.map(({ key, title }) => ({
        id: `report:section:${key}`,
        label: report?.hiddenSections.includes(key) ? `Put ${title} back on the sheet` : `Take ${title} off the sheet`,
        group: "Report",
        icon: <IconRoad />,
        disabled: !report,
        run: () => {
          if (!report) return;
          const hidden = report.hiddenSections.includes(key);
          void actions.persist({
            ...report,
            hiddenSections: hidden ? report.hiddenSections.filter((candidate) => candidate !== key) : [...report.hiddenSections, key],
          });
        },
      })),
      { id: "edit:undo", label: "Undo", group: "Edit", hint: "Ctrl+Z", icon: <IconUndo />, disabled: !state.undoAvailable, run: actions.undo },
      { id: "edit:redo", label: "Redo", group: "Edit", hint: "Ctrl+Y", icon: <IconRedo />, disabled: !state.redoAvailable, run: actions.redo },
      {
        id: "report:print",
        label: "Print report",
        group: "Report",
        icon: <IconPrinter />,
        disabled: state.overflow,
        run: () => void window.nightShift.printReport(),
      },
    ];

    return [...actionCommands, ...sectionCommands];
  }, [report, state.undoAvailable, state.redoAvailable, state.overflow, workspace.inspectorOpen, actions, dispatch]);
}

export function CommandPalette({ report }: { report: NightReport | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useCommands(report);

  const results = useMemo(() => {
    return commands
      .map((command) => ({ command, score: matchScore(query, `${command.label} ${command.group}`) }))
      .filter((item): item is { command: Command; score: number } => item.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.command);
  }, [commands, query]);

  // Each row carries the group heading it should render. Derived by comparing against the previous
  // result rather than by mutating a running variable, so nothing is reassigned during render.
  const rows = useMemo(() => results.map((command, index) => ({
    command,
    header: index === 0 || results[index - 1].group !== command.group ? command.group : null,
  })), [results]);

  // Clamped during render instead of corrected in an effect, so the list never paints one frame
  // with an out-of-range selection after filtering shrinks the results.
  const activeIndex = results.length ? Math.min(active, results.length - 1) : 0;

  useLayoutEffect(() => {
    function handleKey(event: KeyboardEvent) {
      // Ctrl+K is claimed even while typing — it is not a text-editing shortcut, and having to
      // click out of a field first would defeat the point of a keyboard launcher.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        setQuery("");
        setActive(0);
        return;
      }
      if (event.key === "Escape" && !isTypingTarget(event.target)) setOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!open) return null;

  function choose(command: Command) {
    if (command.disabled) return;
    setOpen(false);
    command.run();
  }

  function handleInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (results.length ? (current + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (results.length ? (current - 1 + results.length) % results.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = results[activeIndex];
      if (command) choose(command);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return createPortal(
    <div className="palette-backdrop no-print" onClick={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(event) => event.stopPropagation()}>
        <div className="palette-search">
          <IconSearch />
          <input
            ref={inputRef}
            type="text"
            value={query}
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            aria-activedescendant={results[activeIndex] ? `palette-option-${results[activeIndex].id}` : undefined}
            aria-label="Search commands"
            placeholder="Jump to a section or run a command…"
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={handleInputKey}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-results" id="palette-results" role="listbox" aria-label="Commands">
          {!results.length && <li className="palette-empty">No matching commands.</li>}
          {rows.map(({ command, header }, index) => (
            <li key={command.id}>
              {header && <p className="palette-group">{header}</p>}
              <button
                type="button"
                id={`palette-option-${command.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`palette-option${index === activeIndex ? " active" : ""}${command.disabled ? " disabled" : ""}`}
                disabled={command.disabled}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(command)}
              >
                <span className="palette-option-icon">{command.icon}</span>
                <span className="palette-option-label">{command.label}</span>
                {command.hint && <span className="palette-option-hint">{command.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        <footer className="palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> run</span>
          <span><kbd>Ctrl</kbd><kbd>K</kbd> toggle</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
