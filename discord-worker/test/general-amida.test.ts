import { describe, expect, it } from "vitest";
import {
  buildAmidaSvg,
  createAmidaDraw,
  formatAmidaAssignments,
  generateAmidaPng,
  parseAmidaEntries,
} from "../src/general/amida";

describe("general man amida", () => {
  it("parses one entry per line and removes common list prefixes", () => {
    expect(parseAmidaEntries("1. 石田\n・田中\n\n- 佐藤")).toEqual([
      "石田",
      "田中",
      "佐藤",
    ]);
  });

  it("creates a bijective result that follows the generated rungs", () => {
    const draw = createAmidaDraw(
      ["石田", "田中", "佐藤", "鈴木"],
      ["1番席", "2番席", "3番席", "4番席"],
      "席決め",
      () => 0.25,
    );

    expect(draw.rungLevels.length).toBeGreaterThanOrEqual(6);
    expect(draw.rungs.every((rung) => rung >= 0 && rung < 3)).toBe(true);
    expect(draw.rungLevels.every((level) => (
      level.every((rung, index) => index === 0 || rung - level[index - 1] > 1)
    ))).toBe(true);
    expect(draw.assignments.map((assignment) => assignment.participant)).toEqual([
      "石田",
      "田中",
      "佐藤",
      "鈴木",
    ]);
    expect(new Set(draw.assignments.map((assignment) => assignment.destination))).toEqual(
      new Set(["1番席", "2番席", "3番席", "4番席"]),
    );
  });

  it("rejects mismatched and duplicated entries", () => {
    expect(() => createAmidaDraw(["A", "B"], ["1"], "test")).toThrow(
      "参加者と行き先の数を同じにしてください。",
    );
    expect(() => createAmidaDraw(["A", "A"], ["1", "2"], "test")).toThrow(
      "参加者に同じ名前が複数あります。",
    );
  });

  it("draws escaped participant and destination labels in the SVG", () => {
    const draw = createAmidaDraw(
      ["<石田>", "田中&佐藤"],
      ["A席", "B席"],
      "懇親会 <席決め>",
      () => 0,
    );
    const svg = buildAmidaSvg(draw);

    expect(svg).toContain("懇親会 &lt;席決め&gt;");
    expect(svg).toContain("スタート");
    expect(svg).toContain("ゴール");
    expect(svg).toContain(">&lt;</tspan>");
    expect(svg).toContain(">&amp;</tspan>");
    expect(svg).toContain("<tspan");
    expect(formatAmidaAssignments(draw)).toContain("→ **");
  });

  it("supports a 30-person ladder without imposing an application limit", () => {
    const participants = Array.from({ length: 30 }, (_, index) => `参加者${index + 1}`);
    const destinations = Array.from({ length: 30 }, (_, index) => String(index + 1));
    const draw = createAmidaDraw(participants, destinations, "30人の席決め", () => 0.37);
    const svg = buildAmidaSvg(draw);

    expect(draw.assignments).toHaveLength(30);
    expect(new Set(draw.assignments.map((assignment) => assignment.destination)).size).toBe(30);
    expect(svg).toContain('height="680"');
    expect(svg).toContain('font-size="30"');
  });

  it("renders the ladder as a PNG with Japanese labels", async () => {
    const draw = createAmidaDraw(
      ["石田", "田中", "佐藤"],
      ["一番席", "二番席", "三番席"],
      "懇親会の席決め",
      () => 0.5,
    );
    const png = await generateAmidaPng(draw);

    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.byteLength).toBeGreaterThan(1_000);
  });
});
