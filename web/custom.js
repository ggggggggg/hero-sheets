/* Custom content merge — the same rules as charsheet/custom.py (see CUSTOM_CONTENT_GUIDE.md). */
(function (root) {
  "use strict";
  const ABILS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
  const Z6 = Object.fromEntries(ABILS.map((a) => [a, 0]));
  const CARD = { name: null, tag: "ON", note: "", desc: "", conc: false };
  const SEVEN = (x) => [x, x, x, x, x, x, x];
  const TEMPLATES = {
    races: { id: null, name: null, speed: 30, asi: Z6, skills: [], hp_per_level: 0, languages: "Common" },
    subraces: { id: null, race_id: null, name: null, asi: Z6, speed: 0, hp_per_level: 0, skills: [], armor_prof_add: [] },
    classes: {
      id: null, name: null, hit_die: 8, primary: ABILS, saves: [], skills: [],
      expertise: [{ lvl: 1, skills: [] }],
      armor: { base: 10, dex_cap: 99, add: [], shield: 0, worn: false },
      armor_prof: [], shield_prof: false, shield_default: false,
      weapons: [{ name: null, die: "1d6", ability: "STR", kind: "melee", hands: "one", note: "" }],
      caster: { kind: "none", ability: "", cantrips: SEVEN(0), mode: "none", known: SEVEN(0), level_mult: 0.0, cap: 0 },
      spell_order: [], cantrip_order: [], subclass_level: 3, asi_levels: [4], speed_bonus: SEVEN(0),
      weapon_prof: ["simple"], melee_slot: -1, look: { accent: "#555555", tagline: "" }, gear: [],
    },
    subclasses: { id: null, class_id: null, name: null, hp_per_level: 0, armor: null, armor_prof_add: [],
      extra_skills: [], extra_cantrips: [], auto_spells: [{ lvl: 1, spell: null }] },
    features: { owner_kind: null, owner_id: null, lvl: 1, card: CARD, tracker: { uses: "", rest: "" } },
    choices: { owner_kind: null, owner_id: null, group: null, label: null, count: SEVEN(1),
      options: [{ name: null, tag: "ON", desc: "", effect: { ac: 0, ranged_hit: 0, onehand_dmg: 0, init: 0, vars: [{ key: null, value: null }] } }] },
    scaling: { owner_kind: null, owner_id: null, key: null, values: null },
    spells: { name: null, lvl: 0, classes: [], card: Object.assign({}, CARD, { tag: "A" }), scale: null },
    items: { name: null, rarity: "common", tier: null, min_level: null, use_by: [], card: Object.assign({}, CARD, { tag: "A", note: null }), uses: 1, rest: "used" },
    armor: { name: null, kind: "light", base: 11, dex_cap: 99, str_req: 0, default_level: 1 },
    weapons: { name: null, cat: "simple", die: "1d6", ability: "STR", hands: "one", note: "" },
  };
  const REQUIRED = { races: ["id", "name"], subraces: ["id", "race_id", "name"], classes: ["id", "name"],
    subclasses: ["id", "class_id", "name"], features: ["owner_kind", "owner_id", "card.name"],
    choices: ["owner_kind", "owner_id", "group"], scaling: ["owner_kind", "owner_id", "key", "values"],
    spells: ["name"], items: ["name"], armor: ["name"], weapons: ["name"] };
  const KEYS = { races: ["id"], subraces: ["id"], classes: ["id"], subclasses: ["id"], spells: ["name"], items: ["name"],
    armor: ["name"], weapons: ["name"], features: ["owner_kind", "owner_id", "card.name"],
    choices: ["owner_kind", "owner_id", "group"], scaling: ["owner_kind", "owner_id", "key"] };
  const SCALE = { base: 0, per: 0, unit: "" };
  const RARITY = { common: [1, 1], uncommon: [2, 3], rare: [3, 5] };

  class CustomError extends Error {}
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

  function fill(val, tmpl, where) {
    if (isObj(tmpl)) {
      if (val == null) val = {};
      if (!isObj(val)) throw new CustomError(where + " should be an object");
      const extra = Object.keys(val).filter((k) => !(k in tmpl));
      if (extra.length) throw new CustomError(where + ": unknown field(s) " + JSON.stringify(extra) + " (allowed: " + Object.keys(tmpl).join(", ") + ")");
      const out = {};
      for (const [k, t] of Object.entries(tmpl)) out[k] = fill(val[k], t, where + "." + k);
      return out;
    }
    if (Array.isArray(tmpl) && tmpl.length === 1 && isObj(tmpl[0])) {
      if (val == null) return [];
      if (!Array.isArray(val)) throw new CustomError(where + " should be a list");
      return val.map((x, i) => fill(x, tmpl[0], where + "[" + i + "]"));
    }
    return val == null ? clone(tmpl) : val;
  }
  const get = (row, path) => path.split(".").reduce((r, p) => (isObj(r) ? r[p] : undefined), row);

  function fillRow(table, row, i) {
    const where = table + "[" + (i || 0) + "]";
    if (!isObj(row)) throw new CustomError(where + " should be an object");
    let tmpl = TEMPLATES[table];
    if (table === "spells" && row.scale != null) tmpl = Object.assign({}, tmpl, { scale: SCALE });
    if (table === "subclasses" && row.armor != null) tmpl = Object.assign({}, tmpl, { armor: TEMPLATES.classes.armor });
    const out = fill(row, tmpl, where);
    for (const r of REQUIRED[table]) { const v = get(out, r); if (v == null || v === "") throw new CustomError(where + " needs '" + r + "'"); }
    if (out.card && out.card.name == null) out.card.name = out.name;
    if (table === "items") {
      const [t, lv] = RARITY[out.rarity] || [1, 1];
      if (out.tier == null) out.tier = t;
      if (out.min_level == null) out.min_level = lv;
      if (out.card.note == null) out.card.note = out.rarity;
    }
    for (const e of out.auto_spells || []) if (e.spell == null) throw new CustomError(where + ".auto_spells entries need 'spell'");
    for (const o of out.options || []) {
      if (o.name == null) throw new CustomError(where + ".options entries need 'name'");
      for (const kv of o.effect.vars) if (kv.key == null || kv.value == null) throw new CustomError(where + ".options vars need 'key' and 'value'");
    }
    if (table === "choices" && out.label == null) out.label = out.group;
    return out;
  }

  function mergeRows(table, base, add) {
    const key = (r) => JSON.stringify(KEYS[table].map((k) => get(r, k)));
    const out = base.slice();
    const at = new Map(out.map((r, i) => [key(r), i]));
    add.forEach((r, i) => {
      r = fillRow(table, r, i);
      const k = key(r);
      if (at.has(k)) out[at.get(k)] = r; else { at.set(k, out.length); out.push(r); }
    });
    return out;
  }

  function mergeCustom(tables, custom) {
    if (!isObj(custom)) throw new CustomError("custom content should be one JSON object");
    const bad = Object.keys(custom).filter((k) => !(k in TEMPLATES) && k !== "title" && k !== "about" && k !== "heroes");
    if (custom.heroes != null) heroList(custom); // check them early: a clear message beats a silent skip
    if (bad.length) throw new CustomError("unknown table(s) " + JSON.stringify(bad) + " (allowed: " + Object.keys(TEMPLATES).join(", ") + ")");
    const out = Object.assign({}, tables);
    for (const name of Object.keys(TEMPLATES)) {
      if (!(name in custom)) continue;
      if (!Array.isArray(custom[name])) throw new CustomError(name + " should be a list");
      out[name] = mergeRows(name, tables[name], custom[name]);
    }
    return out;
  }

  // ready-made heroes: the same picks the builder makes, so one click sets everything up
  const HERO_FIELDS = ["name", "race", "subrace", "cls", "subclass", "level", "choices", "cantrips", "spells", "path_spells", "items",
    "armor", "shield", "weapon", "base_scores", "race_asi", "inventory", "notes", "portrait", "portrait_credit", "avatar"];
  function heroList(custom) {
    const hs = custom.heroes == null ? [] : custom.heroes;
    if (!Array.isArray(hs)) throw new CustomError("heroes should be a list");
    return hs.map((h, i) => {
      const where = "heroes[" + i + "]";
      if (!isObj(h)) throw new CustomError(where + " should be an object");
      const extra = Object.keys(h).filter((k) => !HERO_FIELDS.includes(k));
      if (extra.length) throw new CustomError(where + ": unknown field(s) " + JSON.stringify(extra) + " (allowed: " + HERO_FIELDS.join(", ") + ")");
      for (const k of ["name", "race", "cls"]) if (!h[k]) throw new CustomError(where + " needs '" + k + "'");
      if (h.choices != null && !isObj(h.choices)) throw new CustomError(where + ".choices should be an object like {\"invocations\": [\"Agonizing Blast\"]}");
      return h;
    });
  }
  function heroRequest(h) {
    return { name: h.name, race: h.race, subrace: h.subrace || null, cls: h.cls, subclass: h.subclass || null, level: h.level || 1,
      choices: Object.entries(h.choices || {}).map(([group, picks]) => ({ group, picks })),
      cantrips: h.cantrips || null, spells: h.spells || null, path_spells: h.path_spells || null, items: h.items || null, item_seed: null,
      armor: h.armor || null, shield: h.shield == null ? null : h.shield, weapon: h.weapon || null,
      base_scores: h.base_scores || null, race_asi: h.race_asi || null, inventory: h.inventory || null, notes: h.notes || "",
      portrait: h.portrait || null, portrait_credit: h.portrait ? (h.portrait_credit || null) : null };
  }

  function parseCustomText(text) {
    try { return JSON.parse(String(text)); } catch (e) { throw new CustomError("not valid JSON: " + e.message); }
  }

  // Build every hero the custom content touches, so mistakes show up right away (with a readable reason).
  function checkCustom(C, tables, custom) {
    const problems = [];
    const ids = (t, k) => new Set((custom[t] || []).map((r) => r[k]));
    const races = ids("races", "id"), classes = ids("classes", "id"), subs = ids("subclasses", "id"), srs = ids("subraces", "id");
    const touched = new Set([...(custom.features || []), ...(custom.choices || []), ...(custom.scaling || [])].map((r) => r.owner_kind + ":" + r.owner_id));
    const raceIds = tables.races.map((r) => r.id), clsIds = tables.classes.map((c) => c.id);
    const spellCls = new Set((custom.spells || []).flatMap((s) => s.classes || []));
    const tries = [];
    for (const r of tables.races) for (const c of tables.classes) {
      const subList = tables.subclasses.filter((s) => s.class_id === c.id);
      const srList = tables.subraces.filter((s) => s.race_id === r.id);
      const hit = races.has(r.id) || classes.has(c.id) || touched.has("race:" + r.id) || touched.has("class:" + c.id) || spellCls.has(c.id) ||
        subList.some((s) => subs.has(s.id) || touched.has("subclass:" + s.id)) || srList.some((s) => srs.has(s.id) || touched.has("subrace:" + s.id));
      if (!hit && !(custom.items || custom.weapons || custom.armor)) continue;
      if (!hit && r.id !== raceIds[0]) continue; // gear-only changes: one race is enough
      for (const s of subList.length ? subList : [null]) for (const sr of srList.length ? srList : [null]) {
        for (const lvl of [1, 3, 5, 7]) tries.push({ race: r.id, cls: c.id, subclass: s && s.id, subrace: sr && sr.id, level: Math.min(lvl, tables.rules[0].max_level) });
      }
    }
    for (const h of heroList(custom)) {
      try { C.buildCharacter(tables, heroRequest(h)); }
      catch (e) { problems.push("ready-made hero " + JSON.stringify(h.name) + ": " + (e.message || e)); }
    }
    for (const q of tries) {
      const req = { name: "Test", race: q.race, cls: q.cls, subclass: q.subclass, subrace: q.subrace, level: q.level, choices: [], cantrips: null, spells: null,
        inventory: null, notes: "", portrait: null };
      try {
        C.buildCharacter(tables, req);
        // also try every custom spell this class can learn
        const mine = (custom.spells || []).filter((sp) => (sp.classes || []).includes(q.cls));
        const o = mine.length ? C.options(tables, req) : null;
        for (const sp of mine) {
          const isCan = (sp.lvl || 0) === 0;
          const pool = isCan ? o.cantripPool : o.spellPool, n = isCan ? o.nCan : o.nSp;
          if (!pool || !pool.includes(sp.name) || !n) continue;
          const cur = (isCan ? o.defaults.cantrips : o.defaults.spells) || [];
          const pick = [sp.name].concat(cur.filter((x) => x !== sp.name)).slice(0, n);
          C.buildCharacter(tables, Object.assign({}, req, isCan ? { cantrips: pick } : { spells: pick }));
        }
      } catch (e) {
        problems.push(q.race + " " + q.cls + (q.subclass ? " (" + q.subclass + ")" : "") + " level " + q.level + ": " + (e.message || e));
        if (problems.length >= 8) break;
      }
    }
    return [...new Set(problems)];
  }

  root.CharsheetCustom = { mergeCustom, parseCustomText, checkCustom, heroList, heroRequest, CustomError, TEMPLATES };
  if (typeof module !== "undefined" && module.exports) module.exports = root.CharsheetCustom;
})(typeof window !== "undefined" ? window : globalThis);
