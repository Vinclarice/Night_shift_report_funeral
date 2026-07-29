import { describe, expect, it } from "vitest";

import { FIRST_CALL_CHECK_FIELDS, FIRST_CALL_TEXT_FIELDS } from "@/domain/firstCall";
import { FIRST_CALL_CHECK_LAYOUT, FIRST_CALL_TEXT_LAYOUT } from "./FirstCallPage";
import { FIRST_CALL_CHECK_HIGHLIGHTS, FIRST_CALL_SEMANTIC_LAYOUT } from "./firstCallSemanticLayout";

describe("First Call PDF coordinate manifest", () => {
  it("places every typed draft field exactly once inside the supplied page bounds", () => {
    expect(FIRST_CALL_TEXT_LAYOUT.map((item) => item.field).sort()).toEqual([...FIRST_CALL_TEXT_FIELDS].sort());
    expect(new Set(FIRST_CALL_TEXT_LAYOUT.map((item) => item.field)).size).toBe(FIRST_CALL_TEXT_FIELDS.length);
    for (const item of FIRST_CALL_TEXT_LAYOUT) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.x + item.width).toBeLessThanOrEqual(576.6);
      expect(item.y + (item.height ?? 18)).toBeLessThanOrEqual(770.28);
    }
  });

  it("places every checkbox exactly once inside the supplied page bounds", () => {
    expect(FIRST_CALL_CHECK_LAYOUT.map((item) => item.field).sort()).toEqual([...FIRST_CALL_CHECK_FIELDS].sort());
    expect(new Set(FIRST_CALL_CHECK_LAYOUT.map((item) => item.field)).size).toBe(FIRST_CALL_CHECK_FIELDS.length);
    for (const item of FIRST_CALL_CHECK_LAYOUT) {
      expect(item.x + item.width).toBeLessThanOrEqual(576.6);
      expect(item.y + (item.height ?? 18)).toBeLessThanOrEqual(770.28);
    }
  });

  it("keeps every selectable semantic text run and automatic highlight inside the PDF page", () => {
    expect(FIRST_CALL_SEMANTIC_LAYOUT.length).toBeGreaterThan(50);
    for (const item of FIRST_CALL_SEMANTIC_LAYOUT) {
      expect(item.text.trim()).not.toBe("");
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.x + item.width).toBeLessThanOrEqual(576.6);
      expect(item.y + item.height).toBeLessThanOrEqual(770.28);
    }
    expect(Object.keys(FIRST_CALL_CHECK_HIGHLIGHTS).sort()).toEqual([...FIRST_CALL_CHECK_FIELDS].sort());
  });
});
