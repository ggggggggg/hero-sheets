import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildCharacter, CharError, sheetHtml } from "../src/core";
import { heroRequest, mergeCustom, parseCustomText } from "../src/custom";
import type { Tables } from "../src/types";
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
    expect([ch.combat.max_hp, ch.combat.ac, ch.combat.speed, ch.combat.initiative, ch.combat.prof]).toEqual([
      48, 16, 25, 5, 3,
    ]);
    expect(Object.fromEntries(ch.abilities.map((row) => [row.key, row.score]))).toEqual({
      STR: 8,
      DEX: 14,
      CON: 16,
      INT: 10,
      WIS: 13,
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
});

describe("refusals", () => {
  const bad: Partial<Parameters<typeof req>[0]>[] = [
    { race: "nope" },
    { cls: "nope" },
    { level: 0 },
    { level: 8 },
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
  const raceIds = tables.races.map((row) => row.id);
  const classIds = tables.classes.map((row) => row.id);

  it("builds random legal requests", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...raceIds),
        fc.constantFrom(...classIds),
        fc.integer({ min: 1, max: 7 }),
        (race, cls, level) => {
          const sub = tables.subclasses.find((row) => row.class_id === cls)?.id ?? null;
          const ch = buildCharacter(tables, req({ race, cls, subclass: sub, level }));
          expect(ch.combat.max_hp).toBeGreaterThan(0);
          expect(ch.combat.ac).toBeGreaterThanOrEqual(10);
          for (const text of allText(ch)) expect(text).not.toContain("{");
        },
      ),
      { numRuns: 40 },
    );
  });

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

describe("escapes user-supplied text", () => {
  it("escapes name, notes, and inventory so no HTML can be injected", () => {
    const xss = "<img src=x onerror=alert(1)>";
    const html = sheetHtml(buildCharacter(tables, req({ name: `Hero${xss}`, notes: xss, inventory: [xss] })));
    expect(html).not.toContain(xss);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
