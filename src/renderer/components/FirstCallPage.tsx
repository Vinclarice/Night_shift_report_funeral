import type { CSSProperties, MouseEvent } from "react";

import type {
  FirstCallCheckField,
  FirstCallDraft,
  FirstCallHighlight,
  FirstCallHighlightColor,
  FirstCallPrintPreference,
  FirstCallTextField,
} from "@/domain/firstCall";
import { FIRST_CALL_CHECK_HIGHLIGHTS, FIRST_CALL_SEMANTIC_LAYOUT } from "./firstCallSemanticLayout";

interface TextPlacement {
  field: FirstCallTextField;
  label: string;
  x: number;
  y: number;
  width: number;
  height?: number;
  fontSize?: number;
  fontWeight?: number;
  uppercase?: boolean;
  align?: "left" | "center";
}

interface CheckPlacement {
  field: FirstCallCheckField;
  label: string;
  x: number;
  y: number;
  width: number;
  height?: number;
}

// Coordinates are measured in the supplied PDF's native 576.6 x 770.28 point coordinate space.
// Keeping this manifest in PDF points means screen preview and physical print share one geometry.
export const FIRST_CALL_TEXT_LAYOUT: TextPlacement[] = [
  { field: "deceasedLastName", label: "Deceased last name", x: 375.1, y: 9, width: 150, height: 22, fontSize: 11, fontWeight: 700, uppercase: true },
  { field: "dateOfCall", label: "Date of call", x: 199.2, y: 44.6, width: 150, height: 22, fontSize: 12 },
  { field: "timeOfCall", label: "Time of call", x: 446.8, y: 45.7, width: 75.3, height: 22 },
  { field: "takenBy", label: "Taken by", x: 194, y: 68.9, width: 143.3, height: 19.7, fontSize: 12, align: "center" },
  { field: "contactAtFuneralHome", label: "Contact at funeral home", x: 444, y: 67, width: 81.6, height: 20 },
  { field: "caseNumber", label: "Case number", x: 390.3, y: 86.4, width: 130.2, height: 22, fontWeight: 700 },
  { field: "decedentName", label: "Name of decedent", x: 88, y: 118.9, width: 437, height: 18.6, fontWeight: 700 },
  { field: "funeralHomeName", label: "Funeral home", x: 70.1, y: 141.4, width: 457, height: 17 },
  { field: "funeralHomeAddress", label: "Funeral home address", x: 100, y: 163.7, width: 427, height: 18 },
  { field: "funeralHomePhone", label: "Funeral home telephone number", x: 146.6, y: 187, width: 151, height: 16.3 },
  { field: "funeralHomeFax", label: "Funeral home fax number", x: 406.5, y: 189.6, width: 121, height: 19 },
  { field: "funeralHomeEmail", label: "Funeral home email", x: 91.9, y: 211.2, width: 246, height: 16 },
  { field: "placeOfDeathName", label: "Place of death", x: 70, y: 228.4, width: 296, height: 17 },
  { field: "placeOfDeathAddress", label: "Place of death address", x: 66, y: 246.3, width: 300, height: 13 },
  { field: "placeOfDeathPhone", label: "Place of death phone", x: 406.1, y: 236.1, width: 118, height: 22 },
  { field: "shipOutTo", label: "Ship out to", x: 56.6, y: 289.8, width: 91.5, height: 16 },
  { field: "internationalShipOutTo", label: "International ship out to", x: 310.5, y: 284.1, width: 101, height: 22 },
  { field: "otherService", label: "Other service", x: 448.9, y: 282.3, width: 79.3, height: 22 },
  { field: "call1DateTime", label: "First call date and time", x: 10, y: 357, width: 95, height: 16 },
  { field: "call1CalledBy", label: "First call called by", x: 140, y: 357, width: 96, height: 16 },
  { field: "call1SpokeTo", label: "First call spoke to", x: 259, y: 357, width: 96, height: 16 },
  { field: "call1Comments", label: "First call comments", x: 391, y: 357, width: 126, height: 16 },
  { field: "call2DateTime", label: "Second call date and time", x: 10, y: 380.5, width: 95, height: 16 },
  { field: "call2CalledBy", label: "Second call called by", x: 140, y: 380.5, width: 96, height: 16 },
  { field: "call2SpokeTo", label: "Second call spoke to", x: 259, y: 380.5, width: 96, height: 16 },
  { field: "call2Comments", label: "Second call comments", x: 391, y: 380.5, width: 126, height: 16 },
  { field: "call3DateTime", label: "Third call date and time", x: 10, y: 404, width: 95, height: 16 },
  { field: "call3CalledBy", label: "Third call called by", x: 140, y: 404, width: 96, height: 16 },
  { field: "call3SpokeTo", label: "Third call spoke to", x: 259, y: 404, width: 96, height: 16 },
  { field: "call3Comments", label: "Third call comments", x: 391, y: 404, width: 126, height: 16 },
  { field: "physicianName", label: "Name of physician", x: 204, y: 427.25, width: 302, height: 18 },
  { field: "physicianAddress1", label: "Address of physician line 1", x: 209, y: 451.19, width: 297, height: 18 },
  { field: "physicianAddress2", label: "Address of physician line 2", x: 126, y: 472.96, width: 380, height: 18 },
  { field: "certifiedCount", label: "Number of certified copies", x: 10, y: 475.12, width: 67, height: 18 },
  { field: "physicianPhone", label: "Telephone number of physician", x: 236.6, y: 498.16, width: 270, height: 18 },
  { field: "recorderDate", label: "Recorder and date", x: 10, y: 521.74, width: 67, height: 18 },
  { field: "dateOfDeath", label: "Date of death", x: 186.1, y: 522.1, width: 133, height: 18 },
  { field: "timeOfDeath", label: "Time of death", x: 451, y: 520.48, width: 55, height: 18 },
  { field: "certificateToPhysician", label: "Certificate to physician", x: 111, y: 557.55, width: 103, height: 18 },
  { field: "physicianMailed", label: "Certificate to physician mailed", x: 263, y: 559.35, width: 94, height: 18 },
  { field: "physicianByHand", label: "Certificate to physician by hand", x: 409, y: 561.33, width: 68, height: 18 },
  { field: "certificateToHealthDepartment", label: "Certificate to health department", x: 126, y: 579.15, width: 85, height: 18 },
  { field: "healthDepartmentMailed", label: "Certificate to health department mailed", x: 263, y: 577.89, width: 94, height: 18 },
  { field: "healthDepartmentByHand", label: "Certificate to health department by hand", x: 410, y: 580.41, width: 68, height: 18 },
  { field: "copiesToFuneralHome", label: "Certified copies to funeral home", x: 173, y: 602.18, width: 102, height: 18 },
  { field: "copiesFuneralHomeMailed", label: "Certified copies to funeral home mailed", x: 321, y: 602.72, width: 112, height: 18 },
  { field: "copiesToFamily", label: "Certified copies to family", x: 138, y: 621.26, width: 137, height: 18 },
  { field: "copiesFamilyMailed", label: "Certified copies to family mailed", x: 321, y: 622.52, width: 112, height: 18 },
  { field: "familyMailingAddress", label: "Family mailing name and address", x: 197, y: 640.52, width: 324, height: 18 },
  { field: "caseNote1", label: "Case notes line 1", x: 62, y: 663.37, width: 461, height: 18 },
  { field: "caseNote2", label: "Case notes line 2", x: 10, y: 686.41, width: 516, height: 18 },
  { field: "caseNote3", label: "Case notes line 3", x: 12, y: 709.45, width: 515, height: 18 },
];

export const FIRST_CALL_CHECK_LAYOUT: CheckPlacement[] = [
  { field: "metropolitan", label: "Metropolitan", x: 7.4, y: 74.6, width: 18, height: 14 },
  { field: "nms", label: "NMS", x: 8.1, y: 94.4, width: 18, height: 14 },
  { field: "inman", label: "Inman", x: 66.4, y: 94.7, width: 18, height: 14 },
  { field: "removalOnly", label: "Removal only", x: 104.7, y: 269.1, width: 18, height: 14 },
  { field: "removeAndEmbalm", label: "Remove and embalm", x: 221.2, y: 268.2, width: 18, height: 14 },
  { field: "fdp", label: "FDP", x: 374.5, y: 267.5, width: 18, height: 14 },
  { field: "removeAndHold", label: "Remove and hold", x: 431.8, y: 267.2, width: 18, height: 14 },
  { field: "cremationServiceOnly", label: "Cremation service only", x: 177.1, y: 289.6, width: 18, height: 14 },
  { field: "certificateYes", label: "Metro to file certificate yes", x: 143.9, y: 318.9, width: 18, height: 14 },
  { field: "certificateNo", label: "Metro to file certificate no", x: 202.2, y: 318.7, width: 18, height: 14 },
  { field: "needsVaMedicalExaminerAuthorization", label: "Needs Virginia medical examiner authorization", x: 272.9, y: 318.7, width: 18, height: 14 },
  { field: "needsDcStamp", label: "Needs DC C stamp", x: 422, y: 318.1, width: 18, height: 14 },
];

function pointStyle(item: { x: number; y: number; width: number; height?: number }): CSSProperties {
  return { left: `${item.x / 72}in`, top: `${item.y / 72}in`, width: `${item.width / 72}in`, height: `${(item.height ?? 18) / 72}in` };
}

interface Props {
  draft: FirstCallDraft;
  preference: FirstCallPrintPreference;
  interactive?: boolean;
  onTextChange?: (field: FirstCallTextField, value: string) => void;
  onCheckChange?: (field: FirstCallCheckField, value: boolean) => void;
  autoHighlightChecks?: boolean;
  selectionColor?: FirstCallHighlightColor;
  onSemanticSelection?: (rects: Array<Omit<FirstCallHighlight, "id" | "color">>) => void;
  funeralHomeNames?: string[];
  facilityNames?: string[];
}

const HIGHLIGHT_COLORS: Record<FirstCallHighlightColor, string> = {
  yellow: "rgba(255, 224, 65, .48)",
  green: "rgba(92, 222, 130, .42)",
  blue: "rgba(79, 170, 255, .38)",
  pink: "rgba(255, 105, 180, .38)",
  orange: "rgba(255, 154, 60, .43)",
};

function semanticSelectionColor(color: FirstCallHighlightColor) {
  return HIGHLIGHT_COLORS[color].replace(/\.[0-9]+\)$/, ".7)");
}

export function FirstCallPage({ draft, preference, interactive = false, onTextChange, onCheckChange, autoHighlightChecks = true, selectionColor = "yellow", onSemanticSelection, funeralHomeNames = [], facilityNames = [] }: Props) {
  const pageStyle = {
    "--first-call-scale": String(preference.scale),
    "--first-call-offset-x": `${preference.offsetXInches}in`,
    "--first-call-offset-y": `${preference.offsetYInches}in`,
  } as CSSProperties;

  function captureSemanticSelection(event: MouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) { onSemanticSelection?.([]); return; }
    const layer = event.currentTarget;
    if (!selection.anchorNode || !selection.focusNode || !layer.contains(selection.anchorNode) || !layer.contains(selection.focusNode)) return;
    const layerRect = layer.getBoundingClientRect();
    if (!layerRect.width || !layerRect.height) return;
    const scaleX = 576.6 / layerRect.width;
    const scaleY = 770.28 / layerRect.height;
    const rects = Array.from(selection.getRangeAt(0).getClientRects())
      .filter((rect) => rect.width > 1 && rect.height > 1 && rect.right > layerRect.left && rect.left < layerRect.right && rect.bottom > layerRect.top && rect.top < layerRect.bottom)
      .map((rect) => ({
        x: Math.max(0, (rect.left - layerRect.left) * scaleX - 1),
        y: Math.max(0, (rect.top - layerRect.top) * scaleY + 1),
        width: Math.min(576.6, rect.width * scaleX + 2),
        height: Math.min(770.28, Math.max(7, rect.height * scaleY - 1)),
      }));
    onSemanticSelection?.(rects);
  }

  return (
    <article className={`first-call-letter${interactive ? " first-call-interactive" : ""}`} style={pageStyle} aria-label={interactive ? "First Call Sheet form" : undefined}>
      <div className="first-call-source-page">
        <img src="./first-call-template.png" alt="" aria-hidden="true" draggable={false} />
        <div className="first-call-highlight-layer" aria-hidden="true">
          {autoHighlightChecks && FIRST_CALL_CHECK_LAYOUT.filter((item) => draft.checks[item.field]).map((item) => (
            <span key={`auto-${item.field}`} className="first-call-highlight first-call-highlight-auto" style={{ ...pointStyle(FIRST_CALL_CHECK_HIGHLIGHTS[item.field]), background: HIGHLIGHT_COLORS.yellow }} />
          ))}
          {draft.highlights.map((highlight) => (
            <span key={highlight.id} className="first-call-highlight first-call-highlight-manual" style={{ ...pointStyle(highlight), background: HIGHLIGHT_COLORS[highlight.color] }} />
          ))}
        </div>
        <div className="first-call-field-layer">
          {FIRST_CALL_TEXT_LAYOUT.map((item) => {
            const value = draft.values[item.field];
            const style = { ...pointStyle(item), "--field-font-size": `${item.fontSize ?? 9}pt`, "--field-font-weight": String(item.fontWeight ?? 400), textAlign: item.align ?? "left", textTransform: item.uppercase ? "uppercase" : undefined } as CSSProperties;
            if (!interactive) return <span key={item.field} className={`first-call-value${value.length > item.width / 4 ? " compact" : ""}`} style={style}>{value}</span>;
            const list = item.field === "funeralHomeName" ? "first-call-funeral-home-options" : item.field === "placeOfDeathName" && draft.placeOfDeathKind === "facility" ? "first-call-facility-options" : undefined;
            return <input key={item.field} aria-label={item.label} className="first-call-input" style={style} value={value} list={list} autoComplete="off" onChange={(event) => onTextChange?.(item.field, event.target.value)} />;
          })}
          {FIRST_CALL_CHECK_LAYOUT.map((item) => {
            const checked = draft.checks[item.field];
            return (
              <span key={item.field} className="first-call-check-slot" style={pointStyle(item)}>
                {checked && <span className="first-call-check-mark" aria-hidden="true">X</span>}
                {interactive && <input type="checkbox" aria-label={item.label} checked={checked} onChange={(event) => onCheckChange?.(item.field, event.target.checked)} />}
              </span>
            );
          })}
        </div>
        {interactive && <div
          className="first-call-semantic-layer"
          aria-label="Selectable printed form text"
          style={{ "--semantic-selection-color": semanticSelectionColor(selectionColor) } as CSSProperties}
          onMouseUp={captureSemanticSelection}
        >
          {FIRST_CALL_SEMANTIC_LAYOUT.map((item, index) => <span key={`${item.text}-${index}`} style={{ ...pointStyle(item), fontSize: `${item.height}pt` }}>{item.text}</span>)}
        </div>}
      </div>
      {interactive && <>
        <datalist id="first-call-funeral-home-options">{funeralHomeNames.map((name) => <option key={name} value={name} />)}</datalist>
        <datalist id="first-call-facility-options">{facilityNames.map((name) => <option key={name} value={name} />)}</datalist>
      </>}
    </article>
  );
}
