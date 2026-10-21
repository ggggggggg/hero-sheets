import { describe, expect, it } from "vitest";
import { buildCharacter } from "../src/core";
import { PREMADES, premadeFileState, premadeNote } from "../src/premades";
import { freshTables } from "./helpers";

const tables = freshTables();

function premade(id: string) {
  const row = PREMADES.find((item) => item.id === id);
  if (!row) throw new Error(`missing premade ${id}`);
  return row;
}

function built(id: string) {
  return buildCharacter(tables, premade(id).request);
}

describe("premade heroes", () => {
  it("keeps a unique list with no 'best' wording", () => {
    const ids = PREMADES.map((row) => row.id);
    const labels = PREMADES.map((row) => row.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
    expect(PREMADES).toHaveLength(16);
    for (const row of PREMADES) {
      const ch = buildCharacter(tables, row.request);
      expect(`${row.label} ${premadeNote(ch)}`).not.toMatch(/best/i);
    }
  });

  it("matches the finished sheets", () => {
    const wynn = built("wizard-5");
    expect(wynn.identity.name).toBe("Wynn");
    expect(wynn.identity.second).toBeNull();
    expect(wynn.combat.max_hp).toBe(32);
    expect(wynn.combat.ac).toBe(12);
    expect(wynn.combat.armor).toBe("No armor");

    const sword = built("plus-1");
    expect(sword.attacks.filter((row) => row.name === "Longsword +1")).toHaveLength(1);
    expect(sword.combat.armor).toBe("Chain mail +1 + shield");
    expect(sword.combat.ac).toBe(20);
    expect(sword.combat.max_hp).toBe(44);

    expect(built("fighter-11").identity.level).toBe(11);
    expect(built("fighter-11").combat.max_hp).toBe(103);

    const bard = built("bard-20");
    expect(bard.identity.second).toContain("Cleric");
    expect(bard.identity.main_level).toBe(10);
    expect(bard.combat.dice).toBe("20d8");
    expect(bard.combat.armor).toBe("Half plate");
    expect(bard.combat.ac).toBe(17);
    expect(bard.combat.max_hp).toBe(143);

    expect(built("alert").feat?.name).toBe("Alert");
    expect(built("heavy-master").feat?.warn).toBe("");
    expect(built("war-caster").feat?.warn).toBe("");
    const war = built("war-caster");
    expect(war.identity.second).toContain("Wizard");
    expect(war.identity.main_level).toBe(4);
    expect(war.identity.offbook).toContain("Intelligence 13");
    expect(war.combat.max_hp).toBe(42);

    const heavy = built("heavy-master");
    expect(heavy.identity.main_level).toBe(4);
    expect(heavy.identity.second).toContain("Life Domain");
    expect(heavy.combat.max_hp).toBe(33);
    expect(heavy.combat.dice).toBe("4d6 + 1d8");
  });

  it("stores the optional-rule switches a reopen needs", () => {
    const high = premadeFileState(premade("wizard-20").request);
    expect(high.use_high_levels).toBe(true);
    expect(high.level_cap).toBe(20);
    expect(high.use_magic_plus).toBeUndefined();
    const plus = premadeFileState(premade("plus-1").request);
    expect(plus.use_magic_plus).toBe(true);
    expect(plus.plus_cap).toBe(1);
    expect(plus.level).toBe(5);
    expect(premadeFileState(premade("wizard-5").request).use_high_levels).toBeUndefined();
  });
});
