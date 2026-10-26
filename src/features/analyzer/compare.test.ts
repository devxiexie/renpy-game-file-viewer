import { describe, expect, it } from "vitest";
import { compareText, groupComparisons, parseComparisons } from "./compare";

const p = (name: string, code: string, cond = true) => parseComparisons(name, code, cond).map((c) => [c.subject, compareText(c)]);

describe("parseComparisons", () => {
  it("reads operators on either side", () => {
    expect(p("affection", "met_lucy and affection >= 3")).toEqual([["affection", "≥ 3"]]);
    expect(p("affection", "affection>2")).toEqual([["affection", "> 2"]]);
    expect(p("affection", "5 > affection")).toEqual([["affection", "< 5"]]);
    expect(p("affection", "affection < MAX_AFFECTION")).toEqual([["affection", "< MAX_AFFECTION"]]);
    expect(p("route", 'route == "sam"')).toEqual([["route", '= "sam"']]);
    expect(p("route", "route != 'sam'")).toEqual([["route", "≠ 'sam'"]]);
    expect(p("x", "x is not None")).toEqual([["x", "is not None"]]);
    expect(p("x", "1 <= x < 4")).toEqual([["x", "≥ 1"], ["x", "< 4"]]);
  });

  it("reads membership, calls, indexing and truthiness", () => {
    expect(p("inventory", '"key" in inventory')).toEqual([["inventory", 'contains "key"']]);
    expect(p("inventory", '"key" not in inventory')).toEqual([["inventory", 'not contains "key"']]);
    expect(p("route", 'route in ["a", "b"]')).toEqual([["route", 'in ["a", "b"]']]);
    expect(p("inventory", "len(inventory) > 2")).toEqual([["len(inventory)", "> 2"]]);
    expect(p("stats", 'stats["str"] >= 10')).toEqual([['stats["str"]', "≥ 10"]]);
    expect(p("met_lucy", "not met_lucy")).toEqual([["met_lucy", "is false / unset"]]);
    expect(p("met_lucy", "met_lucy and affection >= 3")).toEqual([["met_lucy", "is true / set"]]);
    expect(p("money", "money + bonus >= 10")).toEqual([["money", "in an expression"]]);
    expect(p("bonus", "money + bonus >= 10")).toEqual([["bonus", "in an expression"]]);
    // Text inside strings isn't code.
    expect(p("money", 'renpy.notify("money >= 5")')).toEqual([]);
  });

  it("only keeps comparisons from non-condition code", () => {
    expect(p("money", "price = money * 2", false)).toEqual([]);
    expect(p("money", "ok = money >= price", false)).toEqual([["money", "≥ price"]]);
  });

  it("groups by test", () => {
    const list = [...parseComparisons("a", "a >= 5", true), ...parseComparisons("a", "a >= 2", true), ...parseComparisons("a", "a >= 5 or a < 0", true)];
    const groups = groupComparisons("a", list.map((c) => ({ ...c, ref: null as never })));
    expect(groups.map((g) => [compareText(g), g.items.length])).toEqual([["≥ 2", 1], ["≥ 5", 2], ["< 0", 1]]);
  });
});
