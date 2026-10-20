import { ExportError, makePdf, readHeroSheet } from "../export";
import { createFaceKit, type FacePick, type Look } from "../face";
import { fitCardFont, previewLayout } from "../fit";
import { contentPackPanel } from "../pack-ui";
import { clearSavedKeys, PAF_SAVE_KEYS, refreshBundledPacks } from "../packs";
import { ABILITY_NAME } from "../tags";
import { fileStem } from "../text";
import { createTips, type Tip } from "../tips";
import { ABILITIES, type Ability, type AbilityScores } from "../types";
import {
  buildCharacter,
  CharError,
  options,
  type PafCharacter,
  type PafOrigin,
  type PafRequest,
  type PafTables,
  pairOrigins,
  sheetHtml,
  signed,
} from "./core";
import { mergePaf, packTitle, parsePafPack } from "./custom";

const HEROES_KEY = "paf-heroes-v1";
const PACKS_KEY = "paf-packs-v1";
const PREFS_KEY = "paf-ui-v1";
const PACK_URL_KEY = "paf-pack-url-v1";
const NAMES = [
  "Ada",
  "Bram",
  "Cleo",
  "Dot",
  "Ezra",
  "Fern",
  "Gus",
  "Huck",
  "Ivy",
  "Juno",
  "Kit",
  "Lux",
  "Moss",
  "Nell",
  "Otto",
  "Pip",
  "Quin",
  "Rook",
  "Sable",
  "Tess",
  "Uma",
  "Vesper",
  "Wren",
  "Yael",
];

interface PafState extends PafRequest {
  kind: "paf";
  avatar: FacePick | null;
  look: Look | null;
}

export interface PafSitePack {
  file: string;
  title: string;
  about: string;
  text: string;
}

interface SavedHero {
  id: string;
  state: PafState;
  updated: number;
}

interface Book {
  current: string;
  heroes: SavedHero[];
}

interface DownloadCap {
  save: (file: { filename: string; data: Blob }) => Promise<void>;
}

type Kid = Node | string | number | null | false | undefined;
type Attrs = {
  id?: string;
  class?: string;
  style?: string | null;
  type?: string;
  role?: string;
  href?: string;
  for?: string;
  min?: string;
  max?: string;
  value?: string;
  rows?: string;
  open?: boolean;
  accept?: string;
  title?: string;
  "aria-label"?: string;
  "aria-pressed"?: string;
  "aria-current"?: string;
  onclick?: (ev: Event) => void;
  oninput?: (ev: Event) => void;
  onchange?: (ev: Event) => void;
  ontoggle?: (ev: Event) => void;
};

declare global {
  interface Window {
    __setPaf?: (origin1: string, origin2: string, level: number) => void;
  }
}

function $(sel: string): HTMLElement {
  const node = document.querySelector(sel);
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

function field(label: string, control: Node, hint?: Kid | Kid[]): HTMLElement {
  return el(
    "div",
    { class: "field" },
    el("div", { class: "flabel" }, label, hint ? el("span", { class: "hint" }, hint) : null),
    control,
  );
}

function dice(label: string, fn: () => void): HTMLButtonElement {
  return el(
    "button",
    { type: "button", class: "dice", title: `Random ${label}`, "aria-label": `Random ${label}`, onclick: fn },
    "🎲",
  );
}

function textOf(ev: Event): string {
  if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return ev.target.value;
  return "";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error("nothing to pick");
  return item;
}

function rollOther<T>(items: readonly T[], current: T): T {
  const rest = items.filter((item) => item !== current);
  return pick(rest.length ? rest : items);
}

function rollScores(): AbilityScores {
  const die = () => 1 + Math.floor(Math.random() * 6);
  const three = () => die() + die() + die();
  return { STR: three(), DEX: three(), CON: three(), INT: three(), WIS: three(), CHA: three() };
}

function newId(): string {
  return `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function scoresOf(value: unknown): AbilityScores | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const scores: AbilityScores = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };
  for (const ability of ABILITIES) {
    const n = row[ability];
    if (typeof n !== "number" || n < 1 || n > 20) return null;
    scores[ability] = n;
  }
  return scores;
}

function linesOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const lines: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    lines.push(item);
  }
  return lines;
}

function optString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stateFrom(value: unknown): PafState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== "paf" || typeof row.origin1 !== "string" || typeof row.origin2 !== "string") return null;
  return {
    kind: "paf",
    name: typeof row.name === "string" ? row.name : "",
    origin1: row.origin1,
    origin2: row.origin2,
    level: typeof row.level === "number" ? row.level : 1,
    bonus_skill: optString(row.bonus_skill),
    crit_first: optString(row.crit_first),
    utility_first: optString(row.utility_first),
    expert_first: optString(row.expert_first),
    uber: optString(row.uber),
    scores: scoresOf(row.scores),
    armor: optString(row.armor),
    weapon: optString(row.weapon),
    inventory: linesOf(row.inventory),
    notes: typeof row.notes === "string" ? row.notes : "",
    portrait: optString(row.portrait),
    portrait_credit: optString(row.portrait_credit),
    avatar: faceOf(row.avatar),
    look: row.look === "boy" || row.look === "girl" ? row.look : null,
  };
}

function faceOf(value: unknown): FacePick | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const look = row.look === "boy" || row.look === "girl" ? row.look : null;
  if (typeof row.style !== "string" || typeof row.seed !== "string" || !look) return null;
  return { style: row.style, seed: row.seed, look };
}

function loadBook(): Book | null {
  try {
    const text = localStorage.getItem(HEROES_KEY);
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (typeof row.current !== "string" || !Array.isArray(row.heroes)) return null;
    const heroes: SavedHero[] = [];
    for (const item of row.heroes) {
      if (!item || typeof item !== "object") continue;
      const hero = item as Record<string, unknown>;
      const state = stateFrom(hero.state);
      if (typeof hero.id !== "string" || !state) continue;
      heroes.push({ id: hero.id, state, updated: typeof hero.updated === "number" ? hero.updated : 0 });
    }
    if (!heroes.some((hero) => hero.id === row.current)) return null;
    return { current: row.current, heroes };
  } catch {
    return null;
  }
}

export function startPaf(input: { tables: PafTables; sitePacks: PafSitePack[] }): void {
  const baseTables = input.tables;
  const sitePacks = input.sitePacks;
  const first = baseTables.origins[0];
  const second = baseTables.origins[1] ?? first;
  if (!first || !second) throw new Error("PAF content needs two origins");
  const { tipped } = createTips();

  function freshState(): PafState {
    return {
      kind: "paf",
      name: "",
      origin1: first.id,
      origin2: second.id,
      level: 1,
      bonus_skill: null,
      crit_first: null,
      utility_first: null,
      expert_first: null,
      uber: null,
      scores: null,
      armor: null,
      weapon: null,
      inventory: null,
      notes: "",
      portrait: null,
      portrait_credit: null,
      avatar: null,
      look: null,
    };
  }

  const fixed = window.CHARSHEET_FIXED_START === true;
  const saved = fixed ? null : loadBook();
  let book: Book = saved ?? { current: "", heroes: [] };
  if (!book.heroes.length) {
    const id = newId();
    book = { current: id, heroes: [{ id, state: freshState(), updated: Date.now() }] };
  }
  const current = book.heroes.find((hero) => hero.id === book.current) ?? book.heroes[0];
  if (!current) throw new Error("no hero");
  book.current = current.id;
  let state = structuredClone(current.state);

  interface PafPrefs {
    packsOpen?: boolean;
    noBuiltin?: boolean;
  }
  function loadPrefs(): PafPrefs {
    try {
      const text = localStorage.getItem(PREFS_KEY);
      if (!text) return {};
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") return {};
      const row = parsed as Record<string, unknown>;
      return { packsOpen: row.packsOpen === true, noBuiltin: row.noBuiltin === true };
    } catch {
      return {};
    }
  }
  const prefs = loadPrefs();
  function savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // private mode
    }
  }
  function loadPacks(): { title: string; text: string }[] {
    try {
      const text = localStorage.getItem(PACKS_KEY);
      if (!text) return [];
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || !("packs" in parsed)) return [];
      const row = parsed as { packs: unknown };
      if (!Array.isArray(row.packs)) return [];
      const packs: { title: string; text: string }[] = [];
      for (const item of row.packs) {
        if (!item || typeof item !== "object") continue;
        const pack = item as Record<string, unknown>;
        if (typeof pack.title === "string" && typeof pack.text === "string") {
          packs.push({ title: pack.title, text: pack.text });
        }
      }
      return packs;
    } catch {
      return [];
    }
  }
  function savePacks(packs: { title: string; text: string }[]): void {
    try {
      localStorage.setItem(PACKS_KEY, JSON.stringify({ packs }));
    } catch {
      // private mode
    }
  }
  {
    const refreshed = refreshBundledPacks(
      loadPacks(),
      sitePacks.map((pack) => ({ title: pack.title, text: pack.text })),
    );
    if (refreshed.changed) savePacks(refreshed.packs);
  }
  let packProblems: string[] = [];
  let urlStatus = "";
  function withPacks(): PafTables {
    const empty: PafTables = {
      max_level: baseTables.max_level,
      origins: [],
      skills: [],
      armor: [],
      weapons: [],
      flux: [],
      relics: [],
      capstones: [],
      heroes: [],
    };
    let current = prefs.noBuiltin ? empty : baseTables;
    const problems: string[] = [];
    for (const pack of loadPacks()) {
      try {
        current = mergePaf(current, parsePafPack(pack.text));
      } catch (error) {
        problems.push(`${pack.title}: ${messageOf(error)}`);
      }
    }
    if (current.origins.length < 2 || !current.origins.some((origin) => origin.id === "baseline")) {
      if (prefs.noBuiltin) {
        prefs.noBuiltin = false;
        savePrefs();
        return withPacks();
      }
    }
    packProblems = problems;
    return current;
  }
  let tables = withPacks();
  const faces = createFaceKit({
    read: () => state,
    write: (patch) => {
      Object.assign(state, patch);
    },
    refresh: () => update(true),
  });
  let built: PafCharacter | null = null;
  let heroesOpen = false;
  let timer = 0;
  let dlCap: DownloadCap | null | undefined;

  function originName(id: string): string {
    return tables.origins.find((origin) => origin.id === id)?.name ?? id;
  }

  function originColor(id: string): string | undefined {
    return tables.origins.find((origin) => origin.id === id)?.accent;
  }

  function originBy(id: string): PafOrigin | undefined {
    return tables.origins.find((origin) => origin.id === id);
  }

  function preview(over: Partial<PafRequest>): PafCharacter | null {
    try {
      return buildCharacter(tables, { ...state, ...over });
    } catch (error) {
      if (!(error instanceof CharError)) throw error;
      return null;
    }
  }

  function cardDesc(ch: PafCharacter | null, name: string): string {
    return ch?.cards.find((card) => card.name === name)?.desc ?? "";
  }

  function originSheet(id: string, level: number): PafCharacter | null {
    return preview({
      origin1: id,
      origin2: "baseline",
      level,
      crit_first: id,
      utility_first: id,
      expert_first: id,
    });
  }

  function originTip(id: string): Tip | null {
    const origin = originBy(id);
    if (!origin) return null;
    const now = Math.max(1, state.level);
    const lines: [string | null, string][] = [
      [null, origin.tagline],
      [null, origin.trait],
      [
        null,
        `${ABILITY_NAME[origin.primary]} 18 as the first origin, 16 as the second. 20 if both origins use ${ABILITY_NAME[origin.primary]}.`,
      ],
      [null, `${origin.skill} • speed ${origin.speed} ft • speaks ${origin.speaks}`],
    ];
    const powers: [string, string, number][] = [
      ["Always", origin.novice.name, 1],
      ["Critical", origin.crit.name, 2],
      ["Once a fight", origin.utility.name, 3],
      ["Big power", origin.expert.name, 5],
    ];
    for (const [label, name, level] of powers) {
      const desc = cardDesc(originSheet(id, Math.max(now, level)), name);
      if (!desc) continue;
      const when = now >= level ? label : `level ${level}`;
      lines.push([`${name} (${when})`, desc]);
    }
    return { title: origin.name, lines };
  }

  function levelTip(n: number): Tip | null {
    const now = preview({ level: n });
    const prev = n > 1 ? preview({ level: n - 1 }) : null;
    if (!now) return null;
    const lines: [string | null, string][] = [
      [null, `${now.combat.max_hp} HP • attacks, skills, and defenses +${now.combat.level_bonus}`],
    ];
    if (prev) {
      const had = new Set(prev.cards.map((card) => card.name));
      const fresh = now.cards.filter((card) => !had.has(card.name)).map((card) => card.name);
      if (fresh.length) lines.push(["New", fresh.join(", ")]);
      if (now.flux !== prev.flux) lines.push(["Flux", `Draw ${now.flux} when a fight starts`]);
    }
    return { title: `Level ${n}`, lines };
  }

  function skillTip(name: string): Tip | null {
    const skill = tables.skills.find((row) => row.name === name);
    if (!skill) return null;
    return {
      title: skill.name,
      lines: [[null, `${ABILITY_NAME[skill.ability]}. +4, and it stacks with an origin.`]],
    };
  }

  function armorTip(name: string): Tip | null {
    const ch = preview({ armor: name });
    if (!ch) return null;
    if (name === "No armor") {
      return {
        title: name,
        lines: [[null, `Armor ${ch.combat.ac}. 10 + level + the better of Dexterity and Intelligence.`]],
      };
    }
    const row = tables.armor.find((armor) => armor.name === name);
    if (!row) return null;
    const how =
      row.kind === "light"
        ? `Light, +${row.bonus}, and the better of Dexterity and Intelligence.`
        : `Heavy, +${row.bonus}. Dexterity and Intelligence do not add.`;
    return { title: name, lines: [[null, `Armor ${ch.combat.ac}. ${how}`]] };
  }

  function weaponTip(name: string): Tip | null {
    const row = tables.weapons.find((weapon) => weapon.name === name);
    const attack = preview({ weapon: name })?.attacks[0];
    if (!row || !attack) return null;
    return {
      title: row.name,
      lines: [[null, `${attack.damage}, ${ABILITY_NAME[row.ability]}. ${row.note}. To hit ${signed(attack.to_hit)}.`]],
    };
  }

  function slotTip(kind: "crit" | "utility" | "expert", id: string): Tip | null {
    const origin = originBy(id);
    if (!origin) return null;
    const power = kind === "crit" ? origin.crit : kind === "utility" ? origin.utility : origin.expert;
    const level = kind === "crit" ? 2 : kind === "utility" ? 3 : 5;
    const desc = cardDesc(originSheet(id, Math.max(state.level, level)), power.name);
    return { title: power.name, lines: [[origin.name, desc]] };
  }

  function resolve(): void {
    if (!tables.origins.some((origin) => origin.id === state.origin1)) state.origin1 = first.id;
    if (!tables.origins.some((origin) => origin.id === state.origin2)) state.origin2 = second.id;
    const [origin1, origin2] = pairOrigins(tables, state.origin1, state.origin2);
    state.origin1 = origin1.id;
    state.origin2 = origin2.id;
    const ids = new Set([origin1.id, origin2.id]);
    if (state.crit_first && !ids.has(state.crit_first)) state.crit_first = null;
    if (state.utility_first && !ids.has(state.utility_first)) state.utility_first = null;
    if (state.expert_first && !ids.has(state.expert_first)) state.expert_first = null;
    if (state.bonus_skill && !tables.skills.some((skill) => skill.name === state.bonus_skill)) state.bonus_skill = null;
    if (state.weapon && !tables.weapons.some((weapon) => weapon.name === state.weapon)) state.weapon = null;
    if (state.uber && !tables.capstones.some((cap) => cap.id === state.uber)) state.uber = null;
    if (state.armor && state.armor !== "No armor" && !tables.armor.some((armor) => armor.name === state.armor)) {
      state.armor = null;
    }
    const level = state.level | 0;
    state.level = Math.min(tables.max_level, Math.max(1, level));
  }

  function save(): void {
    const hero = book.heroes.find((item) => item.id === book.current);
    if (hero) {
      hero.state = structuredClone(state);
      hero.updated = Date.now();
    }
    try {
      localStorage.setItem(HEROES_KEY, JSON.stringify(book));
    } catch {
      status("This hero is too big to save in this browser.", true);
    }
  }

  function status(text: string, bad?: boolean): void {
    const node = $("#status");
    node.textContent = text;
    node.classList.toggle("bad", !!bad);
    node.hidden = !text;
  }

  function showError(message: string): void {
    const node = $("#error");
    node.hidden = false;
    node.textContent = `This combo doesn't work: ${message}`;
  }

  function chips(
    items: { id: string; label: string; color?: string; tip: () => Tip | null }[],
    current: string,
    onPick: (id: string) => void,
  ): HTMLElement {
    return el(
      "div",
      { class: "chips", role: "group" },
      items.map((item) =>
        tipped(
          el(
            "button",
            {
              type: "button",
              class: `chip-btn${item.id === current ? " on" : ""}`,
              "aria-pressed": item.id === current ? "true" : "false",
              style: item.color ? `--c:${item.color}` : null,
              onclick: () => onPick(item.id),
            },
            item.label,
          ),
          item.tip,
        ),
      ),
    );
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
    if (!built) return;
    $("#scaler").innerHTML = sheetHtml(built);
    $("#error").hidden = true;
    fitBack($("#scaler"));
    scalePreview();
  }

  function heroLabel(hero: SavedHero): string {
    const savedState = hero.state;
    return `${savedState.name || "Hero"} • Lv ${savedState.level || 1} ${originName(savedState.origin1)}`;
  }

  function switchHero(id: string): void {
    const hero = book.heroes.find((item) => item.id === id);
    if (!hero) return;
    book.current = id;
    state = structuredClone(hero.state);
    update(true);
  }

  function deleteHero(id: string): void {
    const stay = book.current !== id;
    book.heroes = book.heroes.filter((hero) => hero.id !== id);
    if (!book.heroes.length) {
      const hero = { id: newId(), state: freshState(), updated: Date.now() };
      book.heroes = [hero];
      book.current = hero.id;
      state = structuredClone(hero.state);
    } else if (!stay) {
      const hero = book.heroes[0];
      if (!hero) return;
      book.current = hero.id;
      state = structuredClone(hero.state);
    }
    update(true);
  }

  function heroesPanel(): HTMLElement {
    const rows = book.heroes
      .slice()
      .sort((a, b) => b.updated - a.updated)
      .map((hero) => {
        const label = heroLabel(hero);
        let armed = false;
        const del = el(
          "button",
          {
            type: "button",
            class: "link",
            "aria-label": `Delete ${label}`,
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
          { class: `herorow${hero.id === book.current ? " on" : ""}` },
          el(
            "button",
            {
              type: "button",
              class: "heroname",
              "aria-current": hero.id === book.current ? "true" : "false",
              onclick: () => switchHero(hero.id),
            },
            label,
          ),
          del,
        );
      });
    return el(
      "details",
      { id: "heroes", class: "adv heroes", open: true },
      el("summary", {}, "My heroes"),
      el(
        "button",
        {
          type: "button",
          class: "addbtn",
          onclick: () => {
            const id = newId();
            state = freshState();
            book.heroes.push({ id, state: structuredClone(state), updated: Date.now() });
            book.current = id;
            update(true);
          },
        },
        "New hero",
      ),
      el("ul", { class: "herolist" }, rows),
    );
  }

  function savedLink(): { url: string; title: string } | null {
    const raw = localStorage.getItem(PACK_URL_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "url" in parsed && "title" in parsed) {
        const row = parsed as { url: unknown; title: unknown };
        if (typeof row.url === "string" && typeof row.title === "string") return { url: row.url, title: row.title };
      }
    } catch {
      // a plain url from an older save
    }
    return { url: raw, title: "link" };
  }

  function addPackText(text: string, fallback: string): void {
    let title = fallback;
    try {
      const obj = parsePafPack(text);
      title = packTitle(obj, fallback);
      const before = loadPacks();
      savePacks(before.filter((pack) => pack.title !== title).concat([{ title, text }]));
      tables = withPacks();
      const bad = packProblems.filter((problem) => problem.startsWith(`${title}:`));
      if (bad.length) {
        savePacks(before);
        tables = withPacks();
        packProblems = bad;
      }
    } catch (error) {
      packProblems = [`${title}: ${messageOf(error)}`];
    }
    prefs.packsOpen = true;
    savePrefs();
    update(true);
  }

  function dropPack(title: string): void {
    savePacks(loadPacks().filter((pack) => pack.title !== title));
    const link = savedLink();
    if (link && link.title === title) {
      localStorage.removeItem(PACK_URL_KEY);
      urlStatus = "";
    }
    tables = withPacks();
    update(true);
  }

  async function fetchPackUrl(raw: string): Promise<void> {
    const url = raw.trim();
    if (!/^https:\/\//i.test(url)) {
      urlStatus = "⚠ The link should start with https://";
      update(true);
      return;
    }
    urlStatus = "Loading…";
    update(true);
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`the server said ${res.status}`);
      const text = await res.text();
      const title = packTitle(parsePafPack(text), "link");
      localStorage.setItem(PACK_URL_KEY, JSON.stringify({ url, title }));
      urlStatus = "";
      addPackText(text, "link");
    } catch (error) {
      urlStatus = `⚠ Couldn't use that link (${messageOf(error)}). A GitHub Gist “Raw” link works.`;
      update(true);
    }
  }

  function packSection(): HTMLElement {
    const lib = loadPacks();
    const siteTitles = new Set(sitePacks.map((pack) => pack.title));
    const rows = sitePacks.map((pack) => ({
      title: pack.title || pack.file,
      about: pack.about,
      on: lib.some((item) => item.title === pack.title),
      toggle: (checked: boolean) => {
        if (checked) addPackText(pack.text, pack.title);
        else dropPack(pack.title);
      },
    }));
    for (const pack of lib) {
      if (siteTitles.has(pack.title)) continue;
      rows.push({
        title: pack.title,
        about: "loaded pack",
        on: true,
        toggle: (on: boolean) => {
          if (!on) dropPack(pack.title);
        },
      });
    }
    const savedUrl = savedLink()?.url ?? "";
    return contentPackPanel({
      open: !!(prefs.packsOpen || packProblems.length),
      onToggle: (open) => {
        prefs.packsOpen = open;
        savePrefs();
      },
      summaryHint: "Add an origin, a weapon, or a relic. An AI can write the file.",
      guideHref: "https://github.com/ggggggggg/hero-sheets/blob/main/CUSTOM_CONTENT_GUIDE.md#paf-packs",
      builtin: {
        id: "use-builtin",
        title: "Built-in origins",
        about: "the origins that come with PAF",
        on: !prefs.noBuiltin,
        toggle: (on) => {
          prefs.noBuiltin = !on;
          savePrefs();
          tables = withPacks();
          update(true);
        },
      },
      rows,
      problems: packProblems,
      onFileText: (text, name) => {
        addPackText(text, name.replace(/\.json$/i, ""));
      },
      onPaste: (text) => {
        addPackText(text, "pasted pack");
      },
      link: {
        value: savedUrl,
        status: urlStatus,
        saved: !!savedUrl,
        onLoad: (url) => {
          void fetchPackUrl(url);
        },
        onForget: () => {
          const link = savedLink();
          localStorage.removeItem(PACK_URL_KEY);
          urlStatus = "";
          if (link) dropPack(link.title);
          else update(true);
        },
      },
      foot: lib.length
        ? el(
            "p",
            { class: "hint block" },
            "You can load several packs. A row with the same id replaces the one you already have.",
          )
        : null,
      onClear: () => {
        if (!window.confirm("Forget the heroes and content packs saved in this browser?")) return;
        clearSavedKeys(PAF_SAVE_KEYS);
        location.reload();
      },
    });
  }

  function whichField(
    label: string,
    current: string | null,
    kind: "crit" | "utility" | "expert",
    set: (id: string) => void,
  ): HTMLElement {
    const chosen = current === state.origin2 ? state.origin2 : state.origin1;
    return field(
      label,
      chips(
        [state.origin1, state.origin2].map((id) => ({
          id,
          label: originName(id),
          color: originColor(id),
          tip: () => slotTip(kind, id),
        })),
        chosen,
        (id) => {
          set(id);
          update(true);
        },
      ),
      dice(label, () => {
        set(chosen === state.origin1 ? state.origin2 : state.origin1);
        update(true);
      }),
    );
  }

  function renderControls(): void {
    if (!built) return;
    const opt = options(tables, state);
    const locked = new Set<Ability>(opt.locked);
    const scoreRows = ABILITIES.map((ability) => {
      const score = built?.scores[ability] ?? 10;
      if (locked.has(ability)) {
        return el(
          "div",
          { class: "row" },
          el("b", { class: "numname" }, ability),
          el("b", {}, String(score)),
          el("span", { class: "hint" }, "from your origin"),
        );
      }
      return el(
        "label",
        { class: "row" },
        el("b", { class: "numname" }, ability),
        el("input", {
          type: "number",
          min: "1",
          max: "20",
          value: String(score),
          style: "width:5em",
          "aria-label": ability,
          oninput: (ev) => {
            const n = Number(textOf(ev));
            if (!(n >= 1 && n <= 20)) return;
            const base = built?.scores ?? scoreBlank();
            state.scores = { ...base, [ability]: n };
            update(false);
          },
        }),
      );
    });
    const nodes: Node[] = [];
    if (heroesOpen) nodes.push(heroesPanel());
    nodes.push(
      el(
        "p",
        { class: "tagline lead" },
        "Build an even simpler hero for post-apocalyptic fantasy, with Gamma World inspired origins and simplified choices:",
      ),
      el(
        "p",
        { class: "tiphint" },
        el("span", { class: "mouse" }, "Hover over any choice to see what it does."),
        el("span", { class: "touch" }, "Press and hold any choice to see what it does."),
      ),
      field(
        "Name",
        el("input", {
          id: "name",
          type: "text",
          value: state.name,
          "aria-label": "Name",
          oninput: (ev) => {
            state.name = textOf(ev);
            update(false);
            faces.noteName();
          },
        }),
        dice("name", () => {
          state.name = rollOther(NAMES, state.name);
          update(true);
          faces.noteName();
        }),
      ),
      field(
        "First origin",
        chips(
          tables.origins.map((origin) => ({
            id: origin.id,
            label: origin.name,
            color: origin.accent,
            tip: () => originTip(origin.id),
          })),
          state.origin1,
          (id) => {
            state.origin1 = id;
            update(true);
          },
        ),
        dice("first origin", () => {
          state.origin1 = rollOther(
            tables.origins.map((origin) => origin.id),
            state.origin1,
          );
          update(true);
        }),
      ),
      field(
        "Second origin",
        chips(
          tables.origins.map((origin) => ({
            id: origin.id,
            label: origin.name,
            color: origin.accent,
            tip: () => originTip(origin.id),
          })),
          state.origin2,
          (id) => {
            state.origin2 = id;
            update(true);
          },
        ),
        [
          "Choosing one origin twice fills the second spot with Baseline. ",
          dice("second origin", () => {
            state.origin2 = rollOther(
              tables.origins.map((origin) => origin.id),
              state.origin2,
            );
            update(true);
          }),
        ],
      ),
      field(
        "Level",
        chips(
          Array.from({ length: tables.max_level }, (_, i) => {
            const n = i + 1;
            return { id: String(n), label: String(n), tip: () => levelTip(n) };
          }),
          String(state.level),
          (id) => {
            state.level = Number(id);
            update(true);
          },
        ),
        [
          "Adds to attacks, skills, and defenses. ",
          dice("level", () => {
            const levels = Array.from({ length: tables.max_level }, (_, i) => i + 1);
            state.level = rollOther(levels, state.level);
            update(true);
          }),
        ],
      ),
      field(
        "Bonus skill",
        chips(
          tables.skills.map((skill) => ({ id: skill.name, label: skill.name, tip: () => skillTip(skill.name) })),
          opt.bonus_skill,
          (id) => {
            state.bonus_skill = id;
            update(true);
          },
        ),
        [
          "+4, and it stacks with an origin. ",
          dice("bonus skill", () => {
            state.bonus_skill = rollOther(
              tables.skills.map((skill) => skill.name),
              opt.bonus_skill,
            );
            update(true);
          }),
        ],
      ),
    );
    if (opt.show_crit && state.origin1 !== state.origin2) {
      nodes.push(
        whichField("Critical first", state.crit_first, "crit", (id) => {
          state.crit_first = id;
        }),
      );
    }
    if (opt.show_utility && state.origin1 !== state.origin2) {
      nodes.push(
        whichField("Once a fight first", state.utility_first, "utility", (id) => {
          state.utility_first = id;
        }),
      );
    }
    if (opt.show_expert && state.origin1 !== state.origin2) {
      nodes.push(
        whichField("Big power first", state.expert_first, "expert", (id) => {
          state.expert_first = id;
        }),
      );
    }
    if (opt.show_uber) {
      const cap = state.uber ?? tables.capstones[0]?.id ?? "";
      nodes.push(
        field(
          "Capstone",
          chips(
            tables.capstones.map((item) => ({
              id: item.id,
              label: item.name,
              tip: () => ({ title: item.name, lines: [[null, item.desc]] }),
            })),
            cap,
            (id) => {
              state.uber = id;
              update(true);
            },
          ),
          dice("capstone", () => {
            state.uber = rollOther(
              tables.capstones.map((item) => item.id),
              state.uber ?? tables.capstones[0]?.id ?? "",
            );
            update(true);
          }),
        ),
      );
    }
    const armorNames = ["No armor", ...tables.armor.map((armor) => armor.name)];
    const weaponNames = tables.weapons.map((weapon) => weapon.name);
    nodes.push(
      field(
        "Armor",
        chips(
          armorNames.map((name) => ({ id: name, label: name, tip: () => armorTip(name) })),
          built.combat.armor,
          (id) => {
            state.armor = id;
            update(true);
          },
        ),
        [
          "The highest Armor is used until you pick one. ",
          dice("armor", () => {
            state.armor = rollOther(armorNames, built?.combat.armor ?? "No armor");
            update(true);
          }),
        ],
      ),
      field(
        "Weapon",
        chips(
          weaponNames.map((name) => ({ id: name, label: name, tip: () => weaponTip(name) })),
          built.attacks[0]?.name ?? "",
          (id) => {
            state.weapon = id;
            update(true);
          },
        ),
        dice("weapon", () => {
          state.weapon = rollOther(weaponNames, built?.attacks[0]?.name ?? "");
          update(true);
        }),
      ),
      field(
        "Scores",
        el("div", { class: "numgrid" }, scoreRows),
        dice("scores", () => {
          state.scores = rollScores();
          update(true);
        }),
      ),
    );
    nodes.push(
      field(
        "Ready heroes",
        chips(
          tables.heroes.map((hero) => ({
            id: hero.name,
            label: `Start as ${hero.name}`,
            tip: () => ({
              title: hero.name,
              lines: [[null, `${originName(hero.origin1)} and ${originName(hero.origin2)}, level ${hero.level}.`]],
            }),
          })),
          "",
          (name) => {
            const hero = tables.heroes.find((item) => item.name === name);
            if (!hero) return;
            state.name = hero.name;
            state.origin1 = hero.origin1;
            state.origin2 = hero.origin2;
            state.level = hero.level;
            state.scores = null;
            state.bonus_skill = null;
            state.crit_first = null;
            state.utility_first = null;
            state.expert_first = null;
            state.uber = null;
            state.armor = null;
            state.weapon = null;
            state.inventory = null;
            state.notes = "";
            state.portrait = null;
            state.portrait_credit = null;
            state.avatar = null;
            state.look = null;
            update(true);
          },
        ),
      ),
      field(
        "Inventory",
        el("textarea", {
          rows: "4",
          "aria-label": "Inventory",
          oninput: (ev) => {
            state.inventory = textOf(ev)
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line);
            update(false);
          },
        }),
      ),
      field(
        "Notes",
        el("textarea", {
          rows: "4",
          "aria-label": "Notes",
          oninput: (ev) => {
            state.notes = textOf(ev);
            update(false);
          },
        }),
      ),
      field("Picture", faces.controls(), "or leave blank and draw one"),
      el(
        "details",
        { id: "flux-relics", class: "adv" },
        el(
          "summary",
          {},
          "Flux and relics",
          el("span", { class: "hint" }, "Drawn at the table. Write the names in Notes."),
        ),
        el("p", { class: "hint block" }, `Draw ${built.flux} flux when a fight starts. Draw 1 relic, once a fight.`),
        el("h4", { class: "plvl" }, "Flux"),
        ...tables.flux.map((item) => el("p", { class: "pdesc" }, el("b", {}, item.name), ` — ${item.desc}`)),
        el("h4", { class: "plvl" }, "Relics"),
        ...tables.relics.map((item) => el("p", { class: "pdesc" }, el("b", {}, item.name), ` — ${item.desc}`)),
      ),
      packSection(),
    );
    const controls = $("#controls");
    const y = controls.scrollTop;
    controls.replaceChildren(...nodes);
    const inventory = controls.querySelector("textarea[aria-label='Inventory']");
    if (inventory instanceof HTMLTextAreaElement) inventory.value = (state.inventory ?? built.inventory).join("\n");
    const notes = controls.querySelector("textarea[aria-label='Notes']");
    if (notes instanceof HTMLTextAreaElement) notes.value = state.notes;
    controls.scrollTop = y;
  }

  function scoreBlank(): AbilityScores {
    return { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
  }

  function update(rebuild: boolean): void {
    resolve();
    try {
      built = buildCharacter(tables, state);
    } catch (error) {
      if (!(error instanceof CharError)) throw error;
      showError(error.message);
      return;
    }
    state.scores = built.scores;
    document.documentElement.style.setProperty("--ac", built.identity.accent);
    save();
    clearTimeout(timer);
    if (rebuild) {
      renderControls();
      renderSheet();
    } else timer = window.setTimeout(renderSheet, 150);
  }

  function fileBase(): string {
    const idn = built?.identity;
    const name = fileStem(idn?.name || state.name) || "Hero";
    const origin = fileStem(idn?.origin1 || originName(state.origin1));
    return `${name} - Level ${idn?.level || state.level} ${origin}`;
  }

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
    const link = el("a", { href: url });
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function exportPdf(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    status("Making your PDF…");
    try {
      if (!built) throw new Error("no hero yet");
      const blob = await makePdf(sheetHtml(built), state.name || "Hero", {
        state: structuredClone(state),
        packs: loadPacks(),
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
    if (sheet.state.kind !== "paf") {
      status("This PDF is a D&D hero. Open it on the D&D heroes page.", true);
      return;
    }
    const next = stateFrom(sheet.state);
    if (!next) {
      status("This PDF's hero is missing its origins.", true);
      return;
    }
    if (sheet.packs.length) {
      const lib = loadPacks();
      const titles = new Set(sheet.packs.map((pack) => pack.title));
      savePacks(lib.filter((pack) => !titles.has(pack.title)).concat(sheet.packs));
      tables = withPacks();
    }
    state = next;
    update(true);
    status(`Opened ${state.name || "Hero"}.`);
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
    state.name = pick(NAMES);
    state.origin1 = pick(tables.origins).id;
    state.origin2 = pick(tables.origins).id;
    state.level = 1 + Math.floor(Math.random() * tables.max_level);
    state.scores = rollScores();
    state.bonus_skill = pick(tables.skills).name;
    state.armor = null;
    state.weapon = null;
    state.inventory = null;
    state.notes = "";
    state.portrait = null;
    state.portrait_credit = null;
    state.avatar = null;
    state.look = null;
    state.uber = pick(tables.capstones).id;
    resolve();
    const ids = [state.origin1, state.origin2];
    state.crit_first = pick(ids);
    state.utility_first = pick(ids);
    state.expert_first = pick(ids);
    update(true);
    void faces.randomFace();
  }

  window.__setPaf = (origin1, origin2, level) => {
    state.origin1 = origin1;
    state.origin2 = origin2;
    state.level = level;
    state.crit_first = null;
    state.utility_first = null;
    state.expert_first = null;
    state.uber = null;
    update(true);
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
  tipped(openPdf, () => ({
    title: "Open PDF",
    lines: [[null, "Open a hero PDF made here. That hero comes back, including content packs saved in the file."]],
  }));
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
  $("#surprise").addEventListener("click", surprise);
  $("#heroes-btn").addEventListener("click", () => {
    heroesOpen = !heroesOpen;
    setView("build");
    renderControls();
    $("#controls").scrollTop = 0;
  });
  window.addEventListener("resize", scalePreview);
  if (document.fonts) void document.fonts.ready.then(() => renderSheet());
  if (!saved && !fixed) surprise();
  else update(true);
  document.documentElement.dataset.booted = "1";
}
