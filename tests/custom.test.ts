import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCharacter } from "../src/core";
import { CustomError, checkCustom, mergeCustom, parseCustomText } from "../src/custom";
import { cards, freshTables, req } from "./helpers";

const tables = freshTables();
const root = new URL("..", import.meta.url);

function readPack(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

describe("mergeCustom", () => {
  it("explains a bad pack", () => {
    const bad = [
      { racez: [] },
      { races: [{ id: "x" }] },
      { races: [{ id: "x", name: "X", sped: 30 }] },
      { spells: [{ name: "Zap", card: { desc: "hi", colour: "red" } }] },
      { races: { id: "x" } },
      { choices: [{ owner_kind: "class", owner_id: "fighter", group: "g", options: [{ desc: "no name" }] }] },
    ];
    for (const pack of bad) {
      expect(() => mergeCustom(tables, pack)).toThrow(CustomError);
    }
  });

  it("rejects text that is not JSON", () => {
    expect(parseCustomText('{"title": "a"}')).toEqual({ title: "a" });
    for (const text of ['window.CHARSHEET_CUSTOM = {"title": "a"};', "{title: 'a'}", '{"title": "a",}']) {
      expect(() => parseCustomText(text)).toThrow(CustomError);
      try {
        parseCustomText(text);
      } catch (error) {
        expect(error).toBeInstanceOf(CustomError);
        if (error instanceof CustomError) expect(error.message).toContain("not valid JSON");
      }
    }
  });

  it("accepts a pack that is only a race and a class", () => {
    const text = JSON.stringify({
      title: "Solo World",
      races: [{ id: "bot", name: "Robot" }],
      classes: [
        {
          id: "scav",
          name: "Scavenger",
          weapons: [{ name: "Zap Stick", die: "1d6", ability: "STR", kind: "melee", hands: "one", note: "" }],
        },
      ],
    });
    const pack = parseCustomText(text);
    const merged = mergeCustom(tables, pack);
    const problems = checkCustom(merged, pack);
    expect(problems).toEqual([]);
    expect(buildCharacter(merged, req({ race: "bot", cls: "scav", level: 1 })).identity.cls).toBe("Scavenger");
  });

  it("replaces a row with the same id", () => {
    const merged = mergeCustom(tables, { races: [{ id: "dwarf", name: "Dwarf", speed: 35 }] });
    expect(merged.races).toHaveLength(tables.races.length);
    expect(buildCharacter(merged, req({ race: "dwarf", cls: "wizard" })).combat.speed).toBe(35);
  });

  it("builds the turtles example and leaves the built-in races in place", () => {
    const text = readPack("examples/turtles-and-pirates.json");
    const guide = readPack("CUSTOM_CONTENT_GUIDE.md");
    expect(guide).toContain('"id": "turtlefolk"');
    const merged = mergeCustom(tables, parseCustomText(text));
    const ch = buildCharacter(merged, req({ race: "turtlefolk", cls: "rogue", subclass: "pirate", level: 5 }));
    expect(ch.identity.race).toBe("Turtle-folk");
    expect(ch.identity.subclass).toBe("Pirate");
    const names = cards(ch);
    expect(names.has("Shell Defense")).toBe(true);
    expect(names.has("Swashbuckle")).toBe(true);
    const anchor = buildCharacter(merged, req({ cls: "fighter", weapon: "Anchor" }));
    expect(anchor.attacks[0]?.damage.startsWith("2d6")).toBe(true);
    expect(merged.races).toHaveLength(tables.races.length + 1);
  });
});

describe("Mutants & Meltdowns", () => {
  const pack = parseCustomText(readPack("examples/mutants-and-meltdowns.json"));
  const merged = mergeCustom(freshTables(), pack);

  it("builds every pack combo", () => {
    const races = rows(pack.races);
    const classes = rows(pack.classes);
    const subclasses = rows(pack.subclasses);
    let n = 0;
    for (const race of races) {
      for (const cls of classes) {
        const subs = subclasses.filter((sub) => sub.class_id === cls.id);
        for (const sub of [null, ...subs.map((row) => row.id)]) {
          for (let level = 1; level <= 7; level++) {
            buildCharacter(merged, req({ race: race.id, cls: cls.id, subclass: sub, level }));
            n += 1;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it("sits next to the built-in classes", () => {
    for (const [race, cls, sub] of [
      ["dwarf", "brute", "berserker"],
      ["elf", "esper", "telepath"],
      ["mutant", "wizard", null],
    ] as const) {
      const ch = buildCharacter(merged, req({ race, cls, subclass: sub, level: 7 }));
      expect(ch.combat.max_hp).toBeGreaterThan(0);
    }
  });
});

function rows(value: unknown): { id: string; class_id?: string }[] {
  if (!Array.isArray(value)) throw new Error("pack table is not a list");
  return value.map((row) => {
    if (!row || typeof row !== "object" || !("id" in row) || typeof row.id !== "string")
      throw new Error("pack row has no id");
    const classId = "class_id" in row && typeof row.class_id === "string" ? row.class_id : undefined;
    return { id: row.id, class_id: classId };
  });
}
