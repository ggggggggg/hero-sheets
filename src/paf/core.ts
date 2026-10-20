import { ABILITY_NAME, accentTint, PAF_TAGS, tagChip, tagLegend } from "../tags";
import { CharError, escapeHtml, expand, signed } from "../text";
import { ABILITIES, type Ability, type AbilityScores } from "../types";

export { CharError, signed } from "../text";

export interface PafSkill {
  name: string;
  ability: Ability;
}

export interface PafArmor {
  name: string;
  kind: "light" | "heavy";
  bonus: number;
}

export interface PafWeapon {
  name: string;
  die: string;
  ability: Ability;
  note: string;
}

export interface PafBlurb {
  name: string;
  desc: string;
}

export interface PafPower extends PafBlurb {
  tag: string;
}

export interface PafCrit {
  name: string;
  desc: string;
}

export interface PafOrigin {
  id: string;
  name: string;
  primary: Ability;
  skill: string;
  speed: number;
  speaks: string;
  accent: string;
  tagline: string;
  trait: string;
  novice: PafPower;
  utility: PafPower;
  expert: PafPower;
  crit: PafCrit;
}

export interface PafCapstone {
  id: string;
  name: string;
  desc: string;
}

export interface PafReady {
  name: string;
  origin1: string;
  origin2: string;
  level: number;
}

export interface PafTables {
  max_level: number;
  skills: PafSkill[];
  armor: PafArmor[];
  weapons: PafWeapon[];
  flux: PafBlurb[];
  relics: PafBlurb[];
  capstones: PafCapstone[];
  heroes: PafReady[];
  origins: PafOrigin[];
}

export interface PafRequest {
  name: string;
  origin1: string;
  origin2: string;
  level: number;
  bonus_skill: string | null;
  crit_first: string | null;
  utility_first: string | null;
  expert_first: string | null;
  uber: string | null;
  scores: AbilityScores | null;
  armor: string | null;
  weapon: string | null;
  inventory: string[] | null;
  notes: string;
  portrait: string | null;
}

export interface PafCard {
  section: string;
  name: string;
  tag: string;
  note: string;
  desc: string;
  uses: number | null;
  rest: string | null;
}

export interface PafCharacter {
  identity: {
    name: string;
    origin1: string;
    origin2: string;
    level: number;
    accent: string;
    tagline: string;
    speaks: string;
  };
  abilities: { key: Ability; score: number; mod: number }[];
  combat: {
    ac: number;
    armor: string;
    tough: number;
    quick: number;
    guts: number;
    max_hp: number;
    bloodied: number;
    speed: number;
    initiative: number;
    level_bonus: number;
  };
  skills: { name: string; ability: Ability; bonus: number; marked: boolean; expert: boolean }[];
  attacks: { name: string; to_hit: number; damage: string; note: string }[];
  cards: PafCard[];
  inventory: string[];
  extras: { notes: string; portrait: string | null };
  flux: number;
  bonus_skill: string;
  scores: AbilityScores;
}

export interface PafOptions {
  origins: PafOrigin[];
  skills: PafSkill[];
  armor: PafArmor[];
  weapons: PafWeapon[];
  flux: PafBlurb[];
  relics: PafBlurb[];
  capstones: PafCapstone[];
  heroes: PafReady[];
  origin2: string;
  bonus_skill: string;
  show_crit: boolean;
  show_utility: boolean;
  show_expert: boolean;
  show_uber: boolean;
  scores: AbilityScores;
  locked: Ability[];
}

const valueError = (message: string) => new CharError("ValueError", message);

function isObj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAbility(value: unknown): value is Ability {
  return typeof value === "string" && ABILITIES.some((ability) => ability === value);
}

function needString(row: Record<string, unknown>, key: string, where: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value) throw valueError(`${where} needs ${key}`);
  return value;
}

function power(value: unknown, where: string): PafPower {
  if (!isObj(value)) throw valueError(`${where} should be an object`);
  return {
    name: needString(value, "name", where),
    tag: needString(value, "tag", where),
    desc: needString(value, "desc", where),
  };
}

export function tablesFrom(value: unknown): PafTables {
  if (!isObj(value)) throw valueError("PAF content should be an object");
  const origins = value.origins;
  if (!Array.isArray(origins) || origins.length < 2) throw valueError("PAF content needs origins");
  const parsed: PafOrigin[] = origins.map((row, i) => {
    if (!isObj(row)) throw valueError(`origins[${i}] should be an object`);
    const primary = row.primary;
    if (!isAbility(primary)) throw valueError(`origins[${i}] needs a primary ability`);
    const where = `origins[${i}]`;
    return {
      id: needString(row, "id", where),
      name: needString(row, "name", where),
      primary,
      skill: needString(row, "skill", where),
      speed: typeof row.speed === "number" ? row.speed : 30,
      speaks: typeof row.speaks === "string" ? row.speaks : "Trade-talk",
      accent: typeof row.accent === "string" ? row.accent : "#37474f",
      tagline: typeof row.tagline === "string" ? row.tagline : "",
      trait: needString(row, "trait", where),
      novice: power(row.novice, `${where}.novice`),
      utility: power(row.utility, `${where}.utility`),
      expert: power(row.expert, `${where}.expert`),
      crit: (() => {
        if (!isObj(row.crit)) throw valueError(`${where}.crit should be an object`);
        return {
          name: needString(row.crit, "name", `${where}.crit`),
          desc: needString(row.crit, "desc", `${where}.crit`),
        };
      })(),
    };
  });
  if (!parsed.some((origin) => origin.id === "baseline")) throw valueError("PAF content needs a Baseline origin");
  const skills = Array.isArray(value.skills) ? value.skills : [];
  const skillRows: PafSkill[] = skills.map((row, i) => {
    if (!isObj(row) || !isAbility(row.ability)) throw valueError(`skills[${i}] needs a name and ability`);
    return { name: needString(row, "name", `skills[${i}]`), ability: row.ability };
  });
  const names = new Set(skillRows.map((skill) => skill.name));
  for (const origin of parsed) {
    if (!names.has(origin.skill)) throw valueError(`${origin.name} grants an unknown skill`);
  }
  const list = <T>(raw: unknown, read: (row: Record<string, unknown>, i: number) => T): T[] => {
    if (!Array.isArray(raw)) return [];
    return raw.map((row, i) => {
      if (!isObj(row)) throw valueError("list entry should be an object");
      return read(row, i);
    });
  };
  return {
    max_level: typeof value.max_level === "number" ? value.max_level : 10,
    skills: skillRows,
    armor: list(value.armor, (row) => {
      const kind = row.kind === "heavy" ? "heavy" : "light";
      return { name: needString(row, "name", "armor"), kind, bonus: typeof row.bonus === "number" ? row.bonus : 0 };
    }),
    weapons: list(value.weapons, (row) => {
      if (!isAbility(row.ability)) throw valueError("weapon needs an ability");
      return {
        name: needString(row, "name", "weapon"),
        die: needString(row, "die", "weapon"),
        ability: row.ability,
        note: typeof row.note === "string" ? row.note : "",
      };
    }),
    flux: list(value.flux, (row) => ({ name: needString(row, "name", "flux"), desc: needString(row, "desc", "flux") })),
    relics: list(value.relics, (row) => ({
      name: needString(row, "name", "relic"),
      desc: needString(row, "desc", "relic"),
    })),
    capstones: list(value.capstones, (row) => ({
      id: needString(row, "id", "capstone"),
      name: needString(row, "name", "capstone"),
      desc: needString(row, "desc", "capstone"),
    })),
    heroes: list(value.heroes, (row) => ({
      name: needString(row, "name", "hero"),
      origin1: needString(row, "origin1", "hero"),
      origin2: needString(row, "origin2", "hero"),
      level: typeof row.level === "number" ? row.level : 1,
    })),
    origins: parsed,
  };
}

function originBy(tables: PafTables, id: string): PafOrigin {
  const found = tables.origins.find((origin) => origin.id === id);
  if (!found) throw valueError(`unknown origin ${id}`);
  return found;
}

export function pairOrigins(tables: PafTables, first: string, second: string): [PafOrigin, PafOrigin] {
  const origin1 = originBy(tables, first);
  const picked = originBy(tables, second);
  const origin2 = picked.id === origin1.id && origin1.id !== "baseline" ? originBy(tables, "baseline") : picked;
  return [origin1, origin2];
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ (text.charCodeAt(i) || 0), 16777619);
  return h >>> 0;
}

function rollScores(seed: string): AbilityScores {
  let n = hash(seed) || 1;
  const die = () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return (n % 6) + 1;
  };
  const three = () => die() + die() + die();
  return { STR: three(), DEX: three(), CON: three(), INT: three(), WIS: three(), CHA: three() };
}

function applyPrimaries(scores: AbilityScores, origin1: PafOrigin, origin2: PafOrigin): AbilityScores {
  const next = { ...scores };
  if (origin1.primary === origin2.primary) next[origin1.primary] = 20;
  else {
    next[origin1.primary] = 18;
    next[origin2.primary] = 16;
  }
  return next;
}

export function fluxCount(level: number): number {
  if (level >= 8) return 3;
  if (level >= 4) return 2;
  return 1;
}

function defaultBonus(tables: PafTables, origin1: PafOrigin, origin2: PafOrigin): string {
  const taken = new Set([origin1.skill, origin2.skill]);
  return tables.skills.find((skill) => !taken.has(skill.name))?.name ?? tables.skills[0]?.name ?? "";
}

function orderOf(which: string | null, origin1: PafOrigin, origin2: PafOrigin, count: number): PafOrigin[] {
  if (count <= 0) return [];
  if (origin1.id === origin2.id) return [origin1];
  if (which != null && which !== origin1.id && which !== origin2.id) throw valueError(`pick isn't one of your origins`);
  const first = which === origin2.id ? origin2 : origin1;
  const second = first.id === origin1.id ? origin2 : origin1;
  return count === 1 ? [first] : [first, second];
}

function mod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function better(scores: AbilityScores, a: Ability, b: Ability): number {
  return Math.max(mod(scores[a]), mod(scores[b]));
}

export function buildCharacter(tables: PafTables, req: PafRequest): PafCharacter {
  const level = Number(req.level);
  if (!(level >= 1 && level <= tables.max_level)) throw valueError(`level must be 1..${tables.max_level}`);
  const [origin1, origin2] = pairOrigins(tables, req.origin1, req.origin2);
  let scores: AbilityScores;
  if (req.scores == null) scores = rollScores(`${req.name}|${origin1.id}|${origin2.id}`);
  else {
    scores = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
    for (const ability of ABILITIES) {
      const n = req.scores[ability];
      if (!(n >= 1 && n <= 20)) throw valueError(`${ability} must be 1 to 20`);
      scores[ability] = n;
    }
  }
  scores = applyPrimaries(scores, origin1, origin2);
  const bonusSkill = req.bonus_skill ?? defaultBonus(tables, origin1, origin2);
  if (!tables.skills.some((skill) => skill.name === bonusSkill)) throw valueError(`unknown skill ${bonusSkill}`);

  const hp = 12 + scores.CON + 5 * (level - 1);
  const bloodied = Math.floor(hp / 2);
  const tough = 10 + level + better(scores, "STR", "CON");
  const quick = 10 + level + better(scores, "DEX", "INT");
  const guts = 10 + level + better(scores, "WIS", "CHA");
  const abilityMod = better(scores, "DEX", "INT");
  const none = { name: "No armor", ac: 10 + level + abilityMod };
  const wornOptions = [
    none,
    ...tables.armor.map((armor) => ({
      name: armor.name,
      ac: 10 + level + armor.bonus + (armor.kind === "light" ? abilityMod : 0),
    })),
  ];
  let worn = none;
  if (req.armor != null) {
    const found = wornOptions.find((armor) => armor.name === req.armor);
    if (!found) throw valueError(`can't wear ${req.armor}`);
    worn = found;
  } else {
    for (const armor of wornOptions) if (armor.ac > worn.ac) worn = armor;
  }
  const strMod = mod(scores.STR);
  const dexMod = mod(scores.DEX);
  const fallback =
    tables.weapons.find((weapon) => weapon.ability === (strMod >= dexMod ? "STR" : "DEX")) ?? tables.weapons[0];
  if (!fallback) throw valueError("no weapons");
  const weapon = req.weapon == null ? fallback : tables.weapons.find((row) => row.name === req.weapon);
  if (!weapon) throw valueError(`can't use ${req.weapon}`);
  const attackMod = mod(scores[weapon.ability]);
  const vars: Record<string, string | number> = { LVL: level, AC: worn.ac, TOUGH: tough, QUICK: quick, GUTS: guts };
  for (const ability of ABILITIES) {
    const m = mod(scores[ability]);
    vars[ability] = signed(m);
    vars[`${ability}N`] = m;
    vars[`${ability}ATK`] = signed(level + m);
  }
  const cardOf = (
    section: string,
    name: string,
    tag: string,
    desc: string,
    uses: number | null = null,
    rest: string | null = null,
  ): PafCard => ({
    section,
    name: expand(name, vars),
    tag,
    note: "",
    desc: expand(desc, vars),
    uses,
    rest,
  });
  const crits = orderOf(req.crit_first, origin1, origin2, level >= 6 ? 2 : level >= 2 ? 1 : 0);
  const utilities = orderOf(req.utility_first, origin1, origin2, level >= 7 ? 2 : level >= 3 ? 1 : 0);
  const experts = orderOf(req.expert_first, origin1, origin2, level >= 9 ? 2 : level >= 5 ? 1 : 0);
  const cards: PafCard[] = [
    cardOf("What you are", origin1.name, "ON", origin1.trait),
    ...(origin2.id === origin1.id ? [] : [cardOf("What you are", origin2.name, "ON", origin2.trait)]),
    cardOf("Always", origin1.novice.name, origin1.novice.tag, origin1.novice.desc),
    ...(origin2.id === origin1.id
      ? []
      : [cardOf("Always", origin2.novice.name, origin2.novice.tag, origin2.novice.desc)]),
    ...crits.map((origin) => cardOf("Critical", origin.crit.name, "", origin.crit.desc)),
    ...utilities.map((origin) => cardOf("Once a fight", origin.utility.name, origin.utility.tag, origin.utility.desc)),
    ...experts.map((origin) => cardOf("Big powers", origin.expert.name, origin.expert.tag, origin.expert.desc)),
  ];
  if (level >= 10) {
    const uber = req.uber ?? tables.capstones[0]?.id ?? "twice";
    const cap = tables.capstones.find((row) => row.id === uber);
    if (!cap) throw valueError(`unknown capstone ${uber}`);
    cards.push(cardOf("Capstone", cap.name, "ON", cap.desc));
  }
  const flux = fluxCount(level);
  cards.push(
    cardOf("Keeping going", "Second wind", "B", "Once a fight, heal your bloodied number.", 1, "once a fight"),
  );
  cards.push(
    cardOf(
      "Keeping going",
      "Flux",
      "",
      `Draw ${flux} when a fight starts. Write the names in Notes. They leave when the fight ends.`,
    ),
  );
  cards.push(
    cardOf("Keeping going", "Relic", "", "Draw 1 ancient gadget. It works once a fight. Write its name in Notes."),
  );
  const speaks = [
    ...new Set(
      `${origin1.speaks}, ${origin2.speaks}`
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ].join(", ");
  return {
    identity: {
      name: req.name || "Hero",
      origin1: origin1.name,
      origin2: origin2.name,
      level,
      accent: origin1.accent,
      tagline: origin1.tagline,
      speaks,
    },
    abilities: ABILITIES.map((key) => ({ key, score: scores[key], mod: mod(scores[key]) })),
    combat: {
      ac: worn.ac,
      armor: worn.name,
      tough,
      quick,
      guts,
      max_hp: hp,
      bloodied,
      speed: Math.max(origin1.speed, origin2.speed),
      initiative: dexMod + level,
      level_bonus: level,
    },
    skills: tables.skills.map((skill) => {
      const fromFirst = origin1.skill === skill.name;
      const fromSecond = origin2.skill === skill.name && origin2.id !== origin1.id;
      const extra = bonusSkill === skill.name;
      return {
        name: skill.name,
        ability: skill.ability,
        bonus: mod(scores[skill.ability]) + level + (fromFirst ? 4 : 0) + (fromSecond ? 4 : 0) + (extra ? 4 : 0),
        marked: fromFirst || fromSecond || extra,
        expert: fromFirst && fromSecond,
      };
    }),
    attacks: [
      {
        name: weapon.name,
        to_hit: level + attackMod,
        damage: `${weapon.die}${attackMod ? signed(attackMod) : ""}`,
        note: expand(weapon.note, vars),
      },
    ],
    cards,
    inventory: req.inventory ?? ["A coil of wire", "A snack tin", "Chalk"],
    extras: { notes: req.notes, portrait: req.portrait },
    flux,
    bonus_skill: bonusSkill,
    scores,
  };
}

export function options(tables: PafTables, req: PafRequest): PafOptions {
  const [origin1, origin2] = pairOrigins(tables, req.origin1, req.origin2);
  const scores = buildCharacter(tables, { ...req, origin1: origin1.id, origin2: origin2.id }).scores;
  const locked = origin1.primary === origin2.primary ? [origin1.primary] : [origin1.primary, origin2.primary];
  return {
    origins: tables.origins,
    skills: tables.skills,
    armor: tables.armor,
    weapons: tables.weapons,
    flux: tables.flux,
    relics: tables.relics,
    capstones: tables.capstones,
    heroes: tables.heroes,
    origin2: origin2.id,
    bonus_skill: req.bonus_skill ?? defaultBonus(tables, origin1, origin2),
    show_crit: req.level >= 2,
    show_utility: req.level >= 3,
    show_expert: req.level >= 5,
    show_uber: req.level >= 10,
    scores,
    locked,
  };
}

function uses(n: number | null, rest: string | null): string {
  if (n === null) return "";
  const boxes = `<i></i>`.repeat(Math.max(0, n));
  return `<div class="bx">${boxes}<small>${escapeHtml(rest ?? "")}</small></div>`;
}

export function sheetHtml(ch: PafCharacter): string {
  const idn = ch.identity;
  const combat = ch.combat;
  const portrait = ch.extras.portrait ? `<img src="${escapeHtml(ch.extras.portrait)}" alt="">` : "Draw your hero here!";
  const abil = ch.abilities
    .map(
      (ability) =>
        `<div class="ab"><div class="lbl">${ABILITY_NAME[ability.key]}</div><div class="m">${signed(ability.mod)}</div><div class="sc">${ability.score}</div></div>`,
    )
    .join("");
  const skills = ch.skills
    .map(
      (skill) =>
        `<div class="sk"><span><i class="pd${skill.expert ? " ex" : skill.marked ? " on" : ""}"></i> ${escapeHtml(skill.name)}</span><b>${signed(skill.bonus)}</b></div>`,
    )
    .join("");
  const inv = ch.inventory.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  const pair = `${escapeHtml(idn.origin1)} • ${escapeHtml(idn.origin2)}`;
  const front =
    '<section class="page front">' +
    `<div class="head"><div><div class="nm disp">${escapeHtml(idn.name)}</div>` +
    `<div class="sub">${pair}</div>` +
    `<div class="tag">${escapeHtml(idn.tagline)}</div></div>` +
    `<div class="lv"><b>${idn.level}</b><span class="lbl">Level</span></div></div>` +
    `<div class="fr1"><div class="portrait">${portrait}</div><div class="abil">${abil}</div></div>` +
    `<div class="box skills"><h4>Skills</h4><div class="skgrid">${skills}</div>` +
    `<div class="facts"><span>Adds <b>${signed(combat.level_bonus)}</b> to attacks, skills, and defenses</span>` +
    `<span>Speaks: ${escapeHtml(idn.speaks)}</span><span class="player">Player</span></div></div>` +
    `<div class="inv"><div class="box col"><h4>Inventory</h4><div class="lines">${inv}</div>` +
    '<div class="coins"><div>JUNK</div></div></div>' +
    `<div class="box col"><h4>Notes</h4><div class="lines">${escapeHtml(ch.extras.notes)}</div></div></div>` +
    "</section>";
  const tiles =
    `<div class="tile"><b>${combat.ac}</b><span class="lbl">Armor</span><span class="worn">${escapeHtml(combat.armor)}</span></div>` +
    `<div class="tile"><b>${combat.tough}</b><span class="lbl">Tough</span></div>` +
    `<div class="tile"><b>${combat.quick}</b><span class="lbl">Quick</span></div>` +
    `<div class="tile"><b>${combat.guts}</b><span class="lbl">Guts</span></div>` +
    `<div class="tile hp"><div class="mx"><b>${combat.max_hp}</b><span class="lbl">Max HP</span><span class="worn">bloodied ${combat.bloodied}</span></div>` +
    '<div><div class="w"></div><span class="lbl">HP now</span></div></div>' +
    `<div class="tile"><b>${combat.speed}</b><span class="lbl">Speed (ft)</span></div>` +
    `<div class="tile"><b>${signed(combat.initiative)}</b><span class="lbl">Initiative</span></div>`;
  const atk = ch.attacks
    .map(
      (attack) =>
        `<tr><td class="n">${escapeHtml(attack.name)}</td><td>${signed(attack.to_hit)}</td><td>${escapeHtml(attack.damage)}</td><td>${escapeHtml(attack.note)}</td></tr>`,
    )
    .join("");
  const secs = new Map<string, PafCard[]>();
  for (const entry of ch.cards) {
    const list = secs.get(entry.section) ?? [];
    list.push(entry);
    secs.set(entry.section, list);
  }
  let body = "";
  for (const [name, items] of secs) {
    let html = "";
    for (const entry of items) {
      const chip = tagChip(entry.tag, true);
      html += `<div class="cd" data-card="${escapeHtml(entry.name)}"><span class="n">${escapeHtml(entry.name)}</span>${chip}<div class="d">${escapeHtml(entry.desc)}</div>${uses(entry.uses, entry.rest)}</div>`;
    }
    body += `<div class="sec"><h3>${escapeHtml(name)}</h3>${html}</div>`;
  }
  const legend = tagLegend(PAF_TAGS);
  const back =
    '<section class="page back">' +
    `<div class="bhead"><div class="nm disp">${escapeHtml(idn.name)}</div><div class="disp" style="font-size:15px">${pair} • Level ${idn.level}</div></div>` +
    `<div class="combat paf">${tiles}</div>` +
    '<div class="mini"><span>A short rest restores all your HP. At 0 you drop, and a rest wakes you up.</span></div>' +
    `<div class="cmb2 solo"><div class="box"><table class="atk"><tr><th>Attack</th><th>To hit</th><th>Damage</th><th>Range</th></tr>${atk}</table></div></div>` +
    `<div class="cards">${body}</div>` +
    `<div class="foot">${legend}<span><b>Action</b> = your main thing. <b>Bonus</b> = a quick extra thing. <b>Reaction</b> = once a round, even on someone else's turn.</span></div>` +
    "</section>";
  const accent = idn.accent || "#37474f";
  return `<div class="sheet" style="--ac:${escapeHtml(accent)};--tint:${accentTint(accent)}">${front}${back}</div>`;
}
