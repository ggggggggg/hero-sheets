import { ABILITY_NAME, accentTint, tagChip, tagLegend } from "./tags";
import { CharError, escapeHtml, expand, signed } from "./text";
import {
  ABILITIES,
  type Ability,
  type AbilityScores,
  type ArmorOption,
  type AttackRow,
  type Character,
  type ChoiceOption,
  type ClassRow,
  type ClassWeapon,
  type HeroOptions,
  type HeroRequest,
  type Item,
  type SheetCard,
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

function isAbility(value: string): value is Ability {
  return ABILITIES.some((ability) => ability === value);
}

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

function avgDie(die: string): number {
  const match = /^(\d+)d(\d+)$/.exec(die);
  if (!match || match[1] === undefined || match[2] === undefined) return 0;
  return (Number(match[1]) * (Number(match[2]) + 1)) / 2;
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

export function buildCharacter(tables: Tables, req: HeroRequest): Character {
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
  const path = sub !== null && level >= cls.subclass_level ? sub : null;
  const prof = rules.prof_by_level[li];
  if (prof === undefined) throw valueError(`level must be 1..${rules.max_level}`);

  const abilityScores = scores(10);
  if (req.base_scores != null) {
    for (const ability of ABILITIES) {
      const n = req.base_scores[ability];
      if (!(n >= 1 && n <= 20)) throw valueError(`${ability} must be 1 to 20`);
      abilityScores[ability] = n;
    }
  } else {
    cls.primary.forEach((ability, i) => {
      const n = rules.standard_array[i];
      if (n !== undefined) abilityScores[ability] = n;
    });
  }
  let rasi = race.asi;
  if (req.race_asi != null) {
    rasi = req.race_asi;
    for (const ability of ABILITIES) {
      const n = rasi[ability];
      if (!(n >= 0 && n <= 3)) throw valueError(`race bonus for ${ability} must be 0 to 3`);
    }
  }
  for (const ability of ABILITIES) abilityScores[ability] = abilityScores[ability] + (rasi[ability] || 0);
  for (const asiLevel of cls.asi_levels) {
    if (asiLevel <= level) {
      let left = rules.asi.amount;
      for (const ability of cls.primary) {
        const add = Math.max(Math.min(left, rules.asi.cap - abilityScores[ability]), 0);
        abilityScores[ability] += add;
        left -= add;
        if (left <= 0) break;
      }
    }
  }
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
  const picked: [string, string, ChoiceOption][] = [];
  for (const choice of choiceRows) {
    const n = choice.count[li];
    if (n === undefined || n <= 0) continue;
    const names = choice.options.map((option) => option.name);
    let want = asked.get(choice.group);
    if (want === undefined) want = names.slice(0, n);
    if (want.length !== n || new Set(want).size !== n || want.some((name) => !names.includes(name))) {
      throw valueError(`choice ${choice.group} needs ${n} distinct picks`);
    }
    for (const name of want) {
      const option = choice.options[names.indexOf(name)];
      if (!option) throw valueError(`choice ${choice.group} needs ${n} distinct picks`);
      picked.push([choice.owner_kind, choice.owner_id, option]);
    }
  }
  const effAc = picked.reduce((sum, [, , option]) => sum + option.effect.ac, 0);
  const effRhit = picked.reduce((sum, [, , option]) => sum + option.effect.ranged_hit, 0);
  const effDmg = picked.reduce((sum, [, , option]) => sum + option.effect.onehand_dmg, 0);
  const effInit = picked.reduce((sum, [, , option]) => sum + option.effect.init, 0);

  const caster = cls.caster;
  const slotRow = one(table(tables, "slots"), "slot row", (row) => row.kind === caster.kind && row.level === level);
  const slots = slotRow.slots;
  let maxSpell = 0;
  slots.forEach((n, i) => {
    if (n > 0) maxSpell = Math.max(maxSpell, i + 1);
  });
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
    const value = row.values[li];
    if (value === undefined) throw valueError(`scaling ${row.key} has no value at level ${level}`);
    v[row.key] = value;
  }
  for (const [, , option] of picked) for (const kv of option.effect.vars) v[kv.key] = kv.value;

  const ua = path?.armor ?? cls.armor;
  const profs = new Set([...cls.armor_prof, ...(path ? path.armor_prof_add : []), ...race.armor_prof_add]);
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
        ac: armor.base + Math.min(mods.DEX, armor.dex_cap),
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
  const weaponProf = new Set(cls.weapon_prof);
  const weaponOptions = table(tables, "weapons").filter(
    (weapon) => weaponProf.has(weapon.cat) || weaponProf.has(weapon.name),
  );
  const slot = cls.melee_slot;
  const baseW = slot >= 0 && slot < cls.weapons.length ? cls.weapons[slot] : null;
  let main: ClassWeapon | null = null;
  if (req.weapon != null) {
    const found = weaponOptions.find((weapon) => weapon.name === req.weapon);
    if (!found || !baseW) throw valueError(`can't use ${req.weapon}`);
    main = {
      name: found.name,
      die: found.die,
      ability: found.ability,
      kind: "melee",
      hands: found.hands,
      note: found.note,
    };
  }
  const shield = req.shield != null ? !!req.shield : cls.shield_default && !(main && main.hands === "two");
  if (shield && !cls.shield_prof) throw valueError(`${cls.name} can't use a shield`);
  if (shield && main && main.hands === "two") throw valueError("a two-handed weapon and a shield don't fit together");
  if (!main && baseW && !shield && baseW.ability === "STR" && baseW.hands === "one") {
    let best: (typeof weaponOptions)[number] | null = null;
    for (const weapon of weaponOptions) {
      if (weapon.hands === "two" && weapon.ability === "STR" && (!best || avgDie(weapon.die) > avgDie(best.die)))
        best = weapon;
    }
    if (best && avgDie(best.die) > avgDie(baseW.die) + effDmg) {
      main = {
        name: best.name,
        die: best.die,
        ability: best.ability,
        kind: "melee",
        hands: best.hands,
        note: best.note,
      };
    }
  }
  const weapons = cls.weapons.slice();
  if (main) weapons[slot] = main;
  const ac = worn.ac + (shield ? 2 : 0) + (worn.kind !== "none" ? effAc : 0);
  v.AC1 = ac + 1;
  v.AC16 = Math.max(ac, 16);
  const armorLabel = (worn.kind !== "none" ? worn.name : "No armor") + (shield ? " + shield" : "");
  const armorOffbook = worn.kind !== "none" && !profs.has(worn.kind);
  const hd = cls.hit_die;
  let hp = hd + mods.CON + (level - 1) * (Math.floor(hd / 2) + 1 + mods.CON);
  hp += race.hp_per_level * level + (path ? path.hp_per_level * level : 0);
  const speedBonus = cls.speed_bonus[li];
  if (speedBonus === undefined) throw valueError(`level must be 1..${rules.max_level}`);
  const slowed = abilityScores.STR < worn.str_req ? 10 : 0;
  const speed = race.speed + speedBonus - slowed;
  const swim = race.swim > 0 ? Math.max(0, race.swim - slowed) : 0;

  const profSk = new Set([...cls.skills, ...race.skills, ...(path ? path.extra_skills : [])]);
  const expert = new Set<string>();
  for (const entry of cls.expertise) if (entry.lvl <= level) for (const skill of entry.skills) expert.add(skill);
  const skillRows = table(tables, "skills").map((skill) => {
    const trained = profSk.has(skill.name);
    const isExpert = expert.has(skill.name);
    return {
      name: skill.name,
      ability: skill.ability,
      bonus: modOf(mods, skill.ability) + prof * (isExpert ? 2 : trained ? 1 : 0),
      prof: trained,
      expert: isExpert,
    };
  });
  const perception = skillRows.find((skill) => skill.name === "Perception");
  const notice = perception ? perception.bonus : mods.WIS;

  const attacks: AttackRow[] = weapons.map((weapon) => {
    if (!weapon) throw valueError("missing weapon");
    let toHit: number;
    let damage: string;
    if (weapon.ability === "SPELL") {
      toHit = prof + cmod;
      damage = expand(weapon.die, v);
    } else {
      const bonusMod = weapon.ability === "FIN" ? Math.max(mods.STR, mods.DEX) : modOf(mods, weapon.ability);
      toHit = prof + bonusMod + (weapon.kind === "ranged" ? effRhit : 0);
      const bonus = bonusMod + (weapon.kind === "melee" && weapon.hands === "one" ? effDmg : 0);
      damage = expand(weapon.die, v) + (bonus ? signed(bonus) : "");
    }
    return {
      name: weapon.name,
      to_hit: toHit,
      damage,
      note: expand(weapon.note, v) || (weapon.kind === "melee" ? "melee" : ""),
    };
  });

  const cards: SheetCard[] = [];
  const card = (section: string, source: CardSource, uses?: string, rest?: string) => {
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
    });
  };
  const features = table(tables, "features");
  const sections: [string, string, string][] = [["class", cls.id, `${cls.name} Powers`]];
  if (path) sections.push(["subclass", path.id, path.name]);
  sections.push(["race", race.id, `${race0.name} Stuff`]);
  if (sr) sections.push(["subrace", sr.id, `${race0.name} Stuff`]);
  for (const [kind, id, section] of sections) {
    for (const feature of features) {
      if (feature.owner_kind === kind && feature.owner_id === id && feature.lvl <= level) {
        card(section, feature.card, feature.tracker.uses, feature.tracker.rest);
      }
    }
    for (const [ownerKind, ownerId, option] of picked) {
      if (ownerKind === kind && ownerId === id)
        card(section, { name: option.name, tag: option.tag, note: "", desc: option.desc });
    }
  }

  let spellcasting: Character["spellcasting"] = null;
  const spells = table(tables, "spells");
  if (isCaster) {
    const spell = (name: string) => one(spells, `spell ${name}`, (row) => row.name === name);
    const exists = (name: string) => spells.some((row) => row.name === name);
    const nCan = caster.cantrips[li];
    if (nCan === undefined) throw valueError(`level must be 1..${rules.max_level}`);
    const cantrips = req.cantrips != null ? req.cantrips : cls.cantrip_order.filter(exists).slice(0, nCan);
    if (cantrips.length > nCan) throw valueError("too many cantrips");
    const bonusCan = (path ? path.extra_cantrips : []).filter((name) => !cantrips.includes(name));
    if (cantrips.concat(bonusCan).includes("Shillelagh")) {
      attacks.unshift({
        name: "Club (Shillelagh)",
        to_hit: prof + cmod,
        damage: `1d8${cmod ? signed(cmod) : ""}`,
        note: "melee",
      });
    }
    let auto: string[];
    if (req.path_spells != null) {
      auto = [...new Set(req.path_spells)];
      for (const name of auto) {
        const lvl = spell(name).lvl;
        if (!(lvl >= 1 && lvl <= maxSpell)) throw valueError(`${name} is too high a level`);
      }
    } else {
      auto = (path ? path.auto_spells : [])
        .filter((entry) => entry.lvl <= level)
        .map((entry) => entry.spell)
        .filter((name) => {
          const lvl = spell(name).lvl;
          return lvl > 0 && lvl <= Math.max(maxSpell, 0);
        });
    }
    let nSp: number;
    if (maxSpell === 0) nSp = 0;
    else if (caster.mode === "known") {
      const known = caster.known[li];
      if (known === undefined) throw valueError(`level must be 1..${rules.max_level}`);
      nSp = known;
    } else nSp = Math.min(Math.max(1, cmod + Math.floor(level * caster.level_mult)), caster.cap);
    let picks: string[];
    if (req.spells != null) {
      picks = req.spells.slice();
      if (picks.length > nSp) throw valueError("too many spells");
      for (const name of picks) {
        const row = spell(name);
        if (!(row.lvl >= 1 && row.lvl <= maxSpell)) throw valueError(`${name} is too high a level`);
      }
    } else {
      picks = cls.spell_order
        .filter((name) => !auto.includes(name) && exists(name) && spell(name).lvl >= 1 && spell(name).lvl <= maxSpell)
        .slice(0, nSp);
    }
    const scaled = (row: (typeof spells)[number]) => {
      const scale = row.scale;
      const steps = caster.kind === "pact" && row.lvl > 0 ? Math.max(0, maxSpell - row.lvl) : 0;
      v.S = scale == null ? "" : String(scale.base + scale.per * steps) + scale.unit;
      return steps;
    };
    for (const name of cantrips) {
      scaled(spell(name));
      card("Free Magic", spell(name).card);
    }
    for (const name of bonusCan) {
      scaled(spell(name));
      card("Free Magic", { ...spell(name).card, note: "extra" });
    }
    for (let lvl = 1; lvl <= maxSpell; lvl++) {
      for (const name of picks.concat(auto)) {
        const row = spell(name);
        if (row.lvl === lvl) {
          const source: CardSource = { ...row.card };
          if (scaled(row) && row.scale != null)
            source.note = stripChars(`${source.note} • cast at lvl ${maxSpell}`, " •");
          if (auto.includes(name)) source.note = stripChars(`${source.note} • extra`, " •");
          card(`Level ${lvl} Spells`, source);
        }
      }
    }
    if (cantrips.length || slots.length) {
      spellcasting = {
        ability: caster.ability,
        attack: prof + cmod,
        dc: dcb + prof + cmod,
        slots: slots.map((count, i) => ({ level: i + 1, count })).filter((slot) => slot.count > 0),
        rest: slotRow.rest,
      };
    }
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
    card("Potions & Magic Items", row.card, String(row.uses), row.rest);
  }

  const character: Character = {
    identity: {
      name: req.name,
      race: race.name,
      cls: cls.name,
      subclass: path ? path.name : null,
      level,
      accent: cls.look.accent,
      tagline: cls.look.tagline,
      languages: race.languages,
    },
    abilities: ABILITIES.map((ability) => ({
      key: ability,
      score: abilityScores[ability],
      mod: mods[ability],
      save: mods[ability] + (cls.saves.includes(ability) ? prof : 0),
      save_prof: cls.saves.includes(ability),
    })),
    combat: {
      ac,
      speed,
      swim,
      initiative: mods.DEX + effInit,
      prof,
      passive_perception: 10 + notice,
      max_hp: hp,
      hit_die: `d${hd}`,
      hit_dice: level,
      armor: armorLabel,
      armor_offbook: armorOffbook,
    },
    skills: skillRows,
    attacks,
    spellcasting,
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
  };
  applyNumbers(character, req.numbers);
  return character;
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
  if (perception?.offbook && typeof numbers.notice !== "number") ch.combat.passive_perception = 10 + perception.bonus;
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
  const sub = idn.subclass ? ` (${escapeHtml(idn.subclass)})` : "";
  let portrait = ch.extras.portrait ? `<img src="${escapeHtml(ch.extras.portrait)}" alt="">` : "Draw your hero here!";
  if (ch.extras.portrait_credit) portrait += `<span class="credit">${escapeHtml(ch.extras.portrait_credit)}</span>`;
  const abil = ch.abilities
    .map(
      (ability) =>
        `<div class="ab"><div class="lbl">${escapeHtml(ABILITY_NAME[ability.key] || ability.key)}</div><div class="m">${signed(ability.mod)}</div><div class="sc">${ability.score}</div><div class="sv"><i class="pd${ability.save_prof ? " on" : ""}"></i> save ${signed(ability.save)}${star(ability.save_offbook)}</div></div>`,
    )
    .join("");
  const skills = ch.skills
    .map(
      (skill) =>
        `<div class="sk"><span><i class="pd${skill.expert ? " ex" : skill.prof ? " on" : ""}"></i> ${escapeHtml(skill.name)}</span><b${skill.offbook ? ' class="off"' : ""}>${signed(skill.bonus)}${star(skill.offbook)}</b></div>`,
    )
    .join("");
  const inv = ch.inventory.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  return (
    '<section class="page front">' +
    `<div class="head"><div><div class="nm disp">${escapeHtml(idn.name)}</div>` +
    `<div class="sub">${escapeHtml(idn.race)} • ${escapeHtml(idn.cls)}${sub}</div>` +
    `<div class="tag">${escapeHtml(idn.tagline)}</div></div>` +
    `<div class="lv"><b>${idn.level}</b><span class="lbl">Level</span></div></div>` +
    `<div class="fr1"><div class="portrait" data-role="portrait">${portrait}</div><div class="abil">${abil}</div></div>` +
    `<div class="box skills"><h4>Skills</h4><div class="skgrid">${skills}</div>` +
    `<div class="facts"><span>Proficiency <b>${signed(combat.prof)}${star(combat.prof_offbook)}</b></span><span>Notice <b>${combat.passive_perception}${star(combat.notice_offbook)}</b></span><span>Speaks: ${escapeHtml(idn.languages)}</span><span class="player">Player</span></div></div>` +
    `<div class="inv"><div class="box col" data-role="inventory"><h4>Inventory</h4><div class="lines">${inv}</div>` +
    '<div class="coins"><div>GOLD</div><div>SILVER</div><div>COPPER</div></div></div>' +
    `<div class="box col" data-role="notes"><h4>Notes</h4><div class="lines">${escapeHtml(ch.extras.notes)}</div></div></div>` +
    "</section>"
  );
}

function backHtml(ch: Character): string {
  const idn = ch.identity;
  const combat = ch.combat;
  const sc = ch.spellcasting;
  const sub = idn.subclass ? ` (${escapeHtml(idn.subclass)})` : "";
  const armorOff = combat.armor_offbook || !!combat.ac_offbook;
  const tiles =
    `<div class="tile"><b>${combat.ac}</b><span class="lbl">Armor</span>${worn(
      `${escapeHtml(combat.armor || "")}${armorOff ? " • off book" : ""}`,
      armorOff,
    )}</div>` +
    `<div class="tile hp"><div class="mx"><b>${combat.max_hp}</b><span class="lbl">Max HP</span>${worn(combat.hp_offbook ? "off book" : "", !!combat.hp_offbook)}</div>` +
    '<div><div class="w"></div><span class="lbl">HP now</span></div><div><div class="w"></div><span class="lbl">Temp HP</span></div></div>' +
    `<div class="tile"><b>${combat.speed}</b><span class="lbl">Speed (ft)</span>${speedWorn(combat)}</div>` +
    `<div class="tile"><b>${signed(combat.initiative)}</b><span class="lbl">Initiative</span>${worn(combat.initiative_offbook ? "off book" : "", !!combat.initiative_offbook)}</div>`;
  const mini = `<div class="mini"><span>Death saves &nbsp;OK ${repeat('<i class="dot"></i>', 3)} &nbsp;Uh-oh ${repeat('<i class="dot"></i>', 3)}</span></div>`;
  let atk = ch.attacks
    .map(
      (attack) =>
        `<tr><td class="n">${escapeHtml(attack.name)}</td><td>${signed(attack.to_hit)}${star(attack.offbook)}</td><td>${escapeHtml(attack.damage)}</td><td>${escapeHtml(attack.note)}</td></tr>`,
    )
    .join("");
  atk = `<div class="box"><table class="atk"><tr><th>Attack</th><th>To hit</th><th>Damage</th><th>Range</th></tr>${atk}</table></div>`;
  let magic = "";
  if (sc) {
    const rows = sc.slots
      .map((slot) => `<span>Level ${slot.level} ${repeat(`<i>${STAR}</i>`, slot.count)}</span>`)
      .join("");
    const rest = sc.rest === "short" ? "short" : "long";
    magic =
      `<div class="magic"><span class="big">Spell attack ${signed(sc.attack)}${star(sc.attack_offbook)} • DC ${sc.dc}${star(sc.dc_offbook)}</span>${rows}` +
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
      html += `<div class="cd" data-card="${escapeHtml(entry.name)}"><span class="n">${escapeHtml(entry.name)}</span>${chip}${note}${conc}<div class="d">${escapeHtml(entry.desc)}</div>${uses(entry.uses, entry.rest)}</div>`;
    }
    body += `<div class="sec"><h3>${escapeHtml(name)}</h3>${html}</div>`;
  }
  const legend = tagLegend();
  return (
    '<section class="page back">' +
    `<div class="bhead"><div class="nm disp">${escapeHtml(idn.name)}</div><div class="disp" style="font-size:15px">` +
    `${escapeHtml(idn.cls)}${sub} • Level ${idn.level}</div></div>` +
    `<div class="combat">${tiles}</div>${mini}` +
    `<div class="cmb2">${atk}${magic}</div>` +
    `<div class="cards">${body}</div>` +
    `<div class="foot">${legend}<span><b>Action</b> = your main thing. <b>Bonus</b> = a quick extra thing. <b>Reaction</b> = once a round, even on someone else's turn.</span></div>` +
    "</section>"
  );
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
  const subActive = sub !== null && level >= cls.subclass_level;
  const owners: [string, string][] = [
    ["race", race.id],
    ["class", cls.id],
  ];
  if (subActive && sub) owners.push(["subclass", sub.id]);
  const groups = table(tables, "choices")
    .filter(
      (choice) =>
        owners.some(([kind, id]) => kind === choice.owner_kind && id === choice.owner_id) &&
        (choice.count[li] ?? 0) > 0,
    )
    .map((choice) => ({
      group: choice.group,
      label: choice.label,
      count: choice.count[li] ?? 0,
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
    shieldProf: cls.shield_prof,
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
  const armorProfs = new Set([
    ...cls.armor_prof,
    ...(subActive && sub ? sub.armor_prof_add : []),
    ...(sr ? sr.armor_prof_add : []),
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
    const weaponProf = new Set(cls.weapon_prof);
    const quick: Partial<HeroRequest> = { items: null, choices: [], cantrips: null, spells: null, path_spells: null };
    try {
      out.weaponDefault =
        buildCharacter(tables, { ...req, ...quick, weapon: null }).attacks[cls.melee_slot]?.name ?? null;
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
  const slotRow = table(tables, "slots").find((row) => row.kind === caster.kind && row.level === level);
  let maxSpell = 0;
  for (const [i, n] of (slotRow?.slots ?? []).entries()) if (n > 0) maxSpell = Math.max(maxSpell, i + 1);
  const spellRows = table(tables, "spells");
  const byName = new Map(spellRows.map((row) => [row.name, row]));
  const hero = buildCharacter(tables, cleared(req));
  const mod = hero.abilities.find((ability) => ability.key === caster.ability);
  const cmod = mod ? mod.mod : 0;
  out.maxSpell = maxSpell;
  out.nCan = caster.cantrips[li] ?? 0;
  out.nSp =
    maxSpell === 0
      ? 0
      : caster.mode === "known"
        ? (caster.known[li] ?? 0)
        : Math.min(Math.max(1, cmod + Math.floor(level * caster.level_mult)), caster.cap);
  out.bookAuto = (subActive && sub ? sub.auto_spells : [])
    .filter((entry) => {
      const row = byName.get(entry.spell);
      return entry.lvl <= level && row !== undefined && row.lvl > 0 && row.lvl <= maxSpell;
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
      .filter((entry) => entry.section === "Free Magic" && entry.note !== "extra")
      .map((entry) => entry.name),
    spells: hero.cards
      .filter((entry) => /^Level \d+ Spells$/.test(entry.section) && !out.bookAuto.includes(entry.name))
      .map((entry) => entry.name),
  };
  return out;
}
