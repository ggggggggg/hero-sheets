import { describe, expect, it } from "vitest";
import { buildCharacter, CharError, sheetHtml } from "../src/core";
import { clampPlus, matchTier, TIERS } from "../src/tiers";
import { allText, cards, freshTables, req } from "./helpers";

const tables = freshTables();

function trailing(damage: string): number {
  const match = /([+-]\d+)$/.exec(damage);
  return match?.[1] ? Number(match[1]) : 0;
}

describe("magic plus", () => {
  const hero = req({
    race: "human",
    cls: "fighter",
    subclass: "champion",
    level: 5,
    armor: "Chain mail",
    weapon: "Longsword",
  });

  it("adds a +1 weapon and +1 armor, and leaves no armor alone", () => {
    const plain = buildCharacter(tables, hero);
    const plus = buildCharacter(tables, req({ ...hero, weapon_plus: 1, armor_plus: 1 }));
    const sword = plain.attacks.find((row) => row.name === "Longsword");
    const magic = plus.attacks.find((row) => row.name === "Longsword +1");
    if (!sword || !magic) throw new Error("missing longsword");
    expect(magic.to_hit).toBe(sword.to_hit + 1);
    expect(trailing(magic.damage)).toBe(trailing(sword.damage) + 1);
    expect(plus.combat.ac).toBe(plain.combat.ac + 1);
    expect(plus.combat.armor).toContain("Chain mail +1");
    const bare = buildCharacter(tables, req({ cls: "wizard", subclass: "evocation", level: 1, armor: "No armor" }));
    const marked = buildCharacter(
      tables,
      req({ cls: "wizard", subclass: "evocation", level: 1, armor: "No armor", armor_plus: 2 }),
    );
    expect(marked.combat.ac).toBe(bare.combat.ac);
    expect(marked.combat.armor).toBe(bare.combat.armor);
  });

  it("refuses a plus past +3", () => {
    expect(() => buildCharacter(tables, req({ ...hero, weapon_plus: 4 }))).toThrow(CharError);
    expect(() => buildCharacter(tables, req({ ...hero, armor_plus: -1 }))).toThrow(CharError);
  });
});

describe("levels above 7", () => {
  it("keeps level 7 text and adds the higher-level numbers", () => {
    const fighter = (level: number) =>
      buildCharacter(tables, req({ race: "human", cls: "fighter", subclass: "champion", level }));
    const low = cards(fighter(7));
    expect(low.get("Extra Attack")?.desc).toContain("2 times");
    expect(low.has("Indomitable")).toBe(false);
    const mid = fighter(11);
    expect(mid.combat.prof).toBe(4);
    expect(cards(mid).get("Extra Attack")?.desc).toContain("3 times");
    expect(cards(mid).has("Indomitable")).toBe(true);
    expect(cards(fighter(20)).get("Extra Attack")?.desc).toContain("4 times");
    const bard = (level: number) => buildCharacter(tables, req({ cls: "bard", subclass: "lore", level }));
    expect(cards(bard(7)).get("Song of Rest")?.desc).toContain("+1d6");
    expect(cards(bard(9)).get("Song of Rest")?.desc).toContain("+1d8");
  });

  it("trains every monk save at 14 and Wisdom for a rogue at 15", () => {
    const monk = buildCharacter(tables, req({ cls: "monk", subclass: "openhand", level: 14 }));
    expect(monk.abilities.every((row) => row.save_prof)).toBe(true);
    const rogue = buildCharacter(tables, req({ cls: "rogue", subclass: "thief", level: 15 }));
    expect(rogue.abilities.find((row) => row.key === "WIS")?.save_prof).toBe(true);
  });

  it("still prints two pages of HTML, including at level 20", () => {
    const sheet = (level: number) => sheetHtml(buildCharacter(tables, req({ cls: "cleric", subclass: "life", level })));
    expect(sheet(7).match(/class="page /g)).toHaveLength(2);
    expect(sheet(20).match(/class="page /g)).toHaveLength(2);
  });

  it("builds every subclass at the high levels with no leftover placeholders", () => {
    for (const level of [8, 11, 16, 20]) {
      for (const cls of tables.classes) {
        for (const sub of tables.subclasses.filter((row) => row.class_id === cls.id)) {
          const ch = buildCharacter(tables, req({ race: "human", cls: cls.id, subclass: sub.id, level }));
          expect(ch.identity.level).toBe(level);
          for (const text of allText(ch)) expect(text, `${cls.id} ${sub.id} ${level}`).not.toMatch(/[{}]/);
        }
      }
    }
  });
});

describe("tiers", () => {
  it("matches the 2014 tier caps", () => {
    expect(TIERS.map((tier) => [tier.id, tier.maxLevel, tier.maxPlus])).toEqual([
      ["sheet", 7, 0],
      ["1", 4, 1],
      ["2", 10, 2],
      ["3", 16, 3],
      ["4", 20, 3],
    ]);
    expect(matchTier(7, 0)).toBe("sheet");
    expect(matchTier(10, 2)).toBe("2");
    expect(matchTier(12, 0)).toBe("custom");
    expect(clampPlus(4)).toBe(3);
    expect(clampPlus(-2)).toBe(0);
    expect(clampPlus(2, 1)).toBe(1);
    expect(clampPlus(0, 0)).toBe(0);
  });
});
