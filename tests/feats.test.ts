import { describe, expect, it } from "vitest";
import { buildCharacter, featWarnings, options, sheetHtml } from "../src/core";
import { CustomError, heroList, mergeCustom } from "../src/custom";
import type { Ability, Character, HeroRequest } from "../src/types";
import { allText, cards, freshTables, req } from "./helpers";

const tables = freshTables();

function ability(ch: Character, key: Ability): Character["abilities"][number] {
  const row = ch.abilities.find((item) => item.key === key);
  if (!row) throw new Error(`missing ${key}`);
  return row;
}

function hero(over: Partial<HeroRequest> = {}): Character {
  return buildCharacter(tables, req(over));
}

function dip(cls: string, subclass: string, level = 1): NonNullable<HeroRequest["dip"]> {
  return { cls, subclass, level, cantrips: null, spells: null, path_spells: null };
}

describe("feats", () => {
  it("keeps the usual ability boost until a feat is chosen", () => {
    const level3 = hero({ level: 3 });
    const level4 = hero({ level: 4 });
    const toggled = hero({ level: 4, use_feats: true, feat: null });
    expect(ability(level3, "STR").score).toBe(16);
    expect(level3.combat.max_hp).toBe(28);
    expect(ability(level4, "STR").score).toBe(18);
    expect(ability(level4, "CON").score).toBe(15);
    expect(ability(level4, "DEX").score).toBe(14);
    expect(level4.combat.max_hp).toBe(36);
    expect(toggled.abilities.map((row) => row.score)).toEqual(level4.abilities.map((row) => row.score));
    expect(toggled.combat.max_hp).toBe(level4.combat.max_hp);
    expect(cards(toggled).has("Tough")).toBe(false);
  });

  it("replaces the first ability boost and ignores the feat before that level", () => {
    const early = hero({ level: 3, use_feats: true, feat: "tough" });
    const tough = hero({ level: 4, use_feats: true, feat: "tough" });
    const ignored = hero({ level: 4, use_feats: false, feat: "tough" });
    expect(ability(early, "STR").score).toBe(16);
    expect(early.combat.max_hp).toBe(28);
    expect(cards(early).has("Tough")).toBe(false);
    expect(early.feat).toBeNull();
    expect(ability(tough, "STR").score).toBe(16);
    expect(tough.combat.max_hp).toBe(44);
    expect(cards(tough).get("Tough")?.name).toBe("Tough");
    expect(ability(ignored, "STR").score).toBe(18);
    expect(cards(ignored).has("Tough")).toBe(false);
  });

  it("applies speed, initiative, notice, and a new save", () => {
    const plain = hero({ level: 4 });
    const mobile = hero({ level: 4, use_feats: true, feat: "mobile" });
    const alert = hero({ level: 4, use_feats: true, feat: "alert" });
    const observant = hero({ level: 4, use_feats: true, feat: "observant" });
    const resilient = hero({ level: 4, use_feats: true, feat: "resilient" });
    expect(mobile.combat.speed).toBe(plain.combat.speed + 10);
    expect(mobile.combat.speed).toBe(40);
    expect(alert.combat.initiative).toBe(plain.combat.initiative + 5);
    expect(ability(observant, "WIS").score).toBe(14);
    expect(observant.combat.passive_perception).toBe(plain.combat.passive_perception + 6);
    const dex = ability(resilient, "DEX");
    expect(dex.score).toBe(15);
    expect(dex.save_prof).toBe(true);
    expect(dex.save).toBe(4);
  });

  it("keeps a later ability boost when a feat takes the first one", () => {
    const plain = hero({ cls: "fighter", subclass: "champion", level: 6 });
    const alert = hero({ cls: "fighter", subclass: "champion", level: 6, use_feats: true, feat: "alert" });
    expect(ability(plain, "STR").score).toBe(20);
    expect(ability(alert, "STR").score).toBe(18);
    expect(alert.combat.initiative).toBe(plain.combat.initiative + 5);
    expect(alert.feat?.name).toBe("Alert");
  });

  it("marks an unmet feat off book and still grants what it says", () => {
    const ask = req({ cls: "wizard", level: 4, use_feats: true, feat: "heavily_armored" });
    expect(featWarnings(tables, ask).heavily_armored).not.toBe("");
    const ch = buildCharacter(tables, ask);
    expect(ch.feat?.warn).not.toBe("");
    expect(cards(ch).get("Heavily Armored")?.note).toBe("off book");
    expect(options(tables, ask).armorOptions.find((armor) => armor.name === "Plate armor")?.trained).toBe(true);
    expect(buildCharacter(tables, { ...ask, armor: "Plate armor" }).combat.armor_offbook).toBe(false);
  });

  it("opens armor, shields, and weapons the feat trains", () => {
    const light = req({ cls: "wizard", level: 4, use_feats: true, feat: "lightly_armored" });
    expect(options(tables, light).armorOptions.find((armor) => armor.name === "Leather armor")?.trained).toBe(true);
    const medium = req({ cls: "warlock", level: 4, use_feats: true, feat: "moderately_armored" });
    const mediumOptions = options(tables, medium);
    expect(mediumOptions.shieldProf).toBe(true);
    expect(mediumOptions.armorOptions.find((armor) => armor.name === "Half plate")?.trained).toBe(true);
    const armed = req({ cls: "wizard", level: 4, use_feats: true, feat: "weapon_master" });
    const learned = buildCharacter(tables, armed).feat?.weapons ?? [];
    expect(learned).toHaveLength(4);
    const names = options(tables, armed).weaponOptions.map((weapon) => weapon.name);
    for (const name of learned) expect(names).toContain(name);
  });

  it("fills Magic Initiate from the class lists and leaves no placeholders", () => {
    const ch = hero({ cls: "wizard", level: 4, use_feats: true, feat: "magic_initiate" });
    expect(ch.feat?.extra).toEqual(["Fire Bolt", "Mage Hand", "Magic Missile"]);
    for (const text of allText(ch)) expect(text).not.toMatch(/[{}]/);
    expect(sheetHtml(ch)).not.toMatch(/[{}]/);
    expect(sheetHtml(hero({ level: 4 }))).toContain('data-edit="name"');
  });

  it("accepts a sparse feat pack and the hero feat fields", () => {
    const merged = mergeCustom(freshTables(), {
      feats: [{ id: "snack", name: "Snack Time", card: { desc: "You eat a snack." } }],
    });
    expect(merged.feats).toHaveLength(tables.feats.length + 1);
    const ch = buildCharacter(merged, req({ level: 4, use_feats: true, feat: "snack" }));
    expect(cards(ch).get("Snack Time")?.desc).toBe("You eat a snack.");
    expect(() =>
      mergeCustom(freshTables(), {
        feats: [{ id: "snack", name: "Snack Time", card: { desc: "You eat a snack." }, nope: true }],
      }),
    ).toThrow(CustomError);
    const heroes = heroList({
      heroes: [{ name: "A", race: "human", cls: "fighter", use_feats: true, feat: "tough" }],
    });
    expect(heroes[0]?.use_feats).toBe(true);
    expect(heroes[0]?.feat).toBe("tough");
  });

  it("counts the second class toward armor and spell gates", () => {
    const armored = req({
      cls: "wizard",
      subclass: "evocation",
      level: 5,
      use_feats: true,
      feat: "heavy_armor_master",
      use_multiclass: true,
      dip: dip("cleric", "life"),
    });
    expect(featWarnings(tables, armored).heavy_armor_master).toBe("");
    expect(buildCharacter(tables, armored).feat?.warn).toBe("");
    const plain = req({ cls: "wizard", subclass: "evocation", level: 4, use_feats: true, feat: "heavy_armor_master" });
    expect(featWarnings(tables, plain).heavy_armor_master).not.toBe("");

    const caster = req({
      cls: "fighter",
      subclass: "champion",
      level: 5,
      use_feats: true,
      feat: "war_caster",
      use_multiclass: true,
      dip: dip("wizard", "evocation"),
    });
    expect(featWarnings(tables, caster).war_caster).toBe("");
    expect(buildCharacter(tables, caster).feat?.warn).toBe("");
    const fighter = req({ cls: "fighter", subclass: "champion", level: 4, use_feats: true, feat: "war_caster" });
    expect(featWarnings(tables, fighter).war_caster).not.toBe("");
  });

  it("gives each class its own feat slot", () => {
    const both = hero({
      cls: "cleric",
      subclass: "life",
      level: 9,
      use_feats: true,
      use_multiclass: true,
      dip: dip("ranger", "hunter", 4),
      feats: [
        { cls: "cleric", at: 4, id: "alert" },
        { cls: "ranger", at: 4, id: "mobile" },
      ],
    });
    const plain = hero({
      cls: "cleric",
      subclass: "life",
      level: 9,
      use_multiclass: true,
      dip: dip("ranger", "hunter", 4),
    });
    expect(both.feats.map((feat) => feat.name)).toEqual(["Alert", "Mobile"]);
    expect(cards(both).has("Alert")).toBe(true);
    expect(cards(both).has("Mobile")).toBe(true);
    expect(ability(both, "WIS").score).toBe(ability(plain, "WIS").score - 2);
    expect(ability(both, "DEX").score).toBe(ability(plain, "DEX").score - 2);
    expect(both.combat.speed).toBe(plain.combat.speed + 10);
    const dexMod = (score: number) => Math.floor((score - 10) / 2);
    const dexDelta = dexMod(ability(both, "DEX").score) - dexMod(ability(plain, "DEX").score);
    expect(both.combat.initiative).toBe(plain.combat.initiative + 5 + dexDelta);

    const fighter = hero({
      cls: "fighter",
      subclass: "champion",
      level: 6,
      use_feats: true,
      feats: [
        { cls: "fighter", at: 4, id: "alert" },
        { cls: "fighter", at: 6, id: "tough" },
      ],
    });
    const bare = hero({ cls: "fighter", subclass: "champion", level: 1 });
    expect(fighter.feats.map((feat) => feat.at)).toEqual([4, 6]);
    expect(ability(fighter, "STR").score).toBe(ability(bare, "STR").score);
    expect(cards(fighter).has("Tough")).toBe(true);
    expect(cards(fighter).has("Alert")).toBe(true);
  });

  it("does not hand a weapon the second class already trains", () => {
    const learned =
      hero({
        cls: "wizard",
        subclass: "evocation",
        level: 5,
        use_feats: true,
        feat: "weapon_master",
        use_multiclass: true,
        dip: dip("fighter", "champion"),
      }).feat?.weapons ?? [];
    expect(learned).toEqual([]);
  });
});
