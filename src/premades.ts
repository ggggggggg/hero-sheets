import { BOOK_LEVEL } from "./tiers";
import type { AbilityScores, Character, ClassDip, HeroRequest } from "./types";

const ZERO: AbilityScores = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };

function tens(over: Partial<AbilityScores> = {}): AbilityScores {
  return { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10, ...over };
}

function dip(cls: string, subclass: string | null, level: number): ClassDip {
  return { cls, subclass, level, cantrips: null, spells: null, path_spells: null };
}

function hero(over: Partial<HeroRequest>): HeroRequest {
  return {
    name: "Hero",
    race: "human",
    cls: "fighter",
    subclass: null,
    subrace: null,
    level: 1,
    choices: [],
    cantrips: null,
    spells: null,
    path_spells: null,
    items: null,
    item_seed: null,
    armor: null,
    shield: null,
    weapon: null,
    base_scores: null,
    race_asi: null,
    inventory: null,
    notes: "",
    portrait: null,
    portrait_credit: null,
    numbers: null,
    ...over,
  };
}

export interface Premade {
  id: string;
  label: string;
  request: HeroRequest;
}

export const PREMADES: readonly Premade[] = [
  {
    id: "wizard-5",
    label: "Wizard 5, one class",
    request: hero({ name: "Wynn", cls: "wizard", subclass: "evocation", level: 5 }),
  },
  {
    id: "wizard-cleric",
    label: "Wizard 5 / Cleric 2",
    request: hero({
      name: "Wynn",
      cls: "wizard",
      subclass: "evocation",
      level: 7,
      armor: "Half plate",
      use_multiclass: true,
      dip: dip("cleric", "life", 2),
    }),
  },
  {
    id: "paladin-sorcerer",
    label: "Paladin 2 / Sorcerer 3",
    request: hero({
      name: "Bram",
      cls: "paladin",
      subclass: "devotion",
      level: 5,
      armor: "Plate armor",
      shield: true,
      use_multiclass: true,
      dip: dip("sorcerer", "draconic", 3),
    }),
  },
  {
    id: "fighter-warlock",
    label: "Fighter 5 / Warlock 2",
    request: hero({
      name: "Bram",
      cls: "fighter",
      subclass: "champion",
      level: 7,
      armor: "Plate armor",
      shield: true,
      use_multiclass: true,
      dip: dip("warlock", "fiend", 2),
    }),
  },
  {
    id: "barbarian-monk",
    label: "Barbarian 2 / Monk 1",
    request: hero({
      name: "Bram",
      cls: "barbarian",
      subclass: "berserker",
      level: 3,
      armor: "No armor",
      shield: false,
      base_scores: tens({ DEX: 16, WIS: 16 }),
      race_asi: ZERO,
      use_multiclass: true,
      dip: dip("monk", "openhand", 1),
    }),
  },
  {
    id: "fighter-rogue",
    label: "Fighter 5 / Rogue 2, on book",
    request: hero({
      name: "Bram",
      cls: "fighter",
      subclass: "champion",
      level: 7,
      armor: "Half plate",
      shield: true,
      base_scores: tens({ STR: 8, DEX: 15, CON: 14, INT: 10, WIS: 12, CHA: 8 }),
      race_asi: ZERO,
      use_multiclass: true,
      dip: dip("rogue", "thief", 2),
    }),
  },
  {
    id: "fighter-wizard",
    label: "Fighter 5 / Wizard 2, off book",
    request: hero({
      name: "Bram",
      cls: "fighter",
      subclass: "champion",
      level: 7,
      armor: "Half plate",
      shield: true,
      base_scores: tens({ STR: 8, DEX: 15, CON: 14, INT: 10, WIS: 12, CHA: 8 }),
      race_asi: ZERO,
      use_multiclass: true,
      dip: dip("wizard", "evocation", 2),
    }),
  },
  {
    id: "fighter-hp",
    label: "Fighter 5 / Wizard 2, hit dice",
    request: hero({
      name: "Bram",
      cls: "fighter",
      subclass: "champion",
      level: 7,
      armor: "Half plate",
      shield: true,
      base_scores: tens(),
      race_asi: ZERO,
      use_multiclass: true,
      dip: dip("wizard", "evocation", 2),
    }),
  },
  {
    id: "fighter-7",
    label: "Fighter 7, usual sheet",
    request: hero({ name: "Bram", cls: "fighter", subclass: "champion", level: 7 }),
  },
  {
    id: "fighter-11",
    label: "Fighter 11",
    request: hero({ name: "Bram", cls: "fighter", subclass: "champion", level: 11 }),
  },
  {
    id: "wizard-20",
    label: "Wizard 20",
    request: hero({ name: "Wynn", cls: "wizard", subclass: "evocation", level: 20 }),
  },
  {
    id: "bard-20",
    label: "Bard 10 / Cleric 10",
    request: hero({
      name: "Wynn",
      cls: "bard",
      subclass: "lore",
      level: 20,
      armor: "Half plate",
      use_multiclass: true,
      dip: dip("cleric", "life", 10),
    }),
  },
  {
    id: "plus-1",
    label: "Fighter 5, +1 sword and mail",
    request: hero({
      name: "Bram",
      cls: "fighter",
      subclass: "champion",
      level: 5,
      armor: "Chain mail",
      weapon: "Longsword",
      weapon_plus: 1,
      armor_plus: 1,
    }),
  },
  {
    id: "alert",
    label: "Fighter 4, Alert",
    request: hero({ name: "Bram", cls: "fighter", subclass: "champion", level: 4, use_feats: true, feat: "alert" }),
  },
  {
    id: "heavy-master",
    label: "Wizard 4 / Life 1, Heavy Armor Master",
    request: hero({
      name: "Wynn",
      cls: "wizard",
      subclass: "evocation",
      level: 5,
      use_feats: true,
      feat: "heavy_armor_master",
      use_multiclass: true,
      dip: dip("cleric", "life", 1),
    }),
  },
  {
    id: "war-caster",
    label: "Fighter 4 / Wizard 1, War Caster",
    request: hero({
      name: "Bram",
      cls: "fighter",
      subclass: "champion",
      level: 5,
      use_feats: true,
      feat: "war_caster",
      use_multiclass: true,
      dip: dip("wizard", "evocation", 1),
    }),
  },
];

/** Enough of a premade to reopen it. Spell lists fill in again on the next build. */
export function premadeFileState(request: HeroRequest): Record<string, unknown> {
  const choices: Record<string, string[]> = {};
  for (const pick of request.choices) choices[pick.group] = [...pick.picks];
  const plus = Math.max(request.weapon_plus ?? 0, request.armor_plus ?? 0);
  const state: Record<string, unknown> = {
    name: request.name,
    race: request.race,
    cls: request.cls,
    subclass: request.subclass,
    subrace: request.subrace,
    level: request.level,
    choices,
    cantrips: request.cantrips,
    spells: request.spells,
    path_spells: request.path_spells,
    items: request.items,
    item_seed: request.item_seed,
    armor: request.armor,
    shield: request.shield,
    weapon: request.weapon,
    extra_weapons: request.extra_weapons ?? null,
    extra_languages: request.extra_languages ?? null,
    base_scores: request.base_scores,
    race_asi: request.race_asi,
    inventory: request.inventory,
    notes: request.notes,
    use_feats: request.use_feats ?? false,
    feat: request.feat ?? null,
    feat_asi: request.feat_asi ?? null,
    feat_skills: request.feat_skills ?? null,
    feat_pick: request.feat_pick ?? null,
    feat_extra: request.feat_extra ?? null,
    use_multiclass: request.use_multiclass ?? false,
    dip: request.dip ?? null,
    weapon_plus: request.weapon_plus ?? 0,
    armor_plus: request.armor_plus ?? 0,
  };
  if (request.level > BOOK_LEVEL) {
    state.use_high_levels = true;
    state.level_cap = request.level;
  }
  if (plus > 0) {
    state.use_magic_plus = true;
    state.plus_cap = plus;
  }
  return state;
}

export function premadeNote(ch: Character): string {
  const idn = ch.identity;
  const path = idn.subclass ? ` (${idn.subclass})` : "";
  const role = idn.second
    ? `${idn.cls}${path} ${idn.main_level} and ${idn.second}`
    : `${idn.cls}${path}, level ${idn.level}`;
  const dice = ch.combat.dice ? ` Dice ${ch.combat.dice}.` : "";
  return `${idn.name}. ${role}. Armor ${ch.combat.ac} (${ch.combat.armor}). ${ch.combat.max_hp} HP.${dice}`;
}
