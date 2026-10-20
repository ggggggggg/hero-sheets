import { describe, expect, it } from "vitest";
import { PAF_TAGS, tagChip, tagLegend } from "../src/tags";
import { escapeHtml, fileStem } from "../src/text";

describe("shared text", () => {
  it("escapes the characters that would break a sheet", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&#x27;f");
  });

  it("keeps a PDF name to one safe line", () => {
    expect(fileStem(` Pip / Level: 3 `)).toBe("Pip Level 3");
    expect(fileStem('a\\b:c*d?e"f<g>h|i')).toBe("abcdefghi");
    expect(fileStem("ok\u0001name")).toBe("okname");
  });

  it("draws the same action chips for both sheets, and leaves Free off the PAF legend", () => {
    expect(tagChip("")).toBe("");
    expect(tagChip("B")).toContain("BONUS");
    expect(tagChip("B")).toContain("background:#e08a00");
    expect(tagChip("B")).toContain("<svg");
    expect(tagChip("<zap>", false)).toContain("&lt;zap&gt;");
    expect(tagChip("<zap>", false)).toContain("background:#555");
    expect(tagChip("NOPE", true)).toBe("");
    expect(tagLegend()).toContain("FREE");
    expect(tagLegend(PAF_TAGS)).not.toContain("FREE");
    expect(tagLegend(PAF_TAGS)).toContain("ALWAYS ON");
  });
});
