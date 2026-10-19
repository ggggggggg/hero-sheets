export const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export type Ability = (typeof ABILITIES)[number];
export type AbilityScores = Record<Ability, number>;

export interface PointBuy {
  low: number;
  costs: number[];
  budget: number;
}

export interface Rules {
  standard_array: number[];
  prof_by_level: number[];
  cantrip_dice: number[];
  asi: { amount: number; cap: number };
  dc_base: number;
  max_level: number;
  item_slots: number[];
  option_floor: number[];
  point_buy: PointBuy;
}

export interface Skill {
  name: string;
  ability: Ability;
}

export interface SlotRow {
  kind: string;
  level: number;
  slots: number[];
  rest: string;
}

export interface Race {
  id: string;
  name: string;
  speed: number;
  asi: AbilityScores;
  skills: string[];
  hp_per_level: number;
  languages: string;
  armor_prof_add?: string[];
}

export interface Subrace {
  id: string;
  race_id: string;
  name: string;
  asi: AbilityScores;
  speed: number;
  hp_per_level: number;
  skills: string[];
  armor_prof_add: string[];
}

export interface ArmorSpec {
  base: number;
  dex_cap: number;
  add: Ability[];
  shield: number;
  worn: boolean;
}

export interface ClassWeapon {
  name: string;
  die: string;
  ability: string;
  kind: string;
  hands: string;
  note: string;
}

export interface Caster {
  kind: string;
  ability: string;
  cantrips: number[];
  mode: string;
  known: number[];
  level_mult: number;
  cap: number;
}

export interface Expertise {
  lvl: number;
  skills: string[];
}

export interface ClassRow {
  id: string;
  name: string;
  hit_die: number;
  primary: Ability[];
  saves: Ability[];
  skills: string[];
  expertise: Expertise[];
  armor: ArmorSpec;
  armor_prof: string[];
  shield_prof: boolean;
  shield_default: boolean;
  weapons: ClassWeapon[];
  caster: Caster;
  spell_order: string[];
  cantrip_order: string[];
  subclass_level: number;
  asi_levels: number[];
  speed_bonus: number[];
  weapon_prof: string[];
  melee_slot: number;
  look: { accent: string; tagline: string };
  gear: string[];
}

export interface AutoSpell {
  lvl: number;
  spell: string;
}

export interface Subclass {
  id: string;
  class_id: string;
  name: string;
  hp_per_level: number;
  armor: ArmorSpec | null;
  armor_prof_add: string[];
  extra_skills: string[];
  extra_cantrips: string[];
  auto_spells: AutoSpell[];
}

export interface Card {
  name: string;
  tag: string;
  note: string;
  desc: string;
  conc: boolean;
}

export interface Feature {
  owner_kind: string;
  owner_id: string;
  lvl: number;
  card: Card;
  tracker: { uses: string; rest: string };
}

export interface EffectVar {
  key: string;
  value: string | number;
}

export interface Effect {
  ac: number;
  ranged_hit: number;
  onehand_dmg: number;
  init: number;
  vars: EffectVar[];
}

export interface ChoiceOption {
  name: string;
  tag: string;
  desc: string;
  effect: Effect;
}

export interface Choice {
  owner_kind: string;
  owner_id: string;
  group: string;
  label: string;
  count: number[];
  options: ChoiceOption[];
}

export interface Scaling {
  owner_kind: string;
  owner_id: string;
  key: string;
  values: (string | number)[];
}

export interface SpellScale {
  base: number;
  per: number;
  unit: string;
}

export interface Spell {
  name: string;
  lvl: number;
  classes: string[];
  card: Card;
  scale: SpellScale | null;
}

export interface Item {
  name: string;
  rarity: string;
  tier: number;
  min_level: number;
  use_by: string[];
  card: Card;
  uses: number;
  rest: string;
}

export interface ArmorRow {
  name: string;
  kind: string;
  base: number;
  dex_cap: number;
  str_req: number;
  default_level: number;
}

export interface WeaponRow {
  name: string;
  cat: string;
  die: string;
  ability: string;
  hands: string;
  note: string;
}

export interface Tables {
  rules: Rules[];
  skills: Skill[];
  slots: SlotRow[];
  races: Race[];
  subraces: Subrace[];
  classes: ClassRow[];
  subclasses: Subclass[];
  scaling: Scaling[];
  features: Feature[];
  choices: Choice[];
  spells: Spell[];
  items: Item[];
  armor: ArmorRow[];
  weapons: WeaponRow[];
}

export interface ChoicePick {
  group: string;
  picks: string[];
}

export interface HeroRequest {
  name: string;
  race: string;
  cls: string;
  subclass: string | null;
  subrace: string | null;
  level: number;
  choices: ChoicePick[];
  cantrips: string[] | null;
  spells: string[] | null;
  path_spells: string[] | null;
  items: string[] | null;
  item_seed: string | null;
  armor: string | null;
  shield: boolean | null;
  weapon: string | null;
  base_scores: AbilityScores | null;
  race_asi: AbilityScores | null;
  inventory: string[] | null;
  notes: string;
  portrait: string | null;
  portrait_credit: string | null;
}

export interface AbilityRow {
  key: Ability;
  score: number;
  mod: number;
  save: number;
  save_prof: boolean;
}

export interface SkillRow {
  name: string;
  ability: string;
  bonus: number;
  prof: boolean;
  expert: boolean;
}

export interface AttackRow {
  name: string;
  to_hit: number;
  damage: string;
  note: string;
}

export interface SpellSlot {
  level: number;
  count: number;
}

export interface Spellcasting {
  ability: string;
  attack: number;
  dc: number;
  slots: SpellSlot[];
  rest: string;
}

export interface SheetCard {
  section: string;
  name: string;
  tag: string;
  note: string;
  desc: string;
  uses: number | null;
  rest: string | null;
  conc: boolean;
}

export interface Character {
  identity: {
    name: string;
    race: string;
    cls: string;
    subclass: string | null;
    level: number;
    accent: string;
    tagline: string;
    languages: string;
  };
  abilities: AbilityRow[];
  combat: {
    ac: number;
    speed: number;
    initiative: number;
    prof: number;
    passive_perception: number;
    max_hp: number;
    hit_die: string;
    hit_dice: number;
    armor: string;
  };
  skills: SkillRow[];
  attacks: AttackRow[];
  spellcasting: Spellcasting | null;
  cards: SheetCard[];
  inventory: string[];
  extras: { notes: string; portrait: string | null; portrait_credit: string | null };
}

export interface ArmorOption {
  name: string;
  kind: string;
  ac: number;
  strReq: number;
}

export interface WeaponOption {
  name: string;
  hands: string;
  cat: string;
  damage: string;
  note: string;
}

export interface ChoiceGroup {
  group: string;
  label: string;
  count: number;
  options: ChoiceOption[];
}

export interface HeroOptions {
  subs: Subclass[];
  sub: Subclass | null;
  subActive: boolean;
  subclassLevel: number;
  groups: ChoiceGroup[];
  caster: boolean;
  nCan: number;
  nSp: number;
  maxSpell: number;
  auto: string[];
  bonusCantrips: string[];
  cantripPool: string[];
  spellPool: string[];
  armorDefault: string;
  armorOptions: ArmorOption[];
  shieldProf: boolean;
  weaponOptions: WeaponOption[];
  weaponDefault: string | null;
  defaultBase: AbilityScores;
  raceAsi: AbilityScores;
  subraces: Subrace[];
  subrace: string | null;
  pointBuy: PointBuy | null;
  itemSlots: number;
  itemPool: string[];
  itemWarn: (name: string) => string;
  itemRarity: (name: string) => string;
  itemCard: (name: string) => Card | null;
  defaultItems: string[];
  bookAuto: string[];
  anyPool: string[];
  spellLevel: (name: string) => number;
  spellCard: (name: string) => Card | null;
  defaults: { cantrips: string[]; spells: string[] };
}
