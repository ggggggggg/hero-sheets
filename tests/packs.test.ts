import { describe, expect, it } from "vitest";
import { refreshBundledPacks } from "../src/packs";

describe("built-in packs stay current", () => {
  it("replaces a saved copy when the bundled text changed", () => {
    const saved = [
      { title: "Turtles & Pirates", text: '{"title":"Turtles & Pirates","old":true}' },
      { title: "My house pack", text: '{"title":"My house pack"}' },
    ];
    const bundled = [{ title: "Turtles & Pirates", text: '{"title":"Turtles & Pirates","shell":"defense"}' }];
    const next = refreshBundledPacks(saved, bundled);
    expect(next.changed).toBe(true);
    expect(next.packs[0]?.text).toContain("defense");
    expect(next.packs[1]?.text).toBe(saved[1]?.text);
  });

  it("leaves the library alone when the copy already matches", () => {
    const saved = [{ title: "Turtles & Pirates", text: "same" }];
    const next = refreshBundledPacks(saved, [{ title: "Turtles & Pirates", text: "same" }]);
    expect(next.changed).toBe(false);
    expect(next.packs[0]).toBe(saved[0]);
  });
});
