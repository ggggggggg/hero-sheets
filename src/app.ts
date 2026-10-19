import { buildCharacter, CharError, options, sheetHtml } from "./core";
import {
  CustomError,
  checkCustom,
  heroList,
  heroRequest,
  mergeCustom,
  type PackRow,
  parseCustomText,
  TABLE_NAMES,
} from "./custom";
import { ExportError, makePdf } from "./export";
import {
  ABILITIES,
  type Ability,
  type AbilityScores,
  type Character,
  type ClassRow,
  type HeroOptions,
  type HeroRequest,
  type Race,
  type SheetCard,
  type Tables,
} from "./types";

export interface SitePack {
  file: string;
  title: string;
  about: string;
  data: PackRow;
}

interface AvatarState {
  style: string;
  seed: string;
  look: Look;
}

type Look = "boy" | "girl";

interface HeroState {
  name: string;
  race: string;
  cls: string;
  subclass: string | null;
  level: number;
  choices: Record<string, string[]>;
  cantrips: string[] | null;
  spells: string[] | null;
  path_spells: string[] | null;
  items: string[] | null;
  item_seed: string | null;
  inventory: string[] | null;
  notes: string;
  portrait: string | null;
  portrait_credit: string | null;
  subrace: string | null;
  weapon: string | null;
  race_asi: AbilityScores | null;
  base_scores: AbilityScores | null;
  armor: string | null;
  shield: boolean | null;
  avatar: AvatarState | null;
  look: Look | null;
}

interface HeroRecord {
  id: string;
  state: Partial<HeroState>;
  edited: boolean;
  updated: number;
  rolled?: string | null;
  packs?: PackCopy[];
}

interface PackCopy {
  title: string;
  text: string;
}

interface Book {
  heroes: HeroRecord[];
  current: string | null;
}

interface Prefs {
  custom?: boolean;
  adv?: boolean;
  heroesOpen?: boolean;
  rollsOpen?: boolean;
  noBuiltin?: boolean;
}

interface CustomSource {
  label: string;
  title: string;
  counts: string[];
}

interface CustomInfo {
  sources: CustomSource[];
  problems: string[];
  error: string;
  heroes: PackRow[];
  ids: Set<string>;
}

interface Tip {
  title: string;
  lines: [string | null, string][];
}

type ListKind = "cantrips" | "spells" | "items" | "path_spells";
type SpellKind = "cantrips" | "spells";

interface Picker {
  kind: ListKind;
  index: number;
}

interface Chip<T extends string | number> {
  id: T;
  label: string;
  color?: string;
  tip?: () => Tip | null;
}

type Kid = Node | string | number | false | null | undefined;

interface Attrs {
  class?: string;
  id?: string;
  type?: string;
  role?: string;
  for?: string;
  href?: string;
  download?: string;
  accept?: string;
  placeholder?: string;
  value?: string;
  maxlength?: number;
  rows?: number;
  autocomplete?: string;
  spellcheck?: string;
  title?: string;
  style?: string | null;
  hidden?: boolean;
  disabled?: boolean;
  checked?: boolean;
  "aria-label"?: string;
  "aria-pressed"?: string;
  "aria-expanded"?: string;
  "aria-current"?: string;
  "aria-hidden"?: string;
  onclick?: (ev: Event) => void;
  oninput?: (ev: Event) => void;
  onchange?: (ev: Event) => void;
  ontoggle?: (ev: Event) => void;
}

interface DownloadCap {
  save: (file: { filename: string; data: Blob }) => Promise<void>;
}

interface AvatarOptions {
  seed: string;
  size: number;
  hair?: string[];
  earringsProbability?: number;
  features?: string[];
  beardProbability?: number;
  accessories?: string[];
  top?: string[];
  mustacheProbability?: number;
}

interface AvatarCore {
  createAvatar: (style: object, options: AvatarOptions) => { toString(): string };
}

declare global {
  interface Window {
    CHARSHEET_FIXED_START?: boolean;
    __setHero?: (race: string, cls: string, sub: string | null, level: number) => void;
    claude?: { use?: (name: string) => Promise<DownloadCap> };
  }
}

const CUSTOM_KEY = "charsheet-custom-v1";
const CUSTOM_URL_KEY = "charsheet-custom-url-v1";
const PREFS_KEY = "charsheet-ui-v1";
const HEROES_KEY = "charsheet-heroes-v1";
const KEY = "charsheet-hero-v1";
const SRD_TITLE = "Built-in content (D&D 5.1 SRD)";
const MAX_ROLLS = 12;

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // storage blocked for this visit
    }
  },
};

function readJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string")
    return error.code;
  return undefined;
}

function inputOf(ev: Event): HTMLInputElement {
  if (ev.target instanceof HTMLInputElement) return ev.target;
  throw new Error("expected an input");
}

function textOf(ev: Event): HTMLInputElement | HTMLTextAreaElement {
  if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return ev.target;
  throw new Error("expected a text field");
}

function $(sel: string, root: ParentNode = document): HTMLElement {
  const node = root.querySelector(sel);
  if (!(node instanceof HTMLElement)) throw new Error(`missing ${sel}`);
  return node;
}

function maybe(sel: string): HTMLElement | null {
  const node = document.querySelector(sel);
  return node instanceof HTMLElement ? node : null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...kids: (Kid | Kid[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === "class" && typeof value === "string") node.className = value;
    else if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2), value as EventListener);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export function startApp(input: { tables: Tables; guide: string; sitePacks: SitePack[] }): void {
  const baseTables = input.tables;
  const guide = input.guide;
  const sitePacks = input.sitePacks;

  let prefs: Prefs = {};
  const storedPrefs = storage.get(PREFS_KEY);
  if (storedPrefs) {
    const parsed = readJson(storedPrefs);
    if (parsed && typeof parsed === "object") prefs = parsed as Prefs;
  }

  let memUrlText: string | null = null;
  let urlStatus = "";

  function directUrl(url: string): string {
    const match = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=download&)?id=)([\w-]+)/.exec(url);
    return match ? `https://drive.google.com/uc?export=download&id=${match[1]}` : url;
  }

  async function fetchCustomUrl(raw: string, quiet: boolean): Promise<boolean> {
    const url = directUrl(raw.trim());
    if (!/^https:\/\//i.test(url)) {
      urlStatus = "⚠ The link should start with https://";
      return false;
    }
    let text: string;
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`the server said ${res.status}`);
      text = await res.text();
    } catch (error) {
      if (!quiet) {
        urlStatus = `⚠ Couldn't read that link (${messageOf(error)}). Many sites, including Google Drive, don't let other pages read their files. A GitHub Gist “Raw” link or a jsDelivr link works — see the AI instructions.`;
      }
      return false;
    }
    try {
      parseCustomText(text);
    } catch (error) {
      urlStatus = `⚠ That link isn't a custom content file: ${messageOf(error)}`;
      return false;
    }
    memUrlText = text;
    storage.set(CUSTOM_URL_KEY, raw.trim());
    storage.set(`${CUSTOM_URL_KEY}-text`, text);
    urlStatus = "";
    return true;
  }

  let customInfo: CustomInfo = { sources: [], problems: [], error: "", heroes: [], ids: new Set() };
  let memLib: PackCopy[] = [];
  let packOf: Record<string, PackCopy> = {};
  let loadReport: string[] = [];

  function loadLib(): PackCopy[] {
    const raw = storage.get(CUSTOM_KEY);
    if (raw == null) return memLib;
    try {
      const parsed = readJson(raw);
      if (parsed && typeof parsed === "object" && "packs" in parsed && Array.isArray(parsed.packs)) {
        return parsed.packs.filter((pack): pack is PackCopy => {
          return typeof pack === "object" && pack !== null && "title" in pack && "text" in pack;
        });
      }
    } catch {
      // older single-file form falls through
    }
    try {
      const obj = parseCustomText(raw);
      return [{ title: typeof obj.title === "string" ? obj.title : "loaded file", text: raw }];
    } catch {
      return [{ title: "loaded file", text: raw }];
    }
  }

  function saveLib(lib: PackCopy[]): void {
    memLib = lib;
    storage.set(CUSTOM_KEY, JSON.stringify({ packs: lib }));
  }

  function frameworkOnly(tables: Tables): Tables {
    return {
      ...tables,
      races: [],
      subraces: [],
      classes: [],
      subclasses: [],
      features: [],
      choices: [],
      scaling: [],
      spells: [],
      items: [],
      armor: [],
      weapons: [],
    };
  }

  function withCustom(): Tables {
    let tables = prefs.noBuiltin ? frameworkOnly(baseTables) : baseTables;
    customInfo = { sources: [], problems: [], error: "", heroes: [], ids: new Set() };
    packOf = {};
    const add = (obj: PackRow, label: string, text: string) => {
      try {
        const next = mergeCustom(tables, obj);
        const problems = checkCustom(next, obj);
        if (problems.length) {
          customInfo.problems.push(...problems.map((problem) => `${label}: ${problem}`));
          return;
        }
        tables = next;
        for (const hero of heroList(obj)) customInfo.heroes.push(hero);
        for (const key of ["races", "classes", "subclasses", "subraces"] as const) {
          const rows = obj[key];
          if (!Array.isArray(rows)) continue;
          for (const row of rows) {
            if (typeof row === "object" && row !== null && "id" in row && typeof row.id === "string" && row.id) {
              customInfo.ids.add(`${key}:${row.id}`);
              packOf[`${key}:${row.id}`] = {
                title: typeof obj.title === "string" ? obj.title : label,
                text: text || JSON.stringify(obj),
              };
            }
          }
        }
        customInfo.sources.push({
          label,
          title: typeof obj.title === "string" ? obj.title : "",
          counts: TABLE_NAMES.filter((name) => Array.isArray(obj[name]) && obj[name].length > 0).map(
            (name) => `${(obj[name] as unknown[]).length} ${name}`,
          ),
        });
      } catch (error) {
        customInfo.error = `${label}: ${messageOf(error)}`;
      }
    };
    for (const pack of loadLib()) {
      try {
        add(parseCustomText(pack.text), pack.title, pack.text);
      } catch (error) {
        customInfo.error = `${pack.title}: ${messageOf(error)}`;
      }
    }
    const urlText = storage.get(`${CUSTOM_URL_KEY}-text`) ?? memUrlText;
    if (urlText) {
      try {
        add(parseCustomText(urlText), "link", urlText);
      } catch (error) {
        customInfo.error = `link: ${messageOf(error)}`;
      }
    }
    return tables;
  }

  let tables = withCustom();
  if (prefs.noBuiltin && (!tables.races.length || !tables.classes.length)) {
    prefs.noBuiltin = false;
    tables = withCustom();
  }

  const TRAITS = [
    "Collects shiny rocks and names every one",
    "Hums when sneaking (badly)",
    "Never, ever turns down a dare",
    "Talks to their weapon like it's a friend",
    "Has a joke for every situation — most are terrible",
    "Is scared of chickens. Just chickens.",
    "Keeps a list of everyone who owes them a snack",
    "Always wants to pet the monster first",
    "Sleeps with one eye open (they say)",
    "Insists on a dramatic entrance",
    "Counts everything: steps, coins, goblins",
    "Gives everyone a nickname",
    "Writes down every new word they hear",
    "Can't walk past a door without knocking on it",
    "Brags about a dragon they 'almost' beat",
    "Eats the weirdest food on the table to prove they can",
    "Gets braver when someone is watching",
    "Loves maps, even wrong ones",
    "Saves a crumb from every meal for later",
    "Tells the truth even when a fib would be easier",
    "Practices their victory pose daily",
    "Refuses to take the same road twice",
    "Whistles for luck before every big roll",
    "Thinks every old person is secretly a wizard",
  ];
  const FLAWS = [
    "Can't keep a secret for more than a day",
    "Touches things they shouldn't (buttons, levers, glowing orbs)",
    "Gets grumpy when hungry — very grumpy",
    "Believes anyone who says please",
    "Runs toward loud noises",
    "Hates losing, even at games that don't matter",
    "Easily distracted by anything sparkly",
    "Will argue about anything, even the weather",
    "Forgets names right after hearing them",
    "Takes the last cookie. Every time.",
    "Too curious about locked boxes",
    "Says the plan out loud... to the bad guys",
    "Gets lost in their own home town",
    "Trusts animals more than people",
  ];
  const NAMES = [
    "Tobin",
    "Pip",
    "Rook",
    "Mira",
    "Juniper",
    "Bramble",
    "Ash",
    "Wren",
    "Ziggy",
    "Nova",
    "Fennick",
    "Tulip",
    "Grimble",
    "Sparrow",
    "Thistle",
    "Moxie",
    "Brick",
    "Luna",
    "Dex",
    "Odette",
    "Pickle",
    "Rune",
    "Saffron",
    "Bolt",
  ];

  function pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(Math.random() * items.length)];
    if (item === undefined) throw new Error("nothing to pick");
    return item;
  }

  function rollTraits(): string {
    const a = pick(TRAITS);
    let b = pick(TRAITS);
    while (b === a) b = pick(TRAITS);
    return `${a}.\n${b}.\nFlaw: ${pick(FLAWS)}.`;
  }

  const DEFAULT: HeroState = {
    name: "Tobin",
    race: "dwarf",
    cls: "warlock",
    subclass: "fiend",
    level: 5,
    choices: {},
    cantrips: null,
    spells: null,
    inventory: null,
    notes: "",
    portrait: null,
    path_spells: null,
    items: null,
    item_seed: null,
    subrace: null,
    weapon: null,
    race_asi: null,
    base_scores: null,
    armor: null,
    shield: null,
    portrait_credit: null,
    avatar: null,
    look: null,
  };

  const savePrefs = () => {
    storage.set(PREFS_KEY, JSON.stringify(prefs));
  };
  const newId = () => `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const keyFields = (hero: HeroState) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(hero)
          .filter(([key]) => !key.startsWith("ui_"))
          .sort(),
      ),
    );

  function readBook(): Book {
    const raw = storage.get(HEROES_KEY);
    if (!raw) return { heroes: [], current: null };
    try {
      const parsed = readJson(raw);
      if (parsed && typeof parsed === "object" && "heroes" in parsed && Array.isArray(parsed.heroes)) {
        return {
          heroes: parsed.heroes as HeroRecord[],
          current: "current" in parsed && typeof parsed.current === "string" ? parsed.current : null,
        };
      }
    } catch {
      // no saved book
    }
    return { heroes: [], current: null };
  }

  const book = readBook();
  if (!book.heroes.length) {
    const oldRaw = storage.get(KEY);
    if (oldRaw) {
      try {
        const old = readJson(oldRaw);
        if (old && typeof old === "object" && "race" in old) {
          book.heroes.push({ id: newId(), state: old as Partial<HeroState>, edited: true, updated: Date.now() });
        }
      } catch {
        // ignore a broken older save
      }
    }
    book.current = book.heroes[0]?.id ?? null;
  }

  let rolling = false;
  const currentHero = () => book.heroes.find((hero) => hero.id === book.current) ?? null;
  let state: HeroState = { ...DEFAULT };
  const haveSaved = !!currentHero();
  const saved = currentHero();
  if (haveSaved && saved) state = { ...DEFAULT, ...saved.state };
  else {
    const hero: HeroRecord = { id: newId(), state: {}, edited: false, rolled: null, updated: Date.now() };
    book.heroes.push(hero);
    book.current = hero.id;
  }

  function save(): void {
    const hero = currentHero();
    if (!hero) return;
    hero.state = state;
    hero.updated = Date.now();
    const used: PackCopy[] = [];
    for (const key of [
      `races:${state.race}`,
      `classes:${state.cls}`,
      `subclasses:${state.subclass}`,
      `subraces:${state.subrace}`,
    ]) {
      const pack = packOf[key];
      if (pack && !used.some((item) => item.title === pack.title)) used.push(pack);
    }
    hero.packs = used;
    if (!hero.edited && !rolling && hero.rolled != null && keyFields(state) !== hero.rolled) hero.edited = true;
    const rolls = book.heroes
      .filter((item) => !item.edited && item.id !== book.current)
      .sort((a, b) => b.updated - a.updated);
    for (const old of rolls.slice(MAX_ROLLS - 1)) book.heroes = book.heroes.filter((item) => item !== old);
    if (!storage.set(HEROES_KEY, JSON.stringify(book))) {
      const oldest = book.heroes
        .filter((item) => !item.edited && item.id !== book.current)
        .sort((a, b) => a.updated - b.updated);
      const drop = oldest[0];
      if (drop) {
        book.heroes = book.heroes.filter((item) => item !== drop);
        storage.set(HEROES_KEY, JSON.stringify(book));
      }
    }
  }

  function markRolled(): void {
    const hero = currentHero();
    if (!hero) return;
    hero.edited = false;
    hero.rolled = keyFields(state);
    save();
  }

  function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
    return Object.fromEntries(rows.map((row) => [row.id, row]));
  }

  let RACES = byId(tables.races);
  let CLASSES = byId(tables.classes);

  function raceBy(id: string): Race {
    const race = RACES[id];
    if (!race) throw new Error(`unknown race ${id}`);
    return race;
  }
  function classBy(id: string): ClassRow {
    const cls = CLASSES[id];
    if (!cls) throw new Error(`unknown class ${id}`);
    return cls;
  }

  function ensurePacks(hero: HeroRecord | null): boolean {
    if (!hero?.packs?.length) return false;
    const have = new Set(customInfo.sources.map((source) => source.title || source.label));
    const lib = loadLib().slice();
    let changed = false;
    for (const pack of hero.packs) {
      if (!have.has(pack.title) && !lib.some((item) => item.title === pack.title)) {
        lib.push(pack);
        changed = true;
      }
    }
    if (changed) {
      saveLib(lib);
      tables = withCustom();
      RACES = byId(tables.races);
      CLASSES = byId(tables.classes);
    }
    return changed;
  }

  function switchHero(id: string): void {
    const hero = book.heroes.find((item) => item.id === id);
    if (!hero) return;
    save();
    book.current = id;
    ensurePacks(hero);
    state = { ...DEFAULT, ...hero.state };
    picker = null;
    update();
    window.scrollTo(0, 0);
  }

  function deleteHero(id: string): void {
    book.heroes = book.heroes.filter((item) => item.id !== id);
    if (book.current === id) {
      const next = book.heroes.slice().sort((a, b) => Number(b.edited) - Number(a.edited) || b.updated - a.updated)[0];
      if (next) {
        book.current = next.id;
        state = { ...DEFAULT, ...next.state };
        update();
      } else {
        book.current = null;
        newRandomHero();
      }
    } else update();
  }

  function reloadTables(): void {
    tables = withCustom();
    if (prefs.noBuiltin && (!tables.races.length || !tables.classes.length)) {
      prefs.noBuiltin = false;
      savePrefs();
      tables = withCustom();
      customInfo.error =
        "Keep the built-in content for now — load a pack with its own race and class before removing it.";
    }
    RACES = byId(tables.races);
    CLASSES = byId(tables.classes);
    const hero = currentHero();
    if (hero?.edited && (!RACES[state.race] || !CLASSES[state.cls])) {
      status("That hero doesn't fit the new content — it's safe in Saved heroes, so here's a fresh one.");
      newRandomHero();
      return;
    }
    update();
  }

  function request(): HeroRequest {
    return {
      name: state.name || "Hero",
      race: state.race,
      cls: state.cls,
      subclass: state.subclass,
      level: state.level,
      choices: Object.entries(state.choices).map(([group, picks]) => ({ group, picks })),
      cantrips: state.cantrips,
      spells: state.spells,
      path_spells: state.path_spells,
      items: state.items,
      item_seed: state.item_seed,
      base_scores: state.base_scores,
      subrace: state.subrace,
      weapon: state.weapon,
      race_asi: state.race_asi,
      armor: state.armor,
      shield: state.shield,
      inventory: state.inventory,
      notes: state.notes || "",
      portrait: state.portrait,
      portrait_credit: state.portrait ? state.portrait_credit : null,
    };
  }

  function tidy(): HeroOptions {
    const firstRace = tables.races[0];
    const firstClass = tables.classes[0];
    const rules = tables.rules[0];
    if (!firstRace || !firstClass || !rules) throw new Error("the ruleset has no race, class, or rules row");
    if (!RACES[state.race]) state.race = firstRace.id;
    if (!CLASSES[state.cls]) state.cls = firstClass.id;
    const subs = tables.subclasses.filter((row) => row.class_id === state.cls);
    if (!subs.some((row) => row.id === state.subclass)) state.subclass = subs[0]?.id ?? null;
    state.level = Math.min(Math.max(1, state.level | 0), rules.max_level);
    const built = options(tables, request());
    const choices: Record<string, string[]> = {};
    for (const group of built.groups) {
      const names = group.options.map((option) => option.name);
      const picks = (state.choices[group.group] || []).filter((name) => names.includes(name));
      for (const name of names) {
        if (picks.length >= group.count) break;
        if (!picks.includes(name)) picks.push(name);
      }
      choices[group.group] = picks.slice(0, group.count);
    }
    state.choices = choices;
    if (state.cantrips)
      state.cantrips = state.cantrips.filter((name) => built.cantripPool.includes(name)).slice(0, built.nCan);
    if (state.spells) state.spells = state.spells.filter((name) => built.spellPool.includes(name)).slice(0, built.nSp);
    if (state.path_spells) state.path_spells = state.path_spells.filter((name) => built.anyPool.includes(name));
    if (state.subrace && !built.subraces.some((row) => row.id === state.subrace)) state.subrace = null;
    if (state.armor && !built.armorOptions.some((armor) => armor.name === state.armor)) state.armor = null;
    if (state.weapon && !built.weaponOptions.some((weapon) => weapon.name === state.weapon)) state.weapon = null;
    if (state.shield && !built.shieldProf) state.shield = null;
    if (state.items)
      state.items = state.items.filter((name) => built.itemPool.includes(name)).slice(0, built.itemSlots);
    if (!built.caster) {
      state.cantrips = null;
      state.spells = null;
      state.path_spells = null;
      if (picker && picker.kind !== "items") picker = null;
    }
    return built;
  }

  function chipRow<T extends string | number>(
    items: Chip<T>[],
    current: T | null,
    onPick: (id: T) => void,
    opts?: { big?: boolean },
  ): HTMLElement {
    return el(
      "div",
      { class: "chips", role: "group" },
      items.map((item) => {
        const button = el(
          "button",
          {
            type: "button",
            class: `chip-btn${item.id === current ? " on" : ""}${opts?.big ? " big" : ""}`,
            "aria-pressed": item.id === current ? "true" : "false",
            style: item.color ? `--c:${item.color}` : null,
            onclick: () => onPick(item.id),
          },
          item.label,
        );
        return item.tip ? tipped(button, item.tip) : button;
      }),
    );
  }

  const TIPS = new WeakMap<Node, () => Tip | null>();
  const ABN: Record<Ability, string> = {
    STR: "Strength",
    DEX: "Dexterity",
    CON: "Constitution",
    INT: "Intelligence",
    WIS: "Wisdom",
    CHA: "Charisma",
  };

  function fresh(over: Partial<HeroRequest>): HeroRequest {
    return {
      ...request(),
      choices: [],
      cantrips: null,
      spells: null,
      path_spells: null,
      items: null,
      armor: null,
      shield: null,
      inventory: null,
      ...over,
    };
  }

  function tryBuild(over: Partial<HeroRequest>): Character | null {
    try {
      return buildCharacter(tables, fresh(over));
    } catch (error) {
      if (error instanceof CharError) return null;
      throw error;
    }
  }

  function asiText(asi: AbilityScores | null | undefined): string {
    if (!asi) return "";
    return ABILITIES.filter((ability) => asi[ability])
      .map((ability) => `${asi[ability] > 0 ? "+" : ""}${asi[ability]} ${ABN[ability]}`)
      .join(", ");
  }

  function cardLines(ch: Character | null, pred: (card: SheetCard) => boolean): [string, string][] {
    return ch ? ch.cards.filter(pred).map((card) => [card.name, card.desc]) : [];
  }

  const TIP = {
    race(id: string): Tip {
      const race = raceBy(id);
      const srs = tables.subraces.filter((row) => row.race_id === id);
      const sr = srs[0];
      const asi: AbilityScores = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };
      for (const ability of ABILITIES) asi[ability] = (race.asi[ability] || 0) + (sr?.asi[ability] || 0);
      const ch = tryBuild({ race: id, subrace: null });
      const lines: [string | null, string][] = [
        [null, [asiText(asi), `speed ${race.speed + (sr ? sr.speed : 0)} ft`].filter(Boolean).join(" • ")],
      ];
      if (sr) {
        lines.push([
          null,
          `Usually a ${sr.name}${
            srs.length > 1
              ? ` (others: ${srs
                  .slice(1)
                  .map((row) => row.name)
                  .join(", ")} — pick at the bottom)`
              : ""
          }`,
        ]);
      }
      return { title: race.name, lines: lines.concat(cardLines(ch, (card) => card.section === `${race.name} Stuff`)) };
    },
    subrace(id: string): Tip {
      const sr = tables.subraces.find((row) => row.id === id);
      if (!sr) throw new Error(`unknown subrace ${id}`);
      const base = raceBy(sr.race_id);
      const ch = tryBuild({ race: sr.race_id, subrace: id });
      const own = new Set(
        tables.features
          .filter((feature) => feature.owner_kind === "subrace" && feature.owner_id === id)
          .map((feature) => feature.card.name),
      );
      const bits = [
        asiText(sr.asi),
        sr.speed ? `+${sr.speed} ft speed` : "",
        sr.hp_per_level ? `+${sr.hp_per_level} HP per level` : "",
        sr.armor_prof_add.length ? `${sr.armor_prof_add.join(" & ")} armor training` : "",
        sr.skills.length ? `trained in ${sr.skills.join(", ")}` : "",
      ].filter(Boolean);
      return {
        title: sr.name,
        lines: [
          [null, `On top of the ${base.name} basics: ${bits.join(", ") || "no number changes"}`] as [
            string | null,
            string,
          ],
        ].concat(cardLines(ch, (card) => own.has(card.name))),
      };
    },
    cls(id: string): Tip {
      const cls = classBy(id);
      const ch = tryBuild({ cls: id, subclass: null });
      const arm = cls.armor_prof.length
        ? `${cls.armor_prof.join(", ")} armor${cls.shield_prof ? " + shields" : ""}`
        : cls.shield_prof
          ? "shields"
          : "no armor";
      const lines: [string | null, string][] = [
        [null, cls.look.tagline],
        [
          null,
          `d${cls.hit_die} hit die • ${arm} • good at ${cls.primary
            .slice(0, 2)
            .map((ability) => ABN[ability])
            .join(" & ")}`,
        ],
      ];
      if (cls.caster.ability && isAbility(cls.caster.ability))
        lines.push([null, `Casts spells with ${ABN[cls.caster.ability]}`]);
      if (ch) {
        lines.push([
          `At level ${ch.identity.level}`,
          ch.cards
            .filter((card) => card.section === `${cls.name} Powers`)
            .map((card) => card.name)
            .join(", ") || "—",
        ]);
      }
      return { title: cls.name, lines };
    },
    sub(id: string): Tip {
      const sub = tables.subclasses.find((row) => row.id === id);
      if (!sub) throw new Error(`unknown subclass ${id}`);
      const cls = classBy(sub.class_id);
      const lvl = Math.max(state.level, cls.subclass_level);
      const ch = tryBuild({ cls: sub.class_id, subclass: id, level: lvl });
      const rules = tables.rules[0];
      const later = tables.features.filter(
        (feature) =>
          feature.owner_kind === "subclass" &&
          feature.owner_id === id &&
          feature.lvl > lvl &&
          rules &&
          feature.lvl <= rules.max_level,
      );
      const lines: [string | null, string][] =
        state.level < cls.subclass_level
          ? [[null, `Unlocks at level ${cls.subclass_level}. At that level you get:`]]
          : [];
      const spells = sub.auto_spells.filter((entry) => entry.lvl <= lvl).map((entry) => entry.spell);
      const pathLines = cardLines(ch, (card) => card.section === sub.name);
      if (spells.length) pathLines.push(["Bonus spells", spells.join(", ")]);
      if (later.length)
        pathLines.push(["Later", later.map((feature) => `${feature.card.name} (level ${feature.lvl})`).join(", ")]);
      return { title: sub.name, lines: lines.concat(pathLines) };
    },
    level(n: number): Tip | null {
      const now = tryBuild({ level: n });
      const prev = n > 1 ? tryBuild({ level: n - 1 }) : null;
      if (!now) return null;
      const lines: [string | null, string][] = [
        [
          null,
          `${now.combat.max_hp} HP • +${now.combat.prof} proficiency${prev ? ` (${now.combat.max_hp - prev.combat.max_hp} more HP than level ${n - 1})` : ""}`,
        ],
      ];
      if (prev) {
        const had = new Set(prev.cards.map((card) => card.name));
        const freshCards = now.cards
          .filter((card) => !had.has(card.name) && card.section !== "Potions & Magic Items")
          .map((card) => card.name);
        if (freshCards.length) lines.push(["New", freshCards.join(", ")]);
        const top = (ch: Character) =>
          ch.spellcasting ? Math.max(0, ...ch.spellcasting.slots.map((slot) => slot.level)) : 0;
        if (now.spellcasting && top(now) > top(prev)) lines.push(["Spells", `level ${top(now)} spells open up`]);
        for (const ability of now.abilities) {
          const before = prev.abilities.find((row) => row.key === ability.key);
          if (before && ability.score > before.score)
            lines.push(["Stat boost", `${ABN[ability.key]} ${before.score} → ${ability.score}`]);
        }
      }
      return { title: `Level ${n}`, lines };
    },
    armor(armor: HeroOptions["armorOptions"][number]): Tip {
      const row = tables.armor.find((item) => item.name === armor.name);
      const how = !row
        ? "your natural defense, no armor to carry"
        : `${row.base}${row.dex_cap === 0 ? ", Dexterity doesn't help" : row.dex_cap >= 10 ? " + Dexterity" : ` + Dexterity, max +${row.dex_cap}`}`;
      const lines: [string | null, string][] = [
        [
          row ? `${row.kind[0]?.toUpperCase() ?? ""}${row.kind.slice(1)} armor` : "Nothing worn",
          `Armor ${armor.ac} for you (${how})`,
        ],
      ];
      if (armor.strReq) lines.push(["Strength", `Needs Strength ${armor.strReq}, or you move 10 ft slower`]);
      return { title: armor.name, lines };
    },
  };

  function tipped<T extends HTMLElement>(node: T, fn: () => Tip | null): T {
    TIPS.set(node, fn);
    node.classList.add("has-tip");
    return node;
  }

  const tipBox = (() => {
    let box: HTMLElement | null = null;
    return () => {
      if (!box) box = document.body.appendChild(el("div", { id: "tip", role: "tooltip", hidden: true }));
      return box;
    };
  })();
  let tipFor: Node | null = null;
  let tipTimer = 0;
  let holdFired = false;

  function showTip(node: Node): void {
    const fn = TIPS.get(node);
    let tip: Tip | null = null;
    try {
      tip = fn ? fn() : null;
    } catch (error) {
      if (!(error instanceof CharError)) throw error;
      tip = null;
    }
    if (!tip) return;
    const box = tipBox();
    box.replaceChildren(
      el("b", { class: "tt" }, tip.title),
      ...tip.lines
        .filter((line) => line[1])
        .map(([label, text]) => el("p", {}, label ? el("b", {}, `${label}: `) : null, text)),
    );
    box.hidden = false;
    tipFor = node;
    if (!(node instanceof Element)) return;
    const rect = node.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 32);
    box.style.width = `${width}px`;
    const left = Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 16));
    const height = box.offsetHeight;
    const below = rect.bottom + 8 + height < window.innerHeight || rect.top - 8 - height < 0;
    box.style.left = `${left}px`;
    box.style.top = `${below ? rect.bottom + 8 : rect.top - 8 - height}px`;
  }

  function hideTip(): void {
    clearTimeout(tipTimer);
    if (!tipFor) return;
    tipBox().hidden = true;
    tipFor = null;
  }

  function tipTarget(ev: Event): HTMLElement | null {
    if (!(ev.target instanceof Element)) return null;
    const node = ev.target.closest(".has-tip");
    return node instanceof HTMLElement && TIPS.has(node) ? node : null;
  }

  document.addEventListener("pointerover", (ev) => {
    if (ev.pointerType === "touch") return;
    const node = tipTarget(ev);
    if (node === tipFor) return;
    clearTimeout(tipTimer);
    if (!node) {
      tipTimer = window.setTimeout(hideTip, 120);
      return;
    }
    tipTimer = window.setTimeout(() => showTip(node), tipFor ? 0 : 350);
  });
  document.addEventListener("pointerdown", (ev) => {
    holdFired = false;
    if (ev.pointerType !== "touch" && ev.pointerType !== "pen") {
      hideTip();
      return;
    }
    const node = tipTarget(ev);
    hideTip();
    if (node)
      tipTimer = window.setTimeout(() => {
        holdFired = true;
        showTip(node);
      }, 450);
  });
  for (const name of ["pointerup", "pointercancel"]) {
    document.addEventListener(name, () => {
      if (!holdFired) clearTimeout(tipTimer);
    });
  }
  document.addEventListener(
    "pointermove",
    (ev) => {
      if (ev.pointerType === "touch" && !holdFired) clearTimeout(tipTimer);
    },
    { passive: true },
  );
  document.addEventListener(
    "click",
    (ev) => {
      if (!holdFired) return;
      holdFired = false;
      ev.preventDefault();
      ev.stopPropagation();
    },
    true,
  );
  document.addEventListener("contextmenu", (ev) => {
    if (tipTarget(ev)) ev.preventDefault();
  });
  document.addEventListener("focusin", (ev) => {
    const node = tipTarget(ev);
    if (node?.matches(":focus-visible")) showTip(node);
    else if (!node) hideTip();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hideTip();
  });
  window.addEventListener("scroll", hideTip, true);

  function field(label: string, control: Node, hint?: Kid | Kid[]): HTMLElement {
    return el(
      "div",
      { class: "field" },
      el("div", { class: "flabel" }, label, hint ? el("span", { class: "hint" }, hint) : null),
      control,
    );
  }

  function shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = out[i];
      const b = out[j];
      if (a === undefined || b === undefined) continue;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }

  const dice = (label: string, fn: () => void) =>
    el(
      "button",
      { type: "button", class: "dice", title: `Random ${label}`, "aria-label": `Random ${label}`, onclick: fn },
      "🎲",
    );

  let liveDesc: Record<string, string> = {};
  let picker: Picker | null = null;
  const TAGLBL: Record<string, string> = { A: "Action", B: "Bonus", R: "Reaction", ON: "Always on", F: "Free" };

  function optionTexts(kind: ListKind, current: string[], index: number, names: string[]): Record<string, SheetCard> {
    const out: Record<string, SheetCard> = {};
    for (const name of names) {
      const arr = current.slice();
      if (index < 0) arr.push(name);
      else arr[index] = name;
      try {
        const ch = buildCharacter(tables, { ...request(), [kind]: arr });
        const card = ch.cards.find((item) => item.name === name);
        if (card) out[name] = card;
      } catch (error) {
        if (!(error instanceof CharError)) throw error;
      }
    }
    return out;
  }

  function setList(kind: ListKind, arr: string[] | null): void {
    state[kind] = arr;
  }

  function pickerPanel(
    kind: ListKind,
    built: HeroOptions,
    current: string[],
    index: number,
    poolOverride?: string[],
    exclude?: string[],
  ): HTMLElement {
    const isCantrip = kind === "cantrips";
    const isItem = kind === "items";
    const pool = poolOverride || (isItem ? built.itemPool : isCantrip ? built.cantripPool : built.spellPool);
    const taken = new Set(current.filter((_, i) => i !== index).concat(exclude ?? []));
    const names = pool.filter((name) => !taken.has(name));
    const texts = optionTexts(kind, current, index, names);
    const groups = new Map<string, string[]>();
    for (const name of names) {
      const rarity = built.itemRarity(name);
      const key = isItem
        ? ({ rare: "1 Rare", uncommon: "2 Uncommon", common: "3 Common" }[rarity] ?? "4")
        : isCantrip
          ? "Cantrips"
          : `Level ${built.spellLevel(name)}`;
      const list = groups.get(key) ?? [];
      list.push(name);
      groups.set(key, list);
    }
    const choose = (name: string) => {
      const arr = current.slice();
      if (index < 0) arr.push(name);
      else arr[index] = name;
      picker = null;
      setList(kind, arr);
      update();
    };
    const close = () => {
      picker = null;
      update();
    };
    const what = isItem ? "potion or item" : isCantrip ? "cantrip" : "spell";
    return el(
      "div",
      { class: "picker", role: "dialog", "aria-label": `Choose a ${what}` },
      el(
        "div",
        { class: "phead" },
        el("b", {}, index < 0 ? `Add a ${what}` : `Swap ${current[index]} for…`),
        el("button", { type: "button", class: "icon", "aria-label": "Close", onclick: close }, "✕"),
      ),
      [...groups]
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
        .map(([group, list]) =>
          el(
            "div",
            { class: "pgroup" },
            isCantrip ? null : el("div", { class: "plvl" }, isItem ? group.slice(2) : `${group} spells`),
            el(
              "div",
              { class: "popts" },
              list.map((name) => {
                const card = texts[name] ||
                  (isItem ? built.itemCard(name) : built.spellCard(name)) || { desc: "", tag: "", note: "" };
                const currentName = index >= 0 && current[index] === name;
                return el(
                  "button",
                  {
                    type: "button",
                    class: `popt${currentName ? " on" : ""}`,
                    "aria-pressed": currentName ? "true" : "false",
                    onclick: () => choose(name),
                  },
                  el(
                    "span",
                    { class: "ptop" },
                    el("b", {}, name),
                    card.tag ? el("span", { class: `ptag t${card.tag}` }, TAGLBL[card.tag] || card.tag) : null,
                    card.note ? el("span", { class: "pnote" }, card.note) : null,
                  ),
                  el("span", { class: "pdesc" }, (card.desc || "").replace(/\{[A-Z0-9_]+\}/g, "…")),
                  isItem && built.itemWarn(name) ? el("span", { class: "pwarn" }, `⚠ ${built.itemWarn(name)}`) : null,
                );
              }),
            ),
          ),
        ),
    );
  }

  function spellList(kind: SpellKind, built: HeroOptions): HTMLElement | null {
    const isCantrip = kind === "cantrips";
    const max = isCantrip ? built.nCan : built.nSp;
    const pool = isCantrip ? built.cantripPool : built.spellPool;
    if (!max && !(isCantrip ? built.bonusCantrips.length : built.bookAuto.length || (state.path_spells || []).length))
      return null;
    const current = state[kind] || built.defaults[kind].slice();
    const set = (arr: string[] | null) => {
      picker = null;
      setList(kind, arr);
      update();
    };
    const open = (index: number) => {
      picker = picker && picker.kind === kind && picker.index === index ? null : { kind, index };
      update();
    };
    const items: HTMLElement[] = [];
    if (isCantrip) {
      for (const name of built.bonusCantrips.filter((item) => !current.includes(item))) {
        items.push(
          el(
            "li",
            { class: "spell locked" },
            el(
              "div",
              { class: "sname" },
              el("b", {}, name),
              el("small", {}, liveDesc[name] || ""),
              el("span", { class: "swaphint" }, "from your path"),
            ),
          ),
        );
      }
    } else {
      const pathCur = state.path_spells || built.bookAuto.slice();
      const setPath = (arr: string[]) => {
        picker = null;
        state.path_spells = arr;
        update();
      };
      pathCur.forEach((name, i) => {
        const isOpen = picker?.kind === "path_spells" && picker.index === i;
        const book = built.bookAuto.includes(name);
        items.push(
          el(
            "li",
            { class: `spell locked${isOpen ? " open" : ""}${book ? "" : " offbook"}` },
            el(
              "button",
              {
                type: "button",
                class: "sname",
                "aria-expanded": isOpen ? "true" : "false",
                onclick: () => {
                  picker = isOpen ? null : { kind: "path_spells", index: i };
                  update();
                },
              },
              el("b", {}, name),
              el("span", { class: "lvl" }, `L${built.spellLevel(name)}`),
              el("small", {}, liveDesc[name] || (built.spellCard(name)?.desc || "").replace(/\{[A-Z0-9_]+\}/g, "…")),
              el("span", { class: "swaphint" }, book ? "path spell • swap ▾" : "off book • swap ▾"),
            ),
            dice(name, () => {
              const free = built.anyPool.filter((item) => !pathCur.includes(item) && !current.includes(item));
              if (!free.length) return;
              const arr = pathCur.slice();
              arr[i] = pick(free);
              setPath(arr);
            }),
            el(
              "button",
              {
                type: "button",
                class: "icon",
                title: "Remove",
                "aria-label": `Remove ${name}`,
                onclick: () => setPath(pathCur.filter((_, j) => j !== i)),
              },
              "✕",
            ),
          ),
        );
        if (isOpen)
          items.push(
            el("li", { class: "pwrap" }, pickerPanel("path_spells", built, pathCur, i, built.anyPool, current)),
          );
      });
    }
    current.forEach((name, i) => {
      const isOpen = picker?.kind === kind && picker.index === i;
      items.push(
        el(
          "li",
          { class: `spell${isOpen ? " open" : ""}` },
          el(
            "button",
            {
              type: "button",
              class: "sname",
              "aria-expanded": isOpen ? "true" : "false",
              title: "Click to see other choices",
              onclick: () => open(i),
            },
            el("b", {}, name),
            isCantrip ? null : el("span", { class: "lvl" }, `L${built.spellLevel(name)}`),
            el("small", {}, liveDesc[name] || (built.spellCard(name)?.desc || "").replace(/\{[A-Z0-9_]+\}/g, "…")),
            el("span", { class: "swaphint" }, isOpen ? "close" : "swap ▾"),
          ),
          dice(name, () => {
            const free = pool.filter((item) => !current.includes(item) && !built.auto.includes(item));
            if (!free.length) return;
            const arr = current.slice();
            arr[i] = pick(free);
            set(arr);
          }),
          el(
            "button",
            {
              type: "button",
              class: "icon",
              title: "Remove",
              "aria-label": `Remove ${name}`,
              onclick: () => set(current.filter((_, j) => j !== i)),
            },
            "✕",
          ),
        ),
      );
      if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel(kind, built, current, i)));
    });
    const freeLeft = pool.filter((name) => !current.includes(name)).length;
    if (current.length < max && freeLeft) {
      const isOpen = picker?.kind === kind && picker.index === -1;
      items.push(
        el(
          "li",
          {},
          el(
            "button",
            { type: "button", class: "addbtn", "aria-expanded": isOpen ? "true" : "false", onclick: () => open(-1) },
            `+ add ${isCantrip ? "a cantrip" : "a spell"} (${max - current.length} left)`,
          ),
        ),
      );
      if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel(kind, built, current, -1)));
    }
    const reset = el(
      "button",
      {
        type: "button",
        class: "link",
        onclick: () => {
          if (!isCantrip) state.path_spells = null;
          set(null);
        },
      },
      "reset",
    );
    const pathCur = state.path_spells || built.bookAuto;
    const offBook =
      !isCantrip && (pathCur.length !== built.bookAuto.length || pathCur.some((name, i) => name !== built.bookAuto[i]));
    const gone = built.bookAuto.filter((name) => !pathCur.includes(name));
    const added = pathCur.filter((name) => !built.bookAuto.includes(name));
    const what = [
      added.length
        ? `${added.join(", ")} instead of the book's path spell${gone.length > 1 ? "s " : " "}${gone.join(", ") || ""}`
        : "",
      !added.length && gone.length ? `dropped the path spell${gone.length > 1 ? "s " : " "}${gone.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    if (offBook) {
      items.unshift(
        el(
          "li",
          { class: "offnote" },
          `⚠ Going off book: ${what}. Check with your DM. `,
          el(
            "button",
            {
              type: "button",
              class: "link",
              onclick: () => {
                state.path_spells = null;
                picker = null;
                update();
              },
            },
            "back to the book",
          ),
        ),
      );
    }
    const allDice = dice(isCantrip ? "cantrips" : "spells", () => {
      set(shuffle(pool.filter((name) => !built.auto.includes(name))).slice(0, max));
    });
    return field(isCantrip ? "Cantrips" : "Spells", el("ul", { class: "spells" }, items), [
      `${current.length} of ${max} picked `,
      reset,
      " ",
      allDice,
    ]);
  }

  function isAbility(value: string): value is Ability {
    return (ABILITIES as readonly string[]).includes(value);
  }

  function pointCost(n: number, pb: HeroOptions["pointBuy"]): number | null {
    if (!pb || n < pb.low || n >= pb.low + pb.costs.length) return null;
    return pb.costs[n - pb.low] ?? null;
  }

  function abilityField(built: HeroOptions): HTMLElement {
    const base: AbilityScores = { ...(state.base_scores ?? built.defaultBase) };
    const ch = buildCharacter(tables, request());
    const fin = Object.fromEntries(ch.abilities.map((ability) => [ability.key, ability])) as Record<
      Ability,
      Character["abilities"][number]
    >;
    const rasi: AbilityScores = { ...(state.race_asi ?? built.raceAsi) };
    const rTotal = ABILITIES.reduce((sum, ability) => sum + rasi[ability], 0);
    const usualTotal = ABILITIES.reduce((sum, ability) => sum + built.raceAsi[ability], 0);
    const pb = built.pointBuy;
    let total = 0;
    let offChart = false;
    const set = (key: Ability, n: number) => {
      base[key] = Math.max(3, Math.min(18, n));
      state.base_scores = { ...base };
      update();
    };
    const rows = ABILITIES.map((key) => {
      const cost = pointCost(base[key], pb);
      if (cost === null) offChart = true;
      else total += cost;
      const rb = rasi[key] || 0;
      const lvlUp = fin[key].score - base[key] - rb;
      const sg = (n: number) => (n >= 0 ? `+${n}` : String(n));
      const setR = (n: number) => {
        const next = { ...rasi };
        next[key] = Math.max(0, Math.min(3, n));
        state.race_asi = next;
        update();
      };
      return el(
        "div",
        { class: "abrow" },
        el("span", { class: "abname", title: ABN[key] }, el("span", { class: "abshort" }, key)),
        el(
          "button",
          {
            type: "button",
            class: "step",
            "aria-label": `Lower ${ABN[key]}`,
            onclick: () => set(key, base[key] - 1),
            disabled: base[key] <= 3,
          },
          "−",
        ),
        el("b", { class: "abbase", "aria-label": `${ABN[key]} ${base[key]}` }, String(base[key])),
        el(
          "button",
          {
            type: "button",
            class: "step",
            "aria-label": `Raise ${ABN[key]}`,
            onclick: () => set(key, base[key] + 1),
            disabled: base[key] >= 18,
          },
          "+",
        ),
        el(
          "button",
          {
            type: "button",
            class: "step mini",
            "aria-label": `Lower race bonus for ${ABN[key]}`,
            onclick: () => setR(rb - 1),
            disabled: rb <= 0,
          },
          "−",
        ),
        el("span", { class: "abbonus" }, rb ? sg(rb) : "0"),
        el(
          "button",
          {
            type: "button",
            class: "step mini",
            "aria-label": `Raise race bonus for ${ABN[key]}`,
            onclick: () => setR(rb + 1),
            disabled: rb >= 3,
          },
          "+",
        ),
        el("span", { class: "abfinal" }, `${fin[key].score} (${sg(fin[key].mod)})${lvlUp ? " ↑" : ""}`),
        el("span", { class: "abcost" }, cost === null ? "—" : `${cost} pt`),
      );
    });
    const over = pb && !offChart && total !== pb.budget;
    const summary = pb
      ? el(
          "p",
          { class: `pbline${offChart || over ? " warn" : ""}` },
          offChart
            ? "Point buy: some scores are outside 8–15, so this is off the point-buy chart. Talk to your DM about stat rules — most DMs are fine with point buy."
            : `Point buy: ${total} of ${pb.budget} points${total > pb.budget ? " (over budget — talk to your DM about stat rules; most DMs are fine with point buy)" : total < pb.budget ? ` (${pb.budget - total} to spend)` : " ✓"}`,
        )
      : null;
    const reset = el(
      "button",
      {
        type: "button",
        class: "link",
        onclick: () => {
          state.base_scores = null;
          state.race_asi = null;
          update();
        },
      },
      "reset",
    );
    const roll = dice("stats", () => {
      const vals = ABILITIES.map((ability) => built.defaultBase[ability]).sort((a, b) => b - a);
      const keys = shuffle(ABILITIES);
      const next: AbilityScores = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
      keys.forEach((key, i) => {
        const value = vals[i];
        if (value !== undefined) next[key] = value;
      });
      state.base_scores = next;
      update();
    });
    const levelBoost = ch.abilities.some(
      (ability) => ability.score - base[ability.key] - (rasi[ability.key] || 0) !== 0,
    );
    return field(
      "Ability scores",
      el(
        "div",
        { class: "abgrid" },
        el(
          "div",
          { class: "abrow abhead" },
          el("span", {}, ""),
          el("span", {}, ""),
          el("span", {}, "base"),
          el("span", {}, ""),
          el("span", {}, ""),
          el("span", {}, "race"),
          el("span", {}, ""),
          el("span", {}, "final"),
          el("span", {}, "cost"),
        ),
        rows,
        summary,
        el(
          "p",
          { class: `pbline${rTotal !== usualTotal ? " warn" : ""}` },
          "Race bonus: put it wherever you like (newer rules let you pick). ",
          state.race_asi
            ? `Adds up to +${rTotal}${rTotal !== usualTotal ? ` (usual is +${usualTotal} — check with your DM)` : ""}. `
            : "",
          state.race_asi
            ? el(
                "button",
                {
                  type: "button",
                  class: "link",
                  onclick: () => {
                    state.race_asi = null;
                    update();
                  },
                },
                "usual race bonus",
              )
            : null,
        ),
        levelBoost ? el("p", { class: "hint block" }, "↑ includes level-up boosts.") : null,
      ),
      [state.base_scores || state.race_asi ? "" : "default • ", reset, " ", roll],
    );
  }

  function armorField(built: HeroOptions): HTMLElement {
    const cur = buildCharacter(tables, request()).combat;
    const curName = cur.armor.replace(/ \+ shield$/, "");
    const groups: [string, string][] = [
      ["none", "None"],
      ["light", "Light"],
      ["medium", "Medium"],
      ["heavy", "Heavy"],
    ];
    const ch = buildCharacter(tables, request());
    const str = ch.abilities.find((ability) => ability.key === "STR")?.score ?? 10;
    const rows = groups.map(([kind, label]) => {
      const opts = built.armorOptions.filter((armor) => armor.kind === kind);
      if (!opts.length) return null;
      return el(
        "div",
        { class: "armrow" },
        el("span", { class: "armkind" }, label),
        el(
          "div",
          { class: "chips" },
          opts.map((armor, i) =>
            tipped(
              el(
                "button",
                {
                  type: "button",
                  class: `chip-btn${armor.name === curName ? " on" : ""}`,
                  "aria-pressed": armor.name === curName ? "true" : "false",
                  onclick: () => {
                    state.armor = armor.name;
                    update();
                  },
                },
                `${armor.name} • ${armor.ac}${armor.strReq > str ? " ⚠" : ""}`,
              ),
              () => TIP.armor(opts[i] ?? armor),
            ),
          ),
        ),
      );
    });
    const shielded = /\+ shield$/.test(cur.armor);
    const shieldBtn = built.shieldProf
      ? el(
          "button",
          {
            type: "button",
            class: `chip-btn${shielded ? " on" : ""}`,
            "aria-pressed": shielded ? "true" : "false",
            onclick: () => {
              state.shield = !shielded;
              const held = built.weaponOptions.find((weapon) => weapon.name === state.weapon);
              if (state.shield && held?.hands === "two") state.weapon = null;
              update();
            },
          },
          "Shield +2",
        )
      : null;
    if (shieldBtn)
      tipped(shieldBtn, () => ({
        title: "Shield",
        lines: [[null, "+2 Armor. Takes up one hand while you carry it."]],
      }));
    const reset = el(
      "button",
      {
        type: "button",
        class: "link",
        onclick: () => {
          state.armor = null;
          state.shield = null;
          update();
        },
      },
      "reset",
    );
    return field(
      "Armor",
      el(
        "div",
        { class: "armgrid" },
        rows,
        shieldBtn
          ? el(
              "div",
              { class: "armrow" },
              el("span", { class: "armkind" }, "Shield"),
              el("div", { class: "chips" }, shieldBtn),
            )
          : null,
        el(
          "p",
          { class: "hint block" },
          `Armor ${cur.ac} with ${cur.armor.toLowerCase()}. Numbers show the Armor each choice gives (shield not included).`,
        ),
      ),
      [state.armor || state.shield != null ? "" : "default • ", reset],
    );
  }

  function weaponField(built: HeroOptions): HTMLElement | null {
    if (built.weaponOptions.length < 2) return null;
    const attacks = buildCharacter(tables, request()).attacks;
    const curName =
      attacks.find((attack) => built.weaponOptions.some((weapon) => weapon.name === attack.name))?.name ||
      built.weaponDefault;
    const rows = (
      [
        ["one", "One hand"],
        ["two", "Two hands"],
      ] as const
    ).map(([hands, label]) => {
      const opts = built.weaponOptions.filter((weapon) => weapon.hands === hands);
      if (!opts.length) return null;
      return el(
        "div",
        { class: "armrow" },
        el("span", { class: "armkind" }, label),
        el(
          "div",
          { class: "chips" },
          opts.map((weapon) =>
            tipped(
              el(
                "button",
                {
                  type: "button",
                  class: `chip-btn${weapon.name === curName ? " on" : ""}`,
                  "aria-pressed": weapon.name === curName ? "true" : "false",
                  onclick: () => {
                    state.weapon = weapon.name;
                    if (weapon.hands === "two") state.shield = false;
                    else if (state.shield === false && !state.armor) state.shield = null;
                    update();
                  },
                },
                `${weapon.name} • ${weapon.damage}`,
              ),
              () => ({
                title: weapon.name,
                lines: [
                  [
                    weapon.hands === "two" ? "Two hands" : "One hand",
                    weapon.hands === "two" ? "No shield with this one." : "Leaves a hand free for a shield.",
                  ],
                  [null, `Hits for ${weapon.damage}${weapon.note ? ` • ${weapon.note}` : ""}`],
                  [null, weapon.cat === "martial" ? "A warrior's weapon" : "A simple weapon"],
                ],
              }),
            ),
          ),
        ),
      );
    });
    const reset = el(
      "button",
      {
        type: "button",
        class: "link",
        onclick: () => {
          state.weapon = null;
          update();
        },
      },
      "reset",
    );
    return field(
      "Main weapon",
      el(
        "div",
        { class: "armgrid" },
        rows,
        el("p", { class: "hint block" }, "Without a shield, heroes grab a two-handed weapon when it hits harder."),
      ),
      [state.weapon ? "" : "default • ", reset],
    );
  }

  function subraceField(built: HeroOptions): HTMLElement | null {
    const first = built.subraces[0];
    if (!first || built.subraces.length < 2) return null;
    return field(
      "Subrace",
      chipRow(
        built.subraces.map((row) => ({
          id: row.id,
          label: row.name + (customInfo.ids.has(`subraces:${row.id}`) ? " ✦" : ""),
          tip: () => TIP.subrace(row.id),
        })),
        built.subrace,
        (id) => {
          state.subrace = id;
          state.armor = null;
          state.race_asi = null;
          update();
        },
      ),
      built.subrace === first.id ? "the usual one" : "",
    );
  }

  function advanced(built: HeroOptions): HTMLElement {
    const details = el(
      "details",
      {
        class: "adv",
        ontoggle: (ev) => {
          if (ev.target instanceof HTMLDetailsElement) prefs.adv = ev.target.open;
          savePrefs();
        },
      },
      el(
        "summary",
        {},
        "Fine-tune: armor, weapon, ability scores & subrace",
        el("span", { class: "hint" }, "The defaults are usually fine, but you can change all of these."),
      ),
      armorField(built),
      weaponField(built),
      abilityField(built),
      subraceField(built),
    );
    if (prefs.adv) details.open = true;
    return details;
  }

  function warnBtn(text: string): HTMLButtonElement {
    const button = el(
      "button",
      {
        type: "button",
        class: "icon warn",
        "aria-label": text,
        onclick: (ev) => {
          ev.stopPropagation();
          showTip(button);
        },
      },
      "⚠",
    );
    return tipped(button, () => ({ title: "Check with your DM", lines: [[null, text]] }));
  }

  function itemList(built: HeroOptions): HTMLElement | null {
    const max = built.itemSlots;
    if (!max) return null;
    const current = (state.items || built.defaultItems).slice();
    const set = (arr: string[] | null) => {
      picker = null;
      state.items = arr;
      update();
    };
    const items: HTMLElement[] = [];
    current.forEach((name, i) => {
      const isOpen = picker?.kind === "items" && picker.index === i;
      items.push(
        el(
          "li",
          { class: `spell${isOpen ? " open" : ""}` },
          el(
            "button",
            {
              type: "button",
              class: "sname",
              "aria-expanded": isOpen ? "true" : "false",
              onclick: () => {
                picker = isOpen ? null : { kind: "items", index: i };
                update();
              },
            },
            el("b", {}, name),
            el("span", { class: "lvl" }, built.itemRarity(name)),
            el("small", {}, liveDesc[name] || built.itemCard(name)?.desc || ""),
            el("span", { class: "swaphint" }, isOpen ? "close" : "swap ▾"),
          ),
          built.itemWarn(name) ? warnBtn(built.itemWarn(name)) : null,
          dice(name, () => {
            const free = built.itemPool.filter((item) => !current.includes(item) && !built.itemWarn(item));
            if (!free.length) return;
            const arr = current.slice();
            arr[i] = pick(free);
            set(arr);
          }),
          el(
            "button",
            {
              type: "button",
              class: "icon",
              title: "Remove",
              "aria-label": `Remove ${name}`,
              onclick: () => set(current.filter((_, j) => j !== i)),
            },
            "✕",
          ),
        ),
      );
      if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel("items", built, current, i)));
    });
    if (current.length < max) {
      const isOpen = picker?.kind === "items" && picker.index === -1;
      items.push(
        el(
          "li",
          {},
          el(
            "button",
            {
              type: "button",
              class: "addbtn",
              "aria-expanded": isOpen ? "true" : "false",
              onclick: () => {
                picker = isOpen ? null : { kind: "items", index: -1 };
                update();
              },
            },
            `+ add a potion or item (${max - current.length} left)`,
          ),
        ),
      );
      if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel("items", built, current, -1)));
    }
    const reset = el(
      "button",
      {
        type: "button",
        class: "link",
        onclick: () => {
          state.item_seed = null;
          set(null);
        },
      },
      "reset",
    );
    const roll = dice("potions", () => {
      picker = null;
      state.items = null;
      state.item_seed = String(Math.floor(Math.random() * 1e6));
      update();
    });
    const hint = state.items ? "" : current.length ? "picked for you • " : "";
    const note = el(
      "p",
      { class: "hint block" },
      `${built.caster ? "" : "Heroes without spells get a few extra potions and items so they have more fun things to do. "}Check with your DM about which magic items to start with.`,
    );
    return field("Potions & Magic Items", el("div", {}, el("ul", { class: "spells" }, items), note), [
      `${hint}${current.length} of ${max} `,
      reset,
      " ",
      roll,
    ]);
  }

  function controls(built: HeroOptions): void {
    try {
      liveDesc = Object.fromEntries(buildCharacter(tables, request()).cards.map((card) => [card.name, card.desc]));
    } catch (error) {
      if (!(error instanceof CharError)) throw error;
      liveDesc = {};
    }
    const panel = $("#controls");
    panel.replaceChildren();
    if (prefs.heroesOpen) panel.append(heroesPanel());
    const nameIn = el("input", {
      id: "name",
      type: "text",
      value: state.name,
      maxlength: 40,
      autocomplete: "off",
      oninput: (ev) => {
        state.name = textOf(ev).value;
        update(false);
        relook();
      },
    });
    panel.append(
      field(
        "Name",
        el(
          "div",
          { class: "row" },
          nameIn,
          dice("name", () => {
            state.name = pick(NAMES.filter((name) => name !== state.name));
            update();
            relook();
          }),
        ),
      ),
    );
    panel.append(
      el(
        "p",
        { class: "tiphint" },
        el("span", { class: "mouse" }, "Hover over any choice to see what it does."),
        el("span", { class: "touch" }, "Press and hold any choice to see what it does."),
      ),
    );
    const rules = tables.rules[0];
    if (!rules) throw new Error("the ruleset has no rules row");
    panel.append(
      field(
        "Race",
        chipRow(
          tables.races.map((race) => ({
            id: race.id,
            label: race.name + (customInfo.ids.has(`races:${race.id}`) ? " ✦" : ""),
            tip: () => TIP.race(race.id),
          })),
          state.race,
          (id) => {
            state.race = id;
            state.subrace = null;
            state.race_asi = null;
            update();
          },
        ),
        dice("race", () => {
          state.race = pick(tables.races.filter((race) => race.id !== state.race)).id;
          state.subrace = null;
          state.race_asi = null;
          update();
        }),
      ),
    );
    panel.append(
      field(
        "Class",
        chipRow(
          tables.classes.map((cls) => ({
            id: cls.id,
            label: cls.name + (customInfo.ids.has(`classes:${cls.id}`) ? " ✦" : ""),
            color: cls.look.accent,
            tip: () => TIP.cls(cls.id),
          })),
          state.cls,
          (id) => {
            state.cls = id;
            state.subclass = null;
            state.cantrips = null;
            state.spells = null;
            state.path_spells = null;
            state.inventory = null;
            state.base_scores = null;
            state.armor = null;
            state.shield = null;
            update();
          },
        ),
        dice("class", () => {
          state.cls = pick(tables.classes.filter((cls) => cls.id !== state.cls)).id;
          state.subclass = null;
          state.cantrips = null;
          state.spells = null;
          state.path_spells = null;
          state.inventory = null;
          state.base_scores = null;
          state.armor = null;
          state.shield = null;
          update();
        }),
      ),
    );
    panel.append(el("p", { class: "tagline" }, classBy(state.cls).look.tagline));
    panel.append(
      field(
        "Level",
        chipRow(
          [1, 2, 3, 4, 5, 6, 7]
            .slice(0, rules.max_level)
            .map((n) => ({ id: n, label: String(n), tip: () => TIP.level(n) })),
          state.level,
          (id) => {
            state.level = id;
            update();
          },
        ),
        [
          el("span", { class: "hint" }, "ask your DM what level to start at "),
          dice("level", () => {
            state.level = 1 + Math.floor(Math.random() * rules.max_level);
            update();
          }),
        ],
      ),
    );
    if (built.subs.length) {
      panel.append(
        field(
          "Path",
          chipRow(
            built.subs.map((sub) => ({
              id: sub.id,
              label: sub.name + (customInfo.ids.has(`subclasses:${sub.id}`) ? " ✦" : ""),
              tip: () => TIP.sub(sub.id),
            })),
            state.subclass,
            (id) => {
              state.subclass = id;
              state.spells = null;
              state.path_spells = null;
              update();
            },
          ),
          [
            built.subActive ? null : `unlocks at level ${built.subclassLevel} `,
            built.subs.length > 1
              ? dice("path", () => {
                  state.subclass = pick(built.subs.filter((sub) => sub.id !== state.subclass)).id;
                  state.spells = null;
                  state.path_spells = null;
                  update();
                })
              : null,
          ],
        ),
      );
    }
    for (const group of built.groups) {
      const picks = state.choices[group.group] || [];
      const toggle = (name: string) => {
        let next = picks.slice();
        if (next.includes(name)) {
          if (group.count > 1) next = next.filter((item) => item !== name);
        } else {
          next.push(name);
          if (next.length > group.count) next = next.slice(next.length - group.count);
        }
        state.choices[group.group] = next;
        update();
      };
      const chosen = group.options.filter((option) => picks.includes(option.name));
      panel.append(
        field(
          group.label,
          el(
            "div",
            {},
            el(
              "div",
              { class: "chips" },
              group.options.map((option, i) =>
                tipped(
                  el(
                    "button",
                    {
                      type: "button",
                      class: `chip-btn${picks.includes(option.name) ? " on" : ""}`,
                      "aria-pressed": picks.includes(option.name) ? "true" : "false",
                      onclick: () => toggle(option.name),
                    },
                    option.name,
                  ),
                  () => ({
                    title: group.options[i]?.name ?? option.name,
                    lines: [[null, liveDesc[option.name] || option.desc.replace(/\{[A-Z0-9_]+\}/g, "…")]],
                  }),
                ),
              ),
            ),
            el(
              "ul",
              { class: "picked" },
              chosen.map((option) =>
                el(
                  "li",
                  {},
                  el("b", {}, `${option.name}: `),
                  liveDesc[option.name] || option.desc.replace(/\{[A-Z0-9_]+\}/g, "…"),
                ),
              ),
            ),
          ),
          [
            `pick ${group.count} `,
            dice(group.label, () => {
              state.choices[group.group] = shuffle(group.options.map((option) => option.name)).slice(0, group.count);
              update();
            }),
          ],
        ),
      );
    }
    if (built.caster) {
      const cantrips = spellList("cantrips", built);
      const spells = spellList("spells", built);
      if (cantrips) panel.append(cantrips);
      if (spells) panel.append(spells);
    }
    const items = itemList(built);
    if (items) panel.append(items);
    const ch = buildCharacter(tables, request());
    const inv = el(
      "textarea",
      {
        id: "inventory",
        rows: 5,
        oninput: (ev) => {
          state.inventory = textOf(ev)
            .value.split("\n")
            .filter((line) => line.trim());
          update(false);
        },
      },
      (state.inventory || ch.inventory).join("\n"),
    );
    panel.append(field("Inventory", inv, "one per line"));
    const notes = el(
      "textarea",
      {
        id: "notes",
        rows: 3,
        oninput: (ev) => {
          state.notes = textOf(ev).value;
          update(false);
        },
      },
      state.notes || "",
    );
    panel.append(
      field(
        "Notes",
        notes,
        dice("traits", () => {
          state.notes = rollTraits();
          update();
        }),
      ),
    );
    const file = el("input", {
      id: "portrait",
      type: "file",
      accept: "image/*",
      class: "visually-hidden",
      onchange: (ev) => {
        const chosen = inputOf(ev).files?.[0];
        if (chosen) loadPortrait(chosen);
      },
    });
    const avatar = state.avatar;
    const avStyles = AVATAR_STYLES.map((style) =>
      el(
        "button",
        {
          type: "button",
          class: `chip-btn${avatar?.style === style.id ? " on" : ""}`,
          onclick: () => {
            void makeAvatar(style.id, avatar?.style === style.id ? null : avatar?.seed || state.name || "Hero");
          },
        },
        style.label,
      ),
    );
    panel.append(
      field(
        "Picture",
        el(
          "div",
          { class: "pic" },
          el(
            "div",
            { class: "chips" },
            avStyles,
            avatar
              ? dice("face", () => {
                  void makeAvatar(avatar.style, randomSeed());
                })
              : null,
          ),
          avatar
            ? el(
                "div",
                { class: "row" },
                el("label", { for: "face-seed", class: "hint" }, "Face code"),
                el("input", {
                  id: "face-seed",
                  type: "text",
                  value: avatar.seed || "",
                  maxlength: 60,
                  autocomplete: "off",
                  spellcheck: "false",
                  oninput: (ev) => {
                    const value = textOf(ev).value;
                    clearTimeout(seedTimer);
                    seedTimer = window.setTimeout(() => {
                      if (state.avatar) void makeAvatar(state.avatar.style, value || " ");
                    }, 250);
                  },
                }),
              )
            : null,
          avatar
            ? (() => {
                const lf = lookFor(avatar.seed);
                const pickLook = (value: Look | null) => {
                  state.look = value;
                  if (state.avatar) void makeAvatar(state.avatar.style, state.avatar.seed);
                };
                return el(
                  "div",
                  { class: "row" },
                  el("span", { class: "hint" }, "Look"),
                  el(
                    "div",
                    { class: "chips" },
                    (
                      [
                        ["boy", "Boy"],
                        ["girl", "Girl"],
                      ] as const
                    ).map(([value, label]) =>
                      el(
                        "button",
                        {
                          type: "button",
                          class: `chip-btn${lf.look === value ? " on" : ""}`,
                          "aria-pressed": lf.look === value ? "true" : "false",
                          onclick: () => pickLook(value),
                        },
                        label,
                      ),
                    ),
                  ),
                  state.look
                    ? el("button", { type: "button", class: "link", onclick: () => pickLook(null) }, "match name")
                    : el("span", { class: "hint" }, lf.why),
                );
              })()
            : null,
          el(
            "div",
            { class: "row" },
            el("label", { for: "portrait", class: "ghost filebtn" }, "Upload a picture"),
            file,
            state.portrait
              ? el(
                  "button",
                  {
                    type: "button",
                    class: "ghost",
                    onclick: () => {
                      state.portrait = null;
                      state.portrait_credit = null;
                      state.avatar = null;
                      update();
                    },
                  },
                  "Remove",
                )
              : null,
          ),
          el(
            "p",
            { class: "hint block", id: "avatar-msg" },
            avatar
              ? "Same code + same style = same face. Share a code to share a face. Credit prints in the corner."
              : "",
          ),
        ),
        "or leave blank and draw one",
      ),
    );
    panel.append(advanced(built));
    panel.append(customSection());
  }

  function loadHero(hero: PackRow): void {
    const req = heroRequest(hero);
    save();
    const slot: HeroRecord = { id: newId(), state: {}, edited: true, updated: Date.now() };
    book.heroes.push(slot);
    book.current = slot.id;
    state = {
      ...DEFAULT,
      name: req.name,
      race: req.race,
      subrace: req.subrace,
      cls: req.cls,
      subclass: req.subclass,
      level: req.level,
      choices: Object.fromEntries(req.choices.map((choice) => [choice.group, choice.picks])),
      cantrips: req.cantrips,
      spells: req.spells,
      path_spells: req.path_spells,
      items: req.items,
      item_seed: null,
      armor: req.armor,
      shield: req.shield,
      weapon: req.weapon,
      base_scores: req.base_scores,
      race_asi: req.race_asi,
      inventory: req.inventory,
      notes: req.notes,
      portrait: req.portrait,
      portrait_credit: req.portrait_credit,
      avatar: null,
      look: null,
    };
    update();
    const avatarField = hero.avatar;
    if (
      !req.portrait &&
      avatarField &&
      typeof avatarField === "object" &&
      "style" in avatarField &&
      typeof avatarField.style === "string"
    ) {
      const look =
        "look" in avatarField && (avatarField.look === "boy" || avatarField.look === "girl") ? avatarField.look : null;
      const seed = "seed" in avatarField && typeof avatarField.seed === "string" ? avatarField.seed : req.name;
      state.look = look;
      void makeAvatar(avatarField.style, seed);
    }
    window.scrollTo(0, 0);
  }

  function heroesPanel(): HTMLElement {
    const label = (hero: HeroRecord) => {
      const savedState = hero.state;
      const cls = savedState.cls ? CLASSES[savedState.cls] : undefined;
      return `${savedState.name || "Hero"} • Lv ${savedState.level || 1} ${cls ? cls.name : ""}`;
    };
    const row = (hero: HeroRecord) => {
      const cur = hero.id === book.current;
      let armed = false;
      const del = el(
        "button",
        {
          type: "button",
          class: "link",
          "aria-label": `Delete ${label(hero)}`,
          onclick: (ev) => {
            if (!armed) {
              armed = true;
              if (ev.currentTarget instanceof HTMLElement) ev.currentTarget.textContent = "delete for good?";
              return;
            }
            deleteHero(hero.id);
          },
        },
        "×",
      );
      return el(
        "li",
        { class: `herorow${cur ? " on" : ""}` },
        el(
          "button",
          {
            type: "button",
            class: "heroname",
            "aria-current": cur ? "true" : "false",
            onclick: () => switchHero(hero.id),
          },
          label(hero),
        ),
        del,
      );
    };
    const mine = book.heroes.filter((hero) => hero.edited).sort((a, b) => b.updated - a.updated);
    const rolls = book.heroes.filter((hero) => !hero.edited).sort((a, b) => b.updated - a.updated);
    const drawer = el(
      "details",
      {
        class: "rolls",
        ontoggle: (ev) => {
          if (ev.target instanceof HTMLDetailsElement) prefs.rollsOpen = ev.target.open;
          savePrefs();
        },
      },
      el(
        "summary",
        {},
        `Random rolls (${rolls.length})`,
        el("span", { class: "hint" }, " — dice heroes you haven't changed; change one and it moves up"),
      ),
      el("ul", { class: "herolist" }, rolls.map(row)),
    );
    if (prefs.rollsOpen) drawer.open = true;
    return el(
      "div",
      { class: "field heroes" },
      el(
        "div",
        { class: "flabel" },
        "Your heroes",
        el(
          "button",
          {
            type: "button",
            class: "link",
            onclick: () => {
              prefs.heroesOpen = false;
              savePrefs();
              update();
            },
          },
          "close",
        ),
      ),
      mine.length
        ? el("ul", { class: "herolist" }, mine.map(row))
        : el("p", { class: "hint block" }, "Change anything on a hero and it's saved here."),
      el(
        "div",
        { class: "row" },
        el("button", { type: "button", class: "ghost", onclick: newRandomHero }, "🎲 New random hero"),
      ),
      rolls.length ? drawer : null,
      el("p", { class: "hint block" }, "Heroes are saved in this browser only."),
    );
  }

  function addPackText(text: string, fallbackTitle: string): boolean {
    let obj: PackRow;
    try {
      obj = parseCustomText(text);
    } catch (error) {
      customInfo.error = `${fallbackTitle}: ${messageOf(error)}`;
      loadReport = [];
      update();
      return false;
    }
    const title = typeof obj.title === "string" && obj.title ? obj.title : fallbackTitle;
    const before = loadLib();
    saveLib(before.filter((pack) => pack.title !== title).concat([{ title, text }]));
    tables = withCustom();
    const bad = customInfo.problems
      .filter((problem) => problem.startsWith(`${title}:`))
      .concat(customInfo.error.startsWith(`${title}:`) ? [customInfo.error] : []);
    loadReport = bad;
    if (bad.length) saveLib(before);
    prefs.custom = true;
    savePrefs();
    reloadTables();
    return !bad.length;
  }

  function addSitePack(pack: SitePack): boolean {
    return addPackText(JSON.stringify(pack.data), pack.file);
  }

  function customSection(): HTMLElement {
    const details = el(
      "details",
      {
        class: "adv custom",
        ontoggle: (ev) => {
          if (ev.target instanceof HTMLDetailsElement) prefs.custom = ev.target.open;
          savePrefs();
        },
      },
      el(
        "summary",
        {},
        "Add your own races, classes, spells & items",
        el("span", { class: "hint" }, "Have an AI write a custom content file, then load it here."),
      ),
    );
    if (prefs.custom || customInfo.error || customInfo.problems.length || loadReport.length) details.open = true;
    const file = el("input", {
      id: "custom-file",
      type: "file",
      accept: ".json,application/json,text/plain",
      class: "visually-hidden",
      onchange: (ev) => {
        const chosen = inputOf(ev).files?.[0];
        if (!chosen) return;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") addPackText(reader.result, chosen.name);
        };
        reader.readAsText(chosen);
      },
    });
    const lib = loadLib();
    const lines: HTMLElement[] = [
      el(
        "li",
        { class: "src builtin" },
        el(
          "label",
          {},
          el("input", {
            type: "checkbox",
            id: "use-builtin",
            checked: !prefs.noBuiltin,
            onchange: (ev) => {
              prefs.noBuiltin = !inputOf(ev).checked;
              savePrefs();
              loadReport = [];
              reloadTables();
            },
          }),
          ` ${SRD_TITLE}`,
        ),
        el("span", { class: "hint" }, prefs.noBuiltin ? " — left out" : " — the built-in heroes"),
      ),
    ];
    for (const source of customInfo.sources) {
      const inLib = lib.some((pack) => pack.title === source.label);
      lines.push(
        el(
          "li",
          {},
          el("b", {}, `✓ ${source.title || source.label}`),
          ` — ${source.counts.join(", ") || "nothing new"} `,
          inLib
            ? el(
                "button",
                {
                  type: "button",
                  class: "link",
                  onclick: () => {
                    loadReport = [];
                    saveLib(loadLib().filter((pack) => pack.title !== source.label));
                    reloadTables();
                  },
                },
                "remove",
              )
            : null,
        ),
      );
    }
    if (customInfo.error) lines.push(el("li", { class: "bad" }, `⚠ ${customInfo.error}`));
    for (const problem of [...new Set(customInfo.problems.concat(loadReport))])
      lines.push(el("li", { class: "bad" }, `⚠ ${problem}`));
    details.appendChild(
      el(
        "div",
        { class: "field" },
        el(
          "p",
          { class: "hint block" },
          "1. Download the instructions and give them to any AI chat (like Claude), with what you want: “a turtle-folk race”, “a pirate subclass for rogues”…",
        ),
        el(
          "p",
          { class: "hint block" },
          "2. Save what it writes as hero-custom.json and load it here — or put it online and paste the link.",
        ),
        el(
          "div",
          { class: "row" },
          el(
            "button",
            {
              type: "button",
              class: "ghost",
              onclick: () => {
                void saveFile(
                  "Hero Sheet custom content - instructions for AI.md",
                  new Blob([guide], { type: "text/markdown" }),
                ).catch((error: unknown) => status(messageOf(error), true));
              },
            },
            "Download AI instructions",
          ),
          el("label", { for: "custom-file", class: "ghost filebtn" }, "Load a file"),
          file,
        ),
        linkRow(),
        pasteRow(),
        sitePacks.length
          ? el(
              "div",
              {},
              el("div", { class: "flabel" }, "Packs on this site"),
              el(
                "ul",
                { class: "customlist" },
                sitePacks.map((pack) => {
                  const have =
                    lib.some((item) => item.title === pack.title) ||
                    customInfo.sources.some((source) => source.title === pack.title);
                  return el(
                    "li",
                    {},
                    el("b", {}, pack.title || pack.file),
                    pack.about ? ` — ${pack.about} ` : " ",
                    have
                      ? el("span", { class: "hint" }, "added")
                      : el("button", { type: "button", class: "link", onclick: () => addSitePack(pack) }, "add"),
                  );
                }),
              ),
            )
          : null,
        lines.length
          ? el("ul", { class: "customlist" }, lines)
          : el("p", { class: "hint block" }, "No custom content loaded."),
        customInfo.heroes.length
          ? el(
              "div",
              {},
              el("div", { class: "flabel" }, "Ready-made heroes"),
              el(
                "div",
                { class: "chips" },
                customInfo.heroes.map((hero) =>
                  el(
                    "button",
                    { type: "button", class: "chip-btn", onclick: () => loadHero(hero) },
                    `Start as ${String(hero.name)}`,
                  ),
                ),
              ),
            )
          : null,
        customInfo.problems.length || loadReport.length
          ? el(
              "p",
              { class: "hint block" },
              "That file wasn't added. Copy these problems back to the AI and ask it to fix the file.",
            )
          : null,
        lib.length || customInfo.sources.length
          ? el(
              "p",
              { class: "hint block" },
              "You can load several packs. Heroes made with a pack keep their own copy of it, so they keep working even if you remove it.",
            )
          : null,
      ),
    );
    return details;
  }

  function linkRow(): HTMLElement {
    const saved = storage.get(CUSTOM_URL_KEY) || "";
    const inp = el("input", {
      id: "custom-url",
      type: "url",
      placeholder: "or paste a link to a custom content file",
      value: saved,
      autocomplete: "off",
      spellcheck: "false",
    });
    const go = el(
      "button",
      {
        type: "button",
        class: "ghost",
        onclick: () => {
          go.disabled = true;
          urlStatus = "Loading…";
          void fetchCustomUrl(inp.value, false).then((ok) => {
            prefs.custom = true;
            savePrefs();
            if (ok) reloadTables();
            else update();
          });
        },
      },
      "Load link",
    );
    const forget = saved
      ? el(
          "button",
          {
            type: "button",
            class: "link",
            onclick: () => {
              storage.remove(CUSTOM_URL_KEY);
              storage.remove(`${CUSTOM_URL_KEY}-text`);
              memUrlText = null;
              urlStatus = "";
              reloadTables();
            },
          },
          "forget link",
        )
      : null;
    return el(
      "div",
      {},
      el("div", { class: "row" }, inp, go),
      saved ? el("p", { class: "hint block" }, "Checked for updates every time the builder opens. ", forget) : null,
      urlStatus ? el("p", { class: `hint block${urlStatus.startsWith("⚠") ? " bad" : ""}` }, urlStatus) : null,
    );
  }

  function pasteRow(): HTMLElement {
    const ta = el("textarea", {
      id: "custom-paste",
      rows: 3,
      placeholder: "or paste a pack's JSON here",
      spellcheck: "false",
    });
    return el(
      "div",
      {},
      ta,
      el(
        "div",
        { class: "row" },
        el(
          "button",
          {
            type: "button",
            class: "ghost",
            onclick: () => {
              if (ta.value.trim()) addPackText(ta.value, "pasted pack");
            },
          },
          "Add pasted pack",
        ),
      ),
    );
  }

  let seedTimer = 0;
  let lookTimer = 0;

  function relook(): void {
    clearTimeout(lookTimer);
    lookTimer = window.setTimeout(() => {
      if (!state.avatar || state.look) return;
      const refocus = () => {
        const name = maybe("#name");
        if (name instanceof HTMLInputElement && document.activeElement !== name) {
          name.focus();
          name.setSelectionRange(name.value.length, name.value.length);
        }
      };
      const had = document.activeElement instanceof HTMLElement && document.activeElement.id === "name";
      if (lookFor(state.avatar.seed).look !== state.avatar.look) {
        void makeAvatar(state.avatar.style, state.avatar.seed).then(() => {
          if (had) refocus();
        });
      } else {
        update();
        if (had) refocus();
      }
    }, 400);
  }

  const AVATAR_STYLES = [
    { id: "pixel", label: "Pixel", pkg: "pixel-art", credit: "Art: “Pixel Art” by DiceBear, CC0" },
    {
      id: "adventurer",
      label: "Adventurer",
      pkg: "adventurer",
      credit: "Art: “Adventurer” by Lisa Wischofsky, CC BY 4.0, via DiceBear",
    },
    {
      id: "smile",
      label: "Big smile",
      pkg: "big-smile",
      credit: "Art: “Big Smile” by Ashley Seo, CC BY 4.0, via DiceBear",
    },
    {
      id: "doodle",
      label: "Doodle",
      pkg: "croodles",
      credit: "Art: “Croodles” by Vijay Verma, CC BY 4.0, via DiceBear",
    },
  ];
  const DEFAULT_STYLE = "pixel";
  const DICEBEAR = "https://cdn.jsdelivr.net/npm/@dicebear/";
  const DICEBEAR_V = "9.2.2";
  const avatarMods = new Map<string, Promise<unknown>>();

  async function importModule(url: string): Promise<unknown> {
    return await import(/* @vite-ignore */ url);
  }

  function asAvatarCore(mod: unknown): AvatarCore {
    if (typeof mod !== "object" || mod === null || !("createAvatar" in mod) || typeof mod.createAvatar !== "function") {
      throw new Error("cartoon face library didn't load");
    }
    const createAvatar = mod.createAvatar.bind(mod) as AvatarCore["createAvatar"];
    return { createAvatar };
  }

  async function avatarLib(pkg: string): Promise<[AvatarCore, object]> {
    const coreUrl = `${DICEBEAR}core@${DICEBEAR_V}/+esm`;
    const styleUrl = `${DICEBEAR}${pkg}@${DICEBEAR_V}/+esm`;
    let core = avatarMods.get("core");
    if (!core) {
      core = importModule(coreUrl);
      avatarMods.set("core", core);
    }
    let style = avatarMods.get(pkg);
    if (!style) {
      style = importModule(styleUrl);
      avatarMods.set(pkg, style);
    }
    const [coreMod, styleMod] = await Promise.all([core, style]);
    if (typeof styleMod !== "object" || styleMod === null) throw new Error("cartoon face library didn't load");
    return [asAvatarCore(coreMod), styleMod];
  }

  const SEED_A = [
    "brave",
    "sneaky",
    "sleepy",
    "fizzy",
    "lucky",
    "grumpy",
    "jolly",
    "tiny",
    "mighty",
    "silly",
    "quiet",
    "wild",
  ];
  const SEED_B = [
    "otter",
    "dragon",
    "badger",
    "pickle",
    "comet",
    "goblin",
    "pebble",
    "wizard",
    "turnip",
    "falcon",
    "muffin",
    "troll",
  ];
  const randomSeed = () => `${pick(SEED_A)}-${pick(SEED_B)}-${1 + Math.floor(Math.random() * 99)}`;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const range = (pre: string, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => pre + pad2(a + i));
  const LOOKS: Record<string, Partial<Record<Look, Omit<AvatarOptions, "seed" | "size">>>> = {
    adventurer: {
      boy: { hair: range("short", 1, 19), earringsProbability: 0 },
      girl: { hair: range("long", 1, 26), earringsProbability: 30, features: ["blush", "birthmark", "freckles"] },
    },
    pixel: { boy: { hair: range("short", 1, 24) }, girl: { hair: range("long", 1, 21), beardProbability: 0 } },
    smile: {
      boy: { hair: ["shortHair", "mohawk", "bowlCutHair", "shavedHead", "halfShavedHead", "curlyShortHair"] },
      girl: {
        hair: ["wavyBob", "curlyBob", "straightHair", "braids", "bunHair", "froBun", "bangs"],
        accessories: ["catEars", "glasses", "sailormoonCrown", "clownNose", "sleepMask", "sunglasses", "faceMask"],
      },
    },
    doodle: {
      boy: {
        top: [
          "variant01",
          "variant02",
          "variant03",
          "variant04",
          "variant06",
          "variant07",
          "variant08",
          "variant09",
          "variant19",
          "variant21",
          "variant22",
          "variant24",
          "variant25",
          "variant26",
          "variant27",
          "variant29",
        ],
      },
      girl: {
        top: [...range("variant", 10, 18), "variant05", "variant21", "variant25"],
        beardProbability: 0,
        mustacheProbability: 0,
      },
    },
  };
  const BOY_NAMES = new Set(
    "tobin rook fennick grimble brick dex bolt aaron adam aiden alex alexander andrew anthony arthur austin ben benjamin bob brandon brian bruce caleb carl carlos charles charlie chris christopher cole colin connor daniel david dean derek dominic dylan edward eli elijah eric ethan evan felix finn frank fred gabe gabriel galen gavin george graham greg harry henry hugo ian isaac jack jacob jake james jason jeff jeremy jesse joe joel john jonah jonathan jordan jose joseph josh joshua juan julian justin kevin kyle leo leon liam logan lucas luke marcus mark martin mason matt matthew max michael miles nate nathan nick nicholas noah oliver oscar owen patrick paul peter phil ralph ray ryan sam samuel scott sean seth simon steve steven theo thomas tim timothy tom tony travis trevor tyler victor vincent walter wesley will william wyatt zach zachary gandalf aragorn bilbo frodo thor conan merlin drizzt gimli legolas boromir sam".split(
      " ",
    ),
  );
  const GIRL_NAMES = new Set(
    "mira juniper nova tulip moxie luna odette saffron wren abby abigail ada addison alice alicia allison amanda amber amelia amy anna annie aria ariana audrey ava bella brooke caroline charlotte chloe claire clara daisy ella ellie emily emma eva evelyn faith fiona freya grace hailey hannah harper hazel holly isabel isabella ivy jade jane jasmine jenna jennifer jessica josie julia kate katie kayla kim laura layla leah lily lila lucy lydia maddie madison maya megan mia molly naomi natalie nora olivia penny piper poppy quinn rachel rose ruby sadie sara sarah scarlett sofia sophia sophie stella susan tessa violet willow zoe zoey hermione arwen galadriel elsa anna leia rey".split(
      " ",
    ),
  );

  function nameLook(name: string): Look | null {
    const word =
      String(name || "")
        .trim()
        .split(/\s+/)[0]
        ?.toLowerCase()
        .replace(/[^a-z]/g, "") ?? "";
    return BOY_NAMES.has(word) ? "boy" : GIRL_NAMES.has(word) ? "girl" : null;
  }
  const coin = (seed: string): Look => {
    let hash = 7;
    for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) % 2147483647;
    return hash % 2 ? "girl" : "boy";
  };
  function lookFor(seed: string): { look: Look; why: string } {
    if (state.look) return { look: state.look, why: "" };
    const named = nameLook(state.name);
    return named
      ? { look: named, why: "matches the name" }
      : { look: coin(seed), why: "coin flip (name could be either)" };
  }

  async function makeAvatar(styleId: string, seed: string | null): Promise<void> {
    if (seed === null) {
      state.avatar = null;
      state.portrait = null;
      state.portrait_credit = null;
      update();
      return;
    }
    const style = AVATAR_STYLES.find((item) => item.id === styleId);
    const msg = maybe("#avatar-msg");
    if (!style) {
      if (msg)
        msg.textContent = "Couldn't load the cartoon faces (they come from the internet). Upload a picture instead.";
      return;
    }
    if (msg) msg.textContent = "Drawing a face…";
    try {
      const [core, styleMod] = await avatarLib(style.pkg);
      const look = lookFor(seed).look;
      const svg = core.createAvatar(styleMod, { seed, size: 256, ...(LOOKS[styleId]?.[look] ?? {}) }).toString();
      state.portrait = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      state.portrait_credit = style.credit;
      state.avatar = { style: styleId, seed, look };
      const y = $("#controls").scrollTop;
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement.id : "";
      update();
      $("#controls").scrollTop = y;
      if (focused === "face-seed") {
        const face = maybe("#face-seed");
        if (face instanceof HTMLInputElement) {
          face.focus();
          face.setSelectionRange(face.value.length, face.value.length);
        }
      }
    } catch {
      avatarMods.delete("core");
      avatarMods.delete(style.pkg);
      if (msg)
        msg.textContent = "Couldn't load the cartoon faces (they come from the internet). Upload a picture instead.";
    }
  }

  function loadPortrait(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 600 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        state.portrait = canvas.toDataURL("image/jpeg", 0.85);
        state.portrait_credit = null;
        state.avatar = null;
        update();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function fitBack(root: ParentNode): void {
    const cards = root.querySelector(".page.back .cards");
    if (!(cards instanceof HTMLElement) || !cards.clientHeight) return;
    const fits = () => {
      if (cards.scrollHeight > cards.clientHeight + 1 || cards.scrollWidth > cards.clientWidth + 1) return false;
      const box = cards.getBoundingClientRect();
      const tol = 1 + box.width / 400;
      for (const node of cards.querySelectorAll(".cd, .sec h3")) {
        const rect = node.getBoundingClientRect();
        if (rect.right > box.right + tol || rect.bottom > box.bottom + tol) return false;
      }
      return true;
    };
    let fs = 16;
    cards.style.setProperty("--fs", `${fs}px`);
    while (!fits() && fs > 8) {
      fs -= 0.25;
      cards.style.setProperty("--fs", `${fs}px`);
    }
  }

  function scalePreview(): void {
    const wrap = $("#preview");
    const sheet = wrap.querySelector(".sheet");
    if (!(sheet instanceof HTMLElement) || !wrap.clientWidth) return;
    const side = wrap.clientWidth >= 2 * 816 * 0.55 + 24;
    sheet.classList.toggle("side", side);
    const natW = side ? 816 * 2 + 24 : 816;
    const natH = side ? 1056 : 1056 * 2 + 24;
    const scale = Math.min(1, wrap.clientWidth / natW);
    sheet.style.transform = `scale(${scale})`;
    $("#scaler").style.height = `${natH * scale}px`;
  }

  function renderSheet(): void {
    let html: string;
    try {
      html = sheetHtml(buildCharacter(tables, request()));
      $("#error").hidden = true;
    } catch (error) {
      if (!(error instanceof CharError)) throw error;
      $("#error").hidden = false;
      $("#error").textContent = `This combo doesn't work: ${error.message}`;
      return;
    }
    const scaler = $("#scaler");
    scaler.innerHTML = html;
    fitBack(scaler);
    scalePreview();
  }

  let timer = 0;
  function update(rebuildControls?: boolean): void {
    const built = tidy();
    document.documentElement.style.setProperty("--ac", classBy(state.cls).look.accent);
    if (rebuildControls !== false) {
      hideTip();
      const y = $("#controls").scrollTop;
      controls(built);
      $("#controls").scrollTop = y;
    }
    save();
    clearTimeout(timer);
    timer = window.setTimeout(renderSheet, rebuildControls === false ? 150 : 0);
  }

  function fileBase(): string {
    const banned = new Set('\\/:*?"<>|'.split(""));
    const clean = (value: string) =>
      [...value]
        .filter((ch) => ch.charCodeAt(0) >= 32 && !banned.has(ch))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    const idn = buildCharacter(tables, request()).identity;
    return `${clean(idn.name) || "Hero"} - Level ${idn.level} ${clean(idn.cls)}${idn.subclass ? ` (${clean(idn.subclass)})` : ""}`;
  }

  let dlCap: DownloadCap | null | undefined;
  async function saveFile(filename: string, blob: Blob): Promise<void> {
    if (dlCap === undefined) {
      dlCap = null;
      if (window.claude?.use) {
        try {
          dlCap = await window.claude.use("downloads");
        } catch {
          dlCap = null;
        }
      }
    }
    if (dlCap) {
      await dlCap.save({ filename, data: blob });
      return;
    }
    if (window.claude?.use) {
      const error = new Error("Saving files isn't available here.");
      throw Object.assign(error, { code: "unavailable" });
    }
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function status(text: string, bad?: boolean): void {
    const node = $("#status");
    node.textContent = text;
    node.classList.toggle("bad", !!bad);
    node.hidden = !text;
  }

  async function exportPdf(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    status("Making your PDF…");
    try {
      const html = sheetHtml(buildCharacter(tables, request()));
      const blob = await makePdf(html, state.name || "Hero");
      await saveFile(`${fileBase()}.pdf`, blob);
      status("PDF ready — print it double-sided, flip on the long edge.");
    } catch (error) {
      const code = error instanceof ExportError ? error.code : errorCode(error);
      if (code === "declined") status("");
      else if (code === "tainted")
        status(
          "This browser won't let the page build the PDF. Try Chrome, Edge or Firefox, or the builder file in Safari.",
          true,
        );
      else status(messageOf(error) || "Something went wrong making the file.", true);
    } finally {
      btn.disabled = false;
    }
  }

  function setView(view: "build" | "sheet"): void {
    document.body.dataset.view = view;
    $("#tab-build").setAttribute("aria-pressed", view === "build" ? "true" : "false");
    $("#tab-sheet").setAttribute("aria-pressed", view === "sheet" ? "true" : "false");
    window.scrollTo(0, 0);
    if (view === "sheet") requestAnimationFrame(renderSheet);
  }

  function surprise(): void {
    state.race = pick(tables.races).id;
    state.subrace = null;
    state.race_asi = null;
    state.cls = pick(tables.classes).id;
    state.subclass = null;
    state.name = pick(NAMES);
    state.choices = {};
    state.cantrips = null;
    state.spells = null;
    state.inventory = null;
    state.path_spells = null;
    state.portrait = null;
    state.portrait_credit = null;
    state.avatar = null;
    state.look = null;
    state.notes = rollTraits();
    state.weapon = null;
    state.items = null;
    state.item_seed = String(Math.floor(Math.random() * 1e6));
    state.base_scores = null;
    state.armor = null;
    state.shield = null;
    rolling = true;
    update();
    markRolled();
    const myId = book.current;
    void makeAvatar(DEFAULT_STYLE, randomSeed()).finally(() => {
      rolling = false;
      const hero = currentHero();
      if (book.current === myId && hero && !hero.edited) markRolled();
    });
  }

  function newRandomHero(): void {
    save();
    const cur = currentHero();
    if (!(cur && !cur.edited)) {
      const hero: HeroRecord = { id: newId(), state: {}, edited: false, rolled: null, updated: Date.now() };
      book.heroes.push(hero);
      book.current = hero.id;
    }
    state = { ...DEFAULT, choices: {} };
    surprise();
  }

  function applyBuild(race: string, cls: string, sub: string | null, level: number): void {
    state.race = race;
    state.cls = cls;
    state.subclass = sub;
    state.level = level;
    state.choices = {};
    state.cantrips = null;
    state.spells = null;
    state.path_spells = null;
    state.items = null;
    state.item_seed = null;
    state.armor = null;
    state.shield = null;
    state.weapon = null;
    state.subrace = null;
    state.base_scores = null;
    state.race_asi = null;
    state.inventory = null;
    picker = null;
  }

  const buildParam = new URLSearchParams(location.search).get("build");
  if (buildParam && !haveSaved) {
    const [race, cls, sub, level] = buildParam.split(",");
    if (race && cls) applyBuild(race, cls, sub || null, Number(level) || 1);
  }

  window.__setHero = (race, cls, sub, level) => {
    applyBuild(race, cls, sub, level);
    update();
  };

  $("#tab-build").addEventListener("click", () => setView("build"));
  $("#tab-sheet").addEventListener("click", () => setView("sheet"));
  setView("build");
  $("#pdf").addEventListener("click", (ev) => {
    if (ev.currentTarget instanceof HTMLButtonElement) void exportPdf(ev.currentTarget);
  });
  $("#surprise").addEventListener("click", newRandomHero);
  $("#heroes-btn").addEventListener("click", () => {
    prefs.heroesOpen = !prefs.heroesOpen;
    savePrefs();
    setView("build");
    update();
    $("#controls").scrollTop = 0;
  });
  window.addEventListener("resize", scalePreview);
  if (document.fonts) void document.fonts.ready.then(() => renderSheet());
  ensurePacks(currentHero());
  try {
    update();
  } catch (error) {
    if (!(error instanceof CharError) && !(error instanceof CustomError)) throw error;
    storage.remove(KEY);
    state = { ...DEFAULT, choices: {} };
    update();
  }
  void (async () => {
    const fromQuery = new URLSearchParams(location.search).get("custom");
    const url = fromQuery || storage.get(CUSTOM_URL_KEY);
    if (!url) return;
    const before = memUrlText;
    if (await fetchCustomUrl(url, true)) {
      if (memUrlText !== before) reloadTables();
    } else if (urlStatus) update();
  })();
  if (!haveSaved && !window.CHARSHEET_FIXED_START && !buildParam) surprise();
  else if (!haveSaved) markRolled();
  const want = new URLSearchParams(location.search).get("pack");
  const auto = sitePacks.find((pack) => want !== null && (pack.file === want || pack.file === `${want}.json`));
  if (auto && !loadLib().some((pack) => pack.title === auto.title)) addSitePack(auto);
  else update();
  document.documentElement.dataset.booted = "1";
}
