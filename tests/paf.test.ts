import { describe, expect, it } from "vitest";
import { jpegsToPdf, readHeroSheet } from "../src/export";
import content from "../src/paf/content.json";
import {
  buildCharacter,
  CharError,
  fluxCount,
  options,
  type PafCharacter,
  type PafRequest,
  type PafTables,
  sheetHtml,
  tablesFrom,
} from "../src/paf/core";
import type { AbilityScores } from "../src/types";

const tables = tablesFrom(content);
const TENS: AbilityScores = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), w: 1, h: 1 };

function req(over: Partial<PafRequest> = {}): PafRequest {
  return {
    name: "Hero",
    origin1: "baseline",
    origin2: "echo",
    level: 1,
    bonus_skill: null,
    crit_first: null,
    utility_first: null,
    expert_first: null,
    uber: null,
    scores: TENS,
    armor: null,
    weapon: null,
    inventory: null,
    notes: "",
    portrait: null,
    ...over,
  };
}

function section(ch: PafCharacter, name: string): string[] {
  return ch.cards.filter((card) => card.section === name).map((card) => card.name);
}

function skill(ch: PafCharacter, name: string) {
  const row = ch.skills.find((item) => item.name === name);
  if (!row) throw new Error(`missing skill ${name}`);
  return row;
}

function cloneTables(): PafTables {
  return tablesFrom(structuredClone(content));
}

describe("PAF catalog", () => {
  it("has Baseline plus twenty origins, and every origin builds at every level", () => {
    expect(tables.origins).toHaveLength(21);
    expect(tables.origins[0]?.id).toBe("baseline");
    expect(tables.max_level).toBe(10);
    let n = 0;
    for (const origin of tables.origins) {
      for (let level = 1; level <= 10; level++) {
        const ch = buildCharacter(tables, req({ origin1: origin.id, origin2: "baseline", level }));
        expect(ch.identity.level).toBe(level);
        expect(ch.flux).toBe(fluxCount(level));
        for (const card of ch.cards) {
          expect(card.name).not.toMatch(/[{}]/);
          expect(card.desc).not.toMatch(/[{}]/);
        }
        n += 1;
      }
    }
    expect(n).toBe(21 * 10);
  });
});

describe("scores, skills, and hit points", () => {
  it("sets 18 and 16, or 20 when the key abilities match", () => {
    const split = buildCharacter(tables, req({ origin1: "whisk", origin2: "spark" }));
    expect(split.scores.DEX).toBe(18);
    expect(split.scores.INT).toBe(16);
    expect(split.scores.STR).toBe(10);
    const both = buildCharacter(tables, req({ origin1: "crag", origin2: "rasp" }));
    expect(both.scores.STR).toBe(20);
    expect(both.scores.DEX).toBe(10);
  });

  it("turns a duplicate origin into Baseline, and keeps Baseline twice", () => {
    const dup = buildCharacter(tables, req({ origin1: "whisk", origin2: "whisk" }));
    expect(dup.identity.origin1).toBe("Whisk");
    expect(dup.identity.origin2).toBe("Baseline");
    expect(dup.scores.DEX).toBe(18);
    expect(dup.scores.CHA).toBe(16);
    expect(skill(dup, "Stealth").bonus).toBe(9);
    expect(skill(dup, "Stealth").expert).toBe(false);
    const plain = buildCharacter(tables, req({ origin1: "baseline", origin2: "baseline", level: 10 }));
    expect(plain.identity.origin2).toBe("Baseline");
    expect(plain.scores.CHA).toBe(20);
    expect(section(plain, "What you are")).toEqual(["Baseline"]);
    expect(section(plain, "Always")).toEqual(["Hold up"]);
    expect(section(plain, "Critical")).toEqual(["Hesitate"]);
    expect(skill(plain, "Interaction").bonus).toBe(19);
  });

  it("uses 12 + Constitution, then +5 a level, and bloodied is half", () => {
    const scores = { ...TENS, CON: 14 };
    const one = buildCharacter(tables, req({ level: 1, scores }));
    const two = buildCharacter(tables, req({ level: 2, scores }));
    expect(one.combat.max_hp).toBe(26);
    expect(one.combat.bloodied).toBe(13);
    expect(two.combat.max_hp).toBe(31);
    expect(two.combat.bloodied).toBe(15);
  });

  it("adds level to every skill, +4 for a key skill, and stacks a shared skill with the bonus", () => {
    const hero = buildCharacter(tables, req({ origin1: "whisk", origin2: "spark", level: 1 }));
    expect(skill(hero, "Stealth")).toMatchObject({ bonus: 9, marked: true, expert: false });
    expect(skill(hero, "Nature")).toMatchObject({ bonus: 1, marked: false });
    const shared = buildCharacter(tables, req({ origin1: "crag", origin2: "rasp", level: 1 }));
    expect(skill(shared, "Athletics")).toMatchObject({ bonus: 14, expert: true });
    const stacked = buildCharacter(
      tables,
      req({ origin1: "crag", origin2: "rasp", level: 1, bonus_skill: "Athletics" }),
    );
    expect(skill(stacked, "Athletics").bonus).toBe(18);
    const later = buildCharacter(tables, req({ origin1: "baseline", origin2: "echo", level: 5 }));
    expect(skill(later, "Science").bonus).toBe(5);
  });

  it("sets defenses from level plus the better modifier, and picks the higher armor", () => {
    const calm = buildCharacter(tables, req({ origin1: "baseline", origin2: "echo", level: 1 }));
    expect(calm.combat.tough).toBe(11);
    expect(calm.combat.quick).toBe(11);
    expect(calm.combat.guts).toBe(16);
    expect(calm.combat.armor).toBe("Road plate");
    expect(calm.combat.ac).toBe(17);
    expect(calm.combat.initiative).toBe(1);
    const quick = buildCharacter(tables, req({ origin1: "whisk", origin2: "spark", level: 3 }));
    expect(quick.combat.armor).toBe("Tin coat");
    expect(quick.combat.ac).toBe(20);
    expect(quick.combat.speed).toBe(40);
    expect(quick.combat.initiative).toBe(7);
    expect(quick.attacks[0]).toMatchObject({ name: "Knife", to_hit: 7, damage: "1d6+4" });
    const bare = buildCharacter(tables, req({ origin1: "whisk", origin2: "baseline", armor: "No armor" }));
    expect(bare.combat.ac).toBe(15);
    expect(bare.combat.armor).toBe("No armor");
    const heavy = buildCharacter(tables, req({ origin1: "whisk", origin2: "baseline", armor: "Road plate" }));
    expect(heavy.combat.ac).toBe(17);
  });
});

describe("powers", () => {
  it("follows the level schedule and the origin the player picks first", () => {
    const at = (level: number, over: Partial<PafRequest> = {}) =>
      buildCharacter(tables, req({ origin1: "whisk", origin2: "spark", level, ...over }));
    expect(section(at(1), "Once a fight")).toEqual([]);
    expect(section(at(1), "Critical")).toEqual([]);
    expect(at(1).flux).toBe(1);
    expect(section(at(2), "Critical")).toEqual(["Hamstring"]);
    expect(section(at(2, { crit_first: "spark" }), "Critical")).toEqual(["Numb"]);
    expect(section(at(3), "Once a fight")).toEqual(["Vanish"]);
    expect(section(at(3, { utility_first: "spark" }), "Once a fight")).toEqual(["Jolt"]);
    expect(at(4).flux).toBe(2);
    expect(section(at(5), "Big powers")).toEqual(["Nine lives"]);
    expect(section(at(6), "Critical")).toEqual(["Hamstring", "Numb"]);
    expect(section(at(6, { crit_first: "spark" }), "Critical")).toEqual(["Numb", "Hamstring"]);
    expect(section(at(7), "Once a fight")).toEqual(["Vanish", "Jolt"]);
    expect(at(8).flux).toBe(3);
    expect(section(at(9), "Big powers")).toEqual(["Nine lives", "Arc"]);
    expect(section(at(10), "Capstone")).toEqual(["Twice"]);
    expect(section(at(10, { uber: "relic" }), "Capstone")).toEqual(["Careful relic"]);
    expect(section(at(10, { uber: "keep" }), "Capstone")).toEqual(["Sticky flux"]);
    expect(section(at(3), "Keeping going")).toEqual(["Second wind", "Flux", "Relic"]);
    const opt = options(tables, req({ origin1: "whisk", origin2: "spark", level: 3 }));
    expect(opt.show_crit).toBe(true);
    expect(opt.show_utility).toBe(true);
    expect(opt.show_expert).toBe(false);
    expect(opt.show_uber).toBe(false);
    expect(opt.locked).toEqual(["DEX", "INT"]);
  });
});

describe("sheet text", () => {
  it("changes when a used origin changes and stays put for everyone else", () => {
    const hero = req({ origin1: "whisk", origin2: "spark", level: 3 });
    const other = req({ origin1: "bramble", origin2: "crag", level: 3 });
    const before = sheetHtml(buildCharacter(tables, other));
    const edited = cloneTables();
    const whisk = edited.origins.find((origin) => origin.id === "whisk");
    if (!whisk) throw new Error("missing whisk");
    whisk.trait = "QQQQZZZZ ears";
    expect(sheetHtml(buildCharacter(edited, hero))).toContain("QQQQZZZZ ears");
    expect(sheetHtml(buildCharacter(edited, other))).toBe(before);
  });

  it("escapes the name, notes, and gear, and skips the D&D-only lines", () => {
    const html = sheetHtml(
      buildCharacter(
        tables,
        req({ name: "<b>x</b>", notes: "a<b", inventory: ["<i>wire"], origin1: "whisk", origin2: "spark" }),
      ),
    );
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("a&lt;b");
    expect(html).toContain("&lt;i&gt;wire");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("Tough");
    expect(html).toContain("JUNK");
    expect(html).not.toMatch(/proficiency/i);
    expect(html).not.toMatch(/gamma/i);
  });
});

describe("refusals", () => {
  it("throws on a bad level, an unknown origin, and a pick that is not yours", () => {
    expect(() => buildCharacter(tables, req({ level: 0 }))).toThrow(CharError);
    expect(() => buildCharacter(tables, req({ level: 11 }))).toThrow(CharError);
    expect(() => buildCharacter(tables, req({ origin1: "nope" }))).toThrow(/unknown origin nope/);
    expect(() => buildCharacter(tables, req({ level: 2, crit_first: "nope" }))).toThrow(CharError);
    expect(() => buildCharacter(tables, req({ scores: { ...TENS, STR: 0 } }))).toThrow(/STR must be 1 to 20/);
    expect(() => buildCharacter(tables, req({ bonus_skill: "Lockpicking" }))).toThrow(/unknown skill/);
    expect(() => buildCharacter(tables, req({ level: 10, uber: "nope" }))).toThrow(/unknown capstone/);
    let kind = "";
    try {
      buildCharacter(tables, req({ level: 99 }));
    } catch (error) {
      if (error instanceof CharError) kind = error.kind;
    }
    expect(kind).toBe("ValueError");
  });
});

describe("pdf", () => {
  it("round-trips a PAF hero and leaves an origin-only payload unread", () => {
    const state = { kind: "paf", origin1: "whisk", origin2: "spark", name: "Pip", level: 3 };
    const pdf = jpegsToPdf([jpeg], "Pip", { state, packs: [] });
    expect(readHeroSheet(pdf)?.state).toEqual(state);
    const bare = jpegsToPdf([jpeg], "Pip", { state: { origin1: "whisk", origin2: "spark" }, packs: [] });
    expect(readHeroSheet(bare)).toBeNull();
  });
});
