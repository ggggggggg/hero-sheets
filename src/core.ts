import { asksFor, avgDie, type FeatPlan, featTraining, planFeat, warnFeats, weaponTraining } from "./feats";
import { languageNotes, languageSlots, spokenLine } from "./languages";
import {
  casterLevels,
  diceLabel,
  slotRow as findSlot,
  grantArmor,
  maxSpellOf,
  pickSpells,
  prereqMiss,
  resolveSide,
  spellsKnown,
} from "./multiclass";
import spellRuleText from "./spell-rules.json";
import { ABILITY_NAME, accentTint, tagChip, tagLegend } from "./tags";
import { CharError, escapeHtml, expand, signed } from "./text";
import { PLUS_CAP } from "./tiers";
import {
  ABILITIES,
  type Ability,
  type AbilityScores,
  type ArmorOption,
  type AttackRow,
  type CasterLine,
  type Character,
  type ChoiceOption,
  type ClassRow,
  type ClassWeapon,
  type FeatPick,
  type HeroOptions,
  type HeroRequest,
  type Item,
  isAbility,
  type Rules,
  type SheetCard,
  type SkillRow,
  type Subclass,
  type Subrace,
  type Tables,
  type WeaponOption,
} from "./types";

export { CharError, expand, signed } from "./text";
export type {
  Ability,
  AbilityScores,
  Character,
  HeroOptions,
  HeroRequest,
  Tables,
} from "./types";

const valueError = (message: string) => new CharError("ValueError", message);
const keyError = (message: string) => new CharError("KeyError", message);

function modOf(mods: AbilityScores, ability: string): number {
  if (!isAbility(ability)) throw valueError(`unknown ability ${ability}`);
  return mods[ability];
}

function scores(fill: number): AbilityScores {
  return { STR: fill, DEX: fill, CON: fill, INT: fill, WIS: fill, CHA: fill };
}

function table<K extends keyof Tables>(tables: Tables, name: K): Tables[K] {
  if (!(name in tables)) throw keyError(name);
  return tables[name];
}

function one<T>(rows: T[], what: string, pred: (row: T) => boolean): T {
  const found = rows.filter(pred);
  if (found.length !== 1) throw valueError(`unknown ${what}`);
  const row = found[0];
  if (row === undefined) throw valueError(`unknown ${what}`);
  return row;
}

function seedHash(text: string): number {
  let hash = 7;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 2147483647;
  return hash;
}

function pickItems(eligible: Item[], k: number, seed: string): string[] {
  if (k <= 0) return [];
  const tiers: Record<string, string[]> = {};
  for (const row of eligible) {
    const bucket = tiers[row.tier] ?? [];
    bucket.push(row.name);
    tiers[row.tier] = bucket;
  }
  const cmp = (a: string, b: string) => {
    const ha = seedHash(`${seed}|${a}`);
    const hb = seedHash(`${seed}|${b}`);
    return ha !== hb ? ha - hb : a < b ? -1 : a > b ? 1 : 0;
  };
  for (const tier of Object.keys(tiers)) tiers[tier]?.sort(cmp);
  const order = Object.keys(tiers)
    .map(Number)
    .sort((a, b) => b - a);
  const out: string[] = [];
  let i = 0;
  while (out.length < k && order.some((tier) => i < (tiers[tier]?.length ?? 0))) {
    for (const tier of order) {
      const name = tiers[tier]?.[i];
      if (name !== undefined && out.length < k) out.push(name);
    }
    i++;
  }
  return out;
}

interface Worn {
  name: string;
  kind: string;
  ac: number;
  str_req: number;
  dl: number;
}

interface CardSource {
  name: string;
  tag: string;
  note: string;
  desc: string;
  conc?: boolean;
}

interface SpellPrint {
  cls: ClassRow;
  path: Subclass | null;
  level: number;
  mod: number;
  cantrips: string[] | null;
  spells: string[] | null;
  pathSpells: string[] | null;
  cantripSection: string;
  spellSection: (lvl: number) => string;
  cantripEdit: (name: string) => string;
  spellEdit: (name: string) => string;
  attackEdit: string;
  strict: boolean;
}

function placedScores(rules: Rules, cls: ClassRow, req: HeroRequest): AbilityScores {
  const base = scores(10);
  if (req.base_scores != null) {
    for (const ability of ABILITIES) {
      const n = req.base_scores[ability];
      if (!(n >= 1 && n <= 20)) throw valueError(`${ability} must be 1 to 20`);
      base[ability] = n;
    }
    return base;
  }
  cls.primary.forEach((ability, i) => {
    const n = rules.standard_array[i];
    if (n !== undefined) base[ability] = n;
  });
  return base;
}

function placedRace(raceAsi: AbilityScores, req: HeroRequest): AbilityScores {
  if (req.race_asi == null) return raceAsi;
  for (const ability of ABILITIES) {
    const n = req.race_asi[ability];
    if (!(n >= 0 && n <= 3)) throw valueError(`race bonus for ${ability} must be 0 to 3`);
  }
  return req.race_asi;
}

function scoresBeforeBoost(rules: Rules, cls: ClassRow, raceAsi: AbilityScores, req: HeroRequest): AbilityScores {
  const base = placedScores(rules, cls, req);
  const rasi = placedRace(raceAsi, req);
  const abilityScores = scores(0);
  for (const ability of ABILITIES) abilityScores[ability] = base[ability] + (rasi[ability] || 0);
  return abilityScores;
}

function baseLabel(rules: Rules, base: AbilityScores): "Standard array" | "Point buy" | "Base" {
  const array = [...rules.standard_array].sort((a, b) => a - b);
  const got = ABILITIES.map((ability) => base[ability]).sort((a, b) => a - b);
  if (array.length === got.length && array.every((n, i) => n === got[i])) return "Standard array";
  const pb = rules.point_buy;
  const onChart = ABILITIES.every((ability) => {
    const n = base[ability];
    return n >= pb.low && n < pb.low + pb.costs.length;
  });
  return onChart ? "Point buy" : "Base";
}

function pointSpend(rules: Rules, base: AbilityScores): number | null {
  const pb = rules.point_buy;
  let total = 0;
  for (const ability of ABILITIES) {
    const n = base[ability];
    if (n < pb.low || n >= pb.low + pb.costs.length) return null;
    const cost = pb.costs[n - pb.low];
    if (cost === undefined) return null;
    total += cost;
  }
  return total;
}

export function featWarnings(tables: Tables, req: HeroRequest): Record<string, string> {
  const rules = one(table(tables, "rules"), "rules", () => true);
  const level = Number(req.level);
  const race0 = one(table(tables, "races"), "race", (race) => race.id === req.race);
  const subraces = table(tables, "subraces").filter((row) => row.race_id === race0.id);
  const sr = req.subrace ? (subraces.find((row) => row.id === req.subrace) ?? null) : (subraces[0] ?? null);
  const cls = one(table(tables, "classes"), "class", (row) => row.id === req.cls);
  const subs = table(tables, "subclasses").filter((row) => row.class_id === cls.id);
  const sub = req.subclass ? (subs.find((row) => row.id === req.subclass) ?? null) : (subs[0] ?? null);
  const side = resolveSide(table(tables, "classes"), table(tables, "subclasses"), req, level);
  const mainLevel = side ? level - side.level : level;
  const path = sub !== null && mainLevel >= cls.subclass_level ? sub : null;
  const asi: AbilityScores = scores(0);
  for (const ability of ABILITIES) asi[ability] = (race0.asi[ability] || 0) + (sr ? sr.asi[ability] || 0 : 0);
  const gate = scoresBeforeBoost(rules, cls, asi, req);
  const { trained, caster } = featTraining(cls, path, sr ? sr.armor_prof_add : [], side);
  return warnFeats(table(tables, "feats"), gate, trained, caster);
}

function featPick(plan: FeatPlan): FeatPick {
  return {
    cls: plan.cls,
    at: plan.at,
    id: plan.id,
    name: plan.name,
    ability: plan.ability,
    skills: plan.skills,
    pick: plan.pick,
    extra: plan.extra,
    warn: plan.warn,
    armor: plan.armor,
    shield: plan.shield,
    weapons: plan.weapons,
  };
}

export function buildCharacter(tables: Tables, req: HeroRequest): Character {
  table(tables, "feats");
  const rules = one(table(tables, "rules"), "rules", () => true);
  const level = Number(req.level);
  if (!(level >= 1 && level <= rules.max_level)) throw valueError(`level must be 1..${rules.max_level}`);
  const li = level - 1;
  const race0 = one(table(tables, "races"), "race", (race) => race.id === req.race);
  const subraces = table(tables, "subraces").filter((row) => row.race_id === race0.id);
  const sr: Subrace | null = req.subrace
    ? one(subraces, "subrace", (row) => row.id === req.subrace)
    : (subraces[0] ?? null);
  let race: RaceBuilt = { ...race0, swim: race0.swim ?? 0, armor_prof_add: [] };
  if (sr) {
    const asi = scores(0);
    for (const ability of ABILITIES) asi[ability] = (race0.asi[ability] || 0) + (sr.asi[ability] || 0);
    race = {
      ...race0,
      name: sr.name,
      speed: race0.speed + sr.speed,
      swim: race0.swim ?? 0,
      hp_per_level: race0.hp_per_level + sr.hp_per_level,
      asi,
      skills: [...new Set([...race0.skills, ...sr.skills])],
      armor_prof_add: sr.armor_prof_add.slice(),
    };
  }
  const cls = one(table(tables, "classes"), "class", (row) => row.id === req.cls);
  const subs = table(tables, "subclasses").filter((row) => row.class_id === cls.id);
  let sub: Subclass | null = null;
  if (req.subclass) sub = one(subs, "subclass", (row) => row.id === req.subclass);
  else if (subs.length) sub = subs[0] ?? null;
  const side = resolveSide(table(tables, "classes"), table(tables, "subclasses"), req, level);
  const mainLevel = side ? level - side.level : level;
  const mainLi = mainLevel - 1;
  const path = sub !== null && mainLevel >= cls.subclass_level ? sub : null;
  const prof = rules.prof_by_level[li];
  if (prof === undefined) throw valueError(`level must be 1..${rules.max_level}`);

  const base = placedScores(rules, cls, req);
  const rasi = placedRace(race.asi, req);
  const abilityScores = scores(0);
  for (const ability of ABILITIES) abilityScores[ability] = base[ability] + (rasi[ability] || 0);
  const boosts: Record<Ability, { amount: number; from: string }[]> = {
    STR: [],
    DEX: [],
    CON: [],
    INT: [],
    WIS: [],
    CHA: [],
  };
  const rememberBoost = (ability: Ability, amount: number, from: string): void => {
    if (!amount) return;
    const list = boosts[ability];
    const last = list[list.length - 1];
    if (last && last.from === from) last.amount += amount;
    else list.push({ amount, from });
  };
  const sharedAsi = new Set([4, 8, 12, 16, 19]);
  const asiFrom = (row: ClassRow, asiLevel: number): string => {
    if (!sharedAsi.has(asiLevel)) return `${row.name} at level ${asiLevel}`;
    return side ? `level ${asiLevel} ${row.name}` : `level ${asiLevel}`;
  };
  const plans: FeatPlan[] = [];
  const featAdds: { ability: Ability; amount: number; from: string }[] = [];
  const usedFeat = new Set<string>();
  const asks = asksFor(req, cls, mainLevel);
  const takeSlot = (
    row: ClassRow,
    classLevel: number,
    ownerPath: Subclass | null,
    other: { cls: ClassRow; path: Subclass | null } | null,
  ) => {
    for (const asiLevel of row.asi_levels) {
      if (asiLevel > classLevel) continue;
      const ask = asks.find((item) => item.cls === row.id && item.at === asiLevel);
      if (ask && !usedFeat.has(ask.id)) {
        const planned = planFeat(tables, ask, row, ownerPath, race, { ...abilityScores }, rules.asi.cap, other);
        plans.push(planned);
        usedFeat.add(ask.id);
        if (planned.ability) {
          const ability = planned.ability;
          const before = abilityScores[ability];
          abilityScores[ability] = Math.min(rules.asi.cap, before + 1);
          const got = abilityScores[ability] - before;
          if (got) featAdds.push({ ability, amount: got, from: planned.name });
        }
        continue;
      }
      let left = rules.asi.amount;
      const where = asiFrom(row, asiLevel);
      for (const ability of row.primary) {
        const add = Math.max(Math.min(left, rules.asi.cap - abilityScores[ability]), 0);
        abilityScores[ability] += add;
        rememberBoost(ability, add, where);
        left -= add;
        if (left <= 0) break;
      }
    }
  };
  takeSlot(cls, mainLevel, path, side);
  if (side) takeSlot(side.cls, side.level, side.path, { cls, path });
  const multiMiss = side
    ? [...new Set([...prereqMiss(cls, abilityScores), ...prereqMiss(side.cls, abilityScores)])]
    : [];
  const mods = scores(0);
  for (const ability of ABILITIES) mods[ability] = Math.floor((abilityScores[ability] - 10) / 2);

  const owners: [string, string][] = [
    ["race", race.id],
    ["class", cls.id],
  ];
  if (path) owners.push(["subclass", path.id]);
  if (sr) owners.push(["subrace", sr.id]);
  const isOwner = (kind: string, id: string) =>
    owners.some(([ownerKind, ownerId]) => ownerKind === kind && ownerId === id);
  const choiceRows = table(tables, "choices").filter((choice) => isOwner(choice.owner_kind, choice.owner_id));
  const asked = new Map<string, string[]>();
  for (const choice of req.choices) asked.set(choice.group, choice.picks);
  const picked: [string, string, ChoiceOption, string][] = [];
  const takeChoice = (choice: (typeof choiceRows)[number], at: number, key: string) => {
    const n = choice.count[at];
    if (n === undefined || n <= 0) return;
    const names = choice.options.map((option) => option.name);
    let want = asked.get(key);
    if (want === undefined) want = names.slice(0, n);
    if (want.length !== n || new Set(want).size !== n || want.some((name) => !names.includes(name))) {
      throw valueError(`choice ${choice.group} needs ${n} distinct picks`);
    }
    for (const name of want) {
      const option = choice.options[names.indexOf(name)];
      if (!option) throw valueError(`choice ${choice.group} needs ${n} distinct picks`);
      picked.push([choice.owner_kind, choice.owner_id, option, key]);
    }
  };
  for (const choice of choiceRows) takeChoice(choice, mainLi, choice.group);
  if (side) {
    const sideLi = side.level - 1;
    const sideRows = table(tables, "choices").filter(
      (choice) =>
        (choice.owner_kind === "class" && choice.owner_id === side.cls.id) ||
        (side.path !== null && choice.owner_kind === "subclass" && choice.owner_id === side.path.id),
    );
    for (const choice of sideRows) takeChoice(choice, sideLi, `${side.cls.id}:${choice.group}`);
  }
  const effAc = picked.reduce((sum, [, , option]) => sum + option.effect.ac, 0);
  const effRhit = picked.reduce((sum, [, , option]) => sum + option.effect.ranged_hit, 0);
  const effDmg = picked.reduce((sum, [, , option]) => sum + option.effect.onehand_dmg, 0);
  const effInit = picked.reduce((sum, [, , option]) => sum + option.effect.init, 0);

  const caster = cls.caster;
  const slotRow = one(table(tables, "slots"), "slot row", (row) => row.kind === caster.kind && row.level === mainLevel);
  const slots = slotRow.slots;
  const cmod = caster.ability && isAbility(caster.ability) ? mods[caster.ability] : 0;
  const isCaster = caster.kind !== "none";

  const cantripDice = rules.cantrip_dice[li];
  if (cantripDice === undefined) throw valueError(`level must be 1..${rules.max_level}`);
  const v: Record<string, string | number> = {
    LVL: level,
    PROF: prof,
    HALFPROF: Math.floor(prof / 2),
    HALFPROFUP: Math.ceil(prof / 2),
    CD: cantripDice,
  };
  for (const ability of ABILITIES) {
    v[ability] = signed(mods[ability]);
    v[`${ability}N`] = mods[ability];
  }
  const dcb = rules.dc_base;
  Object.assign(v, {
    INTATK: signed(prof + mods.INT),
    CHADC: dcb + prof + mods.CHA,
    CONDC: dcb + prof + mods.CON,
    DC_WIS: dcb + prof + mods.WIS,
    MANDC: dcb + prof + Math.max(mods.STR, mods.DEX),
    CHANMIN1: Math.max(1, mods.CHA),
    WISMIN1: Math.max(1, mods.WIS),
    CHAPLUS1: 1 + mods.CHA,
    DOB: mods.CHA + level,
    WARD: 2 * level + mods.INT,
  });
  if (isCaster)
    Object.assign(v, { SPATK: signed(prof + cmod), DC: dcb + prof + cmod, MOD: signed(cmod), MODN: Math.max(cmod, 1) });
  for (const row of table(tables, "scaling")) {
    if (!isOwner(row.owner_kind, row.owner_id)) continue;
    const at = row.owner_kind === "class" || row.owner_kind === "subclass" ? mainLi : li;
    const value = row.values[at];
    if (value === undefined) throw valueError(`scaling ${row.key} has no value at level ${at + 1}`);
    v[row.key] = value;
  }
  for (const [, , option] of picked) for (const kv of option.effect.vars) v[kv.key] = kv.value;

  const acOf = (spec: { base: number; add: Ability[] }) =>
    spec.base + mods.DEX + spec.add.reduce((sum, ability) => sum + mods[ability], 0);
  const uaMain = path?.armor ?? cls.armor;
  let ua = uaMain;
  if (side) {
    const uaSide = side.path?.armor ?? side.cls.armor;
    if (acOf(uaSide) > acOf(uaMain)) ua = uaSide;
  }
  const profs = new Set([...cls.armor_prof, ...(path ? path.armor_prof_add : []), ...race.armor_prof_add]);
  for (const planned of plans) for (const kind of planned.armor) profs.add(kind);
  if (side) {
    for (const kind of grantArmor(side.cls, false)) profs.add(kind);
    if (side.path) for (const kind of side.path.armor_prof_add) profs.add(kind);
  }
  const armorOptions: Worn[] = [
    {
      name: "No armor",
      kind: "none",
      ac: ua.base + mods.DEX + ua.add.reduce((sum, ability) => sum + mods[ability], 0),
      str_req: 0,
      dl: 1,
    },
  ];
  for (const armor of table(tables, "armor")) {
    if (profs.has(armor.kind) || armor.name === req.armor) {
      armorOptions.push({
        name: armor.name,
        kind: armor.kind,
        ac:
          armor.base +
          Math.min(
            mods.DEX,
            armor.kind === "medium"
              ? Math.max(armor.dex_cap, ...plans.map((planned) => planned.mediumDex), 0)
              : armor.dex_cap,
          ),
        str_req: armor.str_req,
        dl: armor.default_level,
      });
    }
  }
  let worn: Worn;
  if (req.armor != null) {
    const found = armorOptions.find((option) => option.name === req.armor);
    if (!found) throw valueError(`can't wear ${req.armor}`);
    worn = found;
  } else {
    const first = armorOptions[0];
    if (!first) throw valueError("can't wear armor");
    worn = first;
    for (const option of armorOptions)
      if (option.str_req <= abilityScores.STR && option.dl <= level && option.ac > worn.ac) worn = option;
  }
  const weaponProf = weaponTraining(cls, side?.cls ?? null);
  for (const planned of plans) for (const name of planned.weapons) weaponProf.add(name);
  const weaponOptions = table(tables, "weapons").filter(
    (weapon) => weaponProf.has(weapon.cat) || weaponProf.has(weapon.name),
  );
  const slot = cls.melee_slot;
  const baseW = slot >= 0 && slot < cls.weapons.length ? cls.weapons[slot] : null;
  const carried = (found: (typeof weaponOptions)[number]): ClassWeapon => ({
    name: found.name,
    die: found.die,
    ability: found.ability,
    kind: "melee",
    hands: found.hands,
    note: found.note,
  });
  const pickedList = req.extra_weapons?.length ? req.extra_weapons : null;
  let main: ClassWeapon | null = null;
  if (req.weapon != null && pickedList == null) {
    const found = weaponOptions.find((weapon) => weapon.name === req.weapon);
    if (!found || !baseW) throw valueError(`can't use ${req.weapon}`);
    main = carried(found);
  }
  const shieldOk = cls.shield_prof || plans.some((planned) => planned.shield) || !!side?.cls.shield_prof;
  const shield = req.shield != null ? !!req.shield : cls.shield_default && !(main && main.hands === "two");
  if (shield && main && main.hands === "two") throw valueError("a two-handed weapon and a shield don't fit together");
  if (!main && baseW && !shield && baseW.ability === "STR" && baseW.hands === "one") {
    let best: (typeof weaponOptions)[number] | null = null;
    for (const weapon of weaponOptions) {
      if (weapon.hands === "two" && weapon.ability === "STR" && (!best || avgDie(weapon.die) > avgDie(best.die)))
        best = weapon;
    }
    if (best && avgDie(best.die) > avgDie(baseW.die) + effDmg) {
      main = carried(best);
    }
  }
  const weapons = cls.weapons.slice();
  if (main) weapons[slot] = main;
  const dipNames = new Set<string>();
  if (side) {
    const seen = new Set(weapons.map((weapon) => weapon.name));
    for (let index = 0; index < side.cls.weapons.length; index++) {
      if (index === side.cls.melee_slot) continue;
      const weapon = side.cls.weapons[index];
      if (!weapon || seen.has(weapon.name)) continue;
      weapons.push(weapon);
      dipNames.add(weapon.name);
      seen.add(weapon.name);
    }
  }
  const extraNames = new Set<string>();
  let plusName = weapons[slot]?.name ?? "";
  if (pickedList) {
    const rows: ClassWeapon[] = [];
    const seen = new Set<string>();
    for (const name of pickedList) {
      if (seen.has(name)) continue;
      const found = weaponOptions.find((weapon) => weapon.name === name);
      if (!found || !baseW) throw valueError(`can't use ${name}`);
      rows.push(carried(found));
      seen.add(name);
    }
    const kept: ClassWeapon[] = [];
    let at = 0;
    weapons.forEach((weapon, index) => {
      if (!weapon) return;
      const inTable = weaponOptions.some((option) => option.name === weapon.name);
      if (dipNames.has(weapon.name) || !inTable) {
        if (index < slot) at++;
        kept.push(weapon);
      }
    });
    const keptNames = new Set(kept.map((weapon) => weapon.name));
    const fresh = rows.filter((row) => !keptNames.has(row.name));
    kept.splice(at, 0, ...fresh);
    weapons.length = 0;
    weapons.push(...kept);
    for (const row of fresh) extraNames.add(row.name);
    plusName = fresh[0]?.name ?? "";
  }
  const gearPlus = (value: number | undefined, what: string): number => {
    if (value == null || value === 0) return 0;
    if (!Number.isInteger(value) || value < 0 || value > PLUS_CAP)
      throw valueError(`${what} plus must be 0 to ${PLUS_CAP}`);
    return value;
  };
  const weaponPlus = gearPlus(req.weapon_plus, "weapon");
  const armorPlus = gearPlus(req.armor_plus, "armor");
  const wornPlus = worn.kind !== "none" ? armorPlus : 0;
  const ac = worn.ac + wornPlus + (shield ? 2 : 0) + (worn.kind !== "none" ? effAc : 0);
  v.AC1 = ac + 1;
  v.AC16 = Math.max(ac, 16);
  const armorLabel =
    (worn.kind !== "none" ? worn.name : "No armor") + (wornPlus ? ` +${wornPlus}` : "") + (shield ? " + shield" : "");
  const armorOffbook = (worn.kind !== "none" && !profs.has(worn.kind)) || (shield && !shieldOk);
  const hd = cls.hit_die;
  const avg = (die: number) => Math.floor(die / 2) + 1;
  const hpParts: SkillRow["parts"] = [];
  const con = mods.CON;
  hpParts.push({
    label: "Level 1",
    amount: hd + con,
    from: `${cls.name} d${hd} and Constitution`,
  });
  if (mainLevel > 1) {
    const each = avg(hd) + con;
    hpParts.push({
      label: mainLevel === 2 ? "Level 2" : `Levels 2–${mainLevel}`,
      amount: (mainLevel - 1) * each,
      from: `${each} each, from the hit die and Constitution`,
    });
  }
  if (side) {
    const each = avg(side.cls.hit_die) + con;
    hpParts.push({
      label: side.cls.name,
      amount: side.level * each,
      from: `${each} each for ${side.level} ${side.level === 1 ? "level" : "levels"}`,
    });
  }
  if (race.hp_per_level)
    hpParts.push({
      label: "Race",
      amount: race.hp_per_level * level,
      from: `${race.name}, ${race.hp_per_level} each level`,
    });
  if (path?.hp_per_level)
    hpParts.push({
      label: path.name,
      amount: path.hp_per_level * mainLevel,
      from: `${path.hp_per_level} each level`,
    });
  if (side?.path?.hp_per_level)
    hpParts.push({
      label: side.path.name,
      amount: side.path.hp_per_level * side.level,
      from: `${side.path.hp_per_level} each level`,
    });
  for (const planned of plans)
    if (planned.hp) hpParts.push({ label: "Feat", amount: planned.hp * level, from: planned.name });
  const hp = hpParts.reduce((sum, part) => sum + part.amount, 0);
  const speedBonus = cls.speed_bonus[mainLi];
  if (speedBonus === undefined) throw valueError(`level must be 1..${rules.max_level}`);
  let sideSpeed = 0;
  let sideSpeedFrom = "";
  if (side) {
    const found = side.cls.speed_bonus[side.level - 1];
    if (found === undefined) throw valueError(`level must be 1..${rules.max_level}`);
    sideSpeed = found;
    sideSpeedFrom = side.cls.name;
  }
  const slowed = abilityScores.STR < worn.str_req ? 10 : 0;
  const speedParts: SkillRow["parts"] = [{ label: race.name, amount: race.speed, from: "" }];
  if (speedBonus) speedParts.push({ label: cls.name, amount: speedBonus, from: "" });
  if (sideSpeed) speedParts.push({ label: sideSpeedFrom, amount: sideSpeed, from: "" });
  if (slowed) speedParts.push({ label: "Armor", amount: -slowed, from: "Strength is under what this armor wants" });
  for (const planned of plans)
    if (planned.speed) speedParts.push({ label: "Feat", amount: planned.speed, from: planned.name });
  const speed = speedParts.reduce((sum, part) => sum + part.amount, 0);
  const swim = race.swim > 0 ? Math.max(0, race.swim - slowed) : 0;

  const profSk = new Set([
    ...cls.skills,
    ...race.skills,
    ...(path ? path.extra_skills : []),
    ...plans.flatMap((planned) => planned.skills),
    ...(side ? side.cls.skills : []),
    ...(side?.path ? side.path.extra_skills : []),
  ]);
  const expert = new Set<string>();
  for (const entry of cls.expertise) if (entry.lvl <= mainLevel) for (const skill of entry.skills) expert.add(skill);
  if (side)
    for (const entry of side.cls.expertise)
      if (entry.lvl <= side.level) for (const skill of entry.skills) expert.add(skill);
  const joinNames = (names: string[]): string => {
    const unique: string[] = [];
    for (const name of names) if (!unique.includes(name)) unique.push(name);
    if (unique.length <= 1) return unique[0] ?? "";
    if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
    return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
  };
  const skillRows = table(tables, "skills").map((skill) => {
    const trained = profSk.has(skill.name);
    const isExpert = expert.has(skill.name);
    if (!isAbility(skill.ability)) throw valueError(`unknown ability ${skill.ability}`);
    const mod = mods[skill.ability];
    const score = abilityScores[skill.ability];
    const trainFrom = joinNames([
      ...(cls.skills.includes(skill.name) ? [cls.name] : []),
      ...(race.skills.includes(skill.name) ? [race.name] : []),
      ...(path?.extra_skills.includes(skill.name) ? [path.name] : []),
      ...plans.filter((planned) => planned.skills.includes(skill.name)).map((planned) => planned.name),
      ...(side?.cls.skills.includes(skill.name) ? [side.cls.name] : []),
      ...(side?.path?.extra_skills.includes(skill.name) ? [side.path.name] : []),
    ]);
    const expertFrom = joinNames([
      ...(cls.expertise.some((entry) => entry.lvl <= mainLevel && entry.skills.includes(skill.name)) ? [cls.name] : []),
      ...(side
        ? side.cls.expertise.some((entry) => entry.lvl <= side.level && entry.skills.includes(skill.name))
          ? [side.cls.name]
          : []
        : []),
    ]);
    const parts: SkillRow["parts"] = [{ label: `${ABILITY_NAME[skill.ability]} ${score}`, amount: mod, from: "" }];
    if (trained || isExpert) parts.push({ label: "Proficiency", amount: prof, from: trainFrom || expertFrom });
    if (isExpert) parts.push({ label: "Expertise", amount: prof, from: expertFrom });
    return {
      name: skill.name,
      ability: skill.ability,
      bonus: mod + prof * (isExpert ? 2 : trained ? 1 : 0),
      prof: trained,
      expert: isExpert,
      parts,
      ...(skill.use ? { use: skill.use } : {}),
    };
  });
  const perception = skillRows.find((skill) => skill.name === "Perception");
  const noticeParts: SkillRow["parts"] = [{ label: "Base", amount: 10, from: "" }];
  if (perception) noticeParts.push({ label: "Perception", amount: perception.bonus, from: "" });
  else noticeParts.push({ label: "Wisdom", amount: mods.WIS, from: "" });
  for (const planned of plans) {
    if (planned.notice) noticeParts.push({ label: "Feat", amount: planned.notice, from: planned.name });
  }

  const sideAbility = side?.cls.caster.ability ?? "";
  const sideMod = sideAbility && isAbility(sideAbility) ? mods[sideAbility] : 0;
  const dipBag = (): Record<string, string | number> => {
    const bag: Record<string, string | number> = { ...v };
    if (!side) return bag;
    const owners: [string, string][] = [["class", side.cls.id]];
    if (side.path) owners.push(["subclass", side.path.id]);
    for (const row of table(tables, "scaling")) {
      if (!owners.some(([kind, id]) => kind === row.owner_kind && id === row.owner_id)) continue;
      const value = row.values[side.level - 1];
      if (value === undefined) throw valueError(`scaling ${row.key} has no value at level ${side.level}`);
      bag[row.key] = value;
    }
    for (const [ownerKind, ownerId, option] of picked) {
      const owns =
        (ownerKind === "class" && ownerId === side.cls.id) ||
        (side.path !== null && ownerKind === "subclass" && ownerId === side.path.id);
      if (!owns) continue;
      for (const kv of option.effect.vars) bag[kv.key] = kv.value;
    }
    if (side.cls.caster.kind !== "none") {
      bag.SPATK = signed(prof + sideMod);
      bag.DC = dcb + prof + sideMod;
      bag.MOD = signed(sideMod);
      bag.MODN = Math.max(sideMod, 1);
    }
    return bag;
  };
  const dipCast = side ? dipBag() : null;
  const attacks: AttackRow[] = weapons.map((weapon) => {
    if (!weapon) throw valueError("missing weapon");
    const fromDip = dipNames.has(weapon.name);
    const bag = fromDip && dipCast ? dipCast : v;
    let toHit: number;
    let damage: string;
    if (weapon.ability === "SPELL") {
      toHit = prof + (fromDip ? sideMod : cmod);
      damage = expand(weapon.die, bag);
    } else {
      const bonusMod = weapon.ability === "FIN" ? Math.max(mods.STR, mods.DEX) : modOf(mods, weapon.ability);
      const magic = weaponPlus > 0 && !fromDip && weapon.name === plusName;
      toHit = prof + bonusMod + (weapon.kind === "ranged" ? effRhit : 0) + (magic ? weaponPlus : 0);
      const bonus =
        bonusMod + (weapon.kind === "melee" && weapon.hands === "one" ? effDmg : 0) + (magic ? weaponPlus : 0);
      damage = expand(weapon.die, bag) + (bonus ? signed(bonus) : "");
    }
    const isPick = weapon.name === plusName || extraNames.has(weapon.name);
    const edit = weapon.ability === "SPELL" ? (fromDip ? "dip-cantrips" : "cantrips") : isPick ? "weapon" : "class";
    const magicName = weaponPlus > 0 && weapon.name === plusName ? `${weapon.name} +${weaponPlus}` : weapon.name;
    return {
      name: magicName,
      to_hit: toHit,
      damage,
      note: expand(weapon.note, bag) || (weapon.kind === "melee" ? "melee" : ""),
      edit,
    };
  });

  const cards: SheetCard[] = [];
  const card = (section: string, source: CardSource, uses?: string, rest?: string, edit?: string, why?: string) => {
    const expandedUses = uses ? expand(uses, v) : "";
    const trimmed = expandedUses.trim();
    const parsed = /^-*\d+$/.test(trimmed) ? Number.parseInt(trimmed.replace(/^-+/, "-"), 10) : null;
    if (parsed !== null && parsed <= 0) return;
    cards.push({
      section,
      name: expand(source.name, v),
      tag: source.tag,
      note: expand(source.note, v),
      desc: expand(source.desc, v),
      uses: parsed,
      rest: rest ? expand(rest, v) : null,
      conc: source.conc === true,
      edit,
      ...(why ? { why } : {}),
    });
  };
  const features = table(tables, "features");
  const printOwners = (sections: [string, string, string][], levelOf: (kind: string) => number) => {
    const editKind = (kind: string) => (kind === "subclass" ? "path" : kind);
    for (const [kind, id, section] of sections) {
      for (const feature of features) {
        if (feature.owner_kind === kind && feature.owner_id === id && feature.lvl <= levelOf(kind)) {
          card(section, feature.card, feature.tracker.uses, feature.tracker.rest, editKind(kind));
        }
      }
      for (const [ownerKind, ownerId, option, group] of picked) {
        if (ownerKind !== kind || ownerId !== id) continue;
        card(
          section,
          { name: option.name, tag: option.tag, note: "", desc: option.desc },
          undefined,
          undefined,
          `choice:${group}`,
        );
      }
    }
  };
  const sections: [string, string, string][] = [["class", cls.id, `${cls.name} Powers`]];
  if (path) sections.push(["subclass", path.id, path.name]);
  sections.push(["race", race.id, `${race0.name} Stuff`]);
  if (sr) sections.push(["subrace", sr.id, `${race0.name} Stuff`]);
  printOwners(sections, (kind) => (kind === "class" || kind === "subclass" ? mainLevel : level));
  for (const plan of plans) {
    const className = table(tables, "classes").find((row) => row.id === plan.pick)?.name;
    v.PICK = className ?? (plan.pick ? plan.pick.charAt(0).toUpperCase() + plan.pick.slice(1) : "");
    const bits = [
      plan.skills.length ? `Trained in ${plan.skills.join(", ")}` : "",
      plan.weapons.length ? `You can use ${plan.weapons.join(", ")}` : "",
    ].filter(Boolean);
    const desc = bits.length ? `${plan.card.desc} ${bits.join(". ")}.` : plan.card.desc;
    card("Feat", { ...plan.card, desc, note: plan.warn ? "off book" : plan.card.note }, plan.uses, plan.rest, "feat");
    if (plan.grantCantrips || plan.grantSpells) {
      const castClass = table(tables, "classes").find((row) => row.id === plan.pick);
      const castAbility = castClass?.caster.ability;
      const castMod = castAbility && isAbility(castAbility) ? mods[castAbility] : 0;
      const saved: Record<string, string | number | undefined> = {};
      for (const key of ["SPATK", "DC", "MOD", "MODN", "S"]) saved[key] = v[key];
      v.SPATK = signed(prof + castMod);
      v.DC = dcb + prof + castMod;
      v.MOD = signed(castMod);
      v.MODN = Math.max(castMod, 1);
      for (const name of plan.extra) {
        const row = table(tables, "spells").find((spell) => spell.name === name);
        if (!row) continue;
        const source: CardSource = { ...row.card, note: row.lvl > 0 ? "once a day" : "feat" };
        if (row.scale) v.S = String(row.scale.base) + row.scale.unit;
        card("Feat", source, row.lvl > 0 ? "1" : "", row.lvl > 0 ? "long" : "", "feat");
      }
      for (const key of ["SPATK", "DC", "MOD", "MODN", "S"]) {
        const value = saved[key];
        if (value === undefined) delete v[key];
        else v[key] = value;
      }
    }
  }

  let spellcasting: Character["spellcasting"] = null;
  let casters: CasterLine[] = [];
  let pact: Character["pact"] = null;
  const castParts = (ability: string, mod: number, from: string): SkillRow["parts"] => [
    { label: "Proficiency", amount: prof, from: "" },
    { label: isAbility(ability) ? ABILITY_NAME[ability] : "Ability", amount: mod, from },
  ];
  const spells = table(tables, "spells");
  const printSpells = (spec: SpellPrint, slotCounts: number[]) => {
    const cast = spec.cls.caster;
    const maxSpell = maxSpellOf(slotCounts);
    const spell = (name: string) => one(spells, `spell ${name}`, (row) => row.name === name);
    const exists = (name: string) => spells.some((row) => row.name === name);
    const listed = cast.cantrips[spec.level - 1];
    if (spec.strict && listed === undefined) throw valueError(`level must be 1..${rules.max_level}`);
    const nCan = listed ?? 0;
    const cantrips = spec.cantrips != null ? spec.cantrips : spec.cls.cantrip_order.filter(exists).slice(0, nCan);
    if (cantrips.length > nCan) throw valueError("too many cantrips");
    const bonusCan = (spec.path ? spec.path.extra_cantrips : []).filter((name) => !cantrips.includes(name));
    if (cantrips.concat(bonusCan).includes("Shillelagh")) {
      attacks.unshift({
        name: "Club (Shillelagh)",
        to_hit: prof + spec.mod,
        damage: `1d8${spec.mod ? signed(spec.mod) : ""}`,
        note: "melee",
        edit: spec.attackEdit,
      });
    }
    let auto: string[];
    if (spec.pathSpells != null) {
      auto = [...new Set(spec.pathSpells)];
      for (const name of auto) {
        const lvl = spell(name).lvl;
        if (!(lvl >= 1 && lvl <= maxSpell)) throw valueError(`${name} is too high a level`);
      }
    } else {
      auto = (spec.path ? spec.path.auto_spells : [])
        .filter((entry) => entry.lvl <= spec.level)
        .map((entry) => entry.spell)
        .filter((name) => {
          const lvl = spell(name).lvl;
          return lvl > 0 && lvl <= Math.max(maxSpell, 0);
        });
    }
    const known = spellsKnown(cast, spec.level, spec.mod, maxSpell);
    if (spec.strict && known === undefined) throw valueError(`level must be 1..${rules.max_level}`);
    const nSp = known ?? 0;
    let picks: string[];
    if (spec.spells != null) {
      picks = spec.spells.slice();
      if (picks.length > nSp) throw valueError("too many spells");
      for (const name of picks) {
        const row = spell(name);
        if (!(row.lvl >= 1 && row.lvl <= maxSpell)) throw valueError(`${name} is too high a level`);
      }
    } else {
      picks = pickSpells(
        spec.cls.spell_order,
        (name) => (exists(name) ? spell(name).lvl : undefined),
        maxSpell,
        nSp,
        auto,
      );
    }
    const scaled = (row: (typeof spells)[number]) => {
      const scale = row.scale;
      const steps = cast.kind === "pact" && row.lvl > 0 ? Math.max(0, maxSpell - row.lvl) : 0;
      v.S = scale == null ? "" : String(scale.base + scale.per * steps) + scale.unit;
      return steps;
    };
    const abilityName = cast.ability && isAbility(cast.ability) ? ABILITY_NAME[cast.ability] : "";
    const explain = (desc: string, note: string): string | undefined => {
      const bits: string[] = [];
      const die = /(\d+d\d+)\{MOD\}/.exec(desc);
      if (die && abilityName)
        bits.push(
          `${die[1]} is the spell's roll. ${signed(spec.mod)} is the ${abilityName} bonus, from ${spec.cls.name}.`,
        );
      else if (desc.includes("{MOD}") && abilityName)
        bits.push(`${signed(spec.mod)} is the ${abilityName} bonus, from ${spec.cls.name}.`);
      if (note.split("•").some((part) => part.trim().toLowerCase() === "extra")) {
        const from = spec.path?.name ?? spec.cls.name;
        bits.push(`Extra means ${from} gives this one. It does not use a spell pick.`);
      }
      return bits.length ? bits.join(" ") : undefined;
    };
    for (const name of cantrips) {
      scaled(spell(name));
      const source = spell(name).card;
      card(
        spec.cantripSection,
        source,
        undefined,
        undefined,
        spec.cantripEdit(name),
        explain(source.desc, source.note),
      );
    }
    for (const name of bonusCan) {
      scaled(spell(name));
      const source = { ...spell(name).card, note: "extra" };
      card(
        spec.cantripSection,
        source,
        undefined,
        undefined,
        spec.cantripEdit(name),
        explain(source.desc, source.note),
      );
    }
    for (let lvl = 1; lvl <= maxSpell; lvl++) {
      for (const name of picks.concat(auto)) {
        const row = spell(name);
        if (row.lvl !== lvl) continue;
        const source: CardSource = { ...row.card };
        if (scaled(row) && row.scale != null)
          source.note = stripChars(`${source.note} • cast at lvl ${maxSpell}`, " •");
        if (auto.includes(name)) source.note = stripChars(`${source.note} • extra`, " •");
        card(
          spec.spellSection(lvl),
          source,
          undefined,
          undefined,
          spec.spellEdit(name),
          explain(row.card.desc, source.note),
        );
      }
    }
    return cantrips;
  };
  if (isCaster) {
    const cantrips = printSpells(
      {
        cls,
        path,
        level: mainLevel,
        mod: cmod,
        cantrips: req.cantrips,
        spells: req.spells,
        pathSpells: req.path_spells,
        cantripSection: "Free Magic",
        spellSection: (lvl) => `Level ${lvl} Spells`,
        cantripEdit: (name) => `cantrip:${name}`,
        spellEdit: (name) => `spell:${name}`,
        attackEdit: "cantrips",
        strict: true,
      },
      slots,
    );
    if (cantrips.length || slots.length) {
      spellcasting = {
        ability: caster.ability,
        attack: prof + cmod,
        dc: dcb + prof + cmod,
        dc_base: dcb,
        slots: slots.map((count, i) => ({ level: i + 1, count })).filter((slot) => slot.count > 0),
        rest: slotRow.rest,
        parts: castParts(caster.ability, cmod, cls.name),
      };
    }
  }

  if (side && req.dip && dipCast) {
    const saved: Record<string, string | number | undefined> = {};
    const keys = new Set([...Object.keys(v), ...Object.keys(dipCast)]);
    for (const key of keys) saved[key] = v[key];
    for (const key of Object.keys(v)) if (!(key in dipCast)) delete v[key];
    Object.assign(v, dipCast);
    const dipSections: [string, string, string][] = [["class", side.cls.id, `${side.cls.name} Powers`]];
    if (side.path) dipSections.push(["subclass", side.path.id, side.path.name]);
    printOwners(dipSections, () => side.level);
    const dipCaster = side.cls.caster;
    const dipReq = req.dip;
    if (dipCaster.kind !== "none") {
      const own = findSlot(table(tables, "slots"), dipCaster.kind, side.level);
      printSpells(
        {
          cls: side.cls,
          path: side.path,
          level: side.level,
          mod: sideMod,
          cantrips: dipReq.cantrips,
          spells: dipReq.spells,
          pathSpells: dipReq.path_spells,
          cantripSection: `${side.cls.name} Cantrips`,
          spellSection: (lvl) => `${side.cls.name} Level ${lvl}`,
          cantripEdit: (name) => `dip-cantrip:${name}`,
          spellEdit: (name) => `dip-spell:${name}`,
          attackEdit: "dip-cantrips",
          strict: false,
        },
        own?.slots ?? [],
      );
    }
    for (const key of Object.keys(v)) if (!(key in saved)) delete v[key];
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete v[key];
      else v[key] = value;
    }
    const listed = (counts: number[]) =>
      counts.map((count, i) => ({ level: i + 1, count })).filter((entry) => entry.count > 0);
    const partFor = (row: ClassRow, classLevel: number) => {
      const cast = row.caster;
      if (cast.kind === "none") return null;
      const ability = cast.ability;
      const mod = ability && isAbility(ability) ? mods[ability] : 0;
      const found = findSlot(table(tables, "slots"), cast.kind, classLevel);
      const counts = found?.slots ?? [];
      return {
        name: row.name,
        kind: cast.kind,
        ability,
        attack: prof + mod,
        dc: dcb + prof + mod,
        dc_base: dcb,
        slots: counts,
        rest: found?.rest ?? "long",
        visible: (cast.cantrips[classLevel - 1] ?? 0) > 0 || counts.some((n) => n > 0),
        level: classLevel,
        parts: castParts(ability ?? "", mod, row.name),
      };
    };
    const parts = [partFor(cls, mainLevel), partFor(side.cls, side.level)].flatMap((part) => (part ? [part] : []));
    const pooled = parts.filter((part) => part.kind === "full" || part.kind === "half");
    const pactPart = parts.find((part) => part.kind === "pact") ?? null;
    if (pooled.length >= 2) {
      const total = casterLevels(pooled.map((part) => ({ kind: part.kind, level: part.level })));
      const row = total > 0 ? findSlot(table(tables, "slots"), "full", total) : null;
      const shown = pooled.find((part) => part.visible) ?? pooled[0];
      spellcasting =
        row && shown && row.slots.some((n) => n > 0)
          ? {
              ability: shown.ability,
              attack: shown.attack,
              dc: shown.dc,
              dc_base: shown.dc_base,
              slots: listed(row.slots),
              rest: row.rest,
              parts: shown.parts,
            }
          : null;
    } else if (pooled.length === 1) {
      const only = pooled[0];
      spellcasting = only?.slots.some((n) => n > 0)
        ? {
            ability: only.ability,
            attack: only.attack,
            dc: only.dc,
            dc_base: only.dc_base,
            slots: listed(only.slots),
            rest: only.rest,
            parts: only.parts,
          }
        : null;
    } else spellcasting = null;
    pact = pactPart?.slots.some((n) => n > 0)
      ? {
          ability: pactPart.ability,
          attack: pactPart.attack,
          dc: pactPart.dc,
          dc_base: pactPart.dc_base,
          slots: listed(pactPart.slots),
          rest: pactPart.rest,
          parts: pactPart.parts,
        }
      : null;
    casters = parts
      .filter((part) => part.visible)
      .map((part) => ({
        name: part.name,
        attack: part.attack,
        dc: part.dc,
        dc_base: part.dc_base,
        parts: part.parts,
      }));
  }

  const items = table(tables, "items");
  const slotsN = rules.item_slots[li];
  if (slotsN === undefined) throw valueError(`level must be 1..${rules.max_level}`);
  const byItem = new Map(items.map((row) => [row.name, row]));
  let chosen: string[];
  if (req.items != null) {
    chosen = [...new Set(req.items)];
    if (chosen.length > slotsN) throw valueError("too many magic items");
    for (const name of chosen) if (!byItem.has(name)) throw valueError(`unknown magic item ${name}`);
  } else {
    const busy = cards.filter((entry) => entry.tag === "A" || entry.tag === "B").length;
    const floor = rules.option_floor[li];
    if (floor === undefined) throw valueError(`level must be 1..${rules.max_level}`);
    const want = Math.min(slotsN, Math.max(0, floor - busy));
    chosen = pickItems(
      items.filter((row) => row.min_level <= level && (!row.use_by.length || row.use_by.includes(cls.id))),
      want,
      `${cls.id}|${race.id}|${req.item_seed || ""}`,
    );
  }
  for (const name of chosen) {
    const row = byItem.get(name);
    if (!row) throw valueError(`unknown magic item ${name}`);
    card("Potions & Magic Items", row.card, String(row.uses), row.rest, `item:${name}`);
  }

  const saveProf = new Set<Ability>(cls.saves);
  for (const planned of plans) if (planned.save) saveProf.add(planned.save);
  const monkLevel = cls.id === "monk" ? mainLevel : side?.cls.id === "monk" ? side.level : 0;
  if (monkLevel >= 14) for (const trained of ABILITIES) saveProf.add(trained);
  const rogueLevel = cls.id === "rogue" ? mainLevel : side?.cls.id === "rogue" ? side.level : 0;
  if (rogueLevel >= 15) saveProf.add("WIS");

  const scoreLabel = baseLabel(rules, base);
  const scoreNotes: string[] = [];
  if (scoreLabel === "Base") scoreNotes.push("These scores are outside the 8–15 point-buy chart. Talk to your DM.");
  else if (scoreLabel === "Point buy") {
    const spent = pointSpend(rules, base);
    const budget = rules.point_buy.budget;
    if (spent !== null && spent > budget)
      scoreNotes.push(`Point buy is ${spent} of ${budget} points, which is over budget. Talk to your DM.`);
  }
  const bookRace = ABILITIES.reduce((sum, ability) => sum + (race.asi[ability] || 0), 0);
  const raceGot = ABILITIES.reduce((sum, ability) => sum + (rasi[ability] || 0), 0);
  if (raceGot !== bookRace)
    scoreNotes.push(`This race bonus adds up to +${raceGot}. The usual is +${bookRace}. Talk to your DM.`);
  const scoreNote = scoreNotes.join(" ");
  const featLang = plans.reduce((sum, planned) => sum + planned.languages, 0);
  const featLangFrom = joinNames(plans.filter((planned) => planned.languages > 0).map((planned) => planned.name));
  const scoreParts = (ability: Ability): SkillRow["parts"] => {
    const parts: SkillRow["parts"] = [{ label: scoreLabel, amount: base[ability], from: "" }];
    if (rasi[ability]) parts.push({ label: "Race", amount: rasi[ability], from: race.name });
    for (const boost of boosts[ability]) parts.push({ label: "Ability boost", amount: boost.amount, from: boost.from });
    for (const add of featAdds)
      if (add.ability === ability) parts.push({ label: "Feat", amount: add.amount, from: add.from });
    return parts;
  };

  const character: Character = {
    identity: {
      name: req.name,
      race: race.name,
      cls: cls.name,
      subclass: path ? path.name : null,
      level,
      accent: cls.look.accent,
      tagline: cls.look.tagline,
      languages: spokenLine(race.languages, featLang, req.extra_languages),
      language_notes: languageNotes(race.languages, race.name, featLang, featLangFrom, req.extra_languages),
      language_slots: languageSlots(race.languages, featLang),
      second: side ? `${side.cls.name}${side.path ? ` (${side.path.name})` : ""} ${side.level}` : null,
      offbook: multiMiss.length ? `off book: ${multiMiss.join(", ")}` : null,
      main_level: mainLevel,
    },
    abilities: ABILITIES.map((ability) => ({
      key: ability,
      score: abilityScores[ability],
      mod: mods[ability],
      save: mods[ability] + (saveProf.has(ability) ? prof : 0),
      save_prof: saveProf.has(ability),
      parts: scoreParts(ability),
      ...(scoreNote ? { note: scoreNote } : {}),
    })),
    combat: {
      ac,
      speed,
      swim,
      initiative: mods.DEX + effInit + plans.reduce((sum, planned) => sum + planned.init, 0),
      prof,
      passive_perception: noticeParts.reduce((sum, part) => sum + part.amount, 0),
      notice_parts: noticeParts,
      max_hp: hp,
      hp_parts: hpParts,
      speed_parts: speedParts,
      hit_die: `d${hd}`,
      hit_dice: level,
      armor: armorLabel,
      armor_offbook: armorOffbook,
      dice: side ? diceLabel(hd, mainLevel, side.cls.hit_die, side.level) : null,
    },
    skills: skillRows,
    attacks,
    spellcasting,
    casters,
    pact,
    cards,
    inventory:
      req.inventory != null
        ? req.inventory.slice()
        : (worn.kind !== "none" ? [worn.name] : []).concat(
            shield ? ["Shield"] : [],
            cls.gear.map((gear) => (main && baseW && gear === baseW.name ? main.name : gear)),
          ),
    extras: {
      notes: req.notes || "",
      portrait: req.portrait == null ? null : req.portrait,
      portrait_credit: req.portrait ? req.portrait_credit || null : null,
    },
    feat: plans[0] ? featPick(plans[0]) : null,
    feats: plans.map(featPick),
  };
  applyNumbers(character, req.numbers);
  return character;
}

const ABILITY_USE: Record<Ability, string> = {
  STR: "Lifting, pushing, and hitting hard.",
  DEX: "Dodging, sneaking, and quick hands.",
  CON: "Staying up when you are hurt, tired, or poisoned.",
  INT: "Remembering facts, solving puzzles, and studying magic.",
  WIS: "Noticing things, judging people, and keeping a clear head.",
  CHA: "Talking, performing, and getting people on your side.",
};

const SPELL_RULES: Record<string, string> = spellRuleText;

export function spellRules(name: string): string | undefined {
  return SPELL_RULES[name] || undefined;
}

export function skillTip(skill: SkillRow): { title: string; lines: [string | null, string][] } {
  const lines: [string | null, string][] = [];
  const usual = skill.parts.reduce((sum, part) => sum + part.amount, 0);
  if (skill.offbook) lines.push([null, `Off book. The usual total is ${signed(usual)}. Talk to your DM.`]);
  if (skill.use) lines.push([null, skill.use]);
  for (const part of skill.parts) {
    const from = part.from ? `, from ${part.from}` : "";
    lines.push([part.label, `${signed(part.amount)}${from}`]);
  }
  return { title: `${skill.name} ${signed(skill.bonus)}`, lines };
}

export function abilityTip(ability: Character["abilities"][number]): {
  title: string;
  lines: [string | null, string][];
} {
  const lines: [string | null, string][] = [];
  if (ability.note) lines.push([null, ability.note]);
  const use = ABILITY_USE[ability.key];
  if (use) lines.push([null, use]);
  ability.parts.forEach((part, index) => {
    const shown = index === 0 ? String(part.amount) : signed(part.amount);
    const from = part.from ? `, from ${part.from}` : "";
    lines.push([part.label, `${shown}${from}`]);
  });
  const name = ABILITY_NAME[ability.key] || ability.key;
  return { title: `${name} ${ability.score} (${signed(ability.mod)})`, lines };
}

function partLines(parts: SkillRow["parts"], plainFirst: boolean): [string | null, string][] {
  return parts.map((part, index) => {
    const shown = plainFirst && index === 0 ? String(part.amount) : signed(part.amount);
    const from = part.from ? `, from ${part.from}` : "";
    return [part.label, `${shown}${from}`];
  });
}

export function hpTip(combat: Character["combat"]): { title: string; lines: [string | null, string][] } {
  const lines: [string | null, string][] = [];
  const usual = combat.hp_parts.reduce((sum, part) => sum + part.amount, 0);
  if (combat.hp_offbook) lines.push([null, `Off book. The usual total is ${usual}. Talk to your DM.`]);
  lines.push(...partLines(combat.hp_parts, true));
  return { title: `Max HP ${combat.max_hp}`, lines };
}

export function speedTip(combat: Character["combat"]): { title: string; lines: [string | null, string][] } {
  const lines: [string | null, string][] = [];
  const usual = combat.speed_parts.reduce((sum, part) => sum + part.amount, 0);
  if (combat.speed_offbook) lines.push([null, `Off book. The usual total is ${usual}. Talk to your DM.`]);
  lines.push(...partLines(combat.speed_parts, true));
  if (combat.swim > 0) lines.push(["Swim", String(combat.swim)]);
  return { title: `Speed ${combat.speed}`, lines };
}

export function spellTip(row: {
  name?: string;
  attack: number;
  dc: number;
  dc_base: number;
  parts: SkillRow["parts"];
  attack_offbook?: boolean;
  dc_offbook?: boolean;
}): { title: string; lines: [string | null, string][] } {
  const lines: [string | null, string][] = [
    [
      null,
      "The bonus when a spell says to make a spell attack. Plenty of spells ask for a save instead, and that uses the DC.",
    ],
  ];
  const usual = row.parts.reduce((sum, part) => sum + part.amount, 0);
  if (row.attack_offbook) lines.push([null, `Off book. The usual attack is ${signed(usual)}. Talk to your DM.`]);
  lines.push(...partLines(row.parts, false));
  const usualDc = row.dc_base + usual;
  if (row.dc_offbook) lines.push([null, `Off book. The usual save DC is ${usualDc}. Talk to your DM.`]);
  lines.push(["Save DC", `${row.dc_base} + the same bonus, so ${usualDc}. The target rolls a save against this.`]);
  const who = row.name ? `${row.name} spell attack` : "Spell attack";
  return { title: `${who} ${signed(row.attack)}`, lines };
}

export function profTip(
  combat: Character["combat"],
  level: number,
  book: number,
): { title: string; lines: [string | null, string][] } {
  const lines: [string | null, string][] = [];
  if (combat.prof_offbook) lines.push([null, `Off book. The usual bonus is ${signed(book)}. Talk to your DM.`]);
  lines.push([null, "Added to the attacks, saves, and skills you are trained in."]);
  lines.push([`Level ${level}`, signed(book)]);
  return { title: `Proficiency ${signed(combat.prof)}`, lines };
}

export function noticeTip(combat: Character["combat"]): { title: string; lines: [string | null, string][] } {
  const lines: [string | null, string][] = [];
  const usual = combat.notice_parts.reduce((sum, part) => sum + part.amount, 0);
  if (combat.notice_offbook) lines.push([null, `Off book. The usual total is ${usual}. Talk to your DM.`]);
  lines.push([null, "How easily you notice something without trying."]);
  lines.push(...partLines(combat.notice_parts, true));
  return { title: `Notice ${combat.passive_perception}`, lines };
}

export function speaksTip(idn: Character["identity"]): { title: string; lines: [string | null, string][] } {
  const lines: [string | null, string][] = [[null, "The languages this hero knows."]];
  for (const note of idn.language_notes) lines.push([note.from || null, note.name]);
  return { title: "Speaks", lines };
}

function applyOffbook(book: number, next: number | undefined, write: (value: number) => void): void {
  if (typeof next === "number" && next !== book) write(next);
}

function applyNumbers(ch: Character, numbers: HeroRequest["numbers"]): void {
  if (!numbers) return;
  const skills = numbers.skills;
  if (skills) {
    for (const skill of ch.skills) {
      applyOffbook(skill.bonus, skills[skill.name], (next) => {
        skill.bonus = next;
        skill.offbook = true;
      });
    }
  }
  const perception = ch.skills.find((skill) => skill.name === "Perception");
  if (perception?.offbook && typeof numbers.notice !== "number") {
    const part = ch.combat.notice_parts.find((row) => row.label === "Perception");
    if (part) part.amount = perception.bonus;
    ch.combat.passive_perception = ch.combat.notice_parts.reduce((sum, row) => sum + row.amount, 0);
  }
  const saves = numbers.saves;
  if (saves) {
    for (const ability of ch.abilities) {
      applyOffbook(ability.save, saves[ability.key], (next) => {
        ability.save = next;
        ability.save_offbook = true;
      });
    }
  }
  const combat = ch.combat;
  applyOffbook(combat.ac, numbers.ac, (next) => {
    combat.ac = next;
    combat.ac_offbook = true;
  });
  applyOffbook(combat.max_hp, numbers.hp, (next) => {
    combat.max_hp = next;
    combat.hp_offbook = true;
  });
  applyOffbook(combat.speed, numbers.speed, (next) => {
    combat.speed = next;
    combat.speed_offbook = true;
  });
  applyOffbook(combat.swim, numbers.swim, (next) => {
    combat.swim = next;
    combat.swim_offbook = true;
  });
  applyOffbook(combat.initiative, numbers.initiative, (next) => {
    combat.initiative = next;
    combat.initiative_offbook = true;
  });
  applyOffbook(combat.prof, numbers.prof, (next) => {
    combat.prof = next;
    combat.prof_offbook = true;
  });
  applyOffbook(combat.passive_perception, numbers.notice, (next) => {
    combat.passive_perception = next;
    combat.notice_offbook = true;
  });
  const casting = ch.spellcasting;
  if (casting) {
    applyOffbook(casting.attack, numbers.spell_attack, (next) => {
      casting.attack = next;
      casting.attack_offbook = true;
    });
    applyOffbook(casting.dc, numbers.spell_dc, (next) => {
      casting.dc = next;
      casting.dc_offbook = true;
    });
  }
  for (const line of ch.casters) {
    applyOffbook(line.attack, numbers.caster_attack?.[line.name], (next) => {
      line.attack = next;
      line.attack_offbook = true;
    });
    applyOffbook(line.dc, numbers.caster_dc?.[line.name], (next) => {
      line.dc = next;
      line.dc_offbook = true;
    });
  }
  const attacks = numbers.attacks;
  if (attacks) {
    for (const attack of ch.attacks) {
      applyOffbook(attack.to_hit, attacks[attack.name], (next) => {
        attack.to_hit = next;
        attack.offbook = true;
      });
    }
  }
}

interface RaceBuilt {
  id: string;
  name: string;
  speed: number;
  swim: number;
  asi: AbilityScores;
  skills: string[];
  hp_per_level: number;
  languages: string;
  armor_prof_add: string[];
}

function stripChars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start] ?? "")) start++;
  while (end > start && chars.includes(text[end - 1] ?? "")) end--;
  return text.slice(start, end);
}

const STAR =
  '<svg viewBox="0 0 24 24"><path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill="#fff" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const BOX_LIMIT = 12;

const repeat = (text: string, n: number) => (n > 0 ? text.repeat(n) : "");

function uses(n: number | null, rest: string | null): string {
  if (n === null) return "";
  const map: Record<string, string> = {
    short: "back after a short rest",
    long: "back after a long rest",
    turn: "once per turn",
    used: "gone when used",
  };
  const restTxt = rest && rest in map ? map[rest] : rest || "";
  const boxes = n <= BOX_LIMIT ? repeat("<i></i>", n) : `<span class="wr"></span><b>/ ${n}</b>`;
  return `<div class="bx">${boxes}<small>${escapeHtml(restTxt)}</small></div>`;
}

function frontHtml(ch: Character): string {
  const idn = ch.identity;
  const combat = ch.combat;
  let portrait = ch.extras.portrait ? `<img src="${escapeHtml(ch.extras.portrait)}" alt="">` : "Draw your hero here!";
  if (ch.extras.portrait_credit) portrait += `<span class="credit">${escapeHtml(ch.extras.portrait_credit)}</span>`;
  const abil = ch.abilities
    .map(
      (ability) =>
        `<div class="ab" data-edit="ability:${ability.key}"><div class="lbl">${escapeHtml(ABILITY_NAME[ability.key] || ability.key)}</div><div class="m">${signed(ability.mod)}</div><div class="sc">${ability.score}</div><div class="sv" data-edit="save:${ability.key}"><i class="pd${ability.save_prof ? " on" : ""}"></i> save ${signed(ability.save)}${star(ability.save_offbook)}</div></div>`,
    )
    .join("");
  const skills = ch.skills
    .map(
      (skill) =>
        `<div class="sk" data-edit="skill:${escapeHtml(skill.name)}"><span><i class="pd${skill.expert ? " ex" : skill.prof ? " on" : ""}"></i> ${escapeHtml(skill.name)}</span><b${skill.offbook ? ' class="off"' : ""}>${signed(skill.bonus)}${star(skill.offbook)}</b></div>`,
    )
    .join("");
  const inv = ch.inventory.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  const pathEdit = idn.subclass ? `<span data-edit="path"> (${escapeHtml(idn.subclass)})</span>` : "";
  const classBit = `<span data-edit="class">${escapeHtml(idn.cls)}</span>${pathEdit}`;
  const off = idn.offbook ? ` • ${worn(escapeHtml(idn.offbook), true)}` : "";
  const sub = idn.second
    ? `${classBit} ${idn.main_level} • <span data-edit="dip">${escapeHtml(idn.second)}</span>${off}`
    : classBit;
  return (
    '<section class="page front">' +
    `<div class="head"><div><div class="nm disp" data-edit="name">${escapeHtml(idn.name)}</div>` +
    `<div class="sub"><span data-edit="race">${escapeHtml(idn.race)}</span> • ${sub}</div>` +
    `<div class="tag">${escapeHtml(idn.tagline)}</div></div>` +
    `<div class="lv" data-edit="level"><b>${idn.level}</b><span class="lbl">Level</span></div></div>` +
    `<div class="fr1"><div class="portrait" data-role="portrait" data-edit="portrait">${portrait}</div><div class="abil">${abil}</div></div>` +
    `<div class="box skills" data-edit="skills"><h4>Skills</h4><div class="skgrid">${skills}</div>` +
    `<div class="facts"><span data-edit="prof">Proficiency <b>${signed(combat.prof)}${star(combat.prof_offbook)}</b></span><span data-edit="notice">Notice <b>${combat.passive_perception}${star(combat.notice_offbook)}</b></span><span data-edit="languages">Speaks: ${escapeHtml(idn.languages)}</span></div></div>` +
    `<div class="inv"><div class="box col" data-role="inventory" data-edit="inventory"><h4>Inventory</h4><div class="lines">${inv}</div>` +
    '<div class="coins"><div>GOLD</div><div>SILVER</div><div>COPPER</div></div></div>' +
    `<div class="box col" data-role="notes" data-edit="notes"><h4>Notes</h4><div class="lines">${escapeHtml(ch.extras.notes)}</div></div></div>` +
    "</section>"
  );
}

function backHtml(ch: Character): string {
  const idn = ch.identity;
  const combat = ch.combat;
  const sc = ch.spellcasting;
  const pathEdit = idn.subclass ? ` <span data-edit="path">(${escapeHtml(idn.subclass)})</span>` : "";
  const armorOff = combat.armor_offbook || !!combat.ac_offbook;
  const tiles =
    `<div class="tile" data-edit="armor"><b>${combat.ac}</b><span class="lbl">Armor</span>${worn(
      `${escapeHtml(combat.armor || "")}${armorOff ? " • off book" : ""}`,
      armorOff,
    )}</div>` +
    `<div class="tile hp" data-edit="hp"><div class="mx"><b>${combat.max_hp}</b><span class="lbl">Max HP</span>${worn([combat.dice, combat.hp_offbook ? "off book" : ""].filter(Boolean).join(" • "), !!combat.hp_offbook)}</div>` +
    '<div><div class="w"></div><span class="lbl">HP now</span></div><div><div class="w"></div><span class="lbl">Temp HP</span></div></div>' +
    `<div class="tile" data-edit="speed"><b>${combat.speed}</b><span class="lbl">Speed (ft)</span>${speedWorn(combat)}</div>` +
    `<div class="tile" data-edit="initiative"><b>${signed(combat.initiative)}</b><span class="lbl">Initiative</span>${worn(combat.initiative_offbook ? "off book" : "", !!combat.initiative_offbook)}</div>`;
  const mini = `<div class="mini"><span>Death saves &nbsp;OK ${repeat('<i class="dot"></i>', 3)} &nbsp;Uh-oh ${repeat('<i class="dot"></i>', 3)}</span></div>`;
  let atk = ch.attacks
    .map(
      (attack) =>
        `<tr data-edit="${escapeHtml(attack.edit || "class")}">` +
        `<td class="n">${escapeHtml(attack.name)}</td><td>${signed(attack.to_hit)}${star(attack.offbook)}</td>` +
        `<td>${escapeHtml(attack.damage)}</td><td>${escapeHtml(attack.note)}</td></tr>`,
    )
    .join("");
  atk = `<div class="box"><table class="atk"><tr><th>Attack</th><th>To hit</th><th>Damage</th><th>Range</th></tr>${atk}</table></div>`;
  let magic = "";
  if (ch.casters.length) {
    const lines = ch.casters
      .map(
        (line, index) =>
          `<span class="big" data-cast="${index}">${escapeHtml(line.name)} spell ${signed(line.attack)}${star(line.attack_offbook)} • DC ${line.dc}${star(line.dc_offbook)}</span>`,
      )
      .join("");
    const rows = (sc?.slots ?? [])
      .map((slot) => `<span>Level ${slot.level} ${repeat(`<i>${STAR}</i>`, slot.count)}</span>`)
      .join("");
    const pactRows = (ch.pact?.slots ?? [])
      .map((slot) => `<span>Pact ${slot.level} ${repeat(`<i>${STAR}</i>`, slot.count)}</span>`)
      .join("");
    const notes = [
      sc?.slots.length ? "<small>color a star per spell • back after a long rest</small>" : "",
      ch.pact?.slots.length ? "<small>pact slots • back after a short rest</small>" : "",
    ].join("");
    magic = `<div class="magic" data-edit="spells">${lines}${rows}${pactRows}${notes}</div>`;
  } else if (sc) {
    const rows = sc.slots
      .map((slot) => `<span>Level ${slot.level} ${repeat(`<i>${STAR}</i>`, slot.count)}</span>`)
      .join("");
    const rest = sc.rest === "short" ? "short" : "long";
    magic =
      `<div class="magic" data-edit="spells"><span class="big" data-cast="spell">Spell attack ${signed(sc.attack)}${star(sc.attack_offbook)} • DC ${sc.dc}${star(sc.dc_offbook)}</span>${rows}` +
      (sc.slots.length ? `<small>color a star per spell • back after a ${rest} rest</small>` : "") +
      "</div>";
  }
  const secs = new Map<string, SheetCard[]>();
  for (const entry of ch.cards) {
    const list = secs.get(entry.section) ?? [];
    list.push(entry);
    secs.set(entry.section, list);
  }
  let body = "";
  for (const [name, items] of secs) {
    let html = "";
    for (const entry of items) {
      const chip = tagChip(entry.tag);
      const note = entry.note ? `<span class="chip note">${escapeHtml(entry.note)}</span>` : "";
      const conc = entry.conc ? '<span class="chip conc">Concentration</span>' : "";
      const edit = entry.edit ? ` data-edit="${escapeHtml(entry.edit)}"` : "";
      html +=
        `<div class="cd" data-card="${escapeHtml(entry.name)}" data-i="${ch.cards.indexOf(entry)}"${edit}>` +
        `<span class="n">${escapeHtml(entry.name)}</span>${chip}${note}${conc}` +
        `<div class="d">${escapeHtml(entry.desc)}</div>${uses(entry.uses, entry.rest)}</div>`;
    }
    body += `<div class="sec"><h3>${escapeHtml(name)}</h3>${html}</div>`;
  }
  const legend = tagLegend();
  const headClass = idn.second
    ? `<span data-edit="class">${escapeHtml(idn.cls)}</span>${pathEdit} ${idn.main_level} • <span data-edit="dip">${escapeHtml(idn.second)}</span>`
    : `<span data-edit="class">${escapeHtml(idn.cls)}</span>${pathEdit} • <span data-edit="level">Level ${idn.level}</span>`;
  const combatBlock = `<div class="combat">${tiles}</div>${mini}<div class="cmb2">${atk}${magic}</div>`;
  return (
    '<section class="page back">' +
    `<div class="bhead"><div class="nm disp" data-edit="name">${escapeHtml(idn.name)}</div><div class="disp" style="font-size:15px">` +
    `${headClass}</div></div>` +
    combatBlock +
    `<div class="cards">${body}</div>` +
    `<div class="foot">${legend}<span><b>Action</b> = your main thing. <b>Bonus</b> = a quick extra thing. <b>Reaction</b> = once a round, even on someone else's turn.</span></div>` +
    "</section>"
  );
}

/** Saved-list and level-popup line. One class stays `Lv N Class`. */
export function classLine(idn: Character["identity"]): string {
  const path = idn.subclass ? ` (${idn.subclass})` : "";
  if (!idn.second) return `Lv ${idn.level} ${idn.cls}${path}`;
  return `${idn.cls}${path} ${idn.main_level} • ${idn.second}`;
}

export function sheetHtml(ch: Character): string {
  const accent = ch.identity.accent || "#444444";
  return `<div class="sheet" style="--ac:${escapeHtml(accent)};--tint:${accentTint(accent)}">${frontHtml(ch)}${backHtml(ch)}</div>`;
}

function star(off?: boolean): string {
  return off ? "*" : "";
}

function worn(text: string, off = false): string {
  if (!text) return "";
  return `<span class="worn${off ? " off" : ""}">${text}</span>`;
}

function speedWorn(combat: Character["combat"]): string {
  const off = !!(combat.speed_offbook || combat.swim_offbook);
  const swim = combat.swim > 0 ? `swim ${combat.swim}` : "";
  if (!off) return worn(swim);
  return worn([swim, "off book"].filter(Boolean).join(" • "), true);
}

function cleared(req: HeroRequest, over: Partial<HeroRequest> = {}): HeroRequest {
  return {
    ...req,
    items: null,
    choices: [],
    cantrips: null,
    spells: null,
    path_spells: null,
    armor: null,
    shield: null,
    numbers: null,
    ...over,
  };
}

export function options(tables: Tables, req: HeroRequest): HeroOptions {
  let cached: Character | null = null;
  const defaults = (): Character => {
    if (cached) return cached;
    cached = buildCharacter(tables, cleared(req));
    return cached;
  };
  const rules = one(table(tables, "rules"), "rules", () => true);
  const level = Number(req.level);
  const li = level - 1;
  const race = one(table(tables, "races"), "race", (row) => row.id === req.race);
  const subraces = table(tables, "subraces").filter((row) => row.race_id === race.id);
  const sr = (req.subrace && subraces.find((row) => row.id === req.subrace)) || subraces[0] || null;
  const cls: ClassRow = one(table(tables, "classes"), "class", (row) => row.id === req.cls);
  const subs = table(tables, "subclasses").filter((row) => row.class_id === cls.id);
  const sub = req.subclass ? (subs.find((row) => row.id === req.subclass) ?? subs[0] ?? null) : (subs[0] ?? null);
  const side = resolveSide(table(tables, "classes"), table(tables, "subclasses"), req, level);
  const mainLevel = side ? level - side.level : level;
  const mainLi = mainLevel - 1;
  const subActive = sub !== null && mainLevel >= cls.subclass_level;
  const owners: [string, string][] = [
    ["race", race.id],
    ["class", cls.id],
  ];
  if (subActive && sub) owners.push(["subclass", sub.id]);
  const groups = table(tables, "choices")
    .filter(
      (choice) =>
        owners.some(([kind, id]) => kind === choice.owner_kind && id === choice.owner_id) &&
        (choice.count[mainLi] ?? 0) > 0,
    )
    .map((choice) => ({
      group: choice.group,
      label: choice.label,
      count: choice.count[mainLi] ?? 0,
      options: choice.options,
    }));
  const caster = cls.caster;
  const out: HeroOptions = {
    subs,
    sub,
    subActive,
    subclassLevel: cls.subclass_level,
    groups,
    caster: caster.kind !== "none",
    nCan: 0,
    nSp: 0,
    maxSpell: 0,
    auto: [],
    bonusCantrips: [],
    cantripPool: [],
    spellPool: [],
    armorDefault: "",
    armorOptions: [],
    shieldProf: false,
    weaponOptions: [],
    weaponDefault: null,
    defaultBase: scores(10),
    raceAsi: scores(0),
    subraces,
    subrace: sr ? sr.id : null,
    pointBuy: rules.point_buy,
    itemSlots: rules.item_slots[li] ?? 0,
    itemPool: [],
    itemWarn: () => "",
    itemRarity: () => "",
    itemCard: () => null,
    defaultItems: [],
    bookAuto: [],
    anyPool: [],
    spellLevel: () => 0,
    spellCard: () => null,
    defaults: { cantrips: [], spells: [] },
  };
  out.armorDefault = defaults().combat.armor;
  const peeked = defaults().feats;
  out.shieldProf = cls.shield_prof || peeked.some((feat) => feat.shield) || !!side?.cls.shield_prof;
  const armorProfs = new Set([
    ...cls.armor_prof,
    ...(subActive && sub ? sub.armor_prof_add : []),
    ...(sr ? sr.armor_prof_add : []),
    ...peeked.flatMap((feat) => feat.armor),
    ...(side ? grantArmor(side.cls, false) : []),
    ...(side?.path ? side.path.armor_prof_add : []),
  ]);
  const names = ["No armor"].concat(table(tables, "armor").map((armor) => armor.name));
  const kinds = new Map(table(tables, "armor").map((armor) => [armor.name, armor.kind]));
  for (const name of names) {
    try {
      const built = buildCharacter(tables, cleared(req, { armor: name, shield: false }));
      const row = table(tables, "armor").find((armor) => armor.name === name);
      const kind = kinds.get(name) ?? "none";
      const option: ArmorOption = {
        name,
        kind,
        ac: built.combat.ac,
        strReq: row ? row.str_req : 0,
        trained: kind === "none" || armorProfs.has(kind),
      };
      out.armorOptions.push(option);
    } catch (e) {
      if (!(e instanceof CharError)) throw e;
    }
  }
  if (cls.melee_slot >= 0 && cls.melee_slot < cls.weapons.length) {
    const weaponProf = weaponTraining(cls, side?.cls ?? null);
    for (const feat of defaults().feats) for (const name of feat.weapons) weaponProf.add(name);
    const quick: Partial<HeroRequest> = { items: null, choices: [], cantrips: null, spells: null, path_spells: null };
    try {
      out.weaponDefault =
        buildCharacter(tables, { ...req, ...quick, weapon: null, extra_weapons: null }).attacks[cls.melee_slot]?.name ??
        null;
    } catch (e) {
      if (!(e instanceof CharError)) throw e;
    }
    for (const weapon of table(tables, "weapons")) {
      if (!(weaponProf.has(weapon.cat) || weaponProf.has(weapon.name))) continue;
      try {
        const built = buildCharacter(tables, {
          ...req,
          ...quick,
          weapon: weapon.name,
          extra_weapons: null,
          shield: weapon.hands === "two" ? false : req.shield,
        });
        const option: WeaponOption = {
          name: weapon.name,
          hands: weapon.hands,
          cat: weapon.cat,
          damage: built.attacks[cls.melee_slot]?.damage ?? "",
          note: weapon.note,
        };
        out.weaponOptions.push(option);
      } catch (e) {
        if (!(e instanceof CharError)) throw e;
      }
    }
  }
  cls.primary.forEach((ability, i) => {
    const n = rules.standard_array[i];
    if (n !== undefined) out.defaultBase[ability] = n;
  });
  for (const ability of ABILITIES) out.raceAsi[ability] = (race.asi[ability] || 0) + (sr ? sr.asi[ability] || 0 : 0);
  const itemRows = table(tables, "items");
  const itemBy = new Map(itemRows.map((row) => [row.name, row]));
  out.itemPool = itemRows
    .slice()
    .sort((a, b) => b.tier - a.tier || (a.name < b.name ? -1 : 1))
    .map((row) => row.name);
  const className = (id: string) => table(tables, "classes").find((row) => row.id === id)?.name ?? id;
  out.itemWarn = (name) => {
    const row = itemBy.get(name);
    if (!row) return "";
    const why: string[] = [];
    if (row.min_level > level) {
      const article = /^[aeiou]/i.test(row.rarity) ? "an" : "a";
      why.push(`it's ${article} ${row.rarity} item, usually for heroes level ${row.min_level} and up`);
    }
    if (row.use_by.length && !row.use_by.includes(cls.id))
      why.push(`usually only ${row.use_by.map(className).join(", ")} can use it`);
    return why.length ? `By the usual rules ${why.join(", and ")}` : "";
  };
  out.itemRarity = (name) => itemBy.get(name)?.rarity ?? "";
  out.itemCard = (name) => itemBy.get(name)?.card ?? null;
  let builtItems: Character;
  try {
    builtItems = buildCharacter(tables, { ...req, items: null });
  } catch (e) {
    if (!(e instanceof CharError)) throw e;
    builtItems = buildCharacter(tables, cleared(req));
  }
  out.defaultItems = builtItems.cards
    .filter((entry) => entry.section === "Potions & Magic Items")
    .map((entry) => entry.name);
  if (caster.kind === "none") return out;
  const slotRow = table(tables, "slots").find((row) => row.kind === caster.kind && row.level === mainLevel);
  const maxSpell = maxSpellOf(slotRow?.slots ?? []);
  const spellRows = table(tables, "spells");
  const byName = new Map(spellRows.map((row) => [row.name, row]));
  const hero = buildCharacter(tables, cleared(req));
  const mod = hero.abilities.find((ability) => ability.key === caster.ability);
  const cmod = mod ? mod.mod : 0;
  out.maxSpell = maxSpell;
  out.nCan = caster.cantrips[mainLi] ?? 0;
  out.nSp = spellsKnown(caster, mainLevel, cmod, maxSpell) ?? 0;
  out.bookAuto = (subActive && sub ? sub.auto_spells : [])
    .filter((entry) => {
      const row = byName.get(entry.spell);
      return entry.lvl <= mainLevel && row !== undefined && row.lvl > 0 && row.lvl <= maxSpell;
    })
    .map((entry) => entry.spell);
  out.auto =
    req.path_spells != null
      ? req.path_spells.filter((name) => {
          const row = byName.get(name);
          return row !== undefined && row.lvl >= 1 && row.lvl <= maxSpell;
        })
      : out.bookAuto;
  out.anyPool = spellRows
    .filter((row) => row.lvl >= 1 && row.lvl <= maxSpell)
    .map((row) => row.name)
    .sort();
  out.bonusCantrips = subActive && sub ? sub.extra_cantrips.slice() : [];
  const ordered = (order: string[], ok: (lvl: number) => boolean) => {
    const first = order.filter((name) => {
      const row = byName.get(name);
      return row !== undefined && ok(row.lvl);
    });
    const rest = spellRows
      .filter((row) => row.classes.includes(cls.id) && ok(row.lvl) && !first.includes(row.name))
      .map((row) => row.name)
      .sort();
    return first.concat(rest);
  };
  out.cantripPool = ordered(cls.cantrip_order, (lvl) => lvl === 0);
  out.spellPool = ordered(cls.spell_order, (lvl) => lvl >= 1 && lvl <= maxSpell).filter(
    (name) => !out.auto.includes(name),
  );
  out.spellLevel = (name) => byName.get(name)?.lvl ?? 0;
  out.spellCard = (name) => byName.get(name)?.card ?? null;
  out.defaults = {
    cantrips: hero.cards
      .filter((entry) => entry.section === "Free Magic" && entry.note !== "extra" && !entry.edit?.startsWith("dip-"))
      .map((entry) => entry.name),
    spells: hero.cards
      .filter(
        (entry) =>
          /^Level \d+ Spells$/.test(entry.section) &&
          !entry.edit?.startsWith("dip-") &&
          !out.bookAuto.includes(entry.name),
      )
      .map((entry) => entry.name),
  };
  return out;
}
