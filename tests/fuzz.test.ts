import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildCharacter, CharError, options, sheetHtml } from "../src/core";
import { CustomError, mergeCustom } from "../src/custom";
import type { ClassDip } from "../src/types";
import { allText, cards, freshTables, req } from "./helpers";

const tables = freshTables();
const rules = tables.rules[0];
if (!rules) throw new Error("missing rules");
const maxLevel = rules.max_level;
const raceIds = tables.races.map((r) => r.id);
const classIds = tables.classes.map((c) => c.id);
const featIds = tables.feats.map((feat) => feat.id);
const word = fc.string({
  unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"),
  minLength: 1,
  maxLength: 8,
});

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
        fc.integer({ min: 1, max: maxLevel }),
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

function trailing(damage: string): number {
  const match = /([+-]\d+)$/.exec(damage);
  return match?.[1] ? Number(match[1]) : 0;
}

function className(id: string): string {
  return tables.classes.find((row) => row.id === id)?.name ?? id;
}

describe("fuzz: optional rules stay inside the book", () => {
  it("builds a feat, a second class, a high level, and a magic plus together", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...raceIds),
        fc.constantFrom(...classIds),
        fc.integer({ min: 1, max: maxLevel }),
        fc.array(fc.nat(), { minLength: 1, maxLength: 12 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom(...featIds),
        fc.boolean(),
        fc.constantFrom(...classIds),
        fc.integer({ min: 1, max: maxLevel }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        baseScores,
        (
          race,
          cls,
          level,
          stream,
          wantSub,
          wantGear,
          useFeats,
          feat,
          useMulti,
          other,
          dipLevel,
          weaponPlus,
          armorPlus,
          base,
        ) => {
          const subs = tables.subclasses.filter((row) => row.class_id === cls);
          const subclass = wantSub ? (subset(subs, stream, 1)[0]?.id ?? null) : null;
          const dipSubs = tables.subclasses.filter((row) => row.class_id === other);
          const dip: ClassDip | null =
            useMulti && level >= 2 && other !== cls
              ? {
                  cls: other,
                  subclass: subset(dipSubs, stream, 1)[0]?.id ?? null,
                  level: 1 + ((dipLevel - 1) % (level - 1)),
                  cantrips: null,
                  spells: null,
                  path_spells: null,
                }
              : null;
          const ask = req({
            race,
            cls,
            subclass,
            level,
            base_scores: base,
            use_feats: useFeats,
            feat: useFeats ? feat : null,
            use_multiclass: dip != null,
            dip,
            weapon_plus: weaponPlus,
            armor_plus: armorPlus,
          });
          const opt = options(tables, ask);
          const cantrips = opt.caster
            ? subset(
                opt.cantripPool.filter((name) => !opt.bonusCantrips.includes(name)),
                stream,
                opt.nCan,
              )
            : null;
          const spells = opt.caster
            ? subset(
                opt.spellPool.filter((name) => !opt.auto.includes(name)),
                stream.slice(1),
                opt.nSp,
              )
            : null;
          const choices = opt.groups.map((group) => ({
            group: group.group,
            picks: subset(
              group.options.map((option) => option.name),
              stream,
              group.count,
            ),
          }));
          const armor = wantGear ? (subset(opt.armorOptions, stream, 1)[0]?.name ?? null) : null;
          const weaponPick = wantGear ? (subset(opt.weaponOptions, stream, 1)[0] ?? null) : null;
          const shield = wantGear && opt.shieldProf && weaponPick !== null && weaponPick.hands !== "two" ? true : null;
          const full = req({
            ...ask,
            cantrips,
            spells,
            choices,
            armor,
            weapon: weaponPick?.name ?? null,
            shield,
          });
          const ch = buildCharacter(tables, full);
          const label = `${race} ${cls} ${level} ${feat} ${dip?.cls ?? ""} +${weaponPlus}/+${armorPlus}`;
          expect(ch.identity.level, label).toBe(level);
          expect(ch.identity.main_level, label).toBeGreaterThanOrEqual(1);
          expect(ch.combat.prof, label).toBe(rules.prof_by_level[level - 1]);
          expect(ch.combat.max_hp, label).toBeGreaterThan(0);
          expect(Number.isInteger(ch.combat.ac), label).toBe(true);
          expect(ch.combat.ac, label).toBeGreaterThan(0);
          for (const text of allText(ch)) expect(text, label).not.toMatch(/[{}]/);
          const html = sheetHtml(ch);
          expect(html.match(/class="page /g), label).toHaveLength(2);
          expect(html, label).not.toMatch(/[{}]/);
          const row = tables.classes.find((item) => item.id === cls);
          const unlocked = row?.asi_levels.some((asiLevel) => asiLevel <= ch.identity.main_level) ?? false;
          if (!useFeats) expect(ch.feat, label).toBeNull();
          else if (!unlocked) expect(ch.feat, label).toBeNull();
          else expect(ch.feat?.id, label).toBe(feat);
          if (!dip) {
            expect(ch.identity.second, label).toBeNull();
            expect(ch.identity.main_level, label).toBe(level);
            expect(ch.combat.dice, label).toBeNull();
          } else {
            expect(ch.identity.main_level, label).toBe(level - dip.level);
            expect(ch.identity.second, label).toContain(className(dip.cls));
          }
          const twin = buildCharacter(tables, req({ ...full, weapon_plus: 0, armor_plus: 0 }));
          const bare = twin.combat.armor.startsWith("No armor");
          expect(ch.combat.ac - twin.combat.ac, label).toBe(bare ? 0 : armorPlus);
          if (armorPlus > 0 && !bare) expect(ch.combat.armor, label).toContain(`+${armorPlus}`);
          else expect(ch.combat.armor, label).toBe(twin.combat.armor);
          expect(ch.attacks, label).toHaveLength(twin.attacks.length);
          for (const baseAtk of twin.attacks) {
            const magicName = weaponPlus > 0 ? `${baseAtk.name} +${weaponPlus}` : baseAtk.name;
            const next =
              ch.attacks.find((rowAtk) => rowAtk.name === magicName) ??
              ch.attacks.find((rowAtk) => rowAtk.name === baseAtk.name);
            expect(next, `${label} ${baseAtk.name}`).toBeTruthy();
            if (!next) continue;
            if (next.name !== baseAtk.name) {
              expect(next.to_hit - baseAtk.to_hit, label).toBe(weaponPlus);
              expect(trailing(next.damage) - trailing(baseAtk.damage), label).toBe(weaponPlus);
            } else {
              expect(next.to_hit, label).toBe(baseAtk.to_hit);
              expect(next.damage, label).toBe(baseAtk.damage);
            }
          }
        },
      ),
      { numRuns: 120 },
    );
  });

  it("ignores a stored feat and second class while those rules are off", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...raceIds),
        fc.constantFrom(...classIds),
        fc.integer({ min: 1, max: maxLevel }),
        fc.constantFrom(...featIds),
        fc.constantFrom(...classIds),
        fc.integer({ min: 1, max: maxLevel }),
        (race, cls, level, feat, other, dipLevel) => {
          const dip: ClassDip | null =
            level >= 2 && other !== cls
              ? {
                  cls: other,
                  subclass: null,
                  level: Math.min(dipLevel, level - 1),
                  cantrips: null,
                  spells: null,
                  path_spells: null,
                }
              : null;
          const stored = buildCharacter(
            tables,
            req({
              race,
              cls,
              level,
              use_feats: false,
              feat,
              use_multiclass: false,
              dip,
              weapon_plus: 0,
              armor_plus: 0,
            }),
          );
          const plain = buildCharacter(tables, req({ race, cls, level }));
          expect(sheetHtml(stored)).toBe(sheetHtml(plain));
        },
      ),
      { numRuns: 80 },
    );
  });

  it("leaves the hero alone until the first ability boost", () => {
    fc.assert(
      fc.property(fc.constantFrom(...classIds), fc.constantFrom(...featIds), fc.nat(), (cls, feat, salt) => {
        const row = tables.classes.find((item) => item.id === cls);
        if (!row) throw new Error(cls);
        const first = row.asi_levels[0] ?? 1;
        if (first <= 1) return;
        const level = 1 + (salt % (first - 1));
        const on = buildCharacter(tables, req({ cls, level, use_feats: true, feat }));
        const off = buildCharacter(tables, req({ cls, level }));
        expect(on.feat).toBeNull();
        expect(on.abilities.map((ability) => ability.score)).toEqual(off.abilities.map((ability) => ability.score));
        expect(on.combat.max_hp).toBe(off.combat.max_hp);
        expect(sheetHtml(on)).toBe(sheetHtml(off));
      }),
      { numRuns: 60 },
    );
  });

  it("refuses a plus outside 0 to 3", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: -6, max: -1 }), fc.integer({ min: 4, max: 9 })),
        fc.boolean(),
        (plus, onWeapon) => {
          const ask = onWeapon ? req({ weapon_plus: plus }) : req({ armor_plus: plus });
          expect(() => buildCharacter(tables, ask)).toThrow(CharError);
        },
      ),
      { numRuns: 30 },
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
        fc.integer({ min: 1, max: maxLevel }),
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
        fc.integer({ min: 1, max: maxLevel }),
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
      feats: fc.array(
        fc.record({
          id: word,
          name: word,
          card: fc.constant({ desc: "You snack." }),
          hp_per_level: fc.integer({ min: 0, max: 3 }),
        }),
        { maxLength: 2 },
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
          const added = content.feats?.[0];
          if (added) {
            const withFeat = buildCharacter(merged, req({ level: 4, use_feats: true, feat: added.id }));
            expect(withFeat.feat?.id).toBe(added.id);
            expect(cards(withFeat).get(added.name)?.desc).toBe("You snack.");
            for (const text of allText(withFeat)) expect(text).not.toMatch(/[{}]/);
          }
        } catch (e) {
          expect(e).toBeInstanceOf(CharError);
        }
      }),
      { numRuns: 150 },
    );
  });
});
