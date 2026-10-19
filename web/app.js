/* Character builder page. Needs window.Charsheet (core.js) and window.CHARSHEET_TABLES. */
(function () {
  "use strict";
  const C = window.Charsheet;
  const BASE_T = window.CHARSHEET_TABLES;
  const CC = window.CharsheetCustom;
  const CUSTOM_KEY = "charsheet-custom-v1", CUSTOM_URL_KEY = "charsheet-custom-url-v1";
  const PREFS_KEY = "charsheet-ui-v1";
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (e) { prefs = {}; }
  let memUrlText = null, urlStatus = "";
  // Google Drive "share" links point at a web page; this is the direct-download form of the same file
  function directUrl(u) {
    const m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=download&)?id=)([\w-]+)/.exec(u);
    return m ? "https://drive.google.com/uc?export=download&id=" + m[1] : u;
  }
  // Fetch custom content from a link. It is read as data (JSON), never run as code.
  async function fetchCustomUrl(u, quiet) {
    const url = directUrl(u.trim());
    if (!/^https:\/\//i.test(url)) { urlStatus = "\u26a0 The link should start with https://"; return false; }
    let text;
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error("the server said " + res.status);
      text = await res.text();
    } catch (e) {
      if (!quiet) urlStatus = "\u26a0 Couldn't read that link (" + (e.message || e) + "). Many sites, including Google Drive, don't let other pages read their files. " +
        "A GitHub Gist \u201cRaw\u201d link or a jsDelivr link works \u2014 see the AI instructions.";
      return false;
    }
    try { CC.parseCustomText(text); } catch (e) { urlStatus = "\u26a0 That link isn't a custom content file: " + e.message; return false; }
    memUrlText = text;
    try { localStorage.setItem(CUSTOM_URL_KEY, u.trim()); localStorage.setItem(CUSTOM_URL_KEY + "-text", text); } catch (e) { /* keep it for this visit */ }
    urlStatus = "";
    return true;
  }
  // custom content: JSON packs loaded in the builder (from a file or a link)
  let customInfo = { sources: [], problems: [], error: "", heroes: [], ids: new Set() };
  // a library of loaded packs, each kept as its text: [{title, text}]
  function loadLib() {
    let raw = null;
    try { raw = localStorage.getItem(CUSTOM_KEY); } catch (e) { /* no storage */ }
    if (raw == null) return memLib;
    try { const j = JSON.parse(raw); if (j && Array.isArray(j.packs)) return j.packs; } catch (e) { /* older single-file form */ }
    try { const o = CC.parseCustomText(raw); return [{ title: o.title || "loaded file", text: raw }]; } catch (e) { return [{ title: "loaded file", text: raw }]; }
  }
  let memLib = [];
  function saveLib(lib) { memLib = lib; try { localStorage.setItem(CUSTOM_KEY, JSON.stringify({ packs: lib })); } catch (e) { /* this visit only */ } }
  let packOf = {}, loadReport = [];
  // The built-in content (D&D 5.1 SRD) is just the first pack in the list — its data lives in the HTML.
  // "Remove" it to start from the bare framework (dice, proficiency, spell slots) and let a pack supply everything.
  const SRD_TITLE = "Built-in content (D&D 5.1 SRD)";
  function frameworkOnly(t) {
    const out = Object.assign({}, t);
    for (const k of Object.keys(CC ? CC.TEMPLATES : {})) if (k in out) out[k] = [];  // drop race/class/spell/gear content, keep the rules framework
    return out;
  }
  function withCustom() {
    let t = prefs.noBuiltin && CC ? frameworkOnly(BASE_T) : BASE_T;
    customInfo = { sources: [], problems: [], error: "", heroes: [], ids: new Set() };
    packOf = {};
    const add = (obj, label, text) => {
      try {
        const next = CC.mergeCustom(t, obj);
        const problems = CC.checkCustom(C, next, obj);
        if (problems.length) { customInfo.problems.push(...problems.map((x) => label + ": " + x)); return; }
        t = next;
        for (const h of CC.heroList(obj)) customInfo.heroes.push(h);
        for (const k of ["races", "classes", "subclasses", "subraces"]) for (const r of obj[k] || []) if (r.id) {
          customInfo.ids.add(k + ":" + r.id);
          packOf[k + ":" + r.id] = { title: obj.title || label, text: text || JSON.stringify(obj) };
        }
        customInfo.sources.push({ label, title: obj.title || "", counts: Object.keys(CC.TEMPLATES).filter((k) => Array.isArray(obj[k]) && obj[k].length).map((k) => obj[k].length + " " + k) });
      } catch (e) { customInfo.error = label + ": " + (e.message || e); }
    };
    if (CC) for (const pk of loadLib()) {
      try { add(CC.parseCustomText(pk.text), pk.title, pk.text); } catch (e) { customInfo.error = pk.title + ": " + e.message; }
    }
    let urlText = null;
    try { urlText = localStorage.getItem(CUSTOM_URL_KEY + "-text"); } catch (e) { /* no storage */ }
    if (urlText == null) urlText = memUrlText;
    if (CC && urlText) { try { add(CC.parseCustomText(urlText), "link", urlText); } catch (e) { customInfo.error = "link: " + e.message; } }
    return t;
  }
  let T = withCustom();
  if (prefs.noBuiltin && (!T.races.length || !T.classes.length)) { prefs.noBuiltin = false; T = withCustom(); }  // can't stand alone yet: keep the built-ins
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, "");
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };

  // fun personality quirks for the Notes box (our own list, not from a rulebook)
  const TRAITS = ["Collects shiny rocks and names every one", "Hums when sneaking (badly)", "Never, ever turns down a dare",
    "Talks to their weapon like it's a friend", "Has a joke for every situation \u2014 most are terrible", "Is scared of chickens. Just chickens.",
    "Keeps a list of everyone who owes them a snack", "Always wants to pet the monster first", "Sleeps with one eye open (they say)",
    "Insists on a dramatic entrance", "Counts everything: steps, coins, goblins", "Gives everyone a nickname",
    "Writes down every new word they hear", "Can't walk past a door without knocking on it", "Brags about a dragon they 'almost' beat",
    "Eats the weirdest food on the table to prove they can", "Gets braver when someone is watching", "Loves maps, even wrong ones",
    "Saves a crumb from every meal for later", "Tells the truth even when a fib would be easier", "Practices their victory pose daily",
    "Refuses to take the same road twice", "Whistles for luck before every big roll", "Thinks every old person is secretly a wizard"];
  const FLAWS = ["Can't keep a secret for more than a day", "Touches things they shouldn't (buttons, levers, glowing orbs)",
    "Gets grumpy when hungry \u2014 very grumpy", "Believes anyone who says please", "Runs toward loud noises",
    "Hates losing, even at games that don't matter", "Easily distracted by anything sparkly", "Will argue about anything, even the weather",
    "Forgets names right after hearing them", "Takes the last cookie. Every time.", "Too curious about locked boxes",
    "Says the plan out loud... to the bad guys", "Gets lost in their own home town", "Trusts animals more than people"];
  function rollTraits() {
    const p = (a) => a[Math.floor(Math.random() * a.length)];
    let a = p(TRAITS), b = p(TRAITS);
    while (b === a) b = p(TRAITS);
    return a + ".\n" + b + ".\nFlaw: " + p(FLAWS) + ".";
  }

  const NAMES = ["Tobin", "Pip", "Rook", "Mira", "Juniper", "Bramble", "Ash", "Wren", "Ziggy", "Nova", "Fennick", "Tulip",
    "Grimble", "Sparrow", "Thistle", "Moxie", "Brick", "Luna", "Dex", "Odette", "Pickle", "Rune", "Saffron", "Bolt"];
  const KEY = "charsheet-hero-v1";
  const DEFAULT = { name: "Tobin", race: "dwarf", cls: "warlock", subclass: "fiend", level: 5, choices: {}, cantrips: null,
    spells: null, inventory: null, notes: "", portrait: null };

  // ---- saved heroes. Every hero lives in a list; ones changed by hand are "yours", untouched dice rolls go in a drawer.
  const HEROES_KEY = "charsheet-heroes-v1", MAX_ROLLS = 12;
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ } };
  const newId = () => "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const keyFields = (s) => JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith("ui_")).sort()));
  let book = { heroes: [], current: null };
  try { const b = JSON.parse(localStorage.getItem(HEROES_KEY) || "null"); if (b && Array.isArray(b.heroes)) book = b; } catch (e) { /* none */ }
  if (!book.heroes.length) {
    // older versions kept just one hero: keep it, as one of "yours"
    try { const old = JSON.parse(localStorage.getItem(KEY) || "null"); if (old && old.race) book.heroes.push({ id: newId(), state: old, edited: true, updated: Date.now() }); } catch (e) { /* none */ }
    book.current = book.heroes.length ? book.heroes[0].id : null;
  }
  let rolling = false;
  const currentHero = () => book.heroes.find((h) => h.id === book.current) || null;
  let state = Object.assign({}, DEFAULT);
  const haveSaved = !!currentHero();
  if (haveSaved) state = Object.assign({}, DEFAULT, currentHero().state);
  else { const h = { id: newId(), state: {}, edited: false, rolled: null, updated: Date.now() }; book.heroes.push(h); book.current = h.id; }
  function save() {
    const h = currentHero();
    if (!h) return;
    h.state = state; h.updated = Date.now();
    // a hero made with custom content keeps its own copy of that content, so it still works if the pack is removed or replaced
    const used = [];
    for (const k of ["races:" + state.race, "classes:" + state.cls, "subclasses:" + state.subclass, "subraces:" + state.subrace]) {
      const pk = packOf[k];
      if (pk && !used.some((x) => x.title === pk.title)) used.push(pk);
    }
    h.packs = used;
    if (!h.edited && !rolling && h.rolled != null && keyFields(state) !== h.rolled) h.edited = true;  // touched by hand: now it's one of yours
    const rolls = book.heroes.filter((x) => !x.edited && x.id !== book.current).sort((a, b) => b.updated - a.updated);
    for (const x of rolls.slice(MAX_ROLLS - 1)) book.heroes = book.heroes.filter((y) => y !== x);
    try { localStorage.setItem(HEROES_KEY, JSON.stringify(book)); }
    catch (e) { // full: drop the oldest dice rolls and try again
      const old = book.heroes.filter((x) => !x.edited && x.id !== book.current).sort((a, b) => a.updated - b.updated);
      if (old.length) { book.heroes = book.heroes.filter((x) => x !== old[0]); try { localStorage.setItem(HEROES_KEY, JSON.stringify(book)); } catch (e2) { /* give up */ } }
    }
  }
  // mark the current hero as a fresh dice roll (after the dice settle, including its face)
  function markRolled() { const h = currentHero(); if (h) { h.edited = false; h.rolled = keyFields(state); save(); } }
  // bring back any pack this hero was made with (from the copy the hero keeps)
  function ensurePacks(h) {
    if (!h || !h.packs || !h.packs.length || !CC) return false;
    const have = new Set(customInfo.sources.map((s) => s.title || s.label));
    const lib = loadLib().slice();
    let changed = false;
    for (const pk of h.packs) if (!have.has(pk.title) && !lib.some((x) => x.title === pk.title)) { lib.push(pk); changed = true; }
    if (changed) { saveLib(lib); T = withCustom(); RACES = byId(T.races); CLASSES = byId(T.classes); }
    return changed;
  }
  function switchHero(id) {
    const h = book.heroes.find((x) => x.id === id);
    if (!h) return;
    save(); book.current = id; ensurePacks(h); state = Object.assign({}, DEFAULT, h.state); picker = null; update(); window.scrollTo(0, 0);
  }
  function deleteHero(id) {
    book.heroes = book.heroes.filter((x) => x.id !== id);
    if (book.current === id) {
      const next = book.heroes.slice().sort((a, b) => (b.edited - a.edited) || (b.updated - a.updated))[0];
      if (next) { book.current = next.id; state = Object.assign({}, DEFAULT, next.state); update(); }
      else { book.current = null; newRandomHero(); }
    } else update();
  }

  const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
  let RACES = byId(T.races), CLASSES = byId(T.classes);
  function reloadTables() {
    T = withCustom();
    if (prefs.noBuiltin && (!T.races.length || !T.classes.length)) {  // removing the built-ins left nothing to build with: put them back
      prefs.noBuiltin = false; savePrefs(); T = withCustom();
      customInfo.error = "Keep the built-in content for now — load a pack with its own race and class before removing it.";
    }
    RACES = byId(T.races); CLASSES = byId(T.classes);
    const h = currentHero();
    if (h && h.edited && (!RACES[state.race] || !CLASSES[state.cls])) {
      // don't silently rewrite a hero they've worked on: keep it in Saved heroes and roll a fresh one under the new settings
      status("That hero doesn't fit the new content — it's safe in Saved heroes, so here's a fresh one.");
      newRandomHero();
      return;
    }
    update();
  }

  function request() {
    return { name: state.name || "Hero", race: state.race, cls: state.cls, subclass: state.subclass, level: state.level,
      choices: Object.entries(state.choices).map(([group, picks]) => ({ group, picks })),
      cantrips: state.cantrips, spells: state.spells, path_spells: state.path_spells || null,
      items: state.items || null, item_seed: state.item_seed || null, base_scores: state.base_scores || null,
      subrace: state.subrace || null, weapon: state.weapon || null, race_asi: state.race_asi || null, armor: state.armor || null, shield: state.shield == null ? null : state.shield,
      inventory: state.inventory, notes: state.notes || "", portrait: state.portrait,
      portrait_credit: state.portrait ? (state.portrait_credit || null) : null };
  }

  // keep the saved picks legal after race/class/level changes
  function tidy() {
    if (!RACES[state.race]) state.race = T.races[0].id;
    if (!CLASSES[state.cls]) state.cls = T.classes[0].id;
    const subs = T.subclasses.filter((s) => s.class_id === state.cls);
    if (!subs.some((s) => s.id === state.subclass)) state.subclass = subs.length ? subs[0].id : null;
    state.level = Math.min(Math.max(1, state.level | 0), T.rules[0].max_level);
    const o = C.options(T, request());
    const choices = {};
    for (const g of o.groups) {
      const names = g.options.map((x) => x.name);
      let picks = (state.choices[g.group] || []).filter((p) => names.includes(p));
      for (const n of names) { if (picks.length >= g.count) break; if (!picks.includes(n)) picks.push(n); }
      choices[g.group] = picks.slice(0, g.count);
    }
    state.choices = choices;
    if (state.cantrips) state.cantrips = state.cantrips.filter((n) => o.cantripPool.includes(n)).slice(0, o.nCan);
    if (state.spells) state.spells = state.spells.filter((n) => o.spellPool.includes(n)).slice(0, o.nSp);
    if (state.path_spells) state.path_spells = state.path_spells.filter((n) => o.anyPool && o.anyPool.includes(n));
    if (state.subrace && !(o.subraces || []).some((x) => x.id === state.subrace)) state.subrace = null;
    if (state.armor && !o.armorOptions.some((a) => a.name === state.armor)) state.armor = null;
    if (state.weapon && !o.weaponOptions.some((w) => w.name === state.weapon)) state.weapon = null;
    if (state.shield && !o.shieldProf) state.shield = null;
    if (state.items) state.items = state.items.filter((n) => o.itemPool.includes(n)).slice(0, o.itemSlots);
    if (!o.caster) { state.cantrips = null; state.spells = null; state.path_spells = null; if (picker && picker.kind !== "items") picker = null; }
    return o;
  }

  // ------------------------------------------------------------------ controls
  function chipRow(items, current, onPick, opts) {
    return el("div", { class: "chips", role: "group" }, items.map((it) =>
      el("button", { type: "button", class: "chip-btn" + (it.id === current ? " on" : "") + (opts && opts.big ? " big" : ""),
        "aria-pressed": it.id === current ? "true" : "false", style: it.color ? "--c:" + it.color : null,
        onclick: () => onPick(it.id) }, it.label)).map((b, i) => (items[i].tip ? tipped(b, items[i].tip) : b)));
  }

  // ------------------------------------------------------------------ tooltips
  // Hover (mouse), keyboard focus, or press-and-hold (touch) on a choice shows what it does.
  // Each tip is a function so nothing is computed until someone actually asks.
  const TIPS = new WeakMap();
  const ABN = { STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" };
  const fresh = (over) => Object.assign({}, request(), { choices: [], cantrips: null, spells: null, path_spells: null, items: null,
    armor: null, shield: null, inventory: null }, over);
  const tryBuild = (over) => { try { return C.buildCharacter(T, fresh(over)); } catch (e) { return null; } };
  const asiText = (asi) => Object.entries(asi || {}).filter(([, v]) => v).map(([k, v]) => (v > 0 ? "+" : "") + v + " " + ABN[k]).join(", ");
  const cardLines = (ch, pred) => (ch ? ch.cards.filter(pred).map((c) => [c.name, c.desc]) : []);

  const TIP = {
    race(id) {
      const r = RACES[id], srs = T.subraces.filter((x) => x.race_id === id), sr = srs[0];
      const asi = {}; for (const a of Object.keys(ABN)) asi[a] = ((r.asi || {})[a] || 0) + ((sr && sr.asi[a]) || 0);
      const ch = tryBuild({ race: id, subrace: null });
      const lines = [[null, [asiText(asi), "speed " + (r.speed + (sr ? sr.speed : 0)) + " ft"].filter(Boolean).join(" \u2022 ")]];
      if (sr) lines.push([null, "Usually a " + sr.name + (srs.length > 1 ? " (others: " + srs.slice(1).map((x) => x.name).join(", ") + " \u2014 pick at the bottom)" : "")]);
      return { title: r.name, lines: lines.concat(cardLines(ch, (c) => c.section === r.name + " Stuff")) };
    },
    subrace(id) {
      const sr = T.subraces.find((x) => x.id === id), base = RACES[sr.race_id];
      const ch = tryBuild({ race: sr.race_id, subrace: id });
      const own = new Set(T.features.filter((f) => f.owner_kind === "subrace" && f.owner_id === id).map((f) => f.card.name));
      const bits = [asiText(sr.asi), sr.speed ? "+" + sr.speed + " ft speed" : "", sr.hp_per_level ? "+" + sr.hp_per_level + " HP per level" : "",
        sr.armor_prof_add.length ? sr.armor_prof_add.join(" & ") + " armor training" : "", sr.skills.length ? "trained in " + sr.skills.join(", ") : ""].filter(Boolean);
      return { title: sr.name, lines: [[null, "On top of the " + base.name + " basics: " + (bits.join(", ") || "no number changes")]]
        .concat(cardLines(ch, (c) => own.has(c.name))) };
    },
    cls(id) {
      const c = CLASSES[id], ch = tryBuild({ cls: id, subclass: null });
      const arm = c.armor_prof.length ? c.armor_prof.join(", ") + " armor" + (c.shield_prof ? " + shields" : "") : (c.shield_prof ? "shields" : "no armor");
      const lines = [[null, c.look.tagline], [null, "d" + c.hit_die + " hit die \u2022 " + arm + " \u2022 good at " + c.primary.slice(0, 2).map((a) => ABN[a]).join(" & ")]];
      if (c.caster && c.caster.ability) lines.push([null, "Casts spells with " + ABN[c.caster.ability]]);
      if (ch) lines.push(["At level " + ch.identity.level, ch.cards.filter((x) => x.section === c.name + " Powers").map((x) => x.name).join(", ") || "\u2014"]);
      return { title: c.name, lines };
    },
    sub(id) {
      const s = T.subclasses.find((x) => x.id === id), c = CLASSES[s.class_id];
      const lvl = Math.max(state.level, c.subclass_level);
      const ch = tryBuild({ cls: s.class_id, subclass: id, level: lvl });
      const later = T.features.filter((f) => f.owner_kind === "subclass" && f.owner_id === id && f.lvl > lvl && f.lvl <= T.rules[0].max_level);
      const lines = state.level < c.subclass_level ? [[null, "Unlocks at level " + c.subclass_level + ". At that level you get:"]] : [];
      const spells = (s.auto_spells || []).filter((a) => a.lvl <= lvl).map((a) => a.spell);
      const pathLines = cardLines(ch, (x) => x.section === s.name);
      if (spells.length) pathLines.push(["Bonus spells", spells.join(", ")]);
      if (later.length) pathLines.push(["Later", later.map((f) => f.card.name + " (level " + f.lvl + ")").join(", ")]);
      return { title: s.name, lines: lines.concat(pathLines) };
    },
    level(n) {
      const now = tryBuild({ level: n }), prev = n > 1 ? tryBuild({ level: n - 1 }) : null;
      if (!now) return null;
      const lines = [[null, now.combat.max_hp + " HP \u2022 +" + now.combat.prof + " proficiency" + (prev ? " (" + (now.combat.max_hp - prev.combat.max_hp) + " more HP than level " + (n - 1) + ")" : "")]];
      if (prev) {
        const had = new Set(prev.cards.map((c) => c.name));
        const fresh_ = now.cards.filter((c) => !had.has(c.name) && c.section !== "Potions & Magic Items").map((c) => c.name);
        if (fresh_.length) lines.push(["New", fresh_.join(", ")]);
        const sl = (ch) => (ch.spellcasting && ch.spellcasting.slots ? Math.max(0, ...ch.spellcasting.slots.map((x) => x.level)) : 0);
        if (now.spellcasting && sl(now) > sl(prev)) lines.push(["Spells", "level " + sl(now) + " spells open up"]);
        for (const a of now.abilities) { const b = prev.abilities.find((x) => x.key === a.key); if (b && a.score > b.score) lines.push(["Stat boost", ABN[a.key] + " " + b.score + " \u2192 " + a.score]); }
      }
      return { title: "Level " + n, lines };
    },
    armor(a) {
      const row = T.armor.find((x) => x.name === a.name);
      const how = !row ? "your natural defense, no armor to carry"
        : row.base + (row.dex_cap === 0 ? ", Dexterity doesn't help" : row.dex_cap >= 10 ? " + Dexterity" : " + Dexterity, max +" + row.dex_cap);
      const lines = [[row ? row.kind[0].toUpperCase() + row.kind.slice(1) + " armor" : "Nothing worn", "Armor " + a.ac + " for you (" + how + ")"]];
      if (a.strReq) lines.push(["Strength", "Needs Strength " + a.strReq + ", or you move 10 ft slower"]);
      return { title: a.name, lines };
    },
  };

  function tipped(node, fn) { TIPS.set(node, fn); node.classList.add("has-tip"); return node; }

  const tipBox = (() => { let b; return () => b || (b = document.body.appendChild(el("div", { id: "tip", role: "tooltip", hidden: true }))); })();
  let tipFor = null, tipTimer = 0, holdFired = false;
  function showTip(node) {
    const fn = TIPS.get(node);
    let t = null; try { t = fn && fn(); } catch (e) { t = null; }
    if (!t) return;
    const b = tipBox();
    b.replaceChildren(el("b", { class: "tt" }, t.title), ...t.lines.filter((l) => l[1]).map(([k, v]) => el("p", {}, k ? el("b", {}, k + ": ") : null, v)));
    b.hidden = false; tipFor = node;
    const r = node.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 32);
    b.style.width = w + "px";
    const left = Math.max(16, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 16));
    const h = b.offsetHeight, below = r.bottom + 8 + h < window.innerHeight || r.top - 8 - h < 0;
    b.style.left = left + "px"; b.style.top = (below ? r.bottom + 8 : r.top - 8 - h) + "px";
  }
  function hideTip() { clearTimeout(tipTimer); if (tipFor) { tipBox().hidden = true; tipFor = null; } }
  const tipTarget = (e) => { const n = e.target.closest && e.target.closest(".has-tip"); return n && TIPS.has(n) ? n : null; };
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const n = tipTarget(e); if (n === tipFor) return;
    clearTimeout(tipTimer);
    if (!n) { tipTimer = setTimeout(hideTip, 120); return; }
    tipTimer = setTimeout(() => showTip(n), tipFor ? 0 : 350);
  });
  document.addEventListener("pointerdown", (e) => {
    holdFired = false;
    if (e.pointerType !== "touch" && e.pointerType !== "pen") { hideTip(); return; }
    const n = tipTarget(e); hideTip();
    if (n) tipTimer = setTimeout(() => { holdFired = true; showTip(n); }, 450);
  });
  for (const ev of ["pointerup", "pointercancel"]) document.addEventListener(ev, () => { if (!holdFired) clearTimeout(tipTimer); });
  document.addEventListener("pointermove", (e) => { if (e.pointerType === "touch" && !holdFired) clearTimeout(tipTimer); }, { passive: true });
  // a press-and-hold shows the tip; it should not also pick the thing
  document.addEventListener("click", (e) => { if (holdFired) { holdFired = false; e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener("contextmenu", (e) => { if (tipTarget(e)) e.preventDefault(); });
  document.addEventListener("focusin", (e) => { const n = tipTarget(e); if (n && n.matches(":focus-visible")) showTip(n); else if (!n) hideTip(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });
  window.addEventListener("scroll", hideTip, true);

  function field(label, control, hint) {
    return el("div", { class: "field" }, el("div", { class: "flabel" }, label, hint ? el("span", { class: "hint" }, hint) : null), control);
  }

  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const shuffleArr = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const dice = (label, fn) => el("button", { type: "button", class: "dice", title: "Random " + label, "aria-label": "Random " + label, onclick: fn }, "\ud83c\udfb2");
  let liveDesc = {};
  let picker = null; // {kind, index}  index -1 = adding a new one
  const TAGLBL = { A: "Action", B: "Bonus", R: "Reaction", ON: "Always on", F: "Free" };

  // the real (number-filled) text for each option, by building the hero with that spell in place
  function optionTexts(kind, current, index, names) {
    const out = {};
    for (const n of names) {
      const arr = current.slice();
      if (index < 0) arr.push(n); else arr[index] = n;
      try {
        const ch = C.buildCharacter(T, Object.assign(request(), { [kind]: arr }));
        const c = ch.cards.find((x) => x.name === n);
        if (c) out[n] = c;
      } catch (e) { /* leave it out */ }
    }
    return out;
  }

  function pickerPanel(kind, o, current, index, poolOverride, exclude) {
    const isCan = kind === "cantrips", isItem = kind === "items";
    const pool = poolOverride || (isItem ? o.itemPool : isCan ? o.cantripPool : o.spellPool);
    const taken = new Set(current.filter((_, j) => j !== index).concat(exclude || []));
    const names = pool.filter((n) => !taken.has(n));
    const texts = optionTexts(kind, current, index, names);
    const groups = new Map();
    for (const n of names) {
      const k = isItem ? ({ rare: "1 Rare", uncommon: "2 Uncommon", common: "3 Common" }[o.itemRarity(n)] || "4") : isCan ? "Cantrips" : "Level " + o.spellLevel(n);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }
    const choose = (n) => {
      const arr = current.slice();
      if (index < 0) arr.push(n); else arr[index] = n;
      picker = null; state[kind] = arr; update();
    };
    const close = () => { picker = null; update(); };
    const what = isItem ? "potion or item" : isCan ? "cantrip" : "spell";
    return el("div", { class: "picker", role: "dialog", "aria-label": "Choose a " + what },
      el("div", { class: "phead" }, el("b", {}, index < 0 ? "Add a " + what : "Swap " + current[index] + " for…"),
        el("button", { type: "button", class: "icon", "aria-label": "Close", onclick: close }, "\u2715")),
      [...groups].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([g, list]) => el("div", { class: "pgroup" },
        isCan ? null : el("div", { class: "plvl" }, isItem ? g.slice(2) : g + " spells"),
        el("div", { class: "popts" }, list.map((n) => {
          const c = texts[n] || (isItem ? o.itemCard(n) : o.spellCard(n)) || { desc: "", tag: "" };
          const cur = index >= 0 && current[index] === n;
          return el("button", { type: "button", class: "popt" + (cur ? " on" : ""), "aria-pressed": cur ? "true" : "false", onclick: () => choose(n) },
            el("span", { class: "ptop" }, el("b", {}, n), c.tag ? el("span", { class: "ptag t" + c.tag }, TAGLBL[c.tag] || c.tag) : null,
              c.note ? el("span", { class: "pnote" }, c.note) : null),
            el("span", { class: "pdesc" }, (c.desc || "").replace(/\{[A-Z0-9_]+\}/g, "\u2026")),
            isItem && o.itemWarn(n) ? el("span", { class: "pwarn" }, "\u26a0 " + o.itemWarn(n)) : null);
        })))));
  }

  function spellList(kind, o) {
    const isCan = kind === "cantrips";
    const max = isCan ? o.nCan : o.nSp;
    const pool = isCan ? o.cantripPool : o.spellPool;
    if (!max && !(isCan ? o.bonusCantrips.length : (o.bookAuto.length || (state.path_spells || []).length))) return null;
    const current = state[kind] || o.defaults[kind].slice();
    const set = (arr) => { picker = null; state[kind] = arr; update(); };
    const open = (index) => { picker = (picker && picker.kind === kind && picker.index === index) ? null : { kind, index }; update(); };
    const items = [];
    if (isCan) {
      for (const name of o.bonusCantrips.filter((n) => !current.includes(n))) {
        items.push(el("li", { class: "spell locked" }, el("div", { class: "sname" }, el("b", {}, name),
          el("small", {}, liveDesc[name] || ""), el("span", { class: "swaphint" }, "from your path"))));
      }
    } else {
      const pathCur = state.path_spells || o.bookAuto.slice();
      const setPath = (arr) => { picker = null; state.path_spells = arr; update(); };
      pathCur.forEach((name, i) => {
        const isOpen = picker && picker.kind === "path_spells" && picker.index === i;
        const book = o.bookAuto.includes(name);
        items.push(el("li", { class: "spell locked" + (isOpen ? " open" : "") + (book ? "" : " offbook") },
          el("button", { type: "button", class: "sname", "aria-expanded": isOpen ? "true" : "false",
            onclick: () => { picker = isOpen ? null : { kind: "path_spells", index: i }; update(); } },
            el("b", {}, name), el("span", { class: "lvl" }, "L" + o.spellLevel(name)),
            el("small", {}, liveDesc[name] || ((o.spellCard(name) || {}).desc || "").replace(/\{[A-Z0-9_]+\}/g, "\u2026")),
            el("span", { class: "swaphint" }, book ? "path spell \u2022 swap \u25be" : "off book \u2022 swap \u25be")),
          dice(name, () => { const free = o.anyPool.filter((n) => !pathCur.includes(n) && !current.includes(n)); if (!free.length) return;
            const arr = pathCur.slice(); arr[i] = rnd(free); setPath(arr); }),
          el("button", { type: "button", class: "icon", title: "Remove", "aria-label": "Remove " + name,
            onclick: () => setPath(pathCur.filter((_, j) => j !== i)) }, "\u2715")));
        if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel("path_spells", o, pathCur, i, o.anyPool, current)));
      });
    }
    current.forEach((name, i) => {
      const lvl = o.spellLevel(name);
      const isOpen = picker && picker.kind === kind && picker.index === i;
      items.push(el("li", { class: "spell" + (isOpen ? " open" : "") },
        el("button", { type: "button", class: "sname", "aria-expanded": isOpen ? "true" : "false", title: "Click to see other choices", onclick: () => open(i) },
          el("b", {}, name), isCan ? null : el("span", { class: "lvl" }, "L" + lvl),
          el("small", {}, liveDesc[name] || ((o.spellCard(name) || {}).desc || "").replace(/\{[A-Z0-9_]+\}/g, "\u2026")),
          el("span", { class: "swaphint" }, isOpen ? "close" : "swap \u25be")),
        dice(name, () => { const free = pool.filter((n) => !current.includes(n) && !(o.auto || []).includes(n)); if (!free.length) return;
          const arr = current.slice(); arr[i] = rnd(free); set(arr); }),
        el("button", { type: "button", class: "icon", title: "Remove", "aria-label": "Remove " + name,
          onclick: () => set(current.filter((_, j) => j !== i)) }, "\u2715")));
      if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel(kind, o, current, i)));
    });
    const freeLeft = pool.filter((n) => !current.includes(n)).length;
    if (current.length < max && freeLeft) {
      const isOpen = picker && picker.kind === kind && picker.index === -1;
      items.push(el("li", {}, el("button", { type: "button", class: "addbtn", "aria-expanded": isOpen ? "true" : "false", onclick: () => open(-1) },
        "+ add " + (isCan ? "a cantrip" : "a spell") + " (" + (max - current.length) + " left)")));
      if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel(kind, o, current, -1)));
    }
    const reset = el("button", { type: "button", class: "link", onclick: () => { if (!isCan) state.path_spells = null; set(null); } }, "reset");
    const pathCur = state.path_spells || o.bookAuto;
    const offBook = !isCan && (pathCur.length !== o.bookAuto.length || pathCur.some((n, i) => n !== o.bookAuto[i]));
    const gone = o.bookAuto.filter((n) => !pathCur.includes(n)), added = pathCur.filter((n) => !o.bookAuto.includes(n));
    const what = [added.length ? added.join(", ") + " instead of the book's path spell" + (gone.length > 1 ? "s " : " ") + (gone.join(", ") || "") : "",
      !added.length && gone.length ? "dropped the path spell" + (gone.length > 1 ? "s " : " ") + gone.join(", ") : ""].filter(Boolean).join("; ");
    if (offBook) items.unshift(el("li", { class: "offnote" }, "\u26a0 Going off book: " + what + ". Check with your DM. ",
      el("button", { type: "button", class: "link", onclick: () => { state.path_spells = null; picker = null; update(); } }, "back to the book")));
    const allDice = dice(isCan ? "cantrips" : "spells", () => { set(shuffle(pool.filter((n) => !(o.auto || []).includes(n))).slice(0, max)); });
    return field(isCan ? "Cantrips" : "Spells", el("ul", { class: "spells" }, items), [current.length + " of " + max + " picked ", reset, " ", allDice]);
  }

  const ABIL_FULL = { STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" };
  function pointCost(n, pb) {
    if (!pb || n < pb.low || n >= pb.low + pb.costs.length) return null;
    return pb.costs[n - pb.low];
  }
  const lvlAny = (ch, base, rasi) => ch.abilities.some((a) => a.score - base[a.key] - (rasi[a.key] || 0) !== 0);
  function abilityField(o) {
    const base = Object.assign({}, state.base_scores || o.defaultBase);
    const ch = C.buildCharacter(T, request());
    const fin = Object.fromEntries(ch.abilities.map((a) => [a.key, a]));
    const rasi = Object.assign({}, state.race_asi || o.raceAsi);
    const rTotal = Object.values(rasi).reduce((a, b) => a + b, 0), usualTotal = Object.values(o.raceAsi).reduce((a, b) => a + b, 0);
    const pb = o.pointBuy;
    let total = 0, offChart = false;
    const set = (k, n) => { base[k] = Math.max(3, Math.min(18, n)); state.base_scores = base; update(); };
    const rows = Object.keys(ABIL_FULL).map((k) => {
      const c = pointCost(base[k], pb);
      if (c === null) offChart = true; else total += c;
      const rb = rasi[k] || 0;
      const lvlUp = fin[k].score - base[k] - rb;
      const sg = (n) => (n >= 0 ? "+" + n : String(n));
      const setR = (n) => { const r = Object.assign({}, rasi); r[k] = Math.max(0, Math.min(3, n)); state.race_asi = r; update(); };
      return el("div", { class: "abrow" },
        el("span", { class: "abname", title: ABIL_FULL[k] }, el("span", { class: "abshort" }, k)),
        el("button", { type: "button", class: "step", "aria-label": "Lower " + ABIL_FULL[k], onclick: () => set(k, base[k] - 1), disabled: base[k] <= 3 }, "\u2212"),
        el("b", { class: "abbase", "aria-label": ABIL_FULL[k] + " " + base[k] }, String(base[k])),
        el("button", { type: "button", class: "step", "aria-label": "Raise " + ABIL_FULL[k], onclick: () => set(k, base[k] + 1), disabled: base[k] >= 18 }, "+"),
        el("button", { type: "button", class: "step mini", "aria-label": "Lower race bonus for " + ABIL_FULL[k], onclick: () => setR(rb - 1), disabled: rb <= 0 }, "\u2212"),
        el("span", { class: "abbonus" }, rb ? sg(rb) : "0"),
        el("button", { type: "button", class: "step mini", "aria-label": "Raise race bonus for " + ABIL_FULL[k], onclick: () => setR(rb + 1), disabled: rb >= 3 }, "+"),
        el("span", { class: "abfinal" }, fin[k].score + " (" + sg(fin[k].mod) + ")" + (lvlUp ? " \u2191" : "")),
        el("span", { class: "abcost" }, c === null ? "\u2014" : c + " pt"));
    });
    const over = pb && !offChart && total !== pb.budget;
    const summary = pb ? el("p", { class: "pbline" + (offChart || over ? " warn" : "") },
      offChart ? "Point buy: some scores are outside 8\u201315, so this is off the point-buy chart. Talk to your DM about stat rules \u2014 most DMs are fine with point buy."
        : "Point buy: " + total + " of " + pb.budget + " points" + (total > pb.budget ? " (over budget \u2014 talk to your DM about stat rules; most DMs are fine with point buy)" : total < pb.budget ? " (" + (pb.budget - total) + " to spend)" : " \u2713")) : null;
    const reset = el("button", { type: "button", class: "link", onclick: () => { state.base_scores = null; state.race_asi = null; update(); } }, "reset");
    const shuffle = dice("stats", () => {
      const vals = Object.values(o.defaultBase).sort((a, b) => b - a);
      const keys = shuffleArr(Object.keys(ABIL_FULL));
      const nb = {}; keys.forEach((k, i) => { nb[k] = vals[i]; });
      state.base_scores = nb; update();
    });
    return field("Ability scores", el("div", { class: "abgrid" },
      el("div", { class: "abrow abhead" }, el("span", {}, ""), el("span", {}, ""), el("span", {}, "base"), el("span", {}, ""),
        el("span", {}, ""), el("span", {}, "race"), el("span", {}, ""), el("span", {}, "final"), el("span", {}, "cost")), rows, summary,
      el("p", { class: "pbline" + (rTotal !== usualTotal ? " warn" : "") }, "Race bonus: put it wherever you like (newer rules let you pick). " +
        (state.race_asi ? "Adds up to +" + rTotal + (rTotal !== usualTotal ? " (usual is +" + usualTotal + " \u2014 check with your DM)" : "") + ". " : "") ,
        state.race_asi ? el("button", { type: "button", class: "link", onclick: () => { state.race_asi = null; update(); } }, "usual race bonus") : null),
      lvlAny(ch, base, rasi) ? el("p", { class: "hint block" }, "\u2191 includes level-up boosts.") : null),
      [state.base_scores || state.race_asi ? "" : "default \u2022 ", reset, " ", shuffle]);
  }

  function armorField(o) {
    const cur = C.buildCharacter(T, request()).combat;
    const curName = cur.armor.replace(/ \+ shield$/, "");
    const groups = [["none", "None"], ["light", "Light"], ["medium", "Medium"], ["heavy", "Heavy"]];
    const ch = C.buildCharacter(T, request());
    const str = ch.abilities.find((a) => a.key === "STR").score;
    const rows = groups.map(([kind, label]) => {
      const opts = o.armorOptions.filter((a) => a.kind === kind);
      if (!opts.length) return null;
      return el("div", { class: "armrow" }, el("span", { class: "armkind" }, label),
        el("div", { class: "chips" }, opts.map((a) => el("button", { type: "button",
          class: "chip-btn" + (a.name === curName ? " on" : ""), "aria-pressed": a.name === curName ? "true" : "false",
          onclick: () => { state.armor = a.name; update(); } }, a.name + " \u2022 " + a.ac + (a.strReq > str ? " \u26a0" : "")))
          .map((b, i) => tipped(b, () => TIP.armor(opts[i])))));
    });
    const shieldBtn = o.shieldProf ? el("button", { type: "button", class: "chip-btn" + (/\+ shield$/.test(cur.armor) ? " on" : ""),
      "aria-pressed": /\+ shield$/.test(cur.armor) ? "true" : "false",
      onclick: () => { state.shield = !/\+ shield$/.test(cur.armor);
        if (state.shield && state.weapon && (o.weaponOptions.find((w) => w.name === state.weapon) || {}).hands === "two") state.weapon = null;
        update(); } }, "Shield +2") : null;
    if (shieldBtn) tipped(shieldBtn, () => ({ title: "Shield", lines: [[null, "+2 Armor. Takes up one hand while you carry it."]] }));
    const reset = el("button", { type: "button", class: "link", onclick: () => { state.armor = null; state.shield = null; update(); } }, "reset");
    return field("Armor", el("div", { class: "armgrid" }, rows, shieldBtn ? el("div", { class: "armrow" }, el("span", { class: "armkind" }, "Shield"), el("div", { class: "chips" }, shieldBtn)) : null,
      el("p", { class: "hint block" }, "Armor " + cur.ac + " with " + cur.armor.toLowerCase() + ". Numbers show the Armor each choice gives (shield not included).")),
      [state.armor || state.shield != null ? "" : "default \u2022 ", reset]);
  }

  function weaponField(o) {
    if (!o.weaponOptions || o.weaponOptions.length < 2) return null;
    const cur = C.buildCharacter(T, request()).attacks;
    const curName = (cur.find((a) => o.weaponOptions.some((w) => w.name === a.name)) || {}).name || o.weaponDefault;
    const rows = [["one", "One hand"], ["two", "Two hands"]].map(([h, label]) => {
      const opts = o.weaponOptions.filter((w) => w.hands === h);
      if (!opts.length) return null;
      return el("div", { class: "armrow" }, el("span", { class: "armkind" }, label),
        el("div", { class: "chips" }, opts.map((w) => tipped(el("button", { type: "button", class: "chip-btn" + (w.name === curName ? " on" : ""),
          "aria-pressed": w.name === curName ? "true" : "false",
          onclick: () => { state.weapon = w.name; if (w.hands === "two") state.shield = false; else if (state.shield === false && !state.armor) state.shield = null; update(); } },
          w.name + " \u2022 " + w.damage), () => ({ title: w.name, lines: [[w.hands === "two" ? "Two hands" : "One hand", w.hands === "two" ? "No shield with this one." : "Leaves a hand free for a shield."],
          [null, "Hits for " + w.damage + (w.note ? " \u2022 " + w.note : "")], [null, w.cat === "martial" ? "A warrior's weapon" : "A simple weapon"]] })))));
    });
    const reset = el("button", { type: "button", class: "link", onclick: () => { state.weapon = null; update(); } }, "reset");
    return field("Main weapon", el("div", { class: "armgrid" }, rows,
      el("p", { class: "hint block" }, "Without a shield, heroes grab a two-handed weapon when it hits harder.")), [state.weapon ? "" : "default \u2022 ", reset]);
  }

  function subraceField(o) {
    if (!o.subraces || o.subraces.length < 2) return null;
    return field("Subrace", chipRow(o.subraces.map((x) => ({ id: x.id, label: x.name + (customInfo.ids.has("subraces:" + x.id) ? " \u2726" : ""), tip: () => TIP.subrace(x.id) })), o.subrace,
      (id) => { state.subrace = id; state.armor = null; state.race_asi = null; update(); }), o.subrace === o.subraces[0].id ? "the usual one" : "");
  }

  function advanced(o) {
    const d = el("details", { class: "adv", ontoggle: (ev) => { prefs.adv = ev.target.open; savePrefs(); } },
      el("summary", {}, "Fine-tune: armor, weapon, ability scores & subrace", el("span", { class: "hint" }, "The defaults are usually fine, but you can change all of these.")),
      armorField(o), weaponField(o), abilityField(o), subraceField(o));
    if (prefs.adv) d.open = true;
    return d;
  }

  // a small ⚠ that explains itself (tap, hover or hold)
  function warnBtn(text) {
    const b = el("button", { type: "button", class: "icon warn", "aria-label": text, onclick: (ev) => { ev.stopPropagation(); showTip(b); } }, "\u26a0");
    return tipped(b, () => ({ title: "Check with your DM", lines: [[null, text]] }));
  }

  function itemList(o) {
    const max = o.itemSlots;
    if (!max) return null;
    const current = (state.items || o.defaultItems).slice();
    const set = (arr) => { picker = null; state.items = arr; update(); };
    const items = [];
    current.forEach((name, i) => {
      const isOpen = picker && picker.kind === "items" && picker.index === i;
      items.push(el("li", { class: "spell" + (isOpen ? " open" : "") },
        el("button", { type: "button", class: "sname", "aria-expanded": isOpen ? "true" : "false",
          onclick: () => { picker = isOpen ? null : { kind: "items", index: i }; update(); } },
          el("b", {}, name), el("span", { class: "lvl" }, o.itemRarity(name)),
          el("small", {}, liveDesc[name] || ((o.itemCard(name) || {}).desc || "")),
          el("span", { class: "swaphint" }, isOpen ? "close" : "swap \u25be")),
        o.itemWarn(name) ? warnBtn(o.itemWarn(name)) : null,
        dice(name, () => { const free = o.itemPool.filter((n) => !current.includes(n) && !o.itemWarn(n)); if (!free.length) return;
          const arr = current.slice(); arr[i] = rnd(free); set(arr); }),
        el("button", { type: "button", class: "icon", title: "Remove", "aria-label": "Remove " + name,
          onclick: () => set(current.filter((_, j) => j !== i)) }, "\u2715")));
      if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel("items", o, current, i)));
    });
    if (current.length < max) {
      const isOpen = picker && picker.kind === "items" && picker.index === -1;
      items.push(el("li", {}, el("button", { type: "button", class: "addbtn", "aria-expanded": isOpen ? "true" : "false",
        onclick: () => { picker = isOpen ? null : { kind: "items", index: -1 }; update(); } },
        "+ add a potion or item (" + (max - current.length) + " left)")));
      if (isOpen) items.push(el("li", { class: "pwrap" }, pickerPanel("items", o, current, -1)));
    }
    const reset = el("button", { type: "button", class: "link", onclick: () => { state.item_seed = null; set(null); } }, "reset");
    const roll = dice("potions", () => { picker = null; state.items = null; state.item_seed = String(Math.floor(Math.random() * 1e6)); update(); });
    const hint = state.items ? "" : (current.length ? "picked for you \u2022 " : "");
    const martial = !o.caster;
    const note = el("p", { class: "hint block" }, (martial ? "Heroes without spells get a few extra potions and items so they have more fun things to do. " : "") +
      "Check with your DM about which magic items to start with.");
    return field("Potions & Magic Items", el("div", {}, el("ul", { class: "spells" }, items), note), [hint + current.length + " of " + max + " ", reset, " ", roll]);
  }

  function controls(o) {
    try { liveDesc = Object.fromEntries(C.buildCharacter(T, request()).cards.map((c) => [c.name, c.desc])); } catch (e) { liveDesc = {}; }
    const panel = $("#controls");
    panel.replaceChildren();
    if (prefs.heroesOpen) panel.append(heroesPanel());
    const nameIn = el("input", { id: "name", type: "text", value: state.name, maxlength: 40, autocomplete: "off",
      oninput: (ev) => { state.name = ev.target.value; update(false); relook(); } });
    panel.append(field("Name", el("div", { class: "row" }, nameIn,
      dice("name", () => { state.name = rnd(NAMES.filter((n) => n !== state.name)); update(); relook(); }))));
    panel.append(el("p", { class: "tiphint" }, el("span", { class: "mouse" }, "Hover over any choice to see what it does."),
      el("span", { class: "touch" }, "Press and hold any choice to see what it does.")));
    panel.append(field("Race", chipRow(T.races.map((r) => ({ id: r.id, label: r.name + (customInfo.ids.has("races:" + r.id) ? " \u2726" : ""), tip: () => TIP.race(r.id) })), state.race, (id) => { state.race = id; state.subrace = null; state.race_asi = null; update(); }),
      dice("race", () => { state.race = rnd(T.races.filter((r) => r.id !== state.race)).id; state.subrace = null; state.race_asi = null; update(); })));
    panel.append(field("Class", chipRow(T.classes.map((c) => ({ id: c.id, label: c.name + (customInfo.ids.has("classes:" + c.id) ? " \u2726" : ""), color: c.look.accent, tip: () => TIP.cls(c.id) })), state.cls,
      (id) => { state.cls = id; state.subclass = null; state.cantrips = null; state.spells = null; state.path_spells = null; state.inventory = null; state.base_scores = null; state.armor = null; state.shield = null; update(); }),
      dice("class", () => { state.cls = rnd(T.classes.filter((c) => c.id !== state.cls)).id; state.subclass = null; state.cantrips = null;
        state.spells = null; state.path_spells = null; state.inventory = null; state.base_scores = null; state.armor = null; state.shield = null; update(); })));
    const cls = CLASSES[state.cls];
    panel.append(el("p", { class: "tagline" }, cls.look.tagline));
    panel.append(field("Level", chipRow([1, 2, 3, 4, 5, 6, 7].slice(0, T.rules[0].max_level).map((n) => ({ id: n, label: String(n), tip: () => TIP.level(n) })),
      state.level, (id) => { state.level = id; update(); }), [el("span", { class: "hint" }, "ask your DM what level to start at "),
      dice("level", () => { state.level = 1 + Math.floor(Math.random() * T.rules[0].max_level); update(); })]));
    if (o.subs.length) {
      panel.append(field("Path", chipRow(o.subs.map((s) => ({ id: s.id, label: s.name + (customInfo.ids.has("subclasses:" + s.id) ? " \u2726" : ""), tip: () => TIP.sub(s.id) })), state.subclass,
        (id) => { state.subclass = id; state.spells = null; state.path_spells = null; update(); }),
        [o.subActive ? null : "unlocks at level " + o.subclassLevel + " ",
          o.subs.length > 1 ? dice("path", () => { state.subclass = rnd(o.subs.filter((x) => x.id !== state.subclass)).id; state.spells = null; state.path_spells = null; update(); }) : null]));
    }
    for (const g of o.groups) {
      const picks = state.choices[g.group] || [];
      const toggle = (name) => {
        let p = picks.slice();
        if (p.includes(name)) { if (g.count > 1) p = p.filter((x) => x !== name); }
        else { p.push(name); if (p.length > g.count) p = p.slice(p.length - g.count); }
        state.choices[g.group] = p; update();
      };
      const chosen = g.options.filter((x) => picks.includes(x.name));
      panel.append(field(g.label, el("div", {},
        el("div", { class: "chips" }, g.options.map((x) => el("button", { type: "button", class: "chip-btn" + (picks.includes(x.name) ? " on" : ""),
          "aria-pressed": picks.includes(x.name) ? "true" : "false", onclick: () => toggle(x.name) }, x.name))
          .map((b, i) => tipped(b, () => ({ title: g.options[i].name, lines: [[null, liveDesc[g.options[i].name] || g.options[i].desc.replace(/\{[A-Z0-9_]+\}/g, "\u2026")]] })))),
        el("ul", { class: "picked" }, chosen.map((x) => el("li", {}, el("b", {}, x.name + ": "), liveDesc[x.name] || x.desc.replace(/\{[A-Z0-9_]+\}/g, "…"))))),
        ["pick " + g.count + " ", dice(g.label, () => { state.choices[g.group] = shuffle(g.options.map((x) => x.name)).slice(0, g.count); update(); })]));
    }
    if (o.caster) {
      const a = spellList("cantrips", o), b = spellList("spells", o);
      if (a) panel.append(a);
      if (b) panel.append(b);
    }
    const il = itemList(o);
    if (il) panel.append(il);
    const ch = C.buildCharacter(T, request());
    const inv = el("textarea", { id: "inventory", rows: 5, oninput: (ev) => { state.inventory = ev.target.value.split("\n").filter((x) => x.trim()); update(false); } },
      (state.inventory || ch.inventory).join("\n"));
    panel.append(field("Inventory", inv, "one per line"));
    const notes = el("textarea", { id: "notes", rows: 3, oninput: (ev) => { state.notes = ev.target.value; update(false); } }, state.notes || "");
    panel.append(field("Notes", notes, dice("traits", () => { state.notes = rollTraits(); update(); })));
    const file0 = null;
    const file = el("input", { id: "portrait", type: "file", accept: "image/*", class: "visually-hidden", onchange: (ev) => loadPortrait(ev.target.files[0]) });
    const avStyles = AVATAR_STYLES.map((st) => el("button", { type: "button",
      class: "chip-btn" + (state.avatar && state.avatar.style === st.id ? " on" : ""), onclick: () => makeAvatar(st.id, state.avatar && state.avatar.style === st.id ? null : ((state.avatar && state.avatar.seed) || state.name || "Hero")) }, st.label));
    panel.append(field("Picture", el("div", { class: "pic" },
      el("div", { class: "chips" }, avStyles,
        state.avatar ? dice("face", () => makeAvatar(state.avatar.style, randomSeed())) : null),
      state.avatar ? el("div", { class: "row" }, el("label", { for: "face-seed", class: "hint" }, "Face code"),
        el("input", { id: "face-seed", type: "text", value: state.avatar.seed || "", maxlength: 60, autocomplete: "off", spellcheck: "false",
          oninput: (ev) => { const v = ev.target.value; clearTimeout(seedTimer); seedTimer = setTimeout(() => makeAvatar(state.avatar.style, v || " "), 250); } })) : null,
      state.avatar ? (() => {
        const lf = lookFor(state.avatar.seed);
        const pickLook = (v) => { state.look = v; makeAvatar(state.avatar.style, state.avatar.seed); };
        return el("div", { class: "row" }, el("span", { class: "hint" }, "Look"),
          el("div", { class: "chips" }, [["boy", "Boy"], ["girl", "Girl"]].map(([v, label]) => el("button", { type: "button",
            class: "chip-btn" + (lf.look === v ? " on" : ""), "aria-pressed": lf.look === v ? "true" : "false", onclick: () => pickLook(v) }, label))),
          state.look ? el("button", { type: "button", class: "link", onclick: () => pickLook(null) }, "match name") : el("span", { class: "hint" }, lf.why));
      })() : null,
      el("div", { class: "row" },
        el("label", { for: "portrait", class: "ghost filebtn" }, "Upload a picture"),
        file,
        state.portrait ? el("button", { type: "button", class: "ghost", onclick: () => { state.portrait = null; state.portrait_credit = null; state.avatar = null; update(); } }, "Remove") : null),
      el("p", { class: "hint block", id: "avatar-msg" }, state.avatar ? "Same code + same style = same face. Share a code to share a face. Credit prints in the corner." : "")),
      "or leave blank and draw one"));
    panel.append(advanced(o));
    panel.append(customSection());
  }

  function loadHero(h) {
    const q = CC.heroRequest(h);
    save();
    const slot = { id: newId(), state: {}, edited: true, updated: Date.now() };
    book.heroes.push(slot); book.current = slot.id;
    state = Object.assign({}, DEFAULT, {
      name: q.name, race: q.race, subrace: q.subrace, cls: q.cls, subclass: q.subclass, level: q.level,
      choices: Object.fromEntries(q.choices.map((c) => [c.group, c.picks])), cantrips: q.cantrips, spells: q.spells, path_spells: q.path_spells,
      items: q.items, item_seed: null, armor: q.armor, shield: q.shield, weapon: q.weapon, base_scores: q.base_scores, race_asi: q.race_asi,
      inventory: q.inventory, notes: q.notes, portrait: q.portrait, portrait_credit: q.portrait_credit, avatar: null, look: null });
    update();
    if (!q.portrait && h.avatar && h.avatar.style) { state.look = h.avatar.look || null; makeAvatar(h.avatar.style, h.avatar.seed || h.name); }
    window.scrollTo(0, 0);
  }

  function heroesPanel() {
    const label = (h) => { const s = h.state || {}; const c = CLASSES[s.cls]; return (s.name || "Hero") + " \u2022 Lv " + (s.level || 1) + " " + (c ? c.name : ""); };
    const row = (h) => {
      const cur = h.id === book.current;
      let armed = false;
      const del = el("button", { type: "button", class: "link", "aria-label": "Delete " + label(h), onclick: (ev) => {
        if (!armed) { armed = true; ev.currentTarget.textContent = "delete for good?"; return; }
        deleteHero(h.id); } }, "\u00d7");
      return el("li", { class: "herorow" + (cur ? " on" : "") },
        el("button", { type: "button", class: "heroname", "aria-current": cur ? "true" : "false", onclick: () => switchHero(h.id) }, label(h)), del);
    };
    const mine = book.heroes.filter((h) => h.edited).sort((a, b) => b.updated - a.updated);
    const rolls = book.heroes.filter((h) => !h.edited).sort((a, b) => b.updated - a.updated);
    const drawer = el("details", { class: "rolls", ontoggle: (ev) => { prefs.rollsOpen = ev.target.open; savePrefs(); } },
      el("summary", {}, "Random rolls (" + rolls.length + ")", el("span", { class: "hint" }, " \u2014 dice heroes you haven't changed; change one and it moves up")),
      el("ul", { class: "herolist" }, rolls.map(row)));
    if (prefs.rollsOpen) drawer.open = true;
    return el("div", { class: "field heroes" },
      el("div", { class: "flabel" }, "Your heroes", el("button", { type: "button", class: "link", onclick: () => { prefs.heroesOpen = false; savePrefs(); update(); } }, "close")),
      mine.length ? el("ul", { class: "herolist" }, mine.map(row)) : el("p", { class: "hint block" }, "Change anything on a hero and it's saved here."),
      el("div", { class: "row" }, el("button", { type: "button", class: "ghost", onclick: newRandomHero }, "\ud83c\udfb2 New random hero")),
      rolls.length ? drawer : null,
      el("p", { class: "hint block" }, "Heroes are saved in this browser only."));
  }

  // add a pack (JSON text) to the library; a pack with problems isn't kept: show what's wrong and leave the library as it was
  function addPackText(text, fallbackTitle) {
    let obj;
    try { obj = CC.parseCustomText(text); } catch (e) { customInfo.error = fallbackTitle + ": " + e.message; loadReport = []; update(); return false; }
    const title = obj.title || fallbackTitle;
    const before = loadLib();
    saveLib(before.filter((x) => x.title !== title).concat([{ title, text }]));
    T = withCustom();
    const bad = customInfo.problems.filter((x) => x.startsWith(title + ":")).concat(customInfo.error.startsWith(title + ":") ? [customInfo.error] : []);
    loadReport = bad;
    if (bad.length) saveLib(before);
    prefs.custom = true; savePrefs(); reloadTables();
    return !bad.length;
  }

  // packs hosted next to the page (packs/index.json), e.g. on GitHub Pages
  let sitePacks = [];
  async function loadSitePacks() {
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      const res = await fetch("packs/index.json", { cache: "no-cache" });
      if (!res.ok) return;
      const j = await res.json();
      sitePacks = (j.packs || []).filter((p) => p && typeof p.file === "string" && /^[\w.-]+\.json$/.test(p.file));
    } catch (e) { return; }
    let want = null;
    try { want = new URLSearchParams(location.search).get("pack"); } catch (e) { /* none */ }
    const auto = sitePacks.find((p) => want && (p.file === want || p.file === want + ".json"));
    if (auto && !loadLib().some((x) => x.title === auto.title)) await addSitePack(auto);
    else update();
  }
  async function addSitePack(p) {
    try {
      const res = await fetch("packs/" + p.file, { cache: "no-cache" });
      if (!res.ok) throw new Error("the server said " + res.status);
      return addPackText(await res.text(), p.file);
    } catch (e) { customInfo.error = p.file + ": couldn't download (" + (e.message || e) + ")"; update(); return false; }
  }

  function customSection() {
    const d = el("details", { class: "adv custom", ontoggle: (ev) => { prefs.custom = ev.target.open; savePrefs(); } },
      el("summary", {}, "Add your own races, classes, spells & items",
        el("span", { class: "hint" }, "Have an AI write a custom content file, then load it here.")));
    if (prefs.custom || customInfo.error || customInfo.problems.length || loadReport.length) d.open = true;
    const file = el("input", { id: "custom-file", type: "file", accept: ".json,application/json,text/plain", class: "visually-hidden",
      onchange: (ev) => { const f = ev.target.files[0]; if (!f) return; const r = new FileReader();
        r.onload = () => addPackText(r.result, f.name);
        r.readAsText(f); } });
    const lib = loadLib();
    // The built-in content is the first source in the list, with an include/leave-out checkbox like any other source.
    // Its data lives in this page (window.CHARSHEET_TABLES); unchecking it just leaves it out of the merge.
    const lines = [el("li", { class: "src builtin" },
      el("label", {}, el("input", { type: "checkbox", id: "use-builtin", checked: !prefs.noBuiltin,
        onchange: (ev) => { prefs.noBuiltin = !ev.target.checked; savePrefs(); loadReport = []; reloadTables(); } }),
        " " + SRD_TITLE),
      el("span", { class: "hint" }, prefs.noBuiltin ? " — left out" : " — the built-in heroes"))];
    for (const src of customInfo.sources) {
      const inLib = lib.some((x) => x.title === src.label);
      lines.push(el("li", {}, el("b", {}, "\u2713 " + (src.title || src.label)), " \u2014 " + (src.counts.join(", ") || "nothing new") + " ",
        inLib ? el("button", { type: "button", class: "link", onclick: () => { loadReport = []; saveLib(loadLib().filter((x) => x.title !== src.label)); reloadTables(); } }, "remove") : null));
    }
    if (customInfo.error) lines.push(el("li", { class: "bad" }, "\u26a0 " + customInfo.error));
    for (const p of [...new Set(customInfo.problems.concat(loadReport))]) lines.push(el("li", { class: "bad" }, "\u26a0 " + p));
    return d.appendChild(el("div", { class: "field" },
      el("p", { class: "hint block" }, "1. Download the instructions and give them to any AI chat (like Claude), with what you want: \u201ca turtle-folk race\u201d, \u201ca pirate subclass for rogues\u201d\u2026"),
      el("p", { class: "hint block" }, "2. Save what it writes as hero-custom.json and load it here \u2014 or put it online and paste the link."),
      el("div", { class: "row" },
        el("button", { type: "button", class: "ghost", onclick: () => saveFile("Hero Sheet custom content - instructions for AI.md",
          new Blob([window.CHARSHEET_GUIDE || ""], { type: "text/markdown" })).catch((e) => status(e.message, true)) }, "Download AI instructions"),
        el("label", { for: "custom-file", class: "ghost filebtn" }, "Load a file"), file,
        null),
      (() => {
        let saved = ""; try { saved = localStorage.getItem(CUSTOM_URL_KEY) || ""; } catch (e) { /* none */ }
        const inp = el("input", { id: "custom-url", type: "url", placeholder: "or paste a link to a custom content file", value: saved, autocomplete: "off", spellcheck: "false" });
        const go = el("button", { type: "button", class: "ghost", onclick: async () => {
          go.disabled = true; urlStatus = "Loading\u2026"; const ok = await fetchCustomUrl(inp.value, false); prefs.custom = true; savePrefs();
          if (ok) reloadTables(); else update(); } }, "Load link");
        const forget = saved ? el("button", { type: "button", class: "link", onclick: () => {
          try { localStorage.removeItem(CUSTOM_URL_KEY); localStorage.removeItem(CUSTOM_URL_KEY + "-text"); } catch (e) { /* */ }
          memUrlText = null; urlStatus = ""; reloadTables(); } }, "forget link") : null;
        return el("div", {}, el("div", { class: "row" }, inp, go), saved ? el("p", { class: "hint block" }, "Checked for updates every time the builder opens. ", forget) : null,
          urlStatus ? el("p", { class: "hint block" + (urlStatus.startsWith("\u26a0") ? " bad" : "") }, urlStatus) : null);
      })(),
      (() => {
        const ta = el("textarea", { id: "custom-paste", rows: 3, placeholder: "or paste a pack's JSON here", spellcheck: "false" });
        return el("div", {}, ta, el("div", { class: "row" }, el("button", { type: "button", class: "ghost", onclick: () => {
          if (ta.value.trim()) addPackText(ta.value, "pasted pack"); } }, "Add pasted pack")));
      })(),
      sitePacks.length ? el("div", {}, el("div", { class: "flabel" }, "Packs on this site"),
        el("ul", { class: "customlist" }, sitePacks.map((p) => {
          const have = lib.some((x) => x.title === p.title) || customInfo.sources.some((s) => s.title === p.title);
          return el("li", {}, el("b", {}, p.title || p.file), p.about ? " \u2014 " + p.about + " " : " ",
            have ? el("span", { class: "hint" }, "added") : el("button", { type: "button", class: "link", onclick: () => addSitePack(p) }, "add"));
        }))) : null,
      lines.length ? el("ul", { class: "customlist" }, lines) : el("p", { class: "hint block" }, "No custom content loaded."),
      customInfo.heroes.length ? el("div", {}, el("div", { class: "flabel" }, "Ready-made heroes"),
        el("div", { class: "chips" }, customInfo.heroes.map((h) => el("button", { type: "button", class: "chip-btn", onclick: () => loadHero(h) }, "Start as " + h.name)))) : null,
      customInfo.problems.length || loadReport.length ? el("p", { class: "hint block" }, "That file wasn't added. Copy these problems back to the AI and ask it to fix the file.") : null,
      lib.length || customInfo.sources.length ? el("p", { class: "hint block" }, "You can load several packs. Heroes made with a pack keep their own copy of it, so they keep working even if you remove it.") : null)), d;
  }

  let seedTimer = null, lookTimer = null;
  // typing a new name: if the picture follows the name and the look flips, redraw the same face code
  function relook() {
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => {
      if (!state.avatar || state.look) return;
      const refocus = () => { const n = $("#name"); if (n && document.activeElement !== n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } };
      const had = document.activeElement && document.activeElement.id === "name";
      if (lookFor(state.avatar.seed).look !== state.avatar.look) makeAvatar(state.avatar.style, state.avatar.seed).then(() => { if (had) refocus(); });
      else { update(); if (had) refocus(); } // same face, but the "why" note changed
    }, 400);
  }
  const AVATAR_STYLES = [
    { id: "pixel", label: "Pixel", pkg: "pixel-art", credit: "Art: \u201cPixel Art\u201d by DiceBear, CC0" },
    { id: "adventurer", label: "Adventurer", pkg: "adventurer", credit: "Art: \u201cAdventurer\u201d by Lisa Wischofsky, CC BY 4.0, via DiceBear" },
    { id: "smile", label: "Big smile", pkg: "big-smile", credit: "Art: \u201cBig Smile\u201d by Ashley Seo, CC BY 4.0, via DiceBear" },
    { id: "doodle", label: "Doodle", pkg: "croodles", credit: "Art: \u201cCroodles\u201d by Vijay Verma, CC BY 4.0, via DiceBear" },
  ];
  const DEFAULT_STYLE = "pixel";
  const DICEBEAR = "https://cdn.jsdelivr.net/npm/@dicebear/";
  const DICEBEAR_V = "9.2.2";
  const avatarMods = {};
  async function avatarLib(pkg) {
    if (!avatarMods.core) avatarMods.core = import(DICEBEAR + "core@" + DICEBEAR_V + "/+esm");
    if (!avatarMods[pkg]) avatarMods[pkg] = import(DICEBEAR + pkg + "@" + DICEBEAR_V + "/+esm");
    return Promise.all([avatarMods.core, avatarMods[pkg]]);
  }
  const SEED_A = ["brave", "sneaky", "sleepy", "fizzy", "lucky", "grumpy", "jolly", "tiny", "mighty", "silly", "quiet", "wild"];
  const SEED_B = ["otter", "dragon", "badger", "pickle", "comet", "goblin", "pebble", "wizard", "turnip", "falcon", "muffin", "troll"];
  const randomSeed = () => rnd(SEED_A) + "-" + rnd(SEED_B) + "-" + (1 + Math.floor(Math.random() * 99));
  // ---- boy / girl look for the cartoon faces (DiceBear has no gender switch, so we steer hair, beards & earrings)
  const pad2 = (n) => String(n).padStart(2, "0");
  const range = (pre, a, b) => Array.from({ length: b - a + 1 }, (_, i) => pre + pad2(a + i));
  const LOOKS = {
    adventurer: { boy: { hair: range("short", 1, 19), earringsProbability: 0 },
      girl: { hair: range("long", 1, 26), earringsProbability: 30, features: ["blush", "birthmark", "freckles"] } },
    pixel: { boy: { hair: range("short", 1, 24) }, girl: { hair: range("long", 1, 21), beardProbability: 0 } },
    smile: { boy: { hair: ["shortHair", "mohawk", "bowlCutHair", "shavedHead", "halfShavedHead", "curlyShortHair"] },
      girl: { hair: ["wavyBob", "curlyBob", "straightHair", "braids", "bunHair", "froBun", "bangs"],
        accessories: ["catEars", "glasses", "sailormoonCrown", "clownNose", "sleepMask", "sunglasses", "faceMask"] } },
    doodle: { boy: { top: ["variant01", "variant02", "variant03", "variant04", "variant06", "variant07", "variant08", "variant09", "variant19",
      "variant21", "variant22", "variant24", "variant25", "variant26", "variant27", "variant29"] },
      girl: { top: [...range("variant", 10, 18), "variant05", "variant21", "variant25"], beardProbability: 0, mustacheProbability: 0 } },
  };
  // first names that clearly read as a boy or a girl; anything else is a coin flip
  const BOY_NAMES = new Set(("tobin rook fennick grimble brick dex bolt aaron adam aiden alex alexander andrew anthony arthur austin ben benjamin bob " +
    "brandon brian bruce caleb carl carlos charles charlie chris christopher cole colin connor daniel david dean derek dominic dylan edward eli elijah " +
    "eric ethan evan felix finn frank fred gabe gabriel galen gavin george graham greg harry henry hugo ian isaac jack jacob jake james jason jeff " +
    "jeremy jesse joe joel john jonah jonathan jordan jose joseph josh joshua juan julian justin kevin kyle leo leon liam logan lucas luke marcus mark " +
    "martin mason matt matthew max michael miles nate nathan nick nicholas noah oliver oscar owen patrick paul peter phil ralph ray ryan sam samuel " +
    "scott sean seth simon steve steven theo thomas tim timothy tom tony travis trevor tyler victor vincent walter wesley will william wyatt zach zachary " +
    "gandalf aragorn bilbo frodo thor conan merlin drizzt gimli legolas boromir sam").split(" "));
  const GIRL_NAMES = new Set(("mira juniper nova tulip moxie luna odette saffron wren abby abigail ada addison alice alicia allison amanda amber amelia " +
    "amy anna annie aria ariana audrey ava bella brooke caroline charlotte chloe claire clara daisy ella ellie emily emma eva evelyn faith fiona " +
    "freya grace hailey hannah harper hazel holly isabel isabella ivy jade jane jasmine jenna jennifer jessica josie julia kate katie kayla kim " +
    "laura layla leah lily lila lucy lydia maddie madison maya megan mia molly naomi natalie nora olivia penny piper poppy quinn rachel rose ruby " +
    "sadie sara sarah scarlett sofia sophia sophie stella susan tessa violet willow zoe zoey hermione arwen galadriel elsa anna leia rey").split(" "));
  function nameLook(name) {
    const w = String(name || "").trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
    return BOY_NAMES.has(w) ? "boy" : GIRL_NAMES.has(w) ? "girl" : null;
  }
  const coin = (seed) => { let h = 7; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) % 2147483647; return h % 2 ? "girl" : "boy"; };
  // what the picture is drawn as, and why
  function lookFor(seed) {
    if (state.look) return { look: state.look, why: "" };
    const n = nameLook(state.name);
    return n ? { look: n, why: "matches the name" } : { look: coin(seed), why: "coin flip (name could be either)" };
  }
  async function makeAvatar(styleId, seed) {
    if (seed === null) { state.avatar = null; state.portrait = null; state.portrait_credit = null; update(); return; }
    const st = AVATAR_STYLES.find((x) => x.id === styleId);
    const msg = $("#avatar-msg");
    if (msg) msg.textContent = "Drawing a face\u2026";
    try {
      const [core, style] = await avatarLib(st.pkg);
      const look = lookFor(seed).look;
      const svg = core.createAvatar(style, Object.assign({ seed, size: 256 }, (LOOKS[styleId] || {})[look] || {})).toString();
      state.portrait = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
      state.portrait_credit = st.credit;
      state.avatar = { style: styleId, seed, look };
      const y = $("#controls").scrollTop, focused = document.activeElement && document.activeElement.id;
      update();
      $("#controls").scrollTop = y;
      if (focused === "face-seed") { const f = $("#face-seed"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
    } catch (e) {
      avatarMods.core = null; avatarMods[st.pkg] = null;
      if (msg) msg.textContent = "Couldn't load the cartoon faces (they come from the internet). Upload a picture instead.";
    }
  }

  function loadPortrait(f) {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, 600 / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        state.portrait = cv.toDataURL("image/jpeg", 0.85);
        state.portrait_credit = null; state.avatar = null;
        update();
      };
      img.src = r.result;
    };
    r.readAsDataURL(f);
  }

  // ------------------------------------------------------------------ sheet preview
  function fitBack(root) {
    const c = root.querySelector(".page.back .cards");
    if (!c || !c.clientHeight) return;  // hidden (phone "Build" view): fit when shown
    const fits = () => { if (c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1) return false; const box = c.getBoundingClientRect(); const tol = 1 + box.width / 400; for (const k of c.querySelectorAll('.cd, .sec h3')) { const r = k.getBoundingClientRect(); if (r.right > box.right + tol || r.bottom > box.bottom + tol) return false; } return true; };
    let fs = 16;
    c.style.setProperty("--fs", fs + "px");
    while (!fits() && fs > 8) { fs -= 0.25; c.style.setProperty("--fs", fs + "px"); }
  }

  function scalePreview() {
    const wrap = $("#preview");
    const sheet = wrap.querySelector(".sheet");
    if (!sheet) return;
    if (!wrap.clientWidth) return;
    const side = wrap.clientWidth >= 2 * 816 * 0.55 + 24;
    sheet.classList.toggle("side", side);
    const natW = side ? 816 * 2 + 24 : 816;
    const natH = side ? 1056 : 1056 * 2 + 24;
    const s = Math.min(1, wrap.clientWidth / natW);
    sheet.style.transform = "scale(" + s + ")";
    $("#scaler").style.height = natH * s + "px";
  }

  function renderSheet() {
    let html;
    try {
      html = C.sheetHtml(C.buildCharacter(T, request()));
      $("#error").hidden = true;
    } catch (err) {
      $("#error").hidden = false;
      $("#error").textContent = "This combo doesn't work: " + err.message;
      return;
    }
    const scaler = $("#scaler");
    scaler.innerHTML = html;
    fitBack(scaler);
    scalePreview();
  }

  let timer = null;
  function update(rebuildControls) {
    const o = tidy();
    document.documentElement.style.setProperty("--ac", CLASSES[state.cls].look.accent);
    if (rebuildControls !== false) {
      hideTip();
      const y = $("#controls").scrollTop;
      controls(o);
      $("#controls").scrollTop = y;
    }
    save();
    clearTimeout(timer);
    timer = setTimeout(renderSheet, rebuildControls === false ? 150 : 0);
  }

  // ------------------------------------------------------------------ files
  // "Tobin - Level 5 Warlock (The Fiend).pdf"
  function fileBase() {
    const clean = (x) => String(x || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").replace(/\s+/g, " ").trim();
    const ch = C.buildCharacter(T, request()).identity;
    return (clean(ch.name) || "Hero") + " - Level " + ch.level + " " + clean(ch.cls) + (ch.subclass ? " (" + clean(ch.subclass) + ")" : "");
  }
  let dlCap;
  async function saveFile(filename, blob) {
    if (dlCap === undefined) {
      dlCap = null;
      if (window.claude && window.claude.use) { try { dlCap = await window.claude.use("downloads"); } catch (e) { dlCap = null; } }
    }
    if (dlCap) { await dlCap.save({ filename, data: blob }); return; }
    if (window.claude && window.claude.use) throw Object.assign(new Error("Saving files isn't available here."), { code: "unavailable" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function status(t, bad) { const n = $("#status"); n.textContent = t; n.classList.toggle("bad", !!bad); n.hidden = !t; }
  async function exportAs(kind, btn) {
    btn.disabled = true;
    status("Making your PDF\u2026");
    try {
      const html = C.sheetHtml(C.buildCharacter(T, request()));
      const blob = await window.CharsheetExport.makePdf(html, state.name || "Hero");
      await saveFile(fileBase() + ".pdf", blob);
      status("PDF ready \u2014 print it double-sided, flip on the long edge.");
    } catch (e) {
      if (e && e.code === "declined") status("");
      else if (e && e.code === "tainted") status("This browser won't let the page build the PDF. Try Chrome, Edge or Firefox, or the builder file in Safari.", true);
      else status((e && e.message) || "Something went wrong making the file.", true);
    } finally {
      btn.disabled = false;
    }
  }
  function setView(v) {
    document.body.dataset.view = v;
    $("#tab-build").setAttribute("aria-pressed", v === "build" ? "true" : "false");
    $("#tab-sheet").setAttribute("aria-pressed", v === "sheet" ? "true" : "false");
    window.scrollTo(0, 0);
    if (v === "sheet") requestAnimationFrame(renderSheet);
  }
  $("#tab-build").addEventListener("click", () => setView("build"));
  $("#tab-sheet").addEventListener("click", () => setView("sheet"));
  setView("build");
  $("#pdf").addEventListener("click", (ev) => exportAs("pdf", ev.currentTarget));
  // 🎲 Surprise me: a brand-new random hero in its own slot (heroes you've worked on are never overwritten)
  function newRandomHero() {
    save();
    const cur = currentHero();
    if (!(cur && !cur.edited)) { const h = { id: newId(), state: {}, edited: false, rolled: null, updated: Date.now() }; book.heroes.push(h); book.current = h.id; }
    state = Object.assign({}, DEFAULT, { choices: {} });
    surprise();
  }
  function surprise() {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    state.race = pick(T.races).id; state.subrace = null; state.race_asi = null; state.cls = pick(T.classes).id; state.subclass = null;
    state.name = pick(NAMES); state.choices = {}; state.cantrips = null; state.spells = null; state.inventory = null;
    state.path_spells = null; state.portrait = null; state.portrait_credit = null; state.avatar = null; state.look = null;
    state.notes = rollTraits(); state.weapon = null;
    state.items = null; state.item_seed = String(Math.floor(Math.random() * 1e6)); state.base_scores = null; state.armor = null; state.shield = null;
    rolling = true;
    update();
    markRolled();
    const myId = book.current;
    makeAvatar(DEFAULT_STYLE, randomSeed()).finally(() => { rolling = false; if (book.current === myId && currentHero() && !currentHero().edited) markRolled(); });
  }
  $("#surprise").addEventListener("click", newRandomHero);
  $("#heroes-btn").addEventListener("click", () => { prefs.heroesOpen = !prefs.heroesOpen; savePrefs(); setView("build"); update(); $("#controls").scrollTop = 0; });
  window.addEventListener("resize", scalePreview);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderSheet, () => {});
  ensurePacks(currentHero());
  try {
    update();
  } catch (err) {
    // a saved hero from an older version can be broken: start fresh once
    try { localStorage.removeItem(KEY); } catch (e) { /* no storage */ }
    state = Object.assign({}, DEFAULT, { choices: {} });
    update();
  }
  // custom content from a link: ?custom=https://... on the page address, or a link saved earlier (refreshed each visit)
  (async () => {
    let u = null;
    try { u = new URLSearchParams(location.search).get("custom"); } catch (e) { /* no params */ }
    if (!u) { try { u = localStorage.getItem(CUSTOM_URL_KEY); } catch (e) { /* none */ } }
    if (!u) return;
    const before = memUrlText;
    if (await fetchCustomUrl(u, true)) { if (memUrlText !== before) reloadTables(); }
    else if (urlStatus) update();
  })();
  // a first visit starts on a random hero, not always the same one (tests can ask for the fixed default)
  if (!haveSaved && !window.CHARSHEET_FIXED_START) { try { surprise(); } catch (e) { /* keep the default */ } }
  else if (!haveSaved) markRolled();
  loadSitePacks();
  document.documentElement.dataset.booted = "1";
})();
