import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import content from "../src/paf/content.json";
import { buildCharacter, tablesFrom } from "../src/paf/core";
import { mergePaf, parsePafPack } from "../src/paf/custom";

const base = tablesFrom(content);

describe("PAF content packs", () => {
  it("adds an origin and leaves the others in place", () => {
    const pack = parsePafPack(readFileSync("examples/paf/lamp-saint.json", "utf8"));
    const tables = mergePaf(base, pack);
    expect(tables.origins.some((origin) => origin.id === "lampsaint")).toBe(true);
    expect(tables.origins.some((origin) => origin.id === "whisk")).toBe(true);
    const hero = buildCharacter(tables, {
      name: "Lux",
      origin1: "lampsaint",
      origin2: "baseline",
      level: 1,
      bonus_skill: null,
      crit_first: null,
      utility_first: null,
      expert_first: null,
      uber: null,
      scores: null,
      armor: null,
      weapon: null,
      inventory: null,
      notes: "",
      portrait: null,
      portrait_credit: null,
    });
    expect(hero.cards.some((card) => card.name === "Lantern beam")).toBe(true);
    expect(hero.identity.origin1).toBe("Lamp-saint");
  });

  it("rejects a D&D pack", () => {
    expect(() => parsePafPack('{"title":"Turtles","races":[]}')).toThrow(/kind/);
  });

  it("replaces an origin with the same id", () => {
    const tables = mergePaf(base, {
      kind: "paf",
      origins: [
        {
          ...base.origins.find((origin) => origin.id === "baseline"),
          trait: "You hold the line.",
        },
      ],
    });
    expect(tables.origins.filter((origin) => origin.id === "baseline")).toHaveLength(1);
    expect(tables.origins.find((origin) => origin.id === "baseline")?.trait).toBe("You hold the line.");
  });
});
