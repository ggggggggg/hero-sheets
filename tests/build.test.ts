import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  abilityTip,
  buildCharacter,
  CharError,
  hpTip,
  noticeTip,
  options,
  profTip,
  sheetHtml,
  signed,
  skillTip,
  speaksTip,
  speedTip,
  spellRules,
  spellTip,
} from "../src/core";
import { heroRequest, mergeCustom, parseCustomText } from "../src/custom";
import type { Ability, AbilityScores, Tables } from "../src/types";
import { allText, cards, freshTables, picks, req } from "./helpers";

const tables = freshTables();

function attack(ch: ReturnType<typeof buildCharacter>, name: string) {
  const row = ch.attacks.find((item) => item.name === name);
  if (!row) throw new Error(`missing attack ${name}`);
  return row;
}

describe("every built-in combo", () => {
  it("builds levels 1–7 with no leftover placeholders", () => {
    let n = 0;
    for (const race of tables.races) {
      for (const cls of tables.classes) {
        const subs = tables.subclasses.filter((sub) => sub.class_id === cls.id);
        for (const sub of subs) {
          for (let level = 1; level <= 7; level++) {
            const ch = buildCharacter(tables, req({ race: race.id, cls: cls.id, subclass: sub.id, level }));
            expect(ch.identity.level).toBe(level);
            expect(ch.combat.max_hp).toBeGreaterThan(0);
            for (const text of allText(ch)) expect(text).not.toMatch(/[{}]/);
            n += 1;
          }
        }
      }
    }
    expect(tables.races).toHaveLength(8);
    expect(tables.subclasses).toHaveLength(24);
    expect(n).toBe(8 * 24 * 7);
  });
});

describe("sheet follows the rows a hero uses", () => {
  const hero = req({ race: "human", cls: "wizard", subclass: "evocation", level: 1 });

  it("changes when a used feature changes", () => {
    const before = sheetHtml(buildCharacter(tables, hero));
    const edited = freshTables();
    const feature = edited.features.find((row) => row.owner_id === "wizard" && row.lvl <= 1 && row.card.desc);
    if (!feature) throw new Error("wizard has no level-1 feature");
    feature.card.desc = "QQQQZZZZ used feature";
    const after = sheetHtml(buildCharacter(edited, hero));
    expect(after).not.toBe(before);
    expect(after).toContain("QQQQZZZZ used feature");
  });

  it("stays the same when an unused feature changes", () => {
    const before = sheetHtml(buildCharacter(tables, hero));
    const edited = freshTables();
    const feature = edited.features.find((row) => row.card.name === "Sneak Attack");
    if (!feature) throw new Error("missing Sneak Attack");
    feature.card.name = "Backstab";
    feature.card.desc = "QQQQZZZZ unused feature";
    expect(sheetHtml(buildCharacter(edited, hero))).toBe(before);
  });
});

describe("known heroes", () => {
  it("builds Tobin at level 5", () => {
    const ch = buildCharacter(
      tables,
      req({
        name: "Tobin",
        race: "dwarf",
        cls: "warlock",
        subclass: "fiend",
        level: 5,
        choices: picks({
          invocations: ["Agonizing Blast", "Fiendish Vigor", "Eldritch Spear"],
          pact: ["Pact of the Chain"],
        }),
      }),
    );
    expect(ch.identity.subclass).toBe("The Fiend");
    expect(ch.combat.max_hp).toBe(8 + 3 + 4 * (5 + 3) + 5);
    expect(ch.spellcasting?.slots).toEqual([{ level: 3, count: 2 }]);
    expect(ch.spellcasting?.rest).toBe("short");
    const blast = attack(ch, "Eldritch Blast");
    expect(blast.damage).toBe("1d10+3");
    expect(blast.note.startsWith("2 beams")).toBe(true);
    const names = cards(ch);
    expect(names.has("Pact of the Chain")).toBe(true);
    expect(names.has("Dark One's Blessing")).toBe(true);
    expect(ch.combat.hp_parts.reduce((sum, part) => sum + part.amount, 0)).toBe(ch.combat.max_hp);
    expect(hpTip(ch.combat).lines.map((line) => line[0])).toEqual(["Level 1", "Levels 2–5", "Race"]);
    expect(hpTip(ch.combat).lines[2]?.[1]).toContain("Hill Dwarf");
    expect(speedTip(ch.combat)).toEqual({ title: "Speed 25", lines: [["Hill Dwarf", "25"]] });
    const casting = ch.spellcasting;
    if (!casting) throw new Error("missing spellcasting");
    const spell = spellTip(casting);
    expect(spell.title).toBe("Spell attack +6");
    expect(spell.lines[0]?.[1]).toContain("spell attack");
    expect(spell.lines.some((line) => line[0] === "Charisma" && line[1]?.includes("Warlock"))).toBe(true);
    expect(spell.lines.some((line) => line[0] === "Save DC" && line[1]?.includes("14"))).toBe(true);
  });

  it("adds a monk's extra speed and says when a number was typed", () => {
    const monk = buildCharacter(tables, req({ race: "human", cls: "monk", subclass: null, level: 2 }));
    expect(speedTip(monk.combat).lines).toEqual([
      ["Human", "30"],
      ["Monk", "+10"],
    ]);
    const typed = buildCharacter(
      tables,
      req({
        race: "dwarf",
        cls: "warlock",
        subclass: "fiend",
        level: 5,
        numbers: { hp: 99, speed: 15, spell_attack: 1, spell_dc: 30 },
      }),
    );
    expect(hpTip(typed.combat).lines[0]?.[1]).toContain("Talk to your DM");
    expect(hpTip(typed.combat).title).toBe("Max HP 99");
    expect(speedTip(typed.combat).lines[0]?.[1]).toContain("Talk to your DM");
    const casting = typed.spellcasting;
    if (!casting) throw new Error("missing spellcasting");
    const spell = spellTip(casting);
    expect(spell.title).toBe("Spell attack +1");
    expect(spell.lines.some((line) => line[1]?.includes("usual attack"))).toBe(true);
    expect(spell.lines.some((line) => line[1]?.includes("usual save DC"))).toBe(true);
  });

  it("explains a spell's die, the ability bonus, and an extra spell", () => {
    const cleric = buildCharacter(tables, req({ cls: "cleric", subclass: "life", level: 1 }));
    const cure = cleric.cards.find((card) => card.name === "Cure Wounds");
    if (!cure?.why) throw new Error("missing Cure Wounds");
    expect(cure.note).toContain("extra");
    expect(cure.why).toContain("1d8 is the spell's roll");
    expect(cure.why).toContain("Wisdom");
    expect(cure.why).toContain("Extra means Life Domain gives this one");
  });

  it("replaces a sheet number and marks it off book", () => {
    const hero = req({ cls: "fighter", level: 1 });
    const book = buildCharacter(tables, hero);
    const acrobatics = book.skills.find((skill) => skill.name === "Acrobatics");
    const perception = book.skills.find((skill) => skill.name === "Perception");
    const strength = book.abilities.find((ability) => ability.key === "STR");
    if (!acrobatics || !perception || !strength) throw new Error("missing a book number");
    const tweaked = buildCharacter(
      tables,
      req({
        cls: "fighter",
        level: 1,
        numbers: {
          skills: { Acrobatics: acrobatics.bonus + 4 },
          saves: { STR: strength.save + 3 },
          ac: book.combat.ac + 5,
        },
      }),
    );
    const next = tweaked.skills.find((skill) => skill.name === "Acrobatics");
    expect(next?.bonus).toBe(acrobatics.bonus + 4);
    expect(next?.offbook).toBe(true);
    expect(tweaked.abilities.find((ability) => ability.key === "STR")?.save).toBe(strength.save + 3);
    expect(tweaked.combat.ac).toBe(book.combat.ac + 5);
    expect(tweaked.combat.ac_offbook).toBe(true);
    const html = sheetHtml(tweaked);
    expect(html).toContain(`${signed(acrobatics.bonus + 4)}*`);
    expect(html).toContain(`save ${signed(strength.save + 3)}*`);
    expect(html).toContain("off book");
    expect(sheetHtml(book)).not.toContain("off book");
    expect(sheetHtml(book)).not.toContain(`${signed(acrobatics.bonus + 4)}*`);
    const followed = buildCharacter(
      tables,
      req({ cls: "fighter", level: 1, numbers: { skills: { Perception: perception.bonus + 2 } } }),
    );
    expect(followed.combat.passive_perception).toBe(10 + perception.bonus + 2);
    expect(followed.combat.notice_offbook).toBeUndefined();
    const both = buildCharacter(
      tables,
      req({
        cls: "fighter",
        level: 1,
        numbers: { skills: { Perception: perception.bonus + 2 }, notice: 3 },
      }),
    );
    expect(both.combat.passive_perception).toBe(3);
    expect(both.combat.notice_offbook).toBe(true);
  });

  it("marks every other off-book number, and a book value stays unmarked", () => {
    const hero = req({ cls: "wizard", level: 1 });
    const book = buildCharacter(tables, hero);
    const melee = book.attacks[0];
    const acrobatics = book.skills.find((skill) => skill.name === "Acrobatics");
    const casting = book.spellcasting;
    if (!melee || !acrobatics || !casting) throw new Error("missing a book number");
    const same = buildCharacter(
      tables,
      req({
        cls: "wizard",
        level: 1,
        numbers: { ac: book.combat.ac, skills: { Acrobatics: acrobatics.bonus } },
      }),
    );
    expect(same.combat.ac).toBe(book.combat.ac);
    expect(same.combat.ac_offbook).toBeUndefined();
    expect(same.skills.find((skill) => skill.name === "Acrobatics")?.offbook).toBeUndefined();

    const tweaked = buildCharacter(
      tables,
      req({
        cls: "wizard",
        level: 1,
        numbers: {
          hp: book.combat.max_hp + 9,
          speed: book.combat.speed + 10,
          swim: 30,
          initiative: book.combat.initiative + 4,
          prof: book.combat.prof + 1,
          notice: 22,
          spell_attack: casting.attack + 3,
          spell_dc: casting.dc + 2,
          attacks: { [melee.name]: melee.to_hit + 5 },
        },
      }),
    );
    expect(tweaked.combat.max_hp).toBe(book.combat.max_hp + 9);
    expect(tweaked.combat.hp_offbook).toBe(true);
    expect(tweaked.combat.speed).toBe(book.combat.speed + 10);
    expect(tweaked.combat.speed_offbook).toBe(true);
    expect(tweaked.combat.swim).toBe(30);
    expect(tweaked.combat.swim_offbook).toBe(true);
    expect(tweaked.combat.initiative).toBe(book.combat.initiative + 4);
    expect(tweaked.combat.initiative_offbook).toBe(true);
    expect(tweaked.combat.prof).toBe(book.combat.prof + 1);
    expect(tweaked.combat.prof_offbook).toBe(true);
    expect(tweaked.combat.passive_perception).toBe(22);
    expect(tweaked.combat.notice_offbook).toBe(true);
    expect(tweaked.spellcasting?.attack).toBe(casting.attack + 3);
    expect(tweaked.spellcasting?.attack_offbook).toBe(true);
    expect(tweaked.spellcasting?.dc).toBe(casting.dc + 2);
    expect(tweaked.spellcasting?.dc_offbook).toBe(true);
    const hit = tweaked.attacks.find((row) => row.name === melee.name);
    expect(hit?.to_hit).toBe(melee.to_hit + 5);
    expect(hit?.offbook).toBe(true);

    const html = sheetHtml(tweaked);
    expect(html).toContain(`<b>${tweaked.combat.max_hp}</b>`);
    expect(html).toContain(`<b>${tweaked.combat.speed}</b>`);
    expect(html).toContain("swim 30 • off book");
    expect(html).toContain('<span class="worn off">off book</span>');
    expect(html).toContain(`Proficiency <b>${signed(tweaked.combat.prof)}*</b>`);
    expect(html).toContain("Notice <b>22*</b>");
    expect(html).toContain(`Spell attack ${signed(casting.attack + 3)}* • DC ${casting.dc + 2}*`);
    expect(html).toContain(`${signed(melee.to_hit + 5)}*`);
    expect(sheetHtml(book)).not.toContain("off book");
    expect(sheetHtml(book)).not.toContain("22*");

    const fighter = buildCharacter(
      tables,
      req({ cls: "fighter", level: 1, numbers: { spell_attack: 9, spell_dc: 19 } }),
    );
    expect(fighter.spellcasting).toBeNull();
    expect(sheetHtml(fighter)).not.toContain("Spell attack");
  });

  it("adds a shield for any hero and marks an untrained one off book", () => {
    const bare = buildCharacter(
      tables,
      req({ cls: "bard", subclass: "lore", level: 1, armor: "Studded leather", shield: false }),
    );
    const held = buildCharacter(
      tables,
      req({ cls: "bard", subclass: "lore", level: 1, armor: "Studded leather", shield: true }),
    );
    expect(held.combat.ac).toBe(bare.combat.ac + 2);
    expect(held.combat.armor).toContain("Studded leather + shield");
    expect(held.combat.armor_offbook).toBe(true);
    expect(bare.combat.armor_offbook).toBe(false);
    expect(sheetHtml(held)).toContain("off book");
    const fighter = buildCharacter(
      tables,
      req({ cls: "fighter", subclass: "champion", level: 1, armor: "Chain mail", shield: true }),
    );
    expect(fighter.combat.armor).toContain("+ shield");
    expect(fighter.combat.armor_offbook).toBe(false);
  });

  it("names an uncommon item with an, and a rare item with a", () => {
    const low = options(tables, req({ cls: "fighter", level: 1 }));
    expect(low.itemWarn("Potion of Greater Healing")).toBe(
      "By the usual rules it's an uncommon item, usually for heroes level 3 and up",
    );
    expect(low.itemWarn("Potion of Superior Healing")).toBe(
      "By the usual rules it's a rare item, usually for heroes level 5 and up",
    );
    expect(low.itemWarn("No Such Potion")).toBe("");
    expect(options(tables, req({ cls: "fighter", level: 5 })).itemWarn("Potion of Greater Healing")).toBe("");
  });

  it("waits for the subclass level", () => {
    const early = buildCharacter(tables, req({ cls: "fighter", subclass: "champion", level: 2 }));
    const late = buildCharacter(tables, req({ cls: "fighter", subclass: "champion", level: 3 }));
    expect(early.identity.subclass).toBeNull();
    expect(late.identity.subclass).toBe("Champion");
    expect(cards(early).has("Improved Critical")).toBe(false);
    expect(cards(late).has("Improved Critical")).toBe(true);
  });

  it("applies fighting styles", () => {
    const base = buildCharacter(
      tables,
      req({ cls: "fighter", choices: picks({ fighting_style: ["Great Weapon Fighting"] }) }),
    );
    const defense = buildCharacter(tables, req({ cls: "fighter", choices: picks({ fighting_style: ["Defense"] }) }));
    const dueling = buildCharacter(tables, req({ cls: "fighter", choices: picks({ fighting_style: ["Dueling"] }) }));
    const archery = buildCharacter(tables, req({ cls: "fighter", choices: picks({ fighting_style: ["Archery"] }) }));
    expect(defense.combat.ac).toBe(base.combat.ac + 1);
    expect(attack(dueling, "Longsword").damage).not.toBe(attack(base, "Longsword").damage);
    expect(attack(archery, "Heavy crossbow").to_hit).toBe(attack(base, "Heavy crossbow").to_hit + 2);
  });

  it("prints every weapon the hero is carrying", () => {
    const names = (over: Parameters<typeof req>[0]) => buildCharacter(tables, req(over)).attacks.map((row) => row.name);
    expect(names({ cls: "fighter", extra_weapons: ["Longsword", "Battleaxe"] })).toEqual([
      "Longsword",
      "Battleaxe",
      "Heavy crossbow",
    ]);
    expect(names({ cls: "fighter", extra_weapons: ["Battleaxe"] })).toEqual(["Battleaxe", "Heavy crossbow"]);
    expect(names({ cls: "fighter", extra_weapons: ["Longsword", "Longsword"] })).toEqual([
      "Longsword",
      "Heavy crossbow",
    ]);
    expect(names({ cls: "fighter", extra_weapons: [] })).toEqual(names({ cls: "fighter" }));
    expect(names({ cls: "fighter", weapon: "Battleaxe" })).toEqual(["Battleaxe", "Heavy crossbow"]);
    expect(names({ cls: "fighter", weapon: "Greataxe", extra_weapons: ["Longsword", "Battleaxe"] })).toEqual([
      "Longsword",
      "Battleaxe",
      "Heavy crossbow",
    ]);
    const plus = buildCharacter(
      tables,
      req({ cls: "fighter", extra_weapons: ["Battleaxe", "Longsword"], weapon_plus: 1 }),
    );
    expect(plus.attacks.map((row) => [row.name, row.edit])).toEqual([
      ["Battleaxe +1", "weapon"],
      ["Longsword", "weapon"],
      ["Heavy crossbow", "class"],
    ]);
    expect(() => buildCharacter(tables, req({ cls: "fighter", extra_weapons: ["Anchor"] }))).toThrow(CharError);
    expect(() => buildCharacter(tables, req({ cls: "fighter", extra_weapons: ["Anchor"] }))).toThrow(
      /can't use Anchor/,
    );
    const shielded = buildCharacter(
      tables,
      req({ cls: "fighter", shield: true, extra_weapons: ["Longsword", "Greataxe"] }),
    );
    expect(shielded.combat.armor).toContain("shield");
    expect(shielded.attacks.map((row) => row.name)).toContain("Greataxe");
    expect(() => buildCharacter(tables, req({ cls: "fighter", shield: true, weapon: "Greataxe" }))).toThrow(/shield/);
    expect(names({ cls: "rogue", extra_weapons: ["Shortsword"] })).toEqual(["Shortsword", "Shortbow"]);
    expect(names({ cls: "barbarian", extra_weapons: ["Greataxe", "Handaxe"] })).toEqual([
      "Greataxe",
      "Handaxe",
      "Handaxe (x2)",
    ]);
    expect(names({ cls: "warlock", extra_weapons: ["Dagger", "Quarterstaff"] })).toEqual([
      "Eldritch Blast",
      "Dagger",
      "Quarterstaff",
    ]);
    const dipped = buildCharacter(
      tables,
      req({
        cls: "bard",
        subclass: "lore",
        level: 3,
        use_multiclass: true,
        weapon_plus: 1,
        extra_weapons: ["Club", "Dagger"],
        dip: { cls: "warlock", subclass: "fiend", level: 1, cantrips: null, spells: null, path_spells: null },
      }),
    );
    expect(dipped.attacks.map((row) => [row.name, row.edit])).toEqual([
      ["Club +1", "weapon"],
      ["Dagger", "weapon"],
      ["Eldritch Blast", "dip-cantrips"],
    ]);
    const probed = options(tables, req({ cls: "fighter", extra_weapons: ["Longsword"] }));
    const plain = options(tables, req({ cls: "fighter" }));
    const damage = (built: ReturnType<typeof options>, name: string) =>
      built.weaponOptions.find((weapon) => weapon.name === name)?.damage;
    expect(damage(probed, "Greataxe")).toBe(damage(plain, "Greataxe"));
    expect(damage(probed, "Greataxe")).not.toBe(damage(probed, "Longsword"));
  });

  it("lets dragonborn ancestry change the breath weapon", () => {
    const blue = cards(
      buildCharacter(tables, req({ race: "dragonborn", choices: picks({ ancestry: ["Blue Dragon Ancestry"] }) })),
    );
    const breath = blue.get("Breath Weapon");
    expect(breath?.desc).toContain("lightning");
    expect(breath?.desc).toContain("30-ft line");
  });

  it("scales warlock spells to the pact slot", () => {
    const low = cards(
      buildCharacter(tables, req({ cls: "warlock", subclass: "fiend", level: 1, spells: ["Hellish Rebuke"] })),
    );
    expect(low.get("Hellish Rebuke")?.desc).toContain("2d10 fire");
    const high = cards(
      buildCharacter(
        tables,
        req({
          cls: "warlock",
          subclass: "fiend",
          level: 5,
          spells: ["Hellish Rebuke", "Armor of Agathys", "Hold Person"],
        }),
      ),
    );
    expect(high.get("Hellish Rebuke")?.desc).toContain("4d10 fire");
    expect(high.get("Hellish Rebuke")?.note).toContain("cast at lvl 3");
  });
});

describe("ported rules that have to stay", () => {
  it("puts Shillelagh and Fire Bolt on the attack list", () => {
    const druid = buildCharacter(tables, req({ cls: "druid", subclass: "moon", level: 1 }));
    expect(druid.attacks.some((row) => row.name.includes("Shillelagh"))).toBe(true);
    const wizard = buildCharacter(tables, req({ cls: "wizard", subclass: "evocation", level: 1 }));
    const sorcerer = buildCharacter(tables, req({ cls: "sorcerer", subclass: "draconic", level: 1 }));
    expect(wizard.attacks.some((row) => row.name === "Fire Bolt")).toBe(true);
    expect(sorcerer.attacks.some((row) => row.name === "Fire Bolt")).toBe(true);
  });

  it("fills Barkskin placeholders and marks concentration", () => {
    const ch = buildCharacter(
      tables,
      req({
        cls: "druid",
        subclass: "land",
        level: 3,
        spells: ["Barkskin (OG)", "Spike Growth"],
      }),
    );
    const bark = cards(ch).get("Barkskin");
    const og = cards(ch).get("Barkskin (OG)");
    const spikes = cards(ch).get("Spike Growth");
    expect(bark?.desc).toContain(String(ch.combat.ac + 1));
    expect(bark?.desc).not.toContain("{AC1}");
    expect(bark?.note).toContain("extra");
    expect(og?.desc).toContain(String(Math.max(ch.combat.ac, 16)));
    expect(og?.desc).not.toContain("{AC16}");
    expect(og?.conc).toBe(true);
    expect(spikes?.conc).toBe(true);
    const html = sheetHtml(ch);
    expect(html).toContain('class="chip conc"');
    expect(cards(ch).get("Thorn Whip")?.note).toBe("extra");
    expect(html).not.toContain(">bonus<");
  });

  it("rebuilds the Flame Master pack", () => {
    const pack = parseCustomText(readFileSync(new URL("../examples/tobin-flame-master.json", import.meta.url), "utf8"));
    const merged = mergeCustom(freshTables(), pack);
    const heroes = pack.heroes;
    if (!Array.isArray(heroes) || !heroes[0] || typeof heroes[0] !== "object")
      throw new Error("tobin pack has no hero");
    const ch = buildCharacter(merged, heroRequest(heroes[0]));
    expect(ch.identity.race).toBe("Mountain Dwarf");
    expect([ch.combat.max_hp, ch.combat.ac, ch.combat.speed, ch.combat.initiative, ch.combat.prof]).toEqual([
      43, 16, 25, 5, 3,
    ]);
    expect(ch.combat.armor_offbook).toBe(false);
    expect(Object.fromEntries(ch.abilities.map((row) => [row.key, row.score]))).toEqual({
      STR: 10,
      DEX: 14,
      CON: 16,
      INT: 10,
      WIS: 12,
      CHA: 19,
    });
    expect(ch.attacks.map((row) => [row.name, row.to_hit, row.damage])).toEqual([
      ["Flame Blast", 7, "1d10+4"],
      ["Silver dagger", 5, "1d4+2"],
    ]);
    expect([ch.spellcasting?.attack, ch.spellcasting?.dc, ch.spellcasting?.slots]).toEqual([
      7,
      15,
      [{ level: 3, count: 2 }],
    ]);
    const named = cards(ch);
    expect(named.get("Dwarven Armor Training")?.desc).toContain("light and medium armor");
    expect(named.has("Dwarven Toughness")).toBe(false);
    expect(named.get("Hellish Rebuke")?.desc).toContain("4d10");
    expect(named.get("Fireball")?.desc).toContain("8d6");
    expect(named.get("Dark One's Blessing")?.desc).toContain("9 shield HP");
    expect(named.get("Dragon Strike")?.uses).toBe(1);
    expect(
      ch.skills
        .filter((row) => row.prof)
        .map((row) => row.name)
        .sort(),
    ).toEqual(["Arcana", "History", "Intimidation", "Perception"]);
  });

  it("lets the Flame Master wear heavy armor and marks it off book", () => {
    const pack = parseCustomText(readFileSync(new URL("../examples/tobin-flame-master.json", import.meta.url), "utf8"));
    const merged = mergeCustom(freshTables(), pack);
    const hill = options(merged, req({ race: "dwarf", cls: "flame_warlock", subrace: "hill", level: 5 }));
    const mountain = options(merged, req({ race: "dwarf", cls: "flame_warlock", subrace: "mountain", level: 5 }));
    expect(hill.armorOptions.find((armor) => armor.name === "Half plate")?.trained).toBe(false);
    expect(mountain.armorOptions.find((armor) => armor.name === "Half plate")?.trained).toBe(true);
    expect(mountain.armorOptions.find((armor) => armor.name === "Plate armor")?.trained).toBe(false);
    const plate = buildCharacter(merged, req({ race: "dwarf", cls: "flame_warlock", level: 5, armor: "Plate armor" }));
    expect(plate.combat.armor).toBe("Plate armor");
    expect(plate.combat.armor_offbook).toBe(true);
    expect(plate.combat.speed).toBe(15);
    expect(sheetHtml(plate)).toContain("Plate armor • off book");
  });
});

describe("refusals", () => {
  const bad: Partial<Parameters<typeof req>[0]>[] = [
    { race: "nope" },
    { cls: "nope" },
    { level: 0 },
    { level: 21 },
    { cls: "fighter", subclass: "fiend" },
    { cls: "fighter", choices: picks({ fighting_style: ["Defense", "Archery"] }) },
    { cls: "fighter", choices: picks({ fighting_style: ["Not A Style"] }) },
    { cls: "wizard", level: 1, spells: ["Fireball"] },
    { cls: "wizard", level: 1, spells: Array.from({ length: 9 }, () => "Magic Missile") },
    { cls: "wizard", level: 1, spells: ["Made Up Spell"] },
  ];

  it.each(bad)("rejects %j", (over) => {
    expect(() => buildCharacter(tables, req(over))).toThrow(CharError);
    try {
      buildCharacter(tables, req(over));
    } catch (error) {
      expect(error).toBeInstanceOf(CharError);
      if (error instanceof CharError) expect(error.kind).toBe("ValueError");
    }
  });

  it("requires every table", () => {
    const names = [
      "rules",
      "races",
      "classes",
      "subclasses",
      "slots",
      "features",
      "choices",
      "spells",
      "skills",
      "scaling",
      "items",
      "armor",
      "subraces",
      "weapons",
      "feats",
    ] as const;
    for (const name of names) {
      const copy = freshTables() as Partial<Tables>;
      delete copy[name];
      expect(() => buildCharacter(copy as Tables, req({ cls: "wizard", level: 3 }))).toThrow(CharError);
    }
  });
});

describe("editing a table", () => {
  it("follows a new hit die", () => {
    const hero = req({ cls: "wizard", level: 4 });
    const edited = freshTables();
    const wizard = edited.classes.find((row) => row.id === "wizard");
    if (!wizard) throw new Error("missing wizard");
    const before = buildCharacter(tables, hero).combat.max_hp;
    wizard.hit_die = 12;
    const after = buildCharacter(edited, hero);
    expect(after.combat.max_hp - before).toBe(12 - 6 + 3 * (Math.floor(12 / 2) + 1 - (Math.floor(6 / 2) + 1)));
    expect(after.combat.hit_die).toBe("d12");
  });

  it("follows a changed feature", () => {
    const edited = freshTables();
    const feature = edited.features.find((row) => row.owner_id === "rogue" && row.card.name === "Sneak Attack");
    if (!feature) throw new Error("missing Sneak Attack");
    feature.card = { ...feature.card, name: "Backstab", tag: "F", note: "", desc: "Stab them for {SNEAK} dice!" };
    const named = cards(buildCharacter(edited, req({ cls: "rogue", level: 1 })));
    expect(named.has("Sneak Attack")).toBe(false);
    expect(named.get("Backstab")?.desc).toBe("Stab them for 1 dice!");
  });

  it("follows rules numbers and scaling", () => {
    const edited = freshTables();
    const rules = edited.rules[0];
    if (!rules) throw new Error("missing rules");
    rules.prof_by_level = [9, 9, 9, 9, 9, 9, 9];
    rules.standard_array = [18, 17, 16, 15, 14, 13];
    const before = buildCharacter(tables, req({ cls: "bard", level: 3 }));
    const after = buildCharacter(edited, req({ cls: "bard", level: 3 }));
    expect(before.combat.prof).toBe(2);
    expect(after.combat.prof).toBe(9);
    expect(Math.max(...after.abilities.map((row) => row.score))).toBeGreaterThan(
      Math.max(...before.abilities.map((row) => row.score)),
    );

    const rage = freshTables();
    const row = rage.scaling.find((item) => item.owner_id === "barbarian" && item.key === "RAGES");
    if (!row) throw new Error("missing RAGES");
    expect(cards(buildCharacter(tables, req({ cls: "barbarian", level: 1 }))).get("Rage")?.uses).toBe(2);
    row.values = ["9", "9", "9", "9", "9", "9", "9"];
    expect(cards(buildCharacter(rage, req({ cls: "barbarian", level: 1 }))).get("Rage")?.uses).toBe(9);
  });
});

describe("fast-check", () => {
  it("ignores an unused race edit and keeps a random race edit", () => {
    const hero = req({ race: "human", cls: "fighter", subclass: "champion", level: 3 });
    const before = sheetHtml(buildCharacter(tables, hero));
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), fc.integer({ min: 0, max: 80 }), (name, speed) => {
        const edited = freshTables();
        const elf = edited.races.find((row) => row.id === "elf");
        if (!elf) throw new Error("missing elf");
        elf.name = `qx${name}`;
        elf.speed = speed;
        expect(sheetHtml(buildCharacter(edited, hero))).toBe(before);
        const elfHero = buildCharacter(edited, req({ race: "elf", cls: "fighter", level: 1 }));
        expect(elfHero.combat.max_hp).toBeGreaterThan(0);
        const original = tables.races.find((row) => row.id === "elf");
        if (!original) throw new Error("missing elf");
        const untouched = buildCharacter(tables, req({ race: "elf", cls: "fighter", level: 1 }));
        expect(elfHero.combat.speed - untouched.combat.speed).toBe(speed - original.speed);
      }),
      { numRuns: 20 },
    );
  });
});

describe("skill bonus", () => {
  function skill(ch: ReturnType<typeof buildCharacter>, name: string) {
    const row = ch.skills.find((item) => item.name === name);
    if (!row) throw new Error(`missing ${name}`);
    return row;
  }

  it("names the ability, the training, and expertise", () => {
    const rogue = buildCharacter(tables, req({ race: "elf", cls: "rogue", subclass: "thief", level: 1 }));
    const dex = rogue.abilities.find((row) => row.key === "DEX");
    if (!dex) throw new Error("missing dexterity");
    const stealth = skill(rogue, "Stealth");
    expect(stealth.parts).toEqual([
      { label: `Dexterity ${dex.score}`, amount: dex.mod, from: "" },
      { label: "Proficiency", amount: rogue.combat.prof, from: "Rogue" },
      { label: "Expertise", amount: rogue.combat.prof, from: "Rogue" },
    ]);
    expect(stealth.parts.reduce((sum, part) => sum + part.amount, 0)).toBe(stealth.bonus);
    expect(skill(rogue, "Perception").parts.find((part) => part.label === "Proficiency")?.from).toBe(
      "Rogue and Wood Elf",
    );
    expect(skill(rogue, "Athletics").parts).toHaveLength(1);
    expect(skill(rogue, "Acrobatics").expert).toBe(false);

    const bard = buildCharacter(tables, req({ cls: "bard", subclass: "lore", level: 3 }));
    expect(skill(bard, "Insight").parts.find((part) => part.label === "Proficiency")?.from).toBe("College of Lore");
    expect(skill(bard, "Performance").parts.find((part) => part.label === "Expertise")?.from).toBe("Bard");
    const later = buildCharacter(tables, req({ cls: "rogue", subclass: "thief", level: 6 }));
    expect(skill(later, "Acrobatics").expert).toBe(true);

    const off = buildCharacter(
      tables,
      req({ cls: "fighter", subclass: "champion", level: 1, numbers: { skills: { Athletics: 9 } } }),
    );
    const changed = skill(off, "Athletics");
    expect(changed.bonus).toBe(9);
    const tip = skillTip(changed);
    expect(tip.title).toBe("Athletics +9");
    expect(tip.lines[0]?.[1]).toContain("Talk to your DM");
    expect(tip.lines.some((line) => line[0] === "Proficiency" && line[1]?.includes("Fighter"))).toBe(true);
  });
});

describe("ability score", () => {
  const scores = (over: Partial<AbilityScores>): AbilityScores => ({
    STR: 8,
    DEX: 8,
    CON: 8,
    INT: 8,
    WIS: 8,
    CHA: 8,
    ...over,
  });
  function ability(ch: ReturnType<typeof buildCharacter>, key: Ability) {
    const row = ch.abilities.find((item) => item.key === key);
    if (!row) throw new Error(`missing ${key}`);
    return row;
  }

  it("names the array, point buy, race, ability boost, and feat", () => {
    const fighter = buildCharacter(tables, req({ level: 1 }));
    const strength = ability(fighter, "STR");
    expect(strength.parts).toEqual([
      { label: "Standard array", amount: 15, from: "" },
      { label: "Race", amount: 1, from: "Human" },
    ]);
    expect(strength.score).toBe(16);
    expect(strength.parts.reduce((sum, part) => sum + part.amount, 0)).toBe(strength.score);
    expect(strength.note).toBeUndefined();

    const grown = buildCharacter(tables, req({ level: 8 }));
    expect(ability(grown, "STR").parts).toEqual([
      { label: "Standard array", amount: 15, from: "" },
      { label: "Race", amount: 1, from: "Human" },
      { label: "Ability boost", amount: 2, from: "level 4" },
      { label: "Ability boost", amount: 2, from: "Fighter at level 6" },
    ]);
    expect(ability(grown, "STR").score).toBe(20);
    expect(ability(grown, "CON").parts).toContainEqual({ label: "Ability boost", amount: 2, from: "level 8" });
    const later = buildCharacter(tables, req({ level: 12 }));
    expect(ability(later, "CON").parts).toContainEqual({ label: "Ability boost", amount: 2, from: "level 8" });
    expect(ability(later, "CON").parts).toContainEqual({ label: "Ability boost", amount: 2, from: "level 12" });

    const athlete = buildCharacter(tables, req({ level: 4, use_feats: true, feat: "athlete" }));
    expect(ability(athlete, "STR").parts).toEqual([
      { label: "Standard array", amount: 15, from: "" },
      { label: "Race", amount: 1, from: "Human" },
      { label: "Feat", amount: 1, from: "Athlete" },
    ]);
    const alert = buildCharacter(tables, req({ level: 4, use_feats: true, feat: "alert" }));
    expect(ability(alert, "STR").parts.some((part) => part.label === "Ability boost" || part.label === "Feat")).toBe(
      false,
    );

    const split = buildCharacter(
      tables,
      req({
        level: 8,
        use_multiclass: true,
        dip: { cls: "wizard", subclass: null, level: 4, cantrips: null, spells: null, path_spells: null },
      }),
    );
    expect(ability(split, "STR").parts.find((part) => part.label === "Ability boost")?.from).toBe("level 4 Fighter");
    expect(ability(split, "INT").parts.find((part) => part.label === "Ability boost")?.from).toBe("level 4 Wizard");

    const bought = buildCharacter(
      tables,
      req({
        race: "dwarf",
        cls: "warlock",
        level: 1,
        base_scores: scores({ DEX: 14, CON: 14, WIS: 10, CHA: 15 }),
      }),
    );
    expect(ability(bought, "CON").parts).toEqual([
      { label: "Point buy", amount: 14, from: "" },
      { label: "Race", amount: 2, from: "Hill Dwarf" },
    ]);
    expect(ability(bought, "CON").note).toBeUndefined();
    expect(ability(bought, "CHA").parts).toEqual([{ label: "Point buy", amount: 15, from: "" }]);

    const shuffled = buildCharacter(
      tables,
      req({ base_scores: scores({ STR: 8, DEX: 14, CON: 15, INT: 12, WIS: 13, CHA: 10 }) }),
    );
    expect(ability(shuffled, "STR").parts[0]).toEqual({ label: "Standard array", amount: 8, from: "" });

    const high = buildCharacter(tables, req({ base_scores: scores({ STR: 16 }) }));
    const highStr = ability(high, "STR");
    expect(highStr.parts[0]?.label).toBe("Base");
    expect(abilityTip(highStr).lines[0]?.[1]).toContain("Talk to your DM");
    expect(abilityTip(highStr).title).toBe("Strength 17 (+3)");

    const over = buildCharacter(
      tables,
      req({ base_scores: scores({ STR: 15, DEX: 15, CON: 15, INT: 15, WIS: 15, CHA: 15 }) }),
    );
    expect(ability(over, "STR").note).toContain("over budget");

    const moved = buildCharacter(tables, req({ race_asi: { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 } }));
    expect(ability(moved, "STR").parts).toEqual([{ label: "Standard array", amount: 15, from: "" }]);
    expect(ability(moved, "STR").note).toContain("The usual is +6");
  });
});

describe("sheet facts", () => {
  const USE: Record<string, string> = {
    Acrobatics: "Keep your balance, tumble, and squeeze through a tight spot.",
    "Animal Handling": "Calm a scared animal, or tell what it wants.",
    Arcana: "Know spells, magic items, and other planes.",
    Athletics: "Climb, jump, swim, and shove.",
    Deception: "Tell a lie and make it sound true.",
    History: "Remember old stories, kingdoms, and wars.",
    Insight: "Tell when someone is hiding what they feel.",
    Intimidation: "Scare someone into doing what you want.",
    Investigation: "Search a room and figure out what happened.",
    Medicine: "Spot a sickness and help someone who is hurt.",
    Nature: "Know plants, animals, weather, and the wild.",
    Perception: "Notice a sound, a smell, or something hiding.",
    Performance: "Play, sing, or act so people pay attention.",
    Persuasion: "Talk someone into being friendly and helpful.",
    Religion: "Know gods, prayers, and holy symbols.",
    "Sleight of Hand": "Hide a small thing, or pick a pocket.",
    Stealth: "Sneak by without being seen or heard.",
    Survival: "Follow tracks, find food, and not get lost.",
  };
  const NO_SRD = new Set([
    "Armor of Agathys",
    "Barkskin (OG)",
    "Dissonant Whispers",
    "Ensnaring Strike",
    "Hex",
    "Hunger of Hadar",
    "Searing Smite",
    "Tasha's Hideous Laughter",
    "Thorn Whip",
    "Thunderous Smite",
  ]);

  it("drops the player blank and still prints proficiency, notice, and speaks", () => {
    const html = sheetHtml(buildCharacter(tables, req()));
    expect(html).toContain("Proficiency");
    expect(html).toContain("Notice");
    expect(html).toContain("Speaks:");
    expect(html).not.toContain('class="player"');
    expect(html).not.toContain(">Player<");
  });

  it("explains proficiency from the hero's level", () => {
    const hero = buildCharacter(tables, req({ level: 5 }));
    const book = tables.rules[0]?.prof_by_level[4];
    if (book === undefined) throw new Error("missing proficiency");
    const tip = profTip(hero.combat, hero.identity.level, book);
    expect(tip.title).toBe("Proficiency +3");
    expect(tip.lines[0]?.[1]).toBe("Added to the attacks, saves, and skills you are trained in.");
    expect(tip.lines).toContainEqual(["Level 5", "+3"]);
    const typed = buildCharacter(tables, req({ level: 1, numbers: { prof: 9 } }));
    const low = tables.rules[0]?.prof_by_level[0];
    if (low === undefined) throw new Error("missing proficiency");
    const off = profTip(typed.combat, typed.identity.level, low);
    expect(off.title).toBe("Proficiency +9");
    expect(off.lines[0]?.[1]).toContain("Talk to your DM");
    expect(off.lines[0]?.[1]).toContain("+2");
  });

  it("explains notice as 10 plus Perception, and a feat on top", () => {
    const hero = buildCharacter(tables, req({ level: 1 }));
    const perception = hero.skills.find((skill) => skill.name === "Perception");
    if (!perception) throw new Error("missing Perception");
    const tip = noticeTip(hero.combat);
    expect(tip.title).toBe(`Notice ${hero.combat.passive_perception}`);
    expect(tip.lines[0]?.[1]).toBe("How easily you notice something without trying.");
    expect(tip.lines).toContainEqual(["Base", "10"]);
    expect(tip.lines).toContainEqual(["Perception", signed(perception.bonus)]);
    const observant = buildCharacter(tables, req({ level: 4, use_feats: true, feat: "observant" }));
    expect(noticeTip(observant.combat).lines).toContainEqual(["Feat", "+5, from Observant"]);
    const typed = buildCharacter(tables, req({ numbers: { notice: 30 } }));
    const off = noticeTip(typed.combat);
    expect(off.title).toBe("Notice 30");
    expect(off.lines[0]?.[1]).toContain("Talk to your DM");
  });

  it("says where each language came from", () => {
    const human = buildCharacter(tables, req({ race: "human" }));
    expect(speaksTip(human.identity).lines).toEqual([
      [null, "The languages this hero knows."],
      ["Human", "Common"],
      ["Human", "one more, not named yet"],
    ]);
    const picked = buildCharacter(tables, req({ race: "human", extra_languages: ["Elvish"] }));
    expect(picked.identity.languages).toBe("Common, Elvish");
    expect(speaksTip(picked.identity).lines).toContainEqual(["You picked it", "Elvish"]);
    const dwarf = buildCharacter(tables, req({ race: "dwarf" }));
    expect(speaksTip(dwarf.identity).lines).toContainEqual([dwarf.identity.race, "Dwarvish"]);
  });

  it("says what each skill and each ability is for", () => {
    const hero = buildCharacter(tables, req());
    expect(hero.skills).toHaveLength(Object.keys(USE).length);
    for (const skill of hero.skills) {
      expect(skillTip(skill).lines[0]).toEqual([null, USE[skill.name]]);
    }
    const by = (key: string) => hero.abilities.find((row) => row.key === key);
    expect(abilityTip(by("STR") ?? hero.abilities[0]).lines[0]?.[1]).toBe("Lifting, pushing, and hitting hard.");
    expect(abilityTip(by("DEX") ?? hero.abilities[0]).lines[0]?.[1]).toBe("Dodging, sneaking, and quick hands.");
    expect(abilityTip(by("CON") ?? hero.abilities[0]).lines[0]?.[1]).toBe(
      "Staying up when you are hurt, tired, or poisoned.",
    );
    expect(abilityTip(by("INT") ?? hero.abilities[0]).lines[0]?.[1]).toBe(
      "Remembering facts, solving puzzles, and studying magic.",
    );
    expect(abilityTip(by("WIS") ?? hero.abilities[0]).lines[0]?.[1]).toBe(
      "Noticing things, judging people, and keeping a clear head.",
    );
    expect(abilityTip(by("CHA") ?? hero.abilities[0]).lines[0]?.[1]).toBe(
      "Talking, performing, and getting people on your side.",
    );
  });

  it("keeps the kid spell card and pops the SRD entry up beside it", () => {
    const wizard = buildCharacter(tables, req({ cls: "wizard", subclass: null, level: 1, spells: ["Burning Hands"] }));
    const card = wizard.cards.find((row) => row.name === "Burning Hands");
    if (!card) throw new Error("missing Burning Hands");
    expect(card.desc).toContain("Flames shoot");
    expect(card.desc).not.toContain("flammable");
    expect(sheetHtml(wizard)).not.toContain("flammable objects");
    const rules = spellRules("Burning Hands");
    expect(rules).toContain("1st-level evocation");
    expect(rules).toContain("Casting time: 1 action");
    expect(rules).toContain("Range: Self");
    expect(rules).toContain("Components: V, S");
    expect(rules).toContain("15-foot cone");
    expect(rules).toContain("flammable objects");
    expect(rules).toContain("At higher levels.");
    for (const spell of tables.spells) {
      const entry = spellRules(spell.name);
      if (NO_SRD.has(spell.name)) expect(entry, spell.name).toBeUndefined();
      else expect(entry, spell.name).toContain("Casting time:");
    }
  });
});

describe("escapes user-supplied text", () => {
  it("escapes name, notes, and inventory so no HTML can be injected", () => {
    const xss = "<img src=x onerror=alert(1)>";
    const html = sheetHtml(buildCharacter(tables, req({ name: `Hero${xss}`, notes: xss, inventory: [xss] })));
    expect(html).not.toContain(xss);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
