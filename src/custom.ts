import { buildCharacter, CharError, options } from "./core";
import { ABILITIES, type Ability, type AbilityScores, type HeroRequest, type Tables } from "./types";

export class CustomError extends Error {}

export const TABLE_NAMES = [
  "races",
  "subraces",
  "classes",
  "subclasses",
  "features",
  "choices",
  "scaling",
  "spells",
  "items",
  "armor",
  "weapons",
  "feats",
] as const;

export type TableName = (typeof TABLE_NAMES)[number];

const ZERO: AbilityScores = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };
const CARD = { name: null, tag: "ON", note: "", desc: "", conc: false };
const seven = <T>(value: T): T[] => [value, value, value, value, value, value, value];

export const TEMPLATES: Record<TableName, object> = {
  races: { id: null, name: null, speed: 30, swim: 0, asi: ZERO, skills: [], hp_per_level: 0, languages: "Common" },
  subraces: {
    id: null,
    race_id: null,
    name: null,
    asi: ZERO,
    speed: 0,
    hp_per_level: 0,
    skills: [],
    armor_prof_add: [],
  },
  classes: {
    id: null,
    name: null,
    hit_die: 8,
    primary: ABILITIES,
    saves: [],
    skills: [],
    expertise: [{ lvl: 1, skills: [] }],
    armor: { base: 10, dex_cap: 99, add: [], shield: 0, worn: false },
    armor_prof: [],
    shield_prof: false,
    shield_default: false,
    weapons: [{ name: null, die: "1d6", ability: "STR", kind: "melee", hands: "one", note: "" }],
    caster: { kind: "none", ability: "", cantrips: seven(0), mode: "none", known: seven(0), level_mult: 0, cap: 0 },
    spell_order: [],
    cantrip_order: [],
    subclass_level: 3,
    asi_levels: [4],
    speed_bonus: seven(0),
    weapon_prof: ["simple"],
    melee_slot: -1,
    look: { accent: "#555555", tagline: "" },
    gear: [],
    multiclass: null,
  },
  subclasses: {
    id: null,
    class_id: null,
    name: null,
    hp_per_level: 0,
    armor: null,
    armor_prof_add: [],
    extra_skills: [],
    extra_cantrips: [],
    auto_spells: [{ lvl: 1, spell: null }],
  },
  features: { owner_kind: null, owner_id: null, lvl: 1, card: CARD, tracker: { uses: "", rest: "" } },
  choices: {
    owner_kind: null,
    owner_id: null,
    group: null,
    label: null,
    count: seven(1),
    options: [
      {
        name: null,
        tag: "ON",
        desc: "",
        effect: { ac: 0, ranged_hit: 0, onehand_dmg: 0, init: 0, vars: [{ key: null, value: null }] },
      },
    ],
  },
  scaling: { owner_kind: null, owner_id: null, key: null, values: null },
  spells: { name: null, lvl: 0, classes: [], card: { ...CARD, tag: "A" }, scale: null },
  items: {
    name: null,
    rarity: "common",
    tier: null,
    min_level: null,
    use_by: [],
    card: { ...CARD, tag: "A", note: null },
    uses: 1,
    rest: "used",
  },
  armor: { name: null, kind: "light", base: 11, dex_cap: 99, str_req: 0, default_level: 1 },
  weapons: { name: null, cat: "simple", die: "1d6", ability: "STR", hands: "one", note: "" },
  feats: {
    id: null,
    name: null,
    card: CARD,
    asi_pick: [],
    hp_per_level: 0,
    speed: 0,
    init: 0,
    notice: 0,
    skills: [],
    skill_picks: 0,
    save_pick: false,
    armor_prof: [],
    shield: false,
    medium_dex: 0,
    weapon_picks: 0,
    languages: 0,
    need_scores: ZERO,
    need_any: ZERO,
    need_armor: [],
    need_caster: false,
    choose: [],
    grant: { cantrips: 0, spells: 0 },
    uses: "",
    rest: "",
  },
};

const REQUIRED: Record<TableName, string[]> = {
  races: ["id", "name"],
  subraces: ["id", "race_id", "name"],
  classes: ["id", "name"],
  subclasses: ["id", "class_id", "name"],
  features: ["owner_kind", "owner_id", "card.name"],
  choices: ["owner_kind", "owner_id", "group"],
  scaling: ["owner_kind", "owner_id", "key", "values"],
  spells: ["name"],
  items: ["name"],
  armor: ["name"],
  weapons: ["name"],
  feats: ["id", "name"],
};

const KEYS: Record<TableName, string[]> = {
  races: ["id"],
  subraces: ["id"],
  classes: ["id"],
  subclasses: ["id"],
  spells: ["name"],
  items: ["name"],
  armor: ["name"],
  weapons: ["name"],
  feats: ["id"],
  features: ["owner_kind", "owner_id", "card.name"],
  choices: ["owner_kind", "owner_id", "group"],
  scaling: ["owner_kind", "owner_id", "key"],
};

const SCALE = { base: 0, per: 0, unit: "" };
const RARITY: Record<string, [number, number]> = { common: [1, 1], uncommon: [2, 3], rare: [3, 5] };

const HERO_FIELDS = [
  "name",
  "race",
  "subrace",
  "cls",
  "subclass",
  "level",
  "choices",
  "cantrips",
  "spells",
  "path_spells",
  "items",
  "armor",
  "shield",
  "weapon",
  "base_scores",
  "race_asi",
  "inventory",
  "notes",
  "portrait",
  "portrait_credit",
  "avatar",
  "use_feats",
  "feat",
  "feat_asi",
  "feat_skills",
  "feat_pick",
  "feat_extra",
  "weapon_plus",
  "armor_plus",
];

export type PackRow = Record<string, unknown>;

export interface PackInput {
  title?: string;
  about?: string;
  heroes?: unknown;
  races?: unknown;
  subraces?: unknown;
  classes?: unknown;
  subclasses?: unknown;
  features?: unknown;
  choices?: unknown;
  scaling?: unknown;
  spells?: unknown;
  items?: unknown;
  armor?: unknown;
  weapons?: unknown;
  feats?: unknown;
}

function isObj(value: unknown): value is PackRow {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fill(val: unknown, tmpl: unknown, where: string): unknown {
  if (isObj(tmpl)) {
    const given = val == null ? {} : val;
    if (!isObj(given)) throw new CustomError(`${where} should be an object`);
    const extra = Object.keys(given).filter((key) => !(key in tmpl));
    if (extra.length) {
      throw new CustomError(
        `${where}: unknown field(s) ${JSON.stringify(extra)} (allowed: ${Object.keys(tmpl).join(", ")})`,
      );
    }
    const out: PackRow = {};
    for (const [key, child] of Object.entries(tmpl)) out[key] = fill(given[key], child, `${where}.${key}`);
    return out;
  }
  if (Array.isArray(tmpl) && tmpl.length === 1 && isObj(tmpl[0])) {
    if (val == null) return [];
    if (!Array.isArray(val)) throw new CustomError(`${where} should be a list`);
    return val.map((item, i) => fill(item, tmpl[0], `${where}[${i}]`));
  }
  return val == null ? clone(tmpl) : val;
}

function get(row: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, part) => (isObj(cur) ? cur[part] : undefined), row);
}

function isTableName(name: string): name is TableName {
  return (TABLE_NAMES as readonly string[]).includes(name);
}

function fillRow(table: TableName, row: unknown, i: number): PackRow {
  const where = `${table}[${i || 0}]`;
  if (!isObj(row)) throw new CustomError(`${where} should be an object`);
  let tmpl: unknown = TEMPLATES[table];
  if (table === "spells" && row.scale != null) tmpl = { ...(isObj(tmpl) ? tmpl : {}), scale: SCALE };
  if (table === "subclasses" && row.armor != null) tmpl = { ...(isObj(tmpl) ? tmpl : {}), armor: classArmor() };
  const filled = fill(row, tmpl, where);
  if (!isObj(filled)) throw new CustomError(`${where} should be an object`);
  for (const req of REQUIRED[table]) {
    const value = get(filled, req);
    if (value == null || value === "") throw new CustomError(`${where} needs '${req}'`);
  }
  const card = filled.card;
  if (isObj(card) && card.name == null && "name" in filled) card.name = filled.name;
  if (table === "items") {
    const rarity = typeof filled.rarity === "string" ? filled.rarity : "";
    const pair = RARITY[rarity] ?? [1, 1];
    if (filled.tier == null) filled.tier = pair[0];
    if (filled.min_level == null) filled.min_level = pair[1];
    if (isObj(card) && card.note == null) card.note = filled.rarity;
  }
  if (Array.isArray(filled.auto_spells)) {
    for (const entry of filled.auto_spells) {
      if (isObj(entry) && entry.spell == null) throw new CustomError(`${where}.auto_spells entries need 'spell'`);
    }
  }
  if (Array.isArray(filled.options)) {
    for (const option of filled.options) {
      if (!isObj(option) || option.name == null) throw new CustomError(`${where}.options entries need 'name'`);
      const effect = option.effect;
      const vars = isObj(effect) && Array.isArray(effect.vars) ? effect.vars : [];
      for (const kv of vars) {
        if (!isObj(kv) || kv.key == null || kv.value == null) {
          throw new CustomError(`${where}.options vars need 'key' and 'value'`);
        }
      }
    }
  }
  if (table === "choices" && filled.label == null) filled.label = filled.group;
  return filled;
}

function classArmor(): unknown {
  const classes = TEMPLATES.classes;
  return isObj(classes) ? classes.armor : null;
}

function mergeRows(table: TableName, base: unknown[], add: unknown[]): PackRow[] {
  const keyOf = (row: unknown) => JSON.stringify(KEYS[table].map((key) => get(row, key)));
  const out = base.slice();
  const at = new Map(out.map((row, i) => [keyOf(row), i]));
  add.forEach((row, i) => {
    const filled = fillRow(table, row, i);
    const key = keyOf(filled);
    const index = at.get(key);
    if (index !== undefined) out[index] = filled;
    else {
      at.set(key, out.length);
      out.push(filled);
    }
  });
  return out.filter(isObj);
}

function packRows(custom: PackRow, name: TableName): unknown[] {
  const value = custom[name];
  if (!Array.isArray(value)) throw new CustomError(`${name} should be a list`);
  return value;
}

export function mergeCustom(tables: Tables, custom: unknown): Tables {
  if (!isObj(custom)) throw new CustomError("custom content should be one JSON object");
  const bad = Object.keys(custom).filter(
    (key) => !isTableName(key) && key !== "title" && key !== "about" && key !== "heroes" && key !== "emoji",
  );
  if (custom.heroes != null) heroList(custom);
  if (bad.length) {
    throw new CustomError(`unknown table(s) ${JSON.stringify(bad)} (allowed: ${TABLE_NAMES.join(", ")})`);
  }
  const out: Tables = { ...tables };
  for (const name of TABLE_NAMES) {
    if (!(name in custom)) continue;
    writeTable(out, name, mergeRows(name, tables[name], packRows(custom, name)));
  }
  return out;
}

function writeTable(out: Tables, name: TableName, rows: PackRow[]): void {
  const filled = rows as unknown;
  switch (name) {
    case "races":
      out.races = filled as Tables["races"];
      break;
    case "subraces":
      out.subraces = filled as Tables["subraces"];
      break;
    case "classes":
      out.classes = filled as Tables["classes"];
      break;
    case "subclasses":
      out.subclasses = filled as Tables["subclasses"];
      break;
    case "features":
      out.features = filled as Tables["features"];
      break;
    case "choices":
      out.choices = filled as Tables["choices"];
      break;
    case "scaling":
      out.scaling = filled as Tables["scaling"];
      break;
    case "spells":
      out.spells = filled as Tables["spells"];
      break;
    case "items":
      out.items = filled as Tables["items"];
      break;
    case "armor":
      out.armor = filled as Tables["armor"];
      break;
    case "weapons":
      out.weapons = filled as Tables["weapons"];
      break;
    case "feats":
      out.feats = filled as Tables["feats"];
      break;
  }
}

export function heroList(custom: PackRow): PackRow[] {
  const heroes = custom.heroes == null ? [] : custom.heroes;
  if (!Array.isArray(heroes)) throw new CustomError("heroes should be a list");
  return heroes.map((hero, i) => {
    const where = `heroes[${i}]`;
    if (!isObj(hero)) throw new CustomError(`${where} should be an object`);
    const extra = Object.keys(hero).filter((key) => !HERO_FIELDS.includes(key));
    if (extra.length) {
      throw new CustomError(`${where}: unknown field(s) ${JSON.stringify(extra)} (allowed: ${HERO_FIELDS.join(", ")})`);
    }
    for (const key of ["name", "race", "cls"]) if (!hero[key]) throw new CustomError(`${where} needs '${key}'`);
    if (hero.choices != null && !isObj(hero.choices)) {
      throw new CustomError(`${where}.choices should be an object like {"invocations": ["Agonizing Blast"]}`);
    }
    return hero;
  });
}

function abilityOf(value: unknown): Ability | null {
  if (typeof value !== "string") return null;
  for (const ability of ABILITIES) if (ability === value) return ability;
  return null;
}

function strList(value: unknown): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  return value.map(String);
}

function scoresOf(value: unknown): AbilityScores | null {
  if (!isObj(value)) return null;
  const out: AbilityScores = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };
  for (const ability of ABILITIES) {
    const n = value[ability];
    if (typeof n !== "number") return null;
    out[ability] = n;
  }
  return out;
}

export function heroRequest(hero: PackRow): HeroRequest {
  const choices = isObj(hero.choices) ? hero.choices : {};
  return {
    name: String(hero.name),
    race: String(hero.race),
    cls: String(hero.cls),
    subrace: hero.subrace ? String(hero.subrace) : null,
    subclass: hero.subclass ? String(hero.subclass) : null,
    level: typeof hero.level === "number" && hero.level ? hero.level : 1,
    choices: Object.entries(choices).map(([group, picks]) => ({
      group,
      picks: Array.isArray(picks) ? picks.map(String) : [],
    })),
    cantrips: strList(hero.cantrips),
    spells: strList(hero.spells),
    path_spells: strList(hero.path_spells),
    items: strList(hero.items),
    item_seed: null,
    armor: hero.armor ? String(hero.armor) : null,
    shield: hero.shield == null ? null : Boolean(hero.shield),
    weapon: hero.weapon ? String(hero.weapon) : null,
    extra_weapons: strList(hero.extra_weapons),
    extra_languages: strList(hero.extra_languages),
    base_scores: scoresOf(hero.base_scores),
    race_asi: scoresOf(hero.race_asi),
    inventory: strList(hero.inventory),
    notes: hero.notes ? String(hero.notes) : "",
    portrait: hero.portrait ? String(hero.portrait) : null,
    portrait_credit: hero.portrait ? (hero.portrait_credit ? String(hero.portrait_credit) : null) : null,
    numbers: null,
    use_feats: hero.use_feats === true,
    feat: hero.feat ? String(hero.feat) : null,
    feat_asi: abilityOf(hero.feat_asi),
    feat_skills: strList(hero.feat_skills),
    feat_pick: hero.feat_pick ? String(hero.feat_pick) : null,
    feat_extra: strList(hero.feat_extra),
    weapon_plus: typeof hero.weapon_plus === "number" ? hero.weapon_plus : 0,
    armor_plus: typeof hero.armor_plus === "number" ? hero.armor_plus : 0,
  };
}

export function parseCustomText(text: string): PackRow {
  let value: unknown;
  try {
    value = JSON.parse(String(text)) as unknown;
  } catch (error) {
    throw new CustomError(`not valid JSON: ${messageOf(error)}`);
  }
  if (!isObj(value)) throw new CustomError("custom content should be one JSON object");
  return value;
}

function idSet(custom: PackRow, table: TableName): Set<string> {
  const value = custom[table];
  if (!Array.isArray(value)) return new Set();
  const ids = new Set<string>();
  for (const row of value) if (isObj(row) && typeof row.id === "string") ids.add(row.id);
  return ids;
}

function blankRequest(
  race: string,
  cls: string,
  subclass: string | null,
  subrace: string | null,
  level: number,
): HeroRequest {
  return {
    name: "Test",
    race,
    cls,
    subclass,
    subrace,
    level,
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
  };
}

export function checkCustom(tables: Tables, custom: PackRow): string[] {
  const problems: string[] = [];
  const races = idSet(custom, "races");
  const classes = idSet(custom, "classes");
  const subs = idSet(custom, "subclasses");
  const subraces = idSet(custom, "subraces");
  const touched = new Set<string>();
  for (const table of ["features", "choices", "scaling"] as const) {
    const value = custom[table];
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      if (isObj(row)) touched.add(`${String(row.owner_kind)}:${String(row.owner_id)}`);
    }
  }
  const raceIds = tables.races.map((race) => race.id);
  const spellClasses = new Set<string>();
  const spellsByClass = new Map<string, PackRow[]>();
  if (Array.isArray(custom.spells)) {
    for (const spell of custom.spells) {
      if (!isObj(spell) || !Array.isArray(spell.classes)) continue;
      for (const id of new Set(spell.classes.map(String))) {
        spellClasses.add(id);
        const list = spellsByClass.get(id) ?? [];
        list.push(spell);
        spellsByClass.set(id, list);
      }
    }
  }
  const subclassesByClass = new Map<string, Tables["subclasses"]>();
  for (const row of tables.subclasses) {
    const list = subclassesByClass.get(row.class_id) ?? [];
    list.push(row);
    subclassesByClass.set(row.class_id, list);
  }
  const subracesByRace = new Map<string, Tables["subraces"]>();
  for (const row of tables.subraces) {
    const list = subracesByRace.get(row.race_id) ?? [];
    list.push(row);
    subracesByRace.set(row.race_id, list);
  }
  const tries: { race: string; cls: string; subclass: string | null; subrace: string | null; level: number }[] = [];
  const gearOnly = Boolean(custom.items || custom.weapons || custom.armor);
  for (const race of tables.races) {
    for (const cls of tables.classes) {
      const subList = subclassesByClass.get(cls.id) ?? [];
      const srList = subracesByRace.get(race.id) ?? [];
      const hit =
        races.has(race.id) ||
        classes.has(cls.id) ||
        touched.has(`race:${race.id}`) ||
        touched.has(`class:${cls.id}`) ||
        spellClasses.has(cls.id) ||
        subList.some((row) => subs.has(row.id) || touched.has(`subclass:${row.id}`)) ||
        srList.some((row) => subraces.has(row.id) || touched.has(`subrace:${row.id}`));
      if (!hit && !gearOnly) continue;
      if (!hit && race.id !== raceIds[0]) continue;
      for (const sub of subList.length ? subList : [null]) {
        for (const sr of srList.length ? srList : [null]) {
          for (const lvl of [1, 3, 5, 7]) {
            tries.push({
              race: race.id,
              cls: cls.id,
              subclass: sub ? sub.id : null,
              subrace: sr ? sr.id : null,
              level: Math.min(lvl, tables.rules[0]?.max_level ?? lvl),
            });
          }
        }
      }
    }
  }
  for (const hero of heroList(custom)) {
    try {
      buildCharacter(tables, heroRequest(hero));
    } catch (error) {
      problems.push(`ready-made hero ${JSON.stringify(hero.name)}: ${messageOf(error)}`);
    }
  }
  for (const query of tries) {
    const req = blankRequest(query.race, query.cls, query.subclass, query.subrace, query.level);
    try {
      buildCharacter(tables, req);
      const mine = spellsByClass.get(query.cls) ?? [];
      const built = mine.length ? options(tables, req) : null;
      for (const spell of mine) {
        if (!isObj(spell) || !built) continue;
        const isCantrip = (typeof spell.lvl === "number" ? spell.lvl : 0) === 0;
        const pool = isCantrip ? built.cantripPool : built.spellPool;
        const n = isCantrip ? built.nCan : built.nSp;
        const name = typeof spell.name === "string" ? spell.name : "";
        if (!pool.includes(name) || !n) continue;
        const current = (isCantrip ? built.defaults.cantrips : built.defaults.spells) || [];
        const pick = [name].concat(current.filter((item) => item !== name)).slice(0, n);
        buildCharacter(tables, { ...req, ...(isCantrip ? { cantrips: pick } : { spells: pick }) });
      }
    } catch (error) {
      if (!(error instanceof CharError) && !(error instanceof CustomError) && !(error instanceof Error)) throw error;
      problems.push(
        `${query.race} ${query.cls}${query.subclass ? ` (${query.subclass})` : ""} level ${query.level}: ${messageOf(error)}`,
      );
      if (problems.length >= 8) break;
    }
  }
  return [...new Set(problems)];
}
