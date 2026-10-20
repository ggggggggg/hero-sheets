import { buildCharacter, CharError, options, sheetHtml, signed } from "./core";
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
import { ExportError, makePdf, readHeroSheet } from "./export";
import { createFaceKit, type FacePick, type Look } from "./face";
import { fitCardFont, previewLayout } from "./fit";
import { contentPackPanel } from "./pack-ui";
import { clearSavedKeys, DND_SAVE_KEYS, refreshBundledPacks } from "./packs";
import { fileStem } from "./text";
import { createTips, HELP, help, type Tip, tipChrome, tipNode } from "./tips";
import {
  ABILITIES,
  type Ability,
  type AbilityScores,
  type Character,
  type ClassRow,
  type HeroOptions,
  type HeroRequest,
  type NumberOverrides,
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
  avatar: FacePick | null;
  look: Look | null;
  numbers: NumberOverrides | null;
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

type ListKind = "cantrips" | "spells" | "items" | "path_spells";
type SpellKind = "cantrips" | "spells";

interface Picker {
  kind: ListKind;
  index: number;
  all?: boolean;
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
  target?: string;
  rel?: string;
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

function textList(value: unknown): string[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const list: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    list.push(item);
  }
  return list;
}

function scoresOf(value: unknown): AbilityScores | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const scores: Partial<AbilityScores> = {};
  for (const ability of ABILITIES) {
    const score = row[ability];
    if (typeof score !== "number" || !Number.isFinite(score)) return undefined;
    scores[ability] = score;
  }
  return scores as AbilityScores;
}

function avatarOf(value: unknown): FacePick | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const look = row.look === "boy" || row.look === "girl" ? row.look : null;
  if (typeof row.style !== "string" || typeof row.seed !== "string" || !look) return undefined;
  return { style: row.style, seed: row.seed, look };
}

function heroPatch(raw: Record<string, unknown>): Partial<HeroState> | null {
  if (typeof raw.race !== "string" || typeof raw.cls !== "string") return null;
  const patch: Partial<HeroState> = { race: raw.race, cls: raw.cls };
  if (typeof raw.name === "string") patch.name = raw.name;
  if (typeof raw.subclass === "string" || raw.subclass === null) patch.subclass = raw.subclass;
  if (typeof raw.level === "number" && Number.isFinite(raw.level)) patch.level = raw.level;
  if (raw.choices && typeof raw.choices === "object" && !Array.isArray(raw.choices)) {
    const choices: Record<string, string[]> = {};
    let ok = true;
    for (const [group, picks] of Object.entries(raw.choices as Record<string, unknown>)) {
      const list = textList(picks);
      if (!list) {
        ok = false;
        break;
      }
      choices[group] = list;
    }
    if (ok) patch.choices = choices;
  }
  for (const key of ["cantrips", "spells", "path_spells", "items", "inventory"] as const) {
    const list = textList(raw[key]);
    if (list !== undefined) patch[key] = list;
  }
  if (typeof raw.item_seed === "string" || raw.item_seed === null) patch.item_seed = raw.item_seed;
  if (typeof raw.notes === "string") patch.notes = raw.notes;
  if (typeof raw.portrait === "string" || raw.portrait === null) patch.portrait = raw.portrait;
  if (typeof raw.portrait_credit === "string" || raw.portrait_credit === null)
    patch.portrait_credit = raw.portrait_credit;
  if (typeof raw.subrace === "string" || raw.subrace === null) patch.subrace = raw.subrace;
  if (typeof raw.weapon === "string" || raw.weapon === null) patch.weapon = raw.weapon;
  const raceAsi = scoresOf(raw.race_asi);
  if (raceAsi !== undefined) patch.race_asi = raceAsi;
  const baseScores = scoresOf(raw.base_scores);
  if (baseScores !== undefined) patch.base_scores = baseScores;
  if (typeof raw.armor === "string" || raw.armor === null) patch.armor = raw.armor;
  if (typeof raw.shield === "boolean" || raw.shield === null) patch.shield = raw.shield;
  const avatar = avatarOf(raw.avatar);
  if (avatar !== undefined) patch.avatar = avatar;
  if (raw.look === "boy" || raw.look === "girl" || raw.look === null) patch.look = raw.look;
  const numbers = numbersOf(raw.numbers);
  if (numbers !== undefined) patch.numbers = numbers;
  return patch;
}

function numMap(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "number" && Number.isFinite(item)) out[key] = item;
  }
  return out;
}

function numbersOf(value: unknown): NumberOverrides | null | undefined {
  if (value == null) return value === null ? null : undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const numbers: NumberOverrides = {};
  const skills = numMap(row.skills);
  if (skills && Object.keys(skills).length) numbers.skills = skills;
  const attacks = numMap(row.attacks);
  if (attacks && Object.keys(attacks).length) numbers.attacks = attacks;
  if (row.saves && typeof row.saves === "object" && !Array.isArray(row.saves)) {
    const saves: Partial<AbilityScores> = {};
    const saved = row.saves as Record<string, unknown>;
    for (const ability of ABILITIES) {
      const score = saved[ability];
      if (typeof score === "number" && Number.isFinite(score)) saves[ability] = score;
    }
    if (Object.keys(saves).length) numbers.saves = saves;
  }
  for (const key of [
    "ac",
    "hp",
    "speed",
    "swim",
    "initiative",
    "prof",
    "notice",
    "spell_attack",
    "spell_dc",
  ] as const) {
    const score = row[key];
    if (typeof score === "number" && Number.isFinite(score)) numbers[key] = score;
  }
  return Object.keys(numbers).length ? numbers : null;
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

export function startApp(input: { tables: Tables; sitePacks: SitePack[] }): void {
  const baseTables = input.tables;
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
        urlStatus = `⚠ Couldn't read that link (${messageOf(error)}). Many sites, including Google Drive, don't let other pages read their files. A GitHub Gist “Raw” link or a jsDelivr link works — see the instructions.`;
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

  {
    const refreshed = refreshBundledPacks(
      loadLib(),
      sitePacks.map((pack) => ({ title: pack.title, text: JSON.stringify(pack.data) })),
    );
    if (refreshed.changed) saveLib(refreshed.packs);
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
    numbers: null,
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

  const faces = createFaceKit({
    read: () => state,
    write: (patch) => {
      Object.assign(state, patch);
    },
    refresh: () => update(),
  });

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
      numbers: state.numbers,
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
      state.cantrips = state.cantrips
        .filter((name) => learnable("cantrips", built, true).includes(name))
        .slice(0, built.nCan);
    if (state.spells)
      state.spells = state.spells.filter((name) => learnable("spells", built, true).includes(name)).slice(0, built.nSp);
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

  const { tipped, show: showTip, hide: hideTip } = createTips();
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
      numbers: null,
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

  function armorPhrase(kinds: readonly string[]): string {
    const order = ["light", "medium", "heavy"];
    const have = order.filter((kind) => kinds.includes(kind));
    for (const kind of kinds) if (!have.includes(kind)) have.push(kind);
    if (have.length === 0) return "";
    if (have.length === 1) return `${have[0]} armor`;
    if (have.length === 2) return `${have[0]} and ${have[1]} armor`;
    return `${have.slice(0, -1).join(", ")}, and ${have[have.length - 1]} armor`;
  }

  function trainingLine(kinds: readonly string[], shield: boolean): string {
    const body = armorPhrase(kinds);
    if (body && shield) return `${body}, plus a shield`;
    if (body) return body;
    if (shield) return "a shield";
    return "no armor";
  }

  const TIP = {
    race(id: string): Tip {
      const race = raceBy(id);
      const srs = tables.subraces.filter((row) => row.race_id === id);
      const preview = (state.race === id ? srs.find((row) => row.id === state.subrace) : undefined) ?? srs[0] ?? null;
      const asi: AbilityScores = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };
      for (const ability of ABILITIES) asi[ability] = (race.asi[ability] || 0) + (preview?.asi[ability] || 0);
      const ch = tryBuild({ race: id, subrace: preview ? preview.id : null });
      const walk = race.speed + (preview ? preview.speed : 0);
      const swim = race.swim ?? 0;
      const move = swim > 0 ? `speed ${walk} ft, swim ${swim} ft` : `speed ${walk} ft`;
      const lines: [string | null, string][] = [[null, [asiText(asi), move].filter(Boolean).join(" • ")]];
      if (preview && srs.length < 2) lines.push([null, preview.name]);
      const picks =
        srs.length > 1
          ? srs.map((row) => ({
              label: row.name,
              on: state.race === id && (state.subrace ? state.subrace === row.id : row.id === srs[0]?.id),
              choose: () => {
                state.race = id;
                state.subrace = row.id;
                state.armor = null;
                state.race_asi = null;
                update();
                reopenRaceTip();
              },
            }))
          : undefined;
      return {
        title: race.name,
        lines: lines.concat(cardLines(ch, (card) => card.section === `${race.name} Stuff`)),
        picks,
      };
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
      const lines: [string | null, string][] = [
        [null, cls.look.tagline],
        [
          null,
          `d${cls.hit_die} hit die • good at ${cls.primary
            .slice(0, 2)
            .map((ability) => ABN[ability])
            .join(" & ")}`,
        ],
        ["Armor training", trainingLine(cls.armor_prof, cls.shield_prof)],
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
      if (sub.armor_prof_add.length) pathLines.unshift(["Armor training", `also ${armorPhrase(sub.armor_prof_add)}`]);
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
      const cls = classBy(state.cls);
      const sub = tables.subclasses.find((item) => item.id === state.subclass);
      const sr = tables.subraces.find((item) => item.id === state.subrace);
      const from = [`${cls.name} gives ${trainingLine(cls.armor_prof, cls.shield_prof)}`];
      if (sub && state.level >= cls.subclass_level && sub.armor_prof_add.length)
        from.push(`${sub.name} gives ${armorPhrase(sub.armor_prof_add)}`);
      if (sr) {
        const added = armorPhrase(sr.armor_prof_add);
        if (added) from.push(`${sr.name} gives ${added}`);
      }
      const lines: [string | null, string][] = [
        [
          row ? `${row.kind[0]?.toUpperCase() ?? ""}${row.kind.slice(1)} armor` : "Nothing worn",
          `Armor ${armor.ac} for you (${how})`,
        ],
        ["Armor training", from.join(". ")],
      ];
      if (armor.strReq) lines.push(["Strength", `Needs Strength ${armor.strReq}, or you move 10 ft slower`]);
      if (!armor.trained) lines.push([null, dmText("Off the list for this hero")]);
      return { title: armor.name, lines };
    },
  };

  function reopenRaceTip(): void {
    for (const node of document.querySelectorAll(".field")) {
      if (!node.querySelector(".flabel")?.textContent?.startsWith("Race")) continue;
      const btn = node.querySelector(".chip-btn.on");
      if (btn) showTip(btn);
      return;
    }
  }

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
    tipNode(
      el(
        "button",
        { type: "button", class: "dice", title: `Random ${label}`, "aria-label": `Random ${label}`, onclick: fn },
        "🎲",
      ),
      HELP.dice(label),
    );

  function dmText(reason: string): string {
    const sentence = reason.endsWith(".") ? reason : `${reason}.`;
    return `${sentence} Check with your DM.`;
  }

  function dmWarn(reason: string, ...extra: Kid[]): HTMLElement {
    return el("p", { class: "hint block warn" }, dmText(reason), ...extra);
  }

  function stepBtn(
    label: string,
    down: boolean,
    disabled: boolean,
    onclick: () => void,
    mini = false,
  ): HTMLButtonElement {
    return tipNode(
      el(
        "button",
        { type: "button", class: `step${mini ? " mini" : ""}`, "aria-label": label, disabled, onclick },
        down ? "−" : "+",
      ),
      HELP.step(label),
    );
  }

  function swapHint(open: boolean, off: boolean): string {
    if (open) return "close";
    return off ? "off book • swap ▾" : "swap ▾";
  }

  function choiceRow(opts: {
    name: string;
    open: boolean;
    off: boolean;
    locked?: boolean;
    badge?: HTMLElement | null;
    desc: string;
    hint: string;
    title?: string;
    onOpen: () => void;
    roll: HTMLElement | null;
    onRemove: () => void;
  }): HTMLElement {
    return el(
      "li",
      { class: `spell${opts.locked ? " locked" : ""}${opts.open ? " open" : ""}${opts.off ? " offbook" : ""}` },
      el(
        "button",
        {
          type: "button",
          class: "sname",
          "aria-expanded": opts.open ? "true" : "false",
          title: opts.title,
          onclick: opts.onOpen,
        },
        el("b", {}, opts.name),
        opts.badge ?? null,
        el("small", {}, opts.desc),
        el("span", { class: "swaphint" }, opts.hint),
      ),
      opts.roll,
      tipNode(
        el(
          "button",
          {
            type: "button",
            class: "icon",
            title: "Remove",
            "aria-label": `Remove ${opts.name}`,
            onclick: opts.onRemove,
          },
          "✕",
        ),
        help("Remove", "Takes this off the list."),
      ),
    );
  }

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

  function learnable(kind: SpellKind, built: HeroOptions, every: boolean): string[] {
    if (kind === "cantrips") {
      if (!every) return built.cantripPool;
      return tables.spells
        .filter((row) => row.lvl === 0 && !built.bonusCantrips.includes(row.name))
        .map((row) => row.name)
        .sort();
    }
    if (!every) return built.spellPool;
    return built.anyPool.filter((name) => !built.auto.includes(name));
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
    const spellKind: SpellKind | null = kind === "cantrips" || kind === "spells" ? kind : null;
    const widen =
      spellKind !== null && !poolOverride && picker?.kind === kind && picker.index === index && picker.all === true;
    const allowed = spellKind ? learnable(spellKind, built, false) : [];
    const pool = poolOverride ?? (isItem ? built.itemPool : spellKind ? learnable(spellKind, built, widen) : []);
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
    const scope =
      spellKind && !poolOverride
        ? tipNode(
            el(
              "label",
              { class: "pall" },
              el("input", {
                type: "checkbox",
                checked: !widen,
                onchange: (ev) => {
                  picker = { kind, index, all: !inputOf(ev).checked };
                  update();
                },
              }),
              !widen ? "Allowed for this hero" : isCantrip ? "All cantrips" : "All spells",
            ),
            help("This class only", "Checked keeps the list to what this class can learn. Uncheck it to see the rest."),
          )
        : null;
    return el(
      "div",
      { class: "picker", role: "dialog", "aria-label": `Choose a ${what}` },
      el(
        "div",
        { class: "phead" },
        el("div", {}, el("b", {}, index < 0 ? `Add a ${what}` : `Swap ${current[index]} for…`), scope),
        tipNode(
          el("button", { type: "button", class: "icon", "aria-label": "Close", onclick: close }, "✕"),
          help("Close", "Closes this list."),
        ),
      ),
      names.length
        ? null
        : el(
            "p",
            { class: "hint block" },
            widen ? "Nothing left to pick." : "Nothing else this hero can learn. Uncheck the box to see the rest.",
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
                const warn = isItem ? built.itemWarn(name) : "";
                const offList = !!warn || (widen && !allowed.includes(name));
                return el(
                  "button",
                  {
                    type: "button",
                    class: `popt${currentName ? " on" : ""}${offList ? " offbook" : ""}`,
                    "aria-pressed": currentName ? "true" : "false",
                    onclick: () => choose(name),
                  },
                  el(
                    "span",
                    { class: "ptop" },
                    el("b", {}, name),
                    card.tag ? el("span", { class: `ptag t${card.tag}` }, TAGLBL[card.tag] || card.tag) : null,
                    card.note ? el("span", { class: "pnote" }, card.note) : null,
                    offList ? el("span", { class: "swaphint" }, "off book") : null,
                  ),
                  el("span", { class: "pdesc" }, (card.desc || "").replace(/\{[A-Z0-9_]+\}/g, "…")),
                  warn ? el("span", { class: "pwarn" }, dmText(warn)) : null,
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
          choiceRow({
            name,
            open: isOpen,
            off: !book,
            locked: true,
            badge: el("span", { class: "lvl" }, `L${built.spellLevel(name)}`),
            desc: liveDesc[name] || (built.spellCard(name)?.desc || "").replace(/\{[A-Z0-9_]+\}/g, "…"),
            hint: book ? "path spell • swap ▾" : "off book • swap ▾",
            onOpen: () => {
              picker = isOpen ? null : { kind: "path_spells", index: i };
              update();
            },
            roll: dice(name, () => {
              const free = built.anyPool.filter((item) => !pathCur.includes(item) && !current.includes(item));
              if (!free.length) return;
              const arr = pathCur.slice();
              arr[i] = pick(free);
              setPath(arr);
            }),
            onRemove: () => setPath(pathCur.filter((_, j) => j !== i)),
          }),
        );
        if (isOpen)
          items.push(
            el("li", { class: "pwrap" }, pickerPanel("path_spells", built, pathCur, i, built.anyPool, current)),
          );
      });
    }
    current.forEach((name, i) => {
      const isOpen = picker?.kind === kind && picker.index === i;
      const offList = !pool.includes(name);
      items.push(
        choiceRow({
          name,
          open: isOpen,
          off: offList,
          badge: isCantrip ? null : el("span", { class: "lvl" }, `L${built.spellLevel(name)}`),
          desc: liveDesc[name] || (built.spellCard(name)?.desc || "").replace(/\{[A-Z0-9_]+\}/g, "…"),
          hint: swapHint(isOpen, offList),
          title: "Click to see other choices",
          onOpen: () => open(i),
          roll: dice(name, () => {
            const free = pool.filter((item) => !current.includes(item) && !built.auto.includes(item));
            if (!free.length) return;
            const arr = current.slice();
            arr[i] = pick(free);
            set(arr);
          }),
          onRemove: () => set(current.filter((_, j) => j !== i)),
        }),
      );
      if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel(kind, built, current, i)));
    });
    const freeLeft = pool.some((name) => !current.includes(name));
    const anyLeft = learnable(kind, built, true).some((name) => !current.includes(name));
    if (current.length < max && (freeLeft || anyLeft)) {
      const isOpen = picker?.kind === kind && picker.index === -1;
      items.push(
        el(
          "li",
          {},
          tipNode(
            el(
              "button",
              { type: "button", class: "addbtn", "aria-expanded": isOpen ? "true" : "false", onclick: () => open(-1) },
              `+ add ${isCantrip ? "a cantrip" : "a spell"} (${max - current.length} left)`,
            ),
            HELP.addSpell(isCantrip ? "cantrip" : "spell"),
          ),
        ),
      );
      if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel(kind, built, current, -1)));
    }
    const reset = tipNode(
      el(
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
      ),
      help("Reset", "Puts the usual spells back."),
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
    const stray = current.filter((name) => !pool.includes(name));
    const notes: HTMLElement[] = [];
    if (stray.length) {
      const names = stray.join(", ");
      notes.push(dmWarn(`${names} ${stray.length > 1 ? "are" : "is"} off the list for this hero`));
    }
    if (offBook) {
      notes.push(
        dmWarn(
          what,
          " ",
          tipNode(
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
            help("Back to the book", "Puts the path spells back."),
          ),
        ),
      );
    }
    const allDice = dice(isCantrip ? "cantrips" : "spells", () => {
      set(shuffle(pool.filter((name) => !built.auto.includes(name))).slice(0, max));
    });
    return field(isCantrip ? "Cantrips" : "Spells", el("div", {}, notes, el("ul", { class: "spells" }, items)), [
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
        stepBtn(`Lower ${ABN[key]}`, true, base[key] <= 3, () => set(key, base[key] - 1)),
        el("b", { class: "abbase", "aria-label": `${ABN[key]} ${base[key]}` }, String(base[key])),
        stepBtn(`Raise ${ABN[key]}`, false, base[key] >= 18, () => set(key, base[key] + 1)),
        stepBtn(`Lower race bonus for ${ABN[key]}`, true, rb <= 0, () => setR(rb - 1), true),
        el("span", { class: "abbonus" }, rb ? sg(rb) : "0"),
        stepBtn(`Raise race bonus for ${ABN[key]}`, false, rb >= 3, () => setR(rb + 1), true),
        el("span", { class: "abfinal" }, `${fin[key].score} (${sg(fin[key].mod)})${lvlUp ? " ↑" : ""}`),
        el("span", { class: "abcost" }, cost === null ? "—" : `${cost} pt`),
      );
    });
    const summary = !pb
      ? null
      : offChart
        ? dmWarn("These scores are outside the 8–15 point-buy chart")
        : total > pb.budget
          ? dmWarn(`Point buy is ${total} of ${pb.budget} points, which is over budget`)
          : el(
              "p",
              { class: "pbline" },
              `Point buy: ${total} of ${pb.budget} points${total < pb.budget ? ` (${pb.budget - total} to spend)` : " ✓"}`,
            );
    const reset = tipNode(
      el(
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
      ),
      HELP.resetNumbers,
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
          { class: "pbline" },
          "Race bonus: put it wherever you like (newer rules let you pick). ",
          state.race_asi ? `Adds up to +${rTotal}. ` : "",
          state.race_asi
            ? tipNode(
                el(
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
                ),
                help("Usual race bonus", "Puts the race bonus back where the book puts it."),
              )
            : null,
        ),
        state.race_asi && rTotal !== usualTotal
          ? dmWarn(`This race bonus adds up to +${rTotal}. The usual is +${usualTotal}`)
          : null,
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
          opts.map((armor) => {
            const off = !armor.trained;
            return tipped(
              el(
                "button",
                {
                  type: "button",
                  class: `chip-btn${armor.name === curName ? " on" : ""}${off ? " offbook" : ""}`,
                  "aria-pressed": armor.name === curName ? "true" : "false",
                  onclick: () => {
                    state.armor = armor.name;
                    update();
                  },
                },
                `${armor.name} • ${armor.ac}${off ? " • off book" : ""}${armor.strReq > str ? " ⚠" : ""}`,
              ),
              () => TIP.armor(armor),
            );
          }),
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
        lines: [
          [null, "+2 Armor. Takes up one hand while you carry it."],
          ["Armor training", `${classBy(state.cls).name} can use a shield`],
        ],
      }));
    const wearing = built.armorOptions.find((armor) => armor.name === curName);
    const offbook = wearing ? !wearing.trained : false;
    const reset = tipNode(
      el(
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
      ),
      help("Reset", "Puts the usual armor back."),
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
        offbook ? dmWarn(`${curName} is off the list for this hero`) : null,
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
    const reset = tipNode(
      el(
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
      ),
      help("Reset", "Puts the usual weapon back."),
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

  const NUMBER_KEYS = [
    "ac",
    "hp",
    "speed",
    "swim",
    "initiative",
    "prof",
    "notice",
    "spell_attack",
    "spell_dc",
  ] as const;

  function editNumbers(change: (draft: NumberOverrides) => void): void {
    const draft: NumberOverrides = {
      ...state.numbers,
      skills: { ...state.numbers?.skills },
      saves: { ...state.numbers?.saves },
      attacks: { ...state.numbers?.attacks },
    };
    change(draft);
    const next: NumberOverrides = {};
    if (draft.skills && Object.keys(draft.skills).length) next.skills = draft.skills;
    if (draft.saves && Object.keys(draft.saves).length) next.saves = draft.saves;
    if (draft.attacks && Object.keys(draft.attacks).length) next.attacks = draft.attacks;
    for (const key of NUMBER_KEYS) {
      const value = draft[key];
      if (typeof value === "number") next[key] = value;
    }
    state.numbers = Object.keys(next).length ? next : null;
    update();
  }

  function numberRow(
    label: string,
    value: number,
    book: number,
    lo: number,
    hi: number,
    text: (n: number) => string,
    onChange: (next: number) => void,
  ): HTMLElement {
    const off = value !== book;
    const clamp = (n: number) => Math.max(lo, Math.min(hi, n));
    return el(
      "div",
      { class: `numrow${off ? " offbook" : ""}` },
      el("span", { class: "numname" }, label),
      stepBtn(`Lower ${label}`, true, value <= lo, () => onChange(clamp(value - 1))),
      el("b", { "aria-label": `${label} ${text(value)}` }, text(value)),
      stepBtn(`Raise ${label}`, false, value >= hi, () => onChange(clamp(value + 1))),
      el("span", { class: "hint" }, off ? "off book" : "book"),
    );
  }

  function resetNumbers(clear: (draft: NumberOverrides) => void, changed: boolean): HTMLElement {
    return tipNode(
      el(
        "button",
        {
          type: "button",
          class: "link",
          onclick: () => editNumbers(clear),
        },
        changed ? "reset" : "default • reset",
      ),
      HELP.resetNumbers,
    );
  }

  function skillsField(book: Character, live: Character): HTMLElement {
    let changed = false;
    const rows = live.skills.map((skill) => {
      const bookBonus = book.skills.find((row) => row.name === skill.name)?.bonus ?? skill.bonus;
      if (skill.bonus !== bookBonus) changed = true;
      return numberRow(skill.name, skill.bonus, bookBonus, -10, 20, signed, (next) => {
        editNumbers((draft) => {
          const skills = draft.skills ?? {};
          if (next === bookBonus) delete skills[skill.name];
          else skills[skill.name] = next;
          draft.skills = skills;
        });
      });
    });
    return field(
      "Skills",
      el("div", { class: "numgrid", id: "skill-numbers" }, rows, changed ? dmWarn("Off book") : null),
      resetNumbers((draft) => {
        draft.skills = {};
      }, changed),
    );
  }

  function savesField(book: Character, live: Character): HTMLElement {
    let changed = false;
    const rows = ABILITIES.map((key) => {
      const bookSave = book.abilities.find((row) => row.key === key)?.save ?? 0;
      const save = live.abilities.find((row) => row.key === key)?.save ?? bookSave;
      if (save !== bookSave) changed = true;
      return numberRow(ABN[key], save, bookSave, -10, 20, signed, (next) => {
        editNumbers((draft) => {
          const saves = { ...draft.saves };
          if (next === bookSave) delete saves[key];
          else saves[key] = next;
          draft.saves = saves;
        });
      });
    });
    return field(
      "Saves",
      el("div", { class: "numgrid", id: "save-numbers" }, rows, changed ? dmWarn("Off book") : null),
      resetNumbers((draft) => {
        draft.saves = {};
      }, changed),
    );
  }

  function sheetNumbersField(book: Character, live: Character): HTMLElement {
    const bookPerception = book.skills.find((skill) => skill.name === "Perception")?.bonus;
    const livePerception = live.skills.find((skill) => skill.name === "Perception")?.bonus;
    const noticeBook =
      bookPerception !== undefined && livePerception !== undefined && livePerception !== bookPerception
        ? 10 + livePerception
        : book.combat.passive_perception;
    const rows: HTMLElement[] = [];
    let changed = false;
    const add = (
      label: string,
      value: number,
      bookValue: number,
      lo: number,
      hi: number,
      text: (n: number) => string,
      key: (typeof NUMBER_KEYS)[number],
    ) => {
      if (value !== bookValue) changed = true;
      rows.push(
        numberRow(label, value, bookValue, lo, hi, text, (next) => {
          editNumbers((draft) => {
            if (next === bookValue) delete draft[key];
            else draft[key] = next;
          });
        }),
      );
    };
    const plain = (n: number) => String(n);
    add("Armor class", live.combat.ac, book.combat.ac, 0, 40, plain, "ac");
    add("Max HP", live.combat.max_hp, book.combat.max_hp, 1, 400, plain, "hp");
    add("Speed", live.combat.speed, book.combat.speed, 0, 200, plain, "speed");
    add("Swim", live.combat.swim, book.combat.swim, 0, 200, plain, "swim");
    add("Initiative", live.combat.initiative, book.combat.initiative, -10, 20, signed, "initiative");
    add("Proficiency", live.combat.prof, book.combat.prof, 0, 10, signed, "prof");
    add("Notice", live.combat.passive_perception, noticeBook, 0, 40, plain, "notice");
    if (live.spellcasting && book.spellcasting) {
      add("Spell attack", live.spellcasting.attack, book.spellcasting.attack, -10, 20, signed, "spell_attack");
      add("Spell DC", live.spellcasting.dc, book.spellcasting.dc, 0, 40, plain, "spell_dc");
    }
    for (const attack of live.attacks) {
      const bookHit = book.attacks.find((row) => row.name === attack.name)?.to_hit;
      if (bookHit === undefined) continue;
      if (attack.to_hit !== bookHit) changed = true;
      rows.push(
        numberRow(`${attack.name} to hit`, attack.to_hit, bookHit, -10, 20, signed, (next) => {
          editNumbers((draft) => {
            const attacks = draft.attacks ?? {};
            if (next === bookHit) delete attacks[attack.name];
            else attacks[attack.name] = next;
            draft.attacks = attacks;
          });
        }),
      );
    }
    return field(
      "Other numbers",
      el("div", { class: "numgrid", id: "sheet-numbers" }, rows, changed ? dmWarn("Off book") : null),
      resetNumbers((draft) => {
        for (const key of NUMBER_KEYS) delete draft[key];
        draft.attacks = {};
      }, changed),
    );
  }

  function advanced(built: HeroOptions): HTMLElement {
    const book = buildCharacter(tables, { ...request(), numbers: null });
    const live = buildCharacter(tables, request());
    const details = el(
      "details",
      {
        class: "adv",
        ontoggle: (ev) => {
          if (ev.target instanceof HTMLDetailsElement) prefs.adv = ev.target.open;
          savePrefs();
        },
      },
      tipNode(
        el(
          "summary",
          {},
          "Fine-tune: armor, scores, saves, skills & other numbers",
          el("span", { class: "hint" }, "The defaults are usually fine, but you can change all of these."),
        ),
        help("Fine-tune", "Armor, scores, saves, skills, and the other numbers. The defaults are usually fine."),
      ),
      armorField(built),
      weaponField(built),
      abilityField(built),
      savesField(book, live),
      skillsField(book, live),
      sheetNumbersField(book, live),
      subraceField(built),
    );
    if (prefs.adv) details.open = true;
    return details;
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
      const warn = built.itemWarn(name);
      items.push(
        choiceRow({
          name,
          open: isOpen,
          off: !!warn,
          badge: el("span", { class: "lvl" }, built.itemRarity(name)),
          desc: liveDesc[name] || built.itemCard(name)?.desc || "",
          hint: swapHint(isOpen, !!warn),
          onOpen: () => {
            picker = isOpen ? null : { kind: "items", index: i };
            update();
          },
          roll: dice(name, () => {
            const free = built.itemPool.filter((item) => !current.includes(item) && !built.itemWarn(item));
            if (!free.length) return;
            const arr = current.slice();
            arr[i] = pick(free);
            set(arr);
          }),
          onRemove: () => set(current.filter((_, j) => j !== i)),
        }),
      );
      if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel("items", built, current, i)));
    });
    if (current.length < max) {
      const isOpen = picker?.kind === "items" && picker.index === -1;
      items.push(
        el(
          "li",
          {},
          tipNode(
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
            help("Add a potion or item", "Opens the list."),
          ),
        ),
      );
      if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel("items", built, current, -1)));
    }
    const reset = tipNode(
      el(
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
      ),
      help("Reset", "Puts the usual potions and items back."),
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
    const notes = current
      .filter((name) => built.itemWarn(name))
      .map((name) => dmWarn(`${name}: ${built.itemWarn(name)}`));
    return field("Potions & Magic Items", el("div", {}, notes, el("ul", { class: "spells" }, items), note), [
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
    panel.append(el("p", { class: "tagline lead" }, "Build a D&D 5e inspired hero:"));
    const nameIn = tipNode(
      el("input", {
        id: "name",
        type: "text",
        value: state.name,
        maxlength: 40,
        autocomplete: "off",
        oninput: (ev) => {
          state.name = textOf(ev).value;
          update(false);
          faces.noteName();
        },
      }),
      HELP.name,
    );
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
            faces.noteName();
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
    const inv = tipNode(
      el(
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
      ),
      HELP.inventory,
    );
    panel.append(field("Inventory", inv, "one per line"));
    const notes = tipNode(
      el(
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
      ),
      HELP.notes,
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
    panel.append(field("Picture", faces.controls(), "or leave blank and draw one"));
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
      numbers: null,
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
      void faces.draw(avatarField.style, seed);
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
      const del = tipNode(
        el(
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
        ),
        HELP.deleteHero,
      );
      return el(
        "li",
        { class: `herorow${cur ? " on" : ""}` },
        tipNode(
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
          HELP.savedHero,
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
      tipNode(
        el(
          "summary",
          {},
          `Random rolls (${rolls.length})`,
          el("span", { class: "hint" }, " — dice heroes you haven't changed; change one and it moves up"),
        ),
        help("Random rolls", "Dice heroes you haven't changed. Change one and it moves up."),
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
        tipNode(
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
          help("Close", "Hides this list. The heroes stay saved in this browser."),
        ),
      ),
      mine.length
        ? el("ul", { class: "herolist" }, mine.map(row))
        : el("p", { class: "hint block" }, "Change anything on a hero and it's saved here."),
      el(
        "div",
        { class: "row" },
        tipNode(
          el("button", { type: "button", class: "ghost", onclick: newRandomHero }, "🎲 New random hero"),
          HELP.newHero,
        ),
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

  function dropPack(title: string): void {
    loadReport = [];
    if (
      customInfo.sources.some((source) => source.label === "link" && (source.title === title || source.label === title))
    ) {
      storage.remove(CUSTOM_URL_KEY);
      storage.remove(`${CUSTOM_URL_KEY}-text`);
      memUrlText = null;
      urlStatus = "";
    }
    saveLib(loadLib().filter((pack) => pack.title !== title));
    reloadTables();
  }

  function customSection(): HTMLElement {
    const lib = loadLib();
    const siteTitles = new Set(sitePacks.map((pack) => pack.title));
    const rows = sitePacks.map((pack) => ({
      title: pack.title || pack.file,
      about: pack.about,
      on:
        lib.some((item) => item.title === pack.title) ||
        customInfo.sources.some((source) => source.title === pack.title),
      toggle: (checked: boolean) => {
        if (checked) addSitePack(pack);
        else dropPack(pack.title);
      },
    }));
    for (const source of customInfo.sources) {
      if (siteTitles.has(source.title)) continue;
      const title = source.title || source.label;
      rows.push({
        title,
        about: source.counts.join(", ") || "nothing new",
        on: true,
        toggle: (on: boolean) => {
          if (!on) dropPack(title);
        },
      });
    }
    const savedUrl = storage.get(CUSTOM_URL_KEY) || "";
    return contentPackPanel({
      open: !!(prefs.custom || customInfo.error || customInfo.problems.length || loadReport.length),
      onToggle: (open) => {
        prefs.custom = open;
        savePrefs();
      },
      summaryHint: "Add a race, class, spell, or item. An AI can write the file.",
      guideHref: "https://github.com/ggggggggg/hero-sheets/blob/main/CUSTOM_CONTENT_GUIDE.md",
      builtin: {
        id: "use-builtin",
        title: SRD_TITLE,
        about: "the built-in heroes",
        on: !prefs.noBuiltin,
        toggle: (on) => {
          prefs.noBuiltin = !on;
          savePrefs();
          loadReport = [];
          reloadTables();
        },
      },
      rows,
      problems: [...(customInfo.error ? [customInfo.error] : []), ...new Set(customInfo.problems.concat(loadReport))],
      onFileText: (text, name) => {
        addPackText(text, name);
      },
      onPaste: (text) => {
        addPackText(text, "pasted pack");
      },
      link: {
        value: savedUrl,
        status: urlStatus,
        saved: !!savedUrl,
        onLoad: (url) => {
          urlStatus = "Loading…";
          void fetchCustomUrl(url, false).then((ok) => {
            prefs.custom = true;
            savePrefs();
            if (ok) reloadTables();
            else update();
          });
        },
        onForget: () => {
          storage.remove(CUSTOM_URL_KEY);
          storage.remove(`${CUSTOM_URL_KEY}-text`);
          memUrlText = null;
          urlStatus = "";
          reloadTables();
        },
      },
      afterList: customInfo.heroes.length
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
      foot: [
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
      ],
      onClear: () => {
        if (!window.confirm("Forget the heroes and content packs saved in this browser?")) return;
        clearSavedKeys(DND_SAVE_KEYS);
        location.reload();
      },
    });
  }

  function fitBack(root: ParentNode): void {
    const cards = root.querySelector(".page.back .cards");
    if (!(cards instanceof HTMLElement) || !cards.clientHeight) return;
    fitCardFont(cards);
  }

  function scalePreview(): void {
    const wrap = $("#preview");
    const sheet = wrap.querySelector(".sheet");
    const layout = previewLayout(wrap.clientWidth);
    if (!(sheet instanceof HTMLElement) || !layout) return;
    sheet.classList.toggle("side", layout.side);
    sheet.style.transform = `scale(${layout.scale})`;
    $("#scaler").style.height = `${layout.height}px`;
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
    const idn = buildCharacter(tables, request()).identity;
    const name = fileStem(idn.name) || "Hero";
    const cls = fileStem(idn.cls);
    const sub = idn.subclass ? ` (${fileStem(idn.subclass)})` : "";
    return `${name} - Level ${idn.level} ${cls}${sub}`;
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
      save();
      const html = sheetHtml(buildCharacter(tables, request()));
      const blob = await makePdf(html, state.name || "Hero", {
        state: structuredClone(state),
        packs: currentHero()?.packs ?? [],
      });
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

  function keepHeroPacks(packs: PackCopy[], race: string, cls: string): string | null {
    const savedLib = loadLib();
    const savedBuiltin = !!prefs.noBuiltin;
    const savedUrl = storage.get(CUSTOM_URL_KEY);
    const savedUrlText = storage.get(`${CUSTOM_URL_KEY}-text`);
    const savedMem = memUrlText;
    const savedStatus = urlStatus;
    const restore = () => {
      saveLib(savedLib);
      prefs.noBuiltin = savedBuiltin;
      memUrlText = savedMem;
      urlStatus = savedStatus;
      if (savedUrl) storage.set(CUSTOM_URL_KEY, savedUrl);
      else storage.remove(CUSTOM_URL_KEY);
      if (savedUrlText) storage.set(`${CUSTOM_URL_KEY}-text`, savedUrlText);
      else storage.remove(`${CUSTOM_URL_KEY}-text`);
      savePrefs();
      tables = withCustom();
      RACES = byId(tables.races);
      CLASSES = byId(tables.classes);
    };
    const problem = () => customInfo.error || customInfo.problems[0] || "";
    saveLib(packs.map((pack) => ({ title: pack.title, text: pack.text })));
    storage.remove(CUSTOM_URL_KEY);
    storage.remove(`${CUSTOM_URL_KEY}-text`);
    memUrlText = null;
    urlStatus = "";
    loadReport = [];
    prefs.noBuiltin = false;
    tables = withCustom();
    const reason = problem();
    if (reason) {
      restore();
      return reason;
    }
    prefs.noBuiltin = true;
    tables = withCustom();
    const packOnly = !problem() && !!byId(tables.races)[race] && !!byId(tables.classes)[cls];
    if (!packOnly) {
      prefs.noBuiltin = false;
      tables = withCustom();
    }
    RACES = byId(tables.races);
    CLASSES = byId(tables.classes);
    if (!RACES[race] || !CLASSES[cls]) {
      restore();
      return "This hero's race or class isn't in the pack from that PDF.";
    }
    prefs.custom = true;
    savePrefs();
    return null;
  }

  async function openHeroPdf(file: File): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      status(messageOf(error) || "Couldn't read that PDF.", true);
      return;
    }
    const sheet = readHeroSheet(bytes);
    if (!sheet) {
      status("This PDF has no hero from Hero Sheet Builder.", true);
      return;
    }
    if (sheet.state.kind === "paf") {
      status("This PDF is a post-apocalyptic hero. Open it on the PAF page.", true);
      return;
    }
    const patch = heroPatch(sheet.state);
    if (!patch?.race || !patch.cls) {
      status("This PDF's hero is missing a race or class.", true);
      return;
    }
    save();
    const kept = keepHeroPacks(sheet.packs, patch.race, patch.cls);
    if (kept) {
      status(kept, true);
      update();
      return;
    }
    const slot: HeroRecord = {
      id: newId(),
      state: patch,
      edited: true,
      updated: Date.now(),
      packs: sheet.packs,
    };
    book.heroes.push(slot);
    book.current = slot.id;
    state = { ...DEFAULT, ...patch, choices: { ...(patch.choices ?? {}) } };
    picker = null;
    update();
    status(`Opened ${state.name}.`);
    setView("build");
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
    state.numbers = null;
    rolling = true;
    update();
    markRolled();
    const myId = book.current;
    void faces.randomFace().finally(() => {
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
    state.numbers = null;
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
  const openPdfInput = $("#open-pdf-file");
  if (!(openPdfInput instanceof HTMLInputElement)) throw new Error("missing #open-pdf-file");
  const openPdf = $("#open-pdf");
  tipChrome();
  openPdf.addEventListener("click", () => openPdfInput.click());
  openPdfInput.addEventListener("change", () => {
    const chosen = openPdfInput.files?.[0];
    if (!chosen) return;
    void openHeroPdf(chosen)
      .catch((error: unknown) => {
        status(messageOf(error) || "Couldn't open that PDF.", true);
      })
      .finally(() => {
        openPdfInput.value = "";
      });
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
  const want = new URLSearchParams(location.search).get("pack");
  const skipSavedTobin = !want && !buildParam && window.CHARSHEET_FIXED_START !== true && /^Tobin\b/.test(state.name);
  if (skipSavedTobin) newRandomHero();
  else {
    try {
      update();
    } catch (error) {
      if (!(error instanceof CharError) && !(error instanceof CustomError)) throw error;
      storage.remove(KEY);
      state = { ...DEFAULT, choices: {} };
      update();
    }
    if (!haveSaved && !window.CHARSHEET_FIXED_START && !buildParam) surprise();
    else if (!haveSaved) markRolled();
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
  const auto = sitePacks.find((pack) => want !== null && (pack.file === want || pack.file === `${want}.json`));
  if (auto && !loadLib().some((pack) => pack.title === auto.title)) addSitePack(auto);
  else update();
  document.documentElement.dataset.booted = "1";
}
