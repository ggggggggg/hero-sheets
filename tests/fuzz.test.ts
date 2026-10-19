import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildCharacter, CharError, options, sheetHtml } from "../src/core";
import { CustomError, mergeCustom } from "../src/custom";
import { allText, freshTables, req } from "./helpers";

const tables = freshTables();
const raceIds = tables.races.map((r) => r.id);
const classIds = tables.classes.map((c) => c.id);

// Exactly min(n, items.length) distinct items, ordered by the fuzzed stream, with a
// sequential fallback so short streams still yield the full count (choices need an exact count).
function subset<T>(items: T[], stream: number[], n: number): T[] {
  if (items.length === 0 || n <= 0) return [];
  const want = Math.min(n, items.length);
  const out: T[] = [];
  const used = new Set<number>();
  for (const raw of stream.concat(items.map((_, i) => i))) {
    if (out.length >= want) break;
    const i = ((raw % items.length) + items.length) % items.length;
    if (used.has(i)) continue;
    used.add(i);
    const item = items[i];
    if (item !== undefined) out.push(item);
  }
  return out;
}

const score = fc.integer({ min: 3, max: 18 });
const baseScores = fc.option(fc.record({ STR: score, DEX: score, CON: score, INT: score, WIS: score, CHA: score }), {
  nil: null,
});

describe("fuzz: build is total over the legal option space", () => {
  it("builds valid race/class/subclass/level + picked choices, spells, gear", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...raceIds),
        fc.constantFrom(...classIds),
        fc.integer({ min: 1, max: 7 }),
        fc.array(fc.nat(), { minLength: 1, maxLength: 10 }),
        fc.boolean(),
        fc.boolean(),
        baseScores,
        (race, cls, level, stream, wantSub, wantGear, base) => {
          const subs = tables.subclasses.filter((s) => s.class_id === cls);
          const subclass = wantSub ? (subset(subs, stream, 1)[0]?.id ?? null) : null;
          // options() must see the same scores we build with: a prepared caster's spell count is WIS/level-based.
          const opt = options(tables, req({ race, cls, subclass, level, base_scores: base }));
          const cantrips = opt.caster
            ? subset(
                opt.cantripPool.filter((c) => !opt.bonusCantrips.includes(c)),
                stream,
                opt.nCan,
              )
            : null;
          const spells = opt.caster
            ? subset(
                opt.spellPool.filter((s) => !opt.auto.includes(s)),
                stream.slice(1),
                opt.nSp,
              )
            : null;
          const choices = opt.groups.map((g) => ({
            group: g.group,
            picks: subset(
              g.options.map((o) => o.name),
              stream,
              g.count,
            ),
          }));
          const armor = wantGear ? (subset(opt.armorOptions, stream, 1)[0]?.name ?? null) : null;
          const weaponPick = wantGear ? (subset(opt.weaponOptions, stream, 1)[0] ?? null) : null;
          // a shield is only legal with a one-handed weapon, so only pair it with one we explicitly picked
          const shield = wantGear && opt.shieldProf && weaponPick !== null && weaponPick.hands !== "two" ? true : null;
          const ch = buildCharacter(
            tables,
            req({
              race,
              cls,
              subclass,
              level,
              cantrips,
              spells,
              choices,
              base_scores: base,
              armor,
              weapon: weaponPick?.name ?? null,
              shield,
            }),
          );
          expect(ch.combat.max_hp).toBeGreaterThan(0);
          expect(Number.isInteger(ch.combat.ac)).toBe(true);
          expect(ch.combat.ac).toBeGreaterThan(0);
          for (const text of allText(ch)) expect(text).not.toMatch(/[{}]/);
          const html = sheetHtml(ch);
          expect(html).toContain('class="sheet"');
          expect(html).not.toMatch(/[{}]/);
        },
      ),
      { numRuns: 250 },
    );
  });
});

describe("fuzz: user text is escaped and never crashes the sheet", () => {
  const XSS = "<svg/onload=alert(1)></svg>";
  it("escapes adversarial name/notes/inventory in any combo", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...raceIds),
        fc.constantFrom(...classIds),
        fc.integer({ min: 1, max: 7 }),
        fc.string(),
        fc.string(),
        fc.array(fc.string(), { maxLength: 4 }),
        (race, cls, level, name, notes, inventory) => {
          const ch = buildCharacter(
            tables,
            req({
              race,
              cls,
              level,
              name: `${name}${XSS}`,
              notes: `${XSS}${notes}`,
              inventory: inventory.map((l) => l + XSS),
            }),
          );
          // user text is inserted verbatim (never placeholder-expanded), so braces are fine here;
          // what matters is it's HTML-escaped, not injected.
          const html = sheetHtml(ch);
          expect(html).not.toContain(XSS);
          expect(html).not.toContain("<svg/onload");
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("fuzz: card text comes from the tables, not hidden defaults", () => {
  it("a sentinel stamped on a used feature or spell shows up on the sheet", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...raceIds),
        fc.constantFrom(...classIds),
        fc.integer({ min: 1, max: 7 }),
        fc.nat(),
        (race, cls, level, k) => {
          const subclass = tables.subclasses.find((s) => s.class_id === cls)?.id ?? null;
          const seed = req({ race, cls, subclass, level });
          const built = buildCharacter(tables, seed);
          if (built.cards.length === 0) return;
          const target = built.cards[k % built.cards.length];
          if (!target) return;
          const token = `ZZSENTINEL${k % 101}`;
          const edited = freshTables();
          let stamped = false;
          for (const f of edited.features)
            if (f.card.name === target.name) {
              f.card.desc = token;
              stamped = true;
            }
          for (const s of edited.spells)
            if (s.name === target.name || s.card.name === target.name) {
              s.card.desc = token;
              stamped = true;
            }
          if (!stamped) return;
          expect(sheetHtml(buildCharacter(edited, seed))).toContain(token);
        },
      ),
      { numRuns: 120 },
    );
  });
});

describe("fuzz: custom packs never crash the merge/build", () => {
  const id = fc.string({ maxLength: 12 });
  const pack = fc.record(
    {
      races: fc.array(fc.record({ id, name: fc.string() }), { maxLength: 3 }),
      classes: fc.array(fc.record({ id, name: fc.string() }), { maxLength: 3 }),
      spells: fc.array(
        fc.record({
          name: fc.string({ minLength: 1 }),
          lvl: fc.integer({ min: 0, max: 9 }),
          classes: fc.array(fc.constantFrom(...classIds), { maxLength: 3 }),
        }),
        { maxLength: 3 },
      ),
      items: fc.array(
        fc.record({ name: fc.string({ minLength: 1 }), rarity: fc.constantFrom("common", "uncommon", "rare") }),
        { maxLength: 3 },
      ),
    },
    { requiredKeys: [] },
  );
  it("either merges and builds, or fails with a CustomError/CharError — never an unexpected throw", () => {
    fc.assert(
      fc.property(pack, (content) => {
        let merged: ReturnType<typeof mergeCustom>;
        try {
          merged = mergeCustom(freshTables(), content);
        } catch (e) {
          expect(e).toBeInstanceOf(CustomError);
          return;
        }
        try {
          expect(buildCharacter(merged, req({})).combat.max_hp).toBeGreaterThan(0);
        } catch (e) {
          expect(e).toBeInstanceOf(CharError);
        }
      }),
      { numRuns: 150 },
    );
  });
});
