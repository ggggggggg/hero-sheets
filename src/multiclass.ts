import { ABILITY_NAME } from "./tags";
import { CharError } from "./text";
import type { Ability, AbilityScores, Caster, ClassRow, HeroRequest, SlotRow, Subclass } from "./types";

export interface SideClass {
  cls: ClassRow;
  level: number;
  path: Subclass | null;
}

const valueError = (message: string) => new CharError("ValueError", message);

export function resolveSide(
  classes: ClassRow[],
  subclasses: Subclass[],
  req: HeroRequest,
  total: number,
): SideClass | null {
  if (req.use_multiclass !== true || !req.dip) return null;
  const dip = req.dip;
  if (dip.cls === req.cls) return null;
  const dipLevel = dip.level | 0;
  if (!(dipLevel >= 1 && dipLevel < total)) {
    throw valueError("the second class needs its own levels, and the first class keeps at least 1");
  }
  const cls = classes.find((row) => row.id === dip.cls);
  if (!cls) throw valueError(`unknown class ${dip.cls}`);
  const subs = subclasses.filter((row) => row.class_id === cls.id);
  let sub: Subclass | null = null;
  if (dip.subclass) {
    sub = subs.find((row) => row.id === dip.subclass) ?? null;
    if (!sub) throw valueError(`unknown subclass ${dip.subclass}`);
  } else if (subs.length) sub = subs[0] ?? null;
  const path = sub !== null && dipLevel >= cls.subclass_level ? sub : null;
  return { cls, level: dipLevel, path };
}

function prereqParts(cls: ClassRow): { all: Ability[]; any: Ability[] } {
  const rule = cls.multiclass;
  const all = rule?.all?.length ? rule.all : rule ? [] : cls.primary[0] ? [cls.primary[0]] : [];
  const any = rule?.any ?? [];
  return { all, any };
}

export function prereqMiss(cls: ClassRow, scores: AbilityScores): string[] {
  const { all, any } = prereqParts(cls);
  const miss: string[] = [];
  for (const ability of all) {
    if ((scores[ability] ?? 0) < 13) miss.push(`${ABILITY_NAME[ability]} 13`);
  }
  if (any.length && !any.some((ability) => (scores[ability] ?? 0) >= 13)) {
    miss.push(`${any.map((ability) => ABILITY_NAME[ability]).join(" or ")} 13`);
  }
  return miss;
}

export function halfLevels(level: number): number {
  return Math.floor(level / 2);
}

export function casterLevels(parts: { kind: string; level: number }[]): number {
  let total = 0;
  for (const part of parts) {
    if (part.kind === "full") total += part.level;
    else if (part.kind === "half") total += halfLevels(part.level);
  }
  return total;
}

export function slotRow(slots: SlotRow[], kind: string, level: number): SlotRow | null {
  if (level < 1) return null;
  return slots.find((row) => row.kind === kind && row.level === level) ?? null;
}

export function maxSpellOf(slots: number[]): number {
  let max = 0;
  slots.forEach((n, i) => {
    if (n > 0) max = Math.max(max, i + 1);
  });
  return max;
}

export function diceLabel(mainDie: number, mainLevel: number, dipDie: number, dipLevel: number): string {
  const counts = new Map<number, number>();
  counts.set(mainDie, mainLevel);
  counts.set(dipDie, (counts.get(dipDie) ?? 0) + dipLevel);
  return [...counts].map(([die, n]) => `${n}d${die}`).join(" + ");
}

export function grantArmor(cls: ClassRow, heavy: boolean): string[] {
  return cls.armor_prof.filter((kind) => heavy || kind !== "heavy");
}

export function wantsText(cls: ClassRow): string {
  const { all, any } = prereqParts(cls);
  const bits: string[] = [];
  if (all.length) bits.push(all.map((ability) => ABILITY_NAME[ability]).join(" and "));
  if (any.length) bits.push(any.map((ability) => ABILITY_NAME[ability]).join(" or "));
  if (!bits.length) return "";
  return `Usually wants ${bits.join(", and ")} 13`;
}

export function spellsKnown(caster: Caster, level: number, mod: number, maxSpell: number): number | undefined {
  if (level < 1 || maxSpell === 0) return 0;
  const at = level - 1;
  if (caster.mode === "known") return caster.known[at];
  const book = Math.max(1, mod + Math.floor(level * caster.level_mult));
  if (level <= 7 || caster.cap <= 0) return Math.min(book, caster.cap);
  return book;
}

/** One spell of each level the hero can cast, highest first, then the front of the list. */
export function pickSpells(
  order: readonly string[],
  levelOf: (name: string) => number | undefined,
  maxSpell: number,
  count: number,
  covered: readonly string[],
): string[] {
  if (count <= 0) return [];
  const haveLevel = new Set<number>();
  for (const name of covered) {
    const lvl = levelOf(name);
    if (lvl !== undefined && lvl >= 1 && lvl <= maxSpell) haveLevel.add(lvl);
  }
  const skip = new Set(covered);
  const eligible = order.filter((name) => {
    if (skip.has(name)) return false;
    const lvl = levelOf(name);
    return lvl !== undefined && lvl >= 1 && lvl <= maxSpell;
  });
  const picked: string[] = [];
  const have = new Set<string>();
  for (let lvl = maxSpell; lvl >= 1 && picked.length < count; lvl -= 1) {
    if (haveLevel.has(lvl)) continue;
    const name = eligible.find((item) => levelOf(item) === lvl);
    if (!name) continue;
    picked.push(name);
    have.add(name);
  }
  for (const name of eligible) {
    if (picked.length >= count) break;
    if (have.has(name)) continue;
    picked.push(name);
    have.add(name);
  }
  return picked;
}
