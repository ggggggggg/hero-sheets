import { describe, expect, it } from "vitest";
import { buildCharacter, classLine, options, sheetHtml } from "../src/core";
import { casterLevels, diceLabel, maxSpellOf, prereqMiss, spellsKnown, wantsText } from "../src/multiclass";
import { signed } from "../src/text";
import type { AbilityScores, Caster, Character, ClassRow } from "../src/types";
import { allText, cards, freshTables, req } from "./helpers";

const tables = freshTables();

const flat = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };
const tens = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };

function second(cls: string, level: number, subclass: string | null = null) {
  return { cls, subclass, level, cantrips: null, spells: null, path_spells: null };
}

function listedSlots(counts: number[]) {
  return counts.map((count, index) => ({ level: index + 1, count })).filter((slot) => slot.count > 0);
}

describe("multiclass", () => {
  it("leaves a one-class hero on the old sheet", () => {
    const ch = buildCharacter(tables, req({ cls: "wizard", subclass: "evocation", level: 5 }));
    expect(ch.identity.second).toBeNull();
    expect(ch.identity.offbook).toBeNull();
    expect(ch.identity.main_level).toBe(5);
    expect(ch.combat.dice).toBeNull();
    expect(ch.casters).toEqual([]);
    expect(ch.pact).toBeNull();
    expect(ch.spellcasting?.slots).toEqual(listedSlots([4, 3, 2]));
    expect(sheetHtml(ch)).not.toContain("5d6");
    const ignored = buildCharacter(
      tables,
      req({ cls: "fighter", level: 5, use_multiclass: false, dip: second("wizard", 2) }),
    );
    expect(ignored.identity.second).toBeNull();
    expect(ignored.identity.main_level).toBe(5);
    const same = buildCharacter(
      tables,
      req({ cls: "wizard", level: 5, use_multiclass: true, dip: second("wizard", 2) }),
    );
    expect(same.identity.second).toBeNull();
  });

  it("adds the later class's hit die, and prints both dice", () => {
    const ch = buildCharacter(
      tables,
      req({
        cls: "fighter",
        subclass: "champion",
        level: 7,
        base_scores: tens,
        race_asi: flat,
        use_multiclass: true,
        dip: second("wizard", 2, "evocation"),
      }),
    );
    expect(ch.identity.main_level).toBe(5);
    expect(ch.identity.second).toBe("Wizard (School of Evocation) 2");
    expect(ch.combat.max_hp).toBe(42);
    expect(ch.combat.dice).toBe("5d10 + 2d6");
    expect(ch.combat.hit_die).toBe("d10");
    const html = sheetHtml(ch);
    expect(html).toContain("5d10 + 2d6");
    expect(html).toContain("Fighter");
    expect(html).toContain("Wizard (School of Evocation) 2");
  });

  it("pools two full casters and keeps each class's spells", () => {
    const ch = buildCharacter(
      tables,
      req({
        cls: "wizard",
        subclass: "evocation",
        level: 7,
        use_multiclass: true,
        dip: second("cleric", 2, "life"),
      }),
    );
    expect(ch.spellcasting?.slots).toEqual(listedSlots([4, 3, 3, 1]));
    expect(ch.spellcasting?.rest).toBe("long");
    expect(ch.pact).toBeNull();
    expect(ch.casters.map((line) => line.name)).toEqual(["Wizard", "Cleric"]);
    const clericSpells = ch.cards.filter((card) => card.section.startsWith("Cleric Level"));
    const wizardSpells = ch.cards.filter((card) => card.section.startsWith("Level "));
    expect(clericSpells.length).toBeGreaterThan(0);
    expect(clericSpells.every((card) => card.edit?.startsWith("dip-spell:"))).toBe(true);
    expect(wizardSpells.some((card) => card.edit?.startsWith("spell:"))).toBe(true);
  });

  it("rounds a half caster down, and ignores a half caster before spellcasting", () => {
    const paladin = buildCharacter(
      tables,
      req({
        cls: "paladin",
        subclass: "devotion",
        level: 5,
        use_multiclass: true,
        dip: second("sorcerer", 3, "draconic"),
      }),
    );
    expect(paladin.spellcasting?.slots).toEqual(listedSlots([4, 3]));
    expect(paladin.casters.map((line) => line.name)).toEqual(["Paladin", "Sorcerer"]);
    const early = buildCharacter(
      tables,
      req({
        cls: "paladin",
        subclass: "devotion",
        level: 6,
        use_multiclass: true,
        dip: second("wizard", 5, "evocation"),
      }),
    );
    expect(early.spellcasting?.slots).toEqual(listedSlots([4, 3, 2]));
    expect(early.casters.map((line) => line.name)).toEqual(["Wizard"]);
  });

  it("keeps a dip's extra attacks and leaves its weapon slot behind", () => {
    const ch = buildCharacter(
      tables,
      req({
        cls: "bard",
        subclass: "lore",
        level: 4,
        weapon: "Club",
        use_multiclass: true,
        dip: second("warlock", 2, "fiend"),
      }),
    );
    expect(ch.attacks.map((row) => row.name)).toEqual(["Club", "Eldritch Blast"]);
    const solo = buildCharacter(tables, req({ cls: "warlock", subclass: "fiend", level: 2 }));
    expect(solo.attacks.map((row) => row.name)).toEqual(["Eldritch Blast", "Dagger"]);
  });

  it("keeps warlock slots on a short rest beside a class with no spellcasting", () => {
    const ch = buildCharacter(
      tables,
      req({
        cls: "fighter",
        subclass: "champion",
        level: 7,
        use_multiclass: true,
        dip: second("warlock", 2, "fiend"),
      }),
    );
    expect(ch.spellcasting).toBeNull();
    expect(ch.pact?.slots).toEqual([{ level: 1, count: 2 }]);
    expect(ch.pact?.rest).toBe("short");
    expect(ch.casters.map((line) => line.name)).toEqual(["Warlock"]);
    const html = sheetHtml(ch);
    expect(html).toContain("Pact 1");
    expect(html).toContain("back after a short rest");
    expect(html).toContain(`Warlock spell ${signed(ch.casters[0]?.attack ?? 0)}`);
    expect(html).not.toContain("Warlock attack");
    expect(html).not.toContain("Spell attack");
  });

  it("uses the higher unarmored armor and still prints both cards", () => {
    const ch = buildCharacter(
      tables,
      req({
        cls: "barbarian",
        subclass: "berserker",
        level: 3,
        armor: "No armor",
        shield: false,
        base_scores: { STR: 10, DEX: 16, CON: 10, INT: 10, WIS: 16, CHA: 10 },
        race_asi: flat,
        use_multiclass: true,
        dip: second("monk", 1, "openhand"),
      }),
    );
    expect(ch.combat.ac).toBe(16);
    expect(ch.combat.armor).toBe("No armor");
    expect(ch.cards.filter((card) => card.name === "Unarmored Defense")).toHaveLength(2);
  });

  it("marks a short score off book and allows the class", () => {
    const scores = { STR: 8, DEX: 15, CON: 14, INT: 10, WIS: 12, CHA: 8 };
    const shared = {
      cls: "fighter",
      subclass: "champion",
      level: 7,
      base_scores: scores,
      race_asi: flat,
      use_multiclass: true,
    };
    const rogue = buildCharacter(tables, req({ ...shared, dip: second("rogue", 2, "thief") }));
    const wizard = buildCharacter(tables, req({ ...shared, dip: second("wizard", 2, "evocation") }));
    expect(rogue.identity.offbook).toBeNull();
    expect(wizard.identity.offbook).toBe("off book: Intelligence 13");
    expect(sheetHtml(wizard)).toContain("off book: Intelligence 13");
    expect(wizard.identity.second).toContain("Wizard");
  });

  it("puts a dot between the second class and an off-book score", () => {
    const ch = buildCharacter(
      tables,
      req({
        name: "Pip",
        cls: "bard",
        subclass: "lore",
        level: 5,
        base_scores: { STR: 10, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 8 },
        race_asi: flat,
        use_multiclass: true,
        dip: second("warlock", 1, "fiend"),
      }),
    );
    expect(ch.identity.subclass).toBe("College of Lore");
    expect(ch.identity.offbook).toBe("off book: Charisma 13");
    expect(sheetHtml(ch)).toContain(' • <span class="worn off">off book: Charisma 13</span>');
  });

  it("names a multiclass hero as both classes, and one class as a level", () => {
    const dipped = buildCharacter(
      tables,
      req({
        cls: "rogue",
        subclass: "thief",
        level: 5,
        use_multiclass: true,
        dip: second("bard", 1, "lore"),
      }),
    );
    expect(classLine(dipped.identity)).toBe("Rogue (Thief) 4 • Bard 1");
    const alone = buildCharacter(tables, req({ cls: "rogue", subclass: "thief", level: 5 }));
    expect(classLine(alone.identity)).toBe("Lv 5 Rogue (Thief)");
    const early = buildCharacter(tables, req({ cls: "fighter", subclass: "champion", level: 1 }));
    expect(classLine(early.identity)).toBe("Lv 1 Fighter");
    const domain = buildCharacter(tables, req({ cls: "cleric", subclass: "life", level: 1 }));
    expect(classLine(domain.identity)).toBe("Lv 1 Cleric (Life Domain)");
  });

  it("lets a Life cleric dip wear heavy armor", () => {
    const dipped = options(
      tables,
      req({
        cls: "wizard",
        subclass: "evocation",
        level: 6,
        use_multiclass: true,
        dip: second("cleric", 1, "life"),
      }),
    );
    const plain = options(tables, req({ cls: "wizard", subclass: "evocation", level: 6 }));
    expect(dipped.armorOptions.find((armor) => armor.name === "Plate armor")?.trained).toBe(true);
    expect(plain.armorOptions.find((armor) => armor.name === "Plate armor")?.trained).toBe(false);
  });

  it("can take a feat with no second class, and a second class with no feat", () => {
    const featOnly = buildCharacter(
      tables,
      req({ cls: "fighter", subclass: "champion", level: 4, use_feats: true, feat: "alert" }),
    );
    expect(featOnly.identity.second).toBeNull();
    expect(featOnly.feat?.name).toBe("Alert");
    const dipOnly = buildCharacter(
      tables,
      req({
        cls: "fighter",
        subclass: "champion",
        level: 7,
        use_multiclass: true,
        dip: second("wizard", 2, "evocation"),
      }),
    );
    expect(dipOnly.feat).toBeNull();
    expect(dipOnly.identity.second).toContain("Wizard");
    expect(cards(dipOnly).has("Alert")).toBe(false);
    const both = buildCharacter(
      tables,
      req({
        cls: "fighter",
        subclass: "champion",
        level: 6,
        use_feats: true,
        feat: "alert",
        use_multiclass: true,
        dip: second("wizard", 2, "evocation"),
      }),
    );
    expect(both.feat?.name).toBe("Alert");
    expect(both.identity.main_level).toBe(4);
    expect(both.identity.second).toContain("Wizard");
    const early = buildCharacter(
      tables,
      req({
        cls: "fighter",
        subclass: "champion",
        level: 7,
        use_feats: true,
        feat: "alert",
        use_multiclass: true,
        dip: second("wizard", 5, "evocation"),
      }),
    );
    expect(early.identity.main_level).toBe(2);
    expect(early.feat).toBeNull();
  });

  it("refuses a dip that takes every level", () => {
    expect(() => buildCharacter(tables, req({ level: 5, use_multiclass: true, dip: second("wizard", 5) }))).toThrow(
      /second class/,
    );
  });

  it("builds every first class with every other class", () => {
    let n = 0;
    for (const main of tables.classes) {
      for (const other of tables.classes) {
        if (other.id === main.id) continue;
        for (let dipLevel = 1; dipLevel <= 6; dipLevel++) {
          const label = `${main.id} ${other.id} ${dipLevel}`;
          let ch: ReturnType<typeof buildCharacter>;
          try {
            ch = buildCharacter(
              tables,
              req({
                cls: main.id,
                level: 7,
                use_multiclass: true,
                dip: second(other.id, dipLevel),
              }),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`${label}: ${message}`);
          }
          expect(ch.identity.level, label).toBe(7);
          expect(ch.identity.main_level, label).toBe(7 - dipLevel);
          expect(ch.identity.second, label).toContain(other.name);
          expect(ch.combat.dice, label).toBeTruthy();
          for (const text of allText(ch)) expect(text, label).not.toMatch(/[{}]/);
          n += 1;
        }
      }
    }
    expect(n).toBe(12 * 11 * 6);
  });
});

function scores(over: Partial<AbilityScores> = {}): AbilityScores {
  return { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10, ...over };
}

function classRow(id: string): ClassRow {
  const row = tables.classes.find((item) => item.id === id);
  if (!row) throw new Error(`missing ${id}`);
  return row;
}

describe("multiclass rules", () => {
  it("counts full levels and half of each half caster, and leaves pact out", () => {
    expect(
      casterLevels([
        { kind: "full", level: 3 },
        { kind: "half", level: 1 },
        { kind: "half", level: 2 },
        { kind: "pact", level: 2 },
        { kind: "none", level: 4 },
      ]),
    ).toBe(4);
  });

  it("merges hit dice that match", () => {
    expect(diceLabel(8, 4, 8, 3)).toBe("7d8");
    expect(diceLabel(10, 5, 6, 2)).toBe("5d10 + 2d6");
  });

  it("reads the score gate from the class, and falls back to its first ability", () => {
    expect(prereqMiss(classRow("fighter"), scores({ STR: 12, DEX: 12 }))).toEqual(["Strength or Dexterity 13"]);
    expect(prereqMiss(classRow("fighter"), scores({ DEX: 13 }))).toEqual([]);
    expect(prereqMiss(classRow("paladin"), scores({ STR: 14, CHA: 10 }))).toEqual(["Charisma 13"]);
    expect(wantsText(classRow("fighter"))).toBe("Usually wants Strength or Dexterity 13");
    expect(wantsText(classRow("paladin"))).toBe("Usually wants Strength and Charisma 13");
    const bare = { ...classRow("wizard"), multiclass: null };
    expect(prereqMiss(bare, scores({ INT: 12 }))).toEqual(["Intelligence 13"]);
    expect(wantsText(bare)).toBe("Usually wants Intelligence 13");
  });

  it("counts prepared and known spells from the class level", () => {
    const known: Caster = {
      kind: "full",
      ability: "INT",
      cantrips: [],
      mode: "known",
      known: [2, 3],
      level_mult: 1,
      cap: 10,
    };
    expect(spellsKnown(known, 2, 4, 1)).toBe(3);
    expect(spellsKnown(known, 2, 4, 0)).toBe(0);
    expect(spellsKnown({ ...known, mode: "prepared", level_mult: 1 }, 3, 2, 2)).toBe(5);
    expect(spellsKnown(known, 9, 4, 1)).toBeUndefined();
    const prepared = { ...known, mode: "prepared", level_mult: 1, cap: 8 };
    expect(spellsKnown(prepared, 7, 4, 4)).toBe(8);
    expect(spellsKnown(prepared, 20, 5, 9)).toBe(25);
  });
});

function spellSections(ch: Character): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const card of ch.cards) {
    const match = /^Level (\d+) /.exec(card.section);
    if (!match?.[1]) continue;
    const level = Number(match[1]);
    const names = out.get(level) ?? [];
    names.push(card.name);
    out.set(level, names);
  }
  return out;
}

function castableLevels(cls: string, level: number): number[] {
  const row = tables.classes.find((item) => item.id === cls);
  const slots = tables.slots.find((item) => item.kind === row?.caster.kind && item.level === level);
  const maxSpell = maxSpellOf(slots?.slots ?? []);
  const have = new Set<number>();
  for (const name of row?.spell_order ?? []) {
    const spell = tables.spells.find((item) => item.name === name);
    if (spell && spell.lvl >= 1 && spell.lvl <= maxSpell) have.add(spell.lvl);
  }
  return [...have].sort((a, b) => a - b);
}

describe("spell selection", () => {
  it("a level 20 wizard prepares Intelligence plus level, through 9th", () => {
    const ch = buildCharacter(tables, req({ cls: "wizard", subclass: "evocation", level: 20 }));
    const intelligence = ch.abilities.find((row) => row.key === "INT");
    const prepared = ch.cards.filter((card) => /^Level \d+ Spells$/.test(card.section));
    expect(prepared).toHaveLength((intelligence?.mod ?? 0) + 20);
    const levels = spellSections(ch);
    for (let level = 1; level <= 9; level += 1) expect(levels.get(level)?.length ?? 0).toBeGreaterThan(0);
    expect(levels.get(9)).toContain("Wish");
    expect(levels.get(8)?.length ?? 0).toBeGreaterThan(0);
    expect(prepared.some((card) => card.name === "Polymorph")).toBe(true);
  });

  it("prints a spell of every level the class can cast", () => {
    const heroes = [
      { cls: "wizard", subclass: "evocation", level: 20 },
      { cls: "druid", subclass: "moon", level: 7 },
      { cls: "warlock", subclass: "fiend", level: 7 },
      { cls: "bard", subclass: "lore", level: 20 },
      { cls: "sorcerer", subclass: "draconic", level: 20 },
      { cls: "cleric", subclass: "life", level: 20 },
    ];
    for (const hero of heroes) {
      const ch = buildCharacter(tables, req(hero));
      const printed = spellSections(ch);
      for (const level of castableLevels(hero.cls, hero.level)) {
        expect(printed.get(level)?.length ?? 0, `${hero.cls} ${hero.level} level ${level}`).toBeGreaterThan(0);
      }
    }
  });

  it("gives each prepared class its own count", () => {
    const count = (id: string, level: number, mod: number) => spellsKnown(classRow(id).caster, level, mod, 9);
    expect(count("cleric", 7, 5)).toBe(4);
    expect(count("druid", 7, 5)).toBe(8);
    expect(count("wizard", 7, 5)).toBe(8);
    expect(count("paladin", 7, 5)).toBe(6);
    expect(count("cleric", 20, 5)).toBe(25);
    expect(count("druid", 20, 5)).toBe(25);
    expect(count("wizard", 20, 5)).toBe(25);
    expect(count("paladin", 20, 5)).toBe(15);
    const scores = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 20, CHA: 10 };
    const cleric = buildCharacter(
      tables,
      req({ cls: "cleric", subclass: "life", level: 7, base_scores: scores, race_asi: flat }),
    );
    const paladin = buildCharacter(
      tables,
      req({
        cls: "paladin",
        subclass: "devotion",
        level: 20,
        base_scores: { ...scores, WIS: 10, CHA: 20 },
        race_asi: flat,
      }),
    );
    const listed = (ch: Character) =>
      ch.cards.filter((card) => /^Level \d+ Spells$/.test(card.section) && !card.note?.includes("extra"));
    expect(listed(cleric)).toHaveLength(4);
    expect(listed(paladin).length).toBeLessThan(15);
    expect(listed(paladin).some((card) => card.name === "Find Steed")).toBe(true);
  });

  it("keeps a level 7 wizard inside the usual prepared cap", () => {
    const ch = buildCharacter(tables, req({ cls: "wizard", subclass: "evocation", level: 7 }));
    const prepared = ch.cards.filter((card) => /^Level \d+ Spells$/.test(card.section));
    expect(prepared).toHaveLength(8);
    const levels = spellSections(ch);
    expect(levels.get(4)).toContain("Polymorph");
    expect(levels.has(5)).toBe(false);
  });
});

describe("multiclass sheets", () => {
  it("keeps pact slots beside a full caster", () => {
    const ch = buildCharacter(
      tables,
      req({
        cls: "wizard",
        subclass: "evocation",
        level: 7,
        use_multiclass: true,
        dip: second("warlock", 2, "fiend"),
      }),
    );
    expect(ch.spellcasting?.slots).toEqual(listedSlots([4, 3, 2]));
    expect(ch.spellcasting?.rest).toBe("long");
    expect(ch.pact?.slots).toEqual([{ level: 1, count: 2 }]);
    expect(ch.pact?.rest).toBe("short");
    expect(ch.casters.map((line) => line.name)).toEqual(["Wizard", "Warlock"]);
  });

  it("prints one hit die when both classes share it, on two pages", () => {
    const ch = buildCharacter(
      tables,
      req({
        cls: "cleric",
        subclass: "life",
        level: 7,
        use_multiclass: true,
        dip: second("druid", 3, "land"),
      }),
    );
    expect(ch.combat.dice).toBe("7d8");
    expect(sheetHtml(ch).match(/class="page /g)).toHaveLength(2);
  });
});
