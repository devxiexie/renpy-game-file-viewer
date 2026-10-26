import { describe, expect, it } from "vitest";
import { protect, restore } from "./machine";

describe("tag protection", () => {
  it("masks and restores Ren'Py markup", () => {
    const { masked, tokens } = protect("Hello {b}[player]{/b}, you have %(n)d coins {w=0.5}%s");
    expect(masked).toBe("Hello ⟦0⟧⟦1⟧⟦2⟧, you have ⟦3⟧ coins ⟦4⟧⟦5⟧");
    expect(restore("Bonjour ⟦0⟧⟦1⟧⟦2⟧, tu as ⟦3⟧ pièces ⟦4⟧⟦5⟧", tokens)).toBe("Bonjour {b}[player]{/b}, tu as %(n)d pièces {w=0.5}%s");
    expect(restore("Bonjour", ["{i}"])).toBe("Bonjour{i}");
  });
});
