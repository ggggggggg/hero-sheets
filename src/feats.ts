import { grantArmor } from "./multiclass";
import { ABILITY_NAME } from "./tags";
import { CharError } from "./text";
import {
  ABILITIES,
  type Ability,
  type AbilityScores,
  type Card,
  type ClassRow,
  type Feat,
  type FeatAsk,
  type FeatPick,
  type HeroRequest,
  isAbility,
  type Subclass,
  type Tables,
} from "./types";

export interface FeatPlan extends FeatPick {
  hp: number;
  speed: number;
  init: number;
  notice: number;
  save: Ability | null;
  languages: number;
  mediumDex: number;
  card: Card;
  uses: string;
  rest: string;
  grantCantrips: number;
  grantSpells: number;
}

const valueError = (message: string) => new CharError("ValueError", message);

function meetsScores(gate: AbilityScores, need: Partial<AbilityScores> | undefined, mode: "all" | "any"): boolean {
  const checks = ABILITIES.filter((ability) => (need?.[ability] ?? 0) > 0);
  if (!checks.length) return true;
  const ok = (ability: Ability) => gate[ability] >= (need?.[ability] ?? 0);
  return mode === "all" ? checks.every(ok) : checks.some(ok);
}

function featProblem(feat: Feat, gate: AbilityScores, trained: Set<string>, caster: boolean): string {
  const bits: string[] = [];
  const list = (need: Partial<AbilityScores> | undefined) =>
    ABILITIES.filter((ability) => (need?.[ability] ?? 0) > 0)
      .map((ability) => `${ABILITY_NAME[ability]} ${need?.[ability]}`)
      .join(" and ");
  if (!meetsScores(gate, feat.need_scores, "all")) bits.push(`usually wants ${list(feat.need_scores)}`);
  if (!meetsScores(gate, feat.need_any, "any")) {
    bits.push(`usually wants ${list(feat.need_any).replace(" and ", " or ")}`);
  }
  for (const kind of feat.need_armor ?? []) {
    if (!trained.has(kind)) bits.push(`usually wants ${kind} armor training`);
  }
  if (feat.need_caster && !caster) bits.push("usually for a hero who casts spells");
  return bits.length ? `This feat ${bits.join(", and ")}` : "";
}

function goodAbility(primaries: Ability[], allowed: Ability[], gate: AbilityScores, cap: number): Ability | null {
  if (!allowed.length) return null;
  const ranked = primaries.filter((ability) => allowed.includes(ability));
  const rest = allowed.filter((ability) => !ranked.includes(ability));
  const order = [...ranked, ...rest];
  return order.find((ability) => gate[ability] < cap) ?? order[0] ?? null;
}

function fillNames(asked: string[] | null, pool: string[], count: number): string[] {
  const out: string[] = [];
  if (count <= 0) return out;
  for (const name of asked ?? []) {
    if (pool.includes(name) && !out.includes(name)) out.push(name);
    if (out.length === count) return out;
  }
  for (const name of pool) {
    if (!out.includes(name)) out.push(name);
    if (out.length === count) break;
  }
  return out;
}

export function warnFeats(
  feats: Feat[],
  gate: AbilityScores,
  trained: Set<string>,
  caster: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const feat of feats) out[feat.id] = featProblem(feat, gate, trained, caster);
  return out;
}

/** Armor and spells a feat is judged against, including a second class and not the feat itself. */
export function featTraining(
  cls: ClassRow,
  path: Subclass | null,
  raceArmor: readonly string[],
  side: { cls: ClassRow; path: Subclass | null } | null,
): { trained: Set<string>; caster: boolean } {
  const trained = new Set<string>([...cls.armor_prof, ...(path ? path.armor_prof_add : []), ...raceArmor]);
  if (side) {
    for (const kind of grantArmor(side.cls, false)) trained.add(kind);
    if (side.path) for (const kind of side.path.armor_prof_add) trained.add(kind);
  }
  const caster = cls.caster.kind !== "none" || (side != null && side.cls.caster.kind !== "none");
  return { trained, caster };
}

export function weaponTraining(cls: ClassRow, side: ClassRow | null): Set<string> {
  const prof = new Set(cls.weapon_prof);
  if (side) for (const name of side.weapon_prof) prof.add(name);
  return prof;
}

export function avgDie(die: string): number {
  const match = /^(\d+)d(\d+)$/.exec(die);
  if (!match || match[1] === undefined || match[2] === undefined) return 0;
  return (Number(match[1]) * (Number(match[2]) + 1)) / 2;
}

/** Feats the hero actually asked for. A set `feats` list wins. Otherwise one `feat` sits on the first class's first boost. */
export function asksFor(req: HeroRequest, main: ClassRow, mainLevel: number): FeatAsk[] {
  if (req.use_feats !== true) return [];
  if (req.feats) return req.feats.filter((ask) => ask.id !== "" && ask.at > 0);
  if (!req.feat) return [];
  const at = main.asi_levels.find((asiLevel) => asiLevel <= mainLevel);
  if (at === undefined) return [];
  return [
    {
      cls: main.id,
      at,
      id: req.feat,
      asi: req.feat_asi ?? null,
      skills: req.feat_skills ?? null,
      pick: req.feat_pick ?? null,
      extra: req.feat_extra ?? null,
    },
  ];
}

export function planFeat(
  tables: Tables,
  ask: FeatAsk,
  cls: ClassRow,
  path: Subclass | null,
  race: { skills: string[]; armor_prof_add: string[] },
  gate: AbilityScores,
  cap: number,
  side: { cls: ClassRow; path: Subclass | null } | null = null,
): FeatPlan {
  if (!("feats" in tables)) throw new CharError("KeyError", "feats");
  const feat = tables.feats.find((row) => row.id === ask.id);
  if (!feat) throw valueError(`unknown feat ${ask.id}`);
  const { trained, caster } = featTraining(cls, path, race.armor_prof_add, side);
  const warn = featProblem(feat, gate, trained, caster);
  const allowed = (feat.asi_pick ?? []).filter((ability) => isAbility(ability));
  const openSaves = allowed.filter((ability) => !cls.saves.includes(ability));
  const abilityPool = feat.save_pick && openSaves.length ? openSaves : allowed;
  const ability = ask.asi && allowed.includes(ask.asi) ? ask.asi : goodAbility(cls.primary, abilityPool, gate, cap);
  const save = feat.save_pick ? ability : null;
  const have = new Set([
    ...cls.skills,
    ...race.skills,
    ...(path ? path.extra_skills : []),
    ...(side ? side.cls.skills : []),
    ...(side?.path ? side.path.extra_skills : []),
  ]);
  const skillPool = tables.skills
    .slice()
    .sort((a, b) => {
      const ai = cls.primary.indexOf(a.ability);
      const bi = cls.primary.indexOf(b.ability);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name);
    })
    .map((row) => row.name)
    .filter((name) => !have.has(name));
  const skillCount = feat.skill_picks ?? 0;
  const skills = [...(feat.skills ?? []), ...fillNames(ask.skills ?? null, skillPool, skillCount)];
  const choose = feat.choose ?? [];
  const pick =
    ask.pick && choose.includes(ask.pick) ? ask.pick : (choose.find((id) => id === cls.id) ?? choose[0] ?? "");
  const grant = feat.grant ?? { cantrips: 0, spells: 0 };
  const classSpells = tables.spells.filter((row) => pick && row.classes.includes(pick));
  const classRow = tables.classes.find((row) => row.id === pick);
  const rank = (order: string[] | undefined, name: string) => {
    const index = order?.indexOf(name) ?? -1;
    return index < 0 ? 99 : index;
  };
  const cantripPool = classSpells
    .filter((row) => row.lvl === 0)
    .map((row) => row.name)
    .sort((a, b) => rank(classRow?.cantrip_order, a) - rank(classRow?.cantrip_order, b));
  const spellPool = classSpells
    .filter((row) => row.lvl === 1)
    .map((row) => row.name)
    .sort((a, b) => rank(classRow?.spell_order, a) - rank(classRow?.spell_order, b));
  const grantNames = [
    ...fillNames(ask.extra ?? null, cantripPool, grant.cantrips),
    ...fillNames(ask.extra ?? null, spellPool, grant.spells),
  ];
  const weaponProf = weaponTraining(cls, side?.cls ?? null);
  const weaponPool = tables.weapons
    .filter((weapon) => !(weaponProf.has(weapon.cat) || weaponProf.has(weapon.name)))
    .sort((a, b) => avgDie(b.die) - avgDie(a.die) || a.name.localeCompare(b.name))
    .map((weapon) => weapon.name);
  const weapons = (feat.weapon_picks ?? 0) > 0 ? fillNames(ask.extra ?? null, weaponPool, feat.weapon_picks ?? 0) : [];
  const extra = (feat.weapon_picks ?? 0) > 0 ? weapons : grantNames;
  return {
    cls: ask.cls,
    at: ask.at,
    id: feat.id,
    name: feat.name,
    ability,
    skills,
    pick,
    extra,
    warn,
    armor: feat.armor_prof ?? [],
    shield: feat.shield === true,
    weapons,
    hp: feat.hp_per_level ?? 0,
    speed: feat.speed ?? 0,
    init: feat.init ?? 0,
    notice: feat.notice ?? 0,
    save,
    languages: feat.languages ?? 0,
    mediumDex: feat.medium_dex ?? 0,
    card: feat.card,
    uses: feat.uses ?? "",
    rest: feat.rest ?? "",
    grantCantrips: grant.cantrips,
    grantSpells: grant.spells,
  };
}
