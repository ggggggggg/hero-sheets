/* charsheet core — the same two steps as the Python package, for the website.
 *   buildCharacter(tables, request) -> character     (port of build.build_character)
 *   sheetHtml(character)            -> "<div class=sheet>…two pages…</div>"  (port of render.sheet_html)
 * Pure functions. tests/test_web_parity.py checks they match Python output exactly.
 */
(function (root) {
  "use strict";
  const ABILS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
  const PH = /\{([A-Z0-9_]+)\}/g;

  class CharError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }
  const valueError = (m) => new CharError("ValueError", m);
  const keyError = (m) => new CharError("KeyError", m);

  const signed = (n) => (n >= 0 ? "+" + n : String(n));

  function expand(text, vars) {
    let out = text || "";
    for (let i = 0; i < 4; i++) {
      const next = out.replace(PH, (_, k) => {
        if (!(k in vars)) throw keyError("no value for placeholder {" + k + "}");
        return String(vars[k]);
      });
      if (next === out) break;
      out = next;
    }
    PH.lastIndex = 0;
    if (/\{([A-Z0-9_]+)\}/.test(out)) throw keyError("unresolved placeholder in: " + out);
    return out;
  }

  function table(tables, name) {
    if (!(name in tables)) throw keyError(name);
    return tables[name];
  }

  function one(rows, what, pred) {
    const m = rows.filter(pred);
    if (m.length !== 1) throw valueError("unknown " + what);
    return m[0];
  }

  function avgDie(die) {
    const m = /^(\d+)d(\d+)$/.exec(die);
    return m ? (+m[1] * (+m[2] + 1)) / 2 : 0;
  }
  function seedHash(text) {
    let h = 7;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 2147483647;
    return h;
  }

  function pickItems(eligible, k, seed) {
    if (k <= 0) return [];
    const tiers = {};
    for (const r of eligible) (tiers[r.tier] = tiers[r.tier] || []).push(r.name);
    const cmp = (a, b) => { const ha = seedHash(seed + "|" + a), hb = seedHash(seed + "|" + b);
      return ha !== hb ? ha - hb : (a < b ? -1 : a > b ? 1 : 0); };
    for (const t in tiers) tiers[t].sort(cmp);
    const order = Object.keys(tiers).map(Number).sort((a, b) => b - a);
    const out = [];
    let i = 0;
    while (out.length < k && order.some((t) => i < tiers[t].length)) {
      for (const t of order) if (i < tiers[t].length && out.length < k) out.push(tiers[t][i]);
      i++;
    }
    return out;
  }

  function buildCharacter(tables, req) {
    const rules = table(tables, "rules")[0];
    const level = Number(req.level);
    if (!(level >= 1 && level <= rules.max_level)) throw valueError("level must be 1.." + rules.max_level);
    const li = level - 1;
    const race0 = one(table(tables, "races"), "race", (r) => r.id === req.race);
    const srs = table(tables, "subraces").filter((x) => x.race_id === race0.id);
    const sr = req.subrace ? one(srs, "subrace", (x) => x.id === req.subrace) : (srs[0] || null);
    let race = Object.assign({}, race0, { armor_prof_add: [] });
    if (sr) {
      const asi = {};
      for (const a of ABILS) asi[a] = ((race0.asi || {})[a] || 0) + ((sr.asi || {})[a] || 0);
      race = Object.assign({}, race0, { name: sr.name, speed: race0.speed + sr.speed, hp_per_level: race0.hp_per_level + sr.hp_per_level,
        asi, skills: [...new Set([...race0.skills, ...sr.skills])], armor_prof_add: sr.armor_prof_add.slice() });
    }
    const cls = one(table(tables, "classes"), "class", (r) => r.id === req.cls);
    const subs = table(tables, "subclasses").filter((s) => s.class_id === cls.id);
    let sub = null;
    if (req.subclass) sub = one(subs, "subclass", (s) => s.id === req.subclass);
    else if (subs.length) sub = subs[0];
    const subActive = sub !== null && level >= cls.subclass_level;
    const prof = rules.prof_by_level[li];

    // ability scores
    const scores = {};
    if (req.base_scores != null) {
      for (const a of ABILS) {
        const n = req.base_scores[a];
        if (n == null || !(n >= 1 && n <= 20)) throw valueError(a + " must be 1 to 20");
        scores[a] = n;
      }
    } else {
      cls.primary.forEach((a, i) => { if (i < rules.standard_array.length) scores[a] = rules.standard_array[i]; });
    }
    let rasi = race.asi || {};
    if (req.race_asi != null) {
      rasi = req.race_asi;
      for (const a of ABILS) if (rasi[a] == null || !(rasi[a] >= 0 && rasi[a] <= 3)) throw valueError("race bonus for " + a + " must be 0 to 3");
    }
    for (const a of ABILS) scores[a] = (a in scores ? scores[a] : 10) + (rasi[a] || 0);
    for (const asiLvl of cls.asi_levels) {
      if (asiLvl <= level) {
        let left = rules.asi.amount;
        for (const a of cls.primary) {
          const add = Math.max(Math.min(left, rules.asi.cap - scores[a]), 0);
          scores[a] += add;
          left -= add;
          if (left <= 0) break;
        }
      }
    }
    const mods = {};
    for (const a of ABILS) mods[a] = Math.floor((scores[a] - 10) / 2);

    // choices
    const owners = [["race", race.id], ["class", cls.id]].concat(subActive ? [["subclass", sub.id]] : [], sr ? [["subrace", sr.id]] : []);
    const isOwner = (k, i) => owners.some(([a, b]) => a === k && b === i);
    const choiceRows = table(tables, "choices").filter((c) => isOwner(c.owner_kind, c.owner_id));
    const asked = {};
    for (const c of req.choices || []) asked[c.group] = c.picks;
    const picked = [];
    for (const c of choiceRows) {
      const n = c.count[li];
      if (n <= 0) continue;
      const names = c.options.map((o) => o.name);
      let want = asked[c.group];
      if (want === undefined || want === null) want = names.slice(0, n);
      if (want.length !== n || new Set(want).size !== n || want.some((w) => !names.includes(w)))
        throw valueError("choice " + c.group + " needs " + n + " distinct picks");
      for (const w of want) picked.push([c.owner_kind, c.owner_id, c.options[names.indexOf(w)]]);
    }
    const effAc = picked.reduce((s, p) => s + p[2].effect.ac, 0);
    const effRhit = picked.reduce((s, p) => s + p[2].effect.ranged_hit, 0);
    const effDmg = picked.reduce((s, p) => s + p[2].effect.onehand_dmg, 0);
    const effInit = picked.reduce((s, p) => s + p[2].effect.init, 0);

    // spellcasting numbers
    const caster = cls.caster;
    const slotRow = one(table(tables, "slots"), "slot row", (r) => r.kind === caster.kind && r.level === level);
    const slots = slotRow.slots;
    let maxSpell = 0;
    slots.forEach((n, i) => { if (n > 0) maxSpell = Math.max(maxSpell, i + 1); });
    const cmod = caster.ability ? (mods[caster.ability] !== undefined ? mods[caster.ability] : 0) : 0;
    const isCaster = caster.kind !== "none";

    // template variables
    const v = { LVL: level, PROF: prof, HALFPROF: Math.floor(prof / 2), HALFPROFUP: Math.ceil(prof / 2), CD: rules.cantrip_dice[li] };
    for (const a of ABILS) { v[a] = signed(mods[a]); v[a + "N"] = mods[a]; }
    const dcb = rules.dc_base;
    Object.assign(v, {
      INTATK: signed(prof + mods.INT), CHADC: dcb + prof + mods.CHA, CONDC: dcb + prof + mods.CON, DC_WIS: dcb + prof + mods.WIS,
      MANDC: dcb + prof + Math.max(mods.STR, mods.DEX), CHANMIN1: Math.max(1, mods.CHA), WISMIN1: Math.max(1, mods.WIS),
      CHAPLUS1: 1 + mods.CHA, DOB: mods.CHA + level, WARD: 2 * level + mods.INT,
    });
    if (isCaster) Object.assign(v, { SPATK: signed(prof + cmod), DC: dcb + prof + cmod, MOD: signed(cmod), MODN: Math.max(cmod, 1) });
    for (const r of table(tables, "scaling")) if (isOwner(r.owner_kind, r.owner_id)) v[r.key] = r.values[li];
    for (const p of picked) for (const kv of p[2].effect.vars) v[kv.key] = kv.value;

    // defense, hp, speed
    const ua = subActive && sub.armor ? sub.armor : cls.armor;
    const profs = new Set([...cls.armor_prof, ...(subActive ? sub.armor_prof_add : []), ...race.armor_prof_add]);
    const armorOptions = [{ name: "No armor", kind: "none", ac: ua.base + mods.DEX + ua.add.reduce((s, a) => s + mods[a], 0), str_req: 0, dl: 1 }];
    for (const a of table(tables, "armor")) {
      if (profs.has(a.kind)) armorOptions.push({ name: a.name, kind: a.kind, ac: a.base + Math.min(mods.DEX, a.dex_cap), str_req: a.str_req, dl: a.default_level });
    }
    let worn;
    if (req.armor != null) {
      worn = armorOptions.find((o) => o.name === req.armor);
      if (!worn) throw valueError("can't wear " + req.armor);
    } else {
      worn = armorOptions[0];
      for (const o of armorOptions) if (o.str_req <= scores.STR && o.dl <= level && o.ac > worn.ac) worn = o;
    }
    // main melee weapon (swappable; a shield needs a free hand)
    const wprof = new Set(cls.weapon_prof);
    const wopts = table(tables, "weapons").filter((w) => wprof.has(w.cat) || wprof.has(w.name));
    const slot = cls.melee_slot;
    const baseW = slot >= 0 && slot < cls.weapons.length ? cls.weapons[slot] : null;
    let main = null;
    if (req.weapon != null) {
      main = wopts.find((w) => w.name === req.weapon) || null;
      if (!main || !baseW) throw valueError("can't use " + req.weapon);
    }
    const shield = req.shield != null ? !!req.shield : (cls.shield_default && !(main && main.hands === "two"));
    if (shield && !cls.shield_prof) throw valueError(cls.name + " can't use a shield");
    if (shield && main && main.hands === "two") throw valueError("a two-handed weapon and a shield don't fit together");
    if (!main && baseW && !shield && baseW.ability === "STR" && baseW.hands === "one") {
      let best = null;
      for (const w of wopts) if (w.hands === "two" && w.ability === "STR" && (!best || avgDie(w.die) > avgDie(best.die))) best = w;
      if (best && avgDie(best.die) > avgDie(baseW.die) + effDmg) main = best;
    }
    const weapons = cls.weapons.slice();
    if (main) weapons[slot] = { name: main.name, die: main.die, ability: main.ability, kind: "melee", hands: main.hands, note: main.note };
    const ac = worn.ac + (shield ? 2 : 0) + (worn.kind !== "none" ? effAc : 0);
    const armorLabel = (worn.kind !== "none" ? worn.name : "No armor") + (shield ? " + shield" : "");
    const hd = cls.hit_die;
    let hp = hd + mods.CON + (level - 1) * (Math.floor(hd / 2) + 1 + mods.CON);
    hp += race.hp_per_level * level + (subActive ? sub.hp_per_level * level : 0);
    const speed = race.speed + cls.speed_bonus[li] - (scores.STR < worn.str_req ? 10 : 0);

    // skills
    const profSk = new Set([...cls.skills, ...race.skills, ...(subActive ? sub.extra_skills : [])]);
    const expert = new Set();
    for (const e of cls.expertise) if (e.lvl <= level) for (const s of e.skills) expert.add(s);
    const skills = table(tables, "skills").map((s) => {
      const p = profSk.has(s.name), e = expert.has(s.name);
      return { name: s.name, ability: s.ability, bonus: mods[s.ability] + prof * (e ? 2 : p ? 1 : 0), prof: p, expert: e };
    });
    const per = skills.find((s) => s.name === "Perception");
    const perception = per ? per.bonus : mods.WIS;

    // attacks
    const attacks = weapons.map((w) => {
      let toHit, dmg;
      if (w.ability === "SPELL") { toHit = prof + cmod; dmg = expand(w.die, v); }
      else {
        const m = w.ability === "FIN" ? Math.max(mods.STR, mods.DEX) : mods[w.ability];
        toHit = prof + m + (w.kind === "ranged" ? effRhit : 0);
        const bonus = m + (w.kind === "melee" && w.hands === "one" ? effDmg : 0);
        dmg = expand(w.die, v) + (bonus ? signed(bonus) : "");
      }
      return { name: w.name, to_hit: toHit, damage: dmg, note: expand(w.note, v) || (w.kind === "melee" ? "melee" : "") };
    });

    // cards
    const cards = [];
    function card(section, c, uses, rest) {
      const u = uses ? expand(uses, v) : "";
      const t = u.trim();
      const n = /^-*\d+$/.test(t) ? parseInt(t.replace(/^-+/, "-"), 10) : null;
      if (n !== null && n <= 0) return;
      cards.push({ section, name: expand(c.name, v), tag: c.tag, note: expand(c.note, v), desc: expand(c.desc, v),
        uses: n, rest: rest ? expand(rest, v) : null, conc: c.conc === true });
    }
    const feats = table(tables, "features");
    const sections = [["class", cls.id, cls.name + " Powers"]]
      .concat(subActive ? [["subclass", sub.id, sub.name]] : [])
      .concat([["race", race.id, race0.name + " Stuff"]], sr ? [["subrace", sr.id, race0.name + " Stuff"]] : []);
    for (const [kind, oid, sec] of sections) {
      for (const r of feats) if (r.owner_kind === kind && r.owner_id === oid && r.lvl <= level) card(sec, r.card, r.tracker.uses, r.tracker.rest);
      for (const [k, i, o] of picked) if (k === kind && i === oid) card(sec, { name: o.name, tag: o.tag, note: "", desc: o.desc });
    }

    // spells
    let spellcasting = null;
    const sp = table(tables, "spells");
    if (isCaster) {
      const spell = (name) => {
        const m = sp.filter((s) => s.name === name);
        if (m.length !== 1) throw valueError("unknown spell " + name);
        return m[0];
      };
      const exists = (name) => sp.some((s) => s.name === name);
      const nCan = caster.cantrips[li];
      const cantrips = req.cantrips != null ? req.cantrips : cls.cantrip_order.filter(exists).slice(0, nCan);
      if (cantrips.length > nCan) throw valueError("too many cantrips");
      const bonusCan = (subActive ? sub.extra_cantrips : []).filter((c) => !cantrips.includes(c));
      let auto;
      if (req.path_spells != null) {
        auto = [...new Set(req.path_spells)];
        for (const a of auto) { const l = spell(a).lvl; if (!(l >= 1 && l <= maxSpell)) throw valueError(a + " is too high a level"); }
      } else {
        auto = (subActive ? sub.auto_spells : []).filter((a) => a.lvl <= level).map((a) => a.spell);
        auto = auto.filter((a) => { const l = spell(a).lvl; return l > 0 && l <= Math.max(maxSpell, 0); });
      }
      let nSp;
      if (maxSpell === 0) nSp = 0;
      else if (caster.mode === "known") nSp = caster.known[li];
      else nSp = Math.min(Math.max(1, cmod + Math.floor(level * caster.level_mult)), caster.cap);
      let picks;
      if (req.spells != null) {
        picks = req.spells.slice();
        if (picks.length > nSp) throw valueError("too many spells");
        for (const p of picks) { const s = spell(p); if (!(s.lvl >= 1 && s.lvl <= maxSpell)) throw valueError(p + " is too high a level"); }
      } else {
        picks = cls.spell_order.filter((s) => !auto.includes(s) && exists(s) && spell(s).lvl >= 1 && spell(s).lvl <= maxSpell).slice(0, nSp);
      }
      const scaled = (row) => {
        const sc = row.scale;
        const k = caster.kind === "pact" && row.lvl > 0 ? Math.max(0, maxSpell - row.lvl) : 0;
        v.S = sc == null ? "" : String(sc.base + sc.per * k) + sc.unit;
        return k;
      };
      for (const c of cantrips) { scaled(spell(c)); card("Free Magic", spell(c).card); }
      for (const c of bonusCan) { scaled(spell(c)); card("Free Magic", Object.assign({}, spell(c).card, { note: "bonus" })); }
      for (let lv = 1; lv <= maxSpell; lv++) {
        for (const s of picks.concat(auto)) {
          const row = spell(s);
          if (row.lvl === lv) {
            const c = Object.assign({}, row.card);
            if (scaled(row) && row.scale != null) c.note = stripChars(c.note + " \u2022 cast at lvl " + maxSpell, " \u2022");
            if (auto.includes(s)) c.note = stripChars((c.note + " • bonus"), " •");
            card("Level " + lv + " Spells", c);
          }
        }
      }
      if (cantrips.length || slots.length) {
        spellcasting = { ability: caster.ability, attack: prof + cmod, dc: dcb + prof + cmod,
          slots: slots.map((n, i) => ({ level: i + 1, count: n })).filter((s) => s.count > 0), rest: slotRow.rest };
      }
    }

    // potions & magic items
    const itTab = table(tables, "items");
    const slotsN = rules.item_slots[li];
    const byItem = Object.fromEntries(itTab.map((r) => [r.name, r]));
    let chosen;
    if (req.items != null) {
      chosen = [...new Set(req.items)];
      if (chosen.length > slotsN) throw valueError("too many magic items");
      for (const n of chosen) {
        if (!byItem[n]) throw valueError("unknown magic item " + n);
      }
    } else {
      const busy = cards.filter((c) => c.tag === "A" || c.tag === "B").length;
      const want = Math.min(slotsN, Math.max(0, rules.option_floor[li] - busy));
      chosen = pickItems(itTab.filter((r) => r.min_level <= level && (!r.use_by.length || r.use_by.includes(cls.id))), want, cls.id + "|" + race.id + "|" + (req.item_seed || ""));
    }
    for (const n of chosen) { const r = byItem[n]; card("Potions & Magic Items", r.card, String(r.uses), r.rest); }

    return {
      identity: { name: req.name, race: race.name, cls: cls.name, subclass: subActive ? sub.name : null, level,
        accent: cls.look.accent, tagline: cls.look.tagline, languages: race.languages },
      abilities: ABILS.map((a) => ({ key: a, score: scores[a], mod: mods[a], save: mods[a] + (cls.saves.includes(a) ? prof : 0),
        save_prof: cls.saves.includes(a) })),
      combat: { ac, speed, initiative: mods.DEX + effInit, prof, passive_perception: 10 + perception, max_hp: hp,
        hit_die: "d" + hd, hit_dice: level, armor: armorLabel },
      skills, attacks, spellcasting, cards,
      inventory: req.inventory != null ? req.inventory.slice() :
        (worn.kind !== "none" ? [worn.name] : []).concat(shield ? ["Shield"] : [], cls.gear.map((g) => (main && g === baseW.name ? main.name : g))),
      extras: { notes: req.notes || "", portrait: req.portrait == null ? null : req.portrait,
        portrait_credit: req.portrait ? (req.portrait_credit || null) : null },
    };
  }

  function stripChars(s, chars) {
    let a = 0, b = s.length;
    while (a < b && chars.includes(s[a])) a++;
    while (b > a && chars.includes(s[b - 1])) b--;
    return s.slice(a, b);
  }

  // ------------------------------------------------------------------ rendering (port of render.py)
  const ICON = {
    A: '<svg viewBox="0 0 24 24"><path d="M14.5 3H21v6.5L10 20.5l-2-2-3 3-2.5-2.5 3-3-2-2z" fill="currentColor"/></svg>',
    B: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor"/></svg>',
    R: '<svg viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5z" fill="currentColor"/></svg>',
    ON: '<svg viewBox="0 0 24 24"><path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill="currentColor"/></svg>',
    F: '<svg viewBox="0 0 24 24"><path d="M12 1c.6 5 2 9.4 11 11-9 1.6-10.4 6-11 11-.6-5-2-9.4-11-11 9-1.6 10.4-6 11-11z" fill="currentColor"/></svg>',
  };
  const TAGS = [["A", "ACTION", "#222"], ["B", "BONUS", "#e08a00"], ["R", "REACTION", "#2878c8"], ["ON", "ALWAYS ON", "#7a7a7a"], ["F", "FREE", "#2a9d5c"]];
  const TAGMAP = Object.fromEntries(TAGS.map(([k, l, c]) => [k, [l, c]]));
  const ABIL_NAME = { STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" };
  const STAR = '<svg viewBox="0 0 24 24"><path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill="#fff" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  const BOX_LIMIT = 12;

  function e(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  }
  const rep = (s, n) => (n > 0 ? s.repeat(n) : "");
  const tint = (hex) => (hex.length === 7 ? hex + "1a" : "#f2f2f2");

  function uses(n, rest) {
    if (n === null || n === undefined) return "";
    const map = { short: "back after a short rest", long: "back after a long rest", turn: "once per turn", used: "gone when used" };
    const restTxt = (rest || "") in map ? map[rest || ""] : (rest || "");
    const boxes = n <= BOX_LIMIT ? rep("<i></i>", n) : '<span class="wr"></span><b>/ ' + n + "</b>";
    return '<div class="bx">' + boxes + "<small>" + e(restTxt) + "</small></div>";
  }

  function frontHtml(ch) {
    const idn = ch.identity, cb = ch.combat;
    const sub = idn.subclass ? " (" + e(idn.subclass) + ")" : "";
    let portrait = ch.extras.portrait ? '<img src="' + e(ch.extras.portrait) + '" alt="">' : "Draw your hero here!";
    if (ch.extras.portrait_credit) portrait += '<span class="credit">' + e(ch.extras.portrait_credit) + "</span>";
    const abil = ch.abilities.map((a) =>
      '<div class="ab"><div class="lbl">' + e(ABIL_NAME[a.key] || a.key) + '</div><div class="m">' + signed(a.mod) +
      '</div><div class="sc">' + a.score + '</div><div class="sv"><i class="pd' + (a.save_prof ? " on" : "") +
      '"></i> save ' + signed(a.save) + "</div></div>").join("");
    const skills = ch.skills.map((s) =>
      '<div class="sk"><span><i class="pd' + (s.expert ? " ex" : s.prof ? " on" : "") + '"></i> ' + e(s.name) +
      "</span><b>" + signed(s.bonus) + "</b></div>").join("");
    const inv = ch.inventory.map((x) => "<div>" + e(x) + "</div>").join("");
    return '<section class="page front">' +
      '<div class="head"><div><div class="nm disp">' + e(idn.name) + "</div>" +
      '<div class="sub">' + e(idn.race) + " • " + e(idn.cls) + sub + "</div>" +
      '<div class="tag">' + e(idn.tagline) + "</div></div>" +
      '<div class="lv"><b>' + idn.level + '</b><span class="lbl">Level</span></div></div>' +
      '<div class="fr1"><div class="portrait" data-role="portrait">' + portrait + '</div><div class="abil">' + abil + "</div></div>" +
      '<div class="box skills"><h4>Skills</h4><div class="skgrid">' + skills + "</div>" +
      '<div class="facts"><span>Proficiency <b>' + signed(cb.prof) + "</b></span><span>Notice <b>" + cb.passive_perception +
      "</b></span><span>Speaks: " + e(idn.languages) + '</span><span class="player">Player</span></div></div>' +
      '<div class="inv"><div class="box col" data-role="inventory"><h4>Inventory</h4><div class="lines">' + inv + "</div>" +
      '<div class="coins"><div>GOLD</div><div>SILVER</div><div>COPPER</div></div></div>' +
      '<div class="box col" data-role="notes"><h4>Notes</h4><div class="lines">' + e(ch.extras.notes) + "</div></div></div>" +
      "</section>";
  }

  function backHtml(ch) {
    const idn = ch.identity, cb = ch.combat, sc = ch.spellcasting;
    const sub = idn.subclass ? " (" + e(idn.subclass) + ")" : "";
    const tiles = '<div class="tile"><b>' + cb.ac + '</b><span class="lbl">Armor</span><span class="worn">' + e(cb.armor || "") + "</span></div>" +
      '<div class="tile hp"><div class="mx"><b>' + cb.max_hp + '</b><span class="lbl">Max HP</span></div>' +
      '<div><div class="w"></div><span class="lbl">HP now</span></div><div><div class="w"></div><span class="lbl">Temp HP</span></div></div>' +
      '<div class="tile"><b>' + cb.speed + '</b><span class="lbl">Speed (ft)</span></div>' +
      '<div class="tile"><b>' + signed(cb.initiative) + '</b><span class="lbl">Initiative</span></div>';
    const mini = '<div class="mini"><span>Death saves &nbsp;OK ' + rep('<i class="dot"></i>', 3) + " &nbsp;Uh-oh " + rep('<i class="dot"></i>', 3) +
      "</span></div>";
    let atk = ch.attacks.map((a) => '<tr><td class="n">' + e(a.name) + "</td><td>" + signed(a.to_hit) + "</td><td>" + e(a.damage) +
      "</td><td>" + e(a.note) + "</td></tr>").join("");
    atk = '<div class="box"><table class="atk"><tr><th>Attack</th><th>To hit</th><th>Damage</th><th>Range</th></tr>' + atk + "</table></div>";
    let magic = "";
    if (sc) {
      const rows = sc.slots.map((s) => "<span>Level " + s.level + " " + rep("<i>" + STAR + "</i>", s.count) + "</span>").join("");
      const rest = sc.rest === "short" ? "short" : "long";
      magic = '<div class="magic"><span class="big">Spell attack ' + signed(sc.attack) + " • DC " + sc.dc + "</span>" + rows +
        (sc.slots.length ? "<small>color a star per spell • back after a " + rest + " rest</small>" : "") + "</div>";
    }
    const secs = new Map();
    for (const c of ch.cards) { if (!secs.has(c.section)) secs.set(c.section, []); secs.get(c.section).push(c); }
    let body = "";
    for (const [name, items] of secs) {
      let cards = "";
      for (const c of items) {
        const [lab, col] = TAGMAP[c.tag] || [c.tag, "#555"];
        const chip = c.tag ? '<span class="chip" style="background:' + col + '">' + (ICON[c.tag] || "") + e(lab) + "</span>" : "";
        const note = c.note ? '<span class="chip note">' + e(c.note) + "</span>" : "";
        const conc = c.conc ? '<span class="chip conc">Concentration</span>' : "";
        cards += '<div class="cd" data-card="' + e(c.name) + '"><span class="n">' + e(c.name) + "</span>" + chip + note + conc +
          '<div class="d">' + e(c.desc) + "</div>" + uses(c.uses, c.rest) + "</div>";
      }
      body += '<div class="sec"><h3>' + e(name) + "</h3>" + cards + "</div>";
    }
    const legend = TAGS.map(([k, l, c]) => '<span class="chip" style="background:' + c + ';margin:0">' + ICON[k] + l + "</span>").join("");
    return '<section class="page back">' +
      '<div class="bhead"><div class="nm disp">' + e(idn.name) + '</div><div class="disp" style="font-size:15px">' +
      e(idn.cls) + sub + " • Level " + idn.level + "</div></div>" +
      '<div class="combat">' + tiles + "</div>" + mini +
      '<div class="cmb2">' + atk + magic + "</div>" +
      '<div class="cards">' + body + "</div>" +
      '<div class="foot">' + legend + "<span><b>Action</b> = your main thing. <b>Bonus</b> = a quick extra thing. " +
      "<b>Reaction</b> = once a round, even on someone else's turn.</span></div>" +
      "</section>";
  }

  function sheetHtml(ch) {
    const ac = ch.identity.accent || "#444444";
    return '<div class="sheet" style="--ac:' + e(ac) + ";--tint:" + tint(ac) + '">' + frontHtml(ch) + backHtml(ch) + "</div>";
  }


  // ------------------------------------------------------------------ helpers for the website controls
  function options(tables, req) {
    let _d0 = null;
    const dflt0 = () => _d0 || (_d0 = buildCharacter(tables, Object.assign({}, req, { items: null, choices: [], cantrips: null, spells: null, path_spells: null, armor: null, shield: null })));
    const rules = table(tables, "rules")[0];
    const level = Number(req.level), li = level - 1;
    const race = one(table(tables, "races"), "race", (r) => r.id === req.race);
    const srs = table(tables, "subraces").filter((x) => x.race_id === race.id);
    const sr = (req.subrace && srs.find((x) => x.id === req.subrace)) || srs[0] || null;
    const cls = one(table(tables, "classes"), "class", (r) => r.id === req.cls);
    const subs = table(tables, "subclasses").filter((s) => s.class_id === cls.id);
    const sub = req.subclass ? subs.find((s) => s.id === req.subclass) || subs[0] || null : subs[0] || null;
    const subActive = !!sub && level >= cls.subclass_level;
    const owners = [["race", race.id], ["class", cls.id]].concat(subActive ? [["subclass", sub.id]] : []);
    const groups = table(tables, "choices")
      .filter((c) => owners.some(([k, i]) => k === c.owner_kind && i === c.owner_id) && c.count[li] > 0)
      .map((c) => ({ group: c.group, label: c.label, count: c.count[li], options: c.options }));
    const caster = cls.caster;
    const out = { subs, sub, subActive, subclassLevel: cls.subclass_level, groups, caster: caster.kind !== "none",
      nCan: 0, nSp: 0, maxSpell: 0, auto: [], bonusCantrips: [], cantripPool: [], spellPool: [] };
    // armor choices (name, kind, AC) — computed by building the hero in each one
    out.armorDefault = dflt0().combat.armor;
    out.armorOptions = [];
    out.shieldProf = cls.shield_prof;
    {
      const subA = subActive ? sub.armor_prof_add : [];
      const profs = new Set([...cls.armor_prof, ...subA, ...(sr ? sr.armor_prof_add : [])]);
      const names = ["No armor"].concat(table(tables, "armor").filter((a) => profs.has(a.kind)).map((a) => a.name));
      const kinds = Object.fromEntries(table(tables, "armor").map((a) => [a.name, a.kind]));
      for (const n of names) {
        try {
          const c = buildCharacter(tables, Object.assign({}, req, { armor: n, shield: false, items: null, choices: [], cantrips: null, spells: null, path_spells: null }));
          const sr = table(tables, "armor").find((a) => a.name === n);
          out.armorOptions.push({ name: n, kind: kinds[n] || "none", ac: c.combat.ac, strReq: sr ? sr.str_req : 0 });
        } catch (e) { /* skip */ }
      }
    }
    // main melee weapon choices (name, hands, damage) — again by building the hero with each one
    out.weaponOptions = [];
    out.weaponDefault = null;
    if (cls.melee_slot >= 0 && cls.melee_slot < cls.weapons.length) {
      const wprof = new Set(cls.weapon_prof);
      const quick = { items: null, choices: [], cantrips: null, spells: null, path_spells: null };
      try { out.weaponDefault = buildCharacter(tables, Object.assign({}, req, quick, { weapon: null })).attacks[cls.melee_slot].name; } catch (e) { /* skip */ }
      for (const w of table(tables, "weapons")) {
        if (!(wprof.has(w.cat) || wprof.has(w.name))) continue;
        try {
          const c = buildCharacter(tables, Object.assign({}, req, quick, { weapon: w.name, shield: w.hands === "two" ? false : req.shield }));
          out.weaponOptions.push({ name: w.name, hands: w.hands, cat: w.cat, damage: c.attacks[cls.melee_slot].damage, note: w.note });
        } catch (e) { /* skip */ }
      }
    }
    // ability scores before race bonus
    out.defaultBase = {};
    cls.primary.forEach((a, i) => { out.defaultBase[a] = rules.standard_array[i]; });
    for (const a of ABILS) if (!(a in out.defaultBase)) out.defaultBase[a] = 10;
    out.raceAsi = {};
    for (const a of ABILS) out.raceAsi[a] = ((race.asi || {})[a] || 0) + ((sr && sr.asi) ? (sr.asi[a] || 0) : 0);
    out.subraces = srs;
    out.subrace = sr ? sr.id : null;
    out.pointBuy = rules.point_buy || null;
    // potions & magic items
    const its = table(tables, "items");
    const itemBy = Object.fromEntries(its.map((r) => [r.name, r]));
    out.itemSlots = rules.item_slots[li];
    out.itemPool = its.slice().sort((a, b) => b.tier - a.tier || (a.name < b.name ? -1 : 1)).map((r) => r.name);
    // "talk to your DM" notes for picks outside the usual rules
    const clsName = (id) => { const c = table(tables, "classes").find((x) => x.id === id); return c ? c.name : id; };
    out.itemWarn = (n) => {
      const r = itemBy[n];
      if (!r) return "";
      const why = [];
      if (r.min_level > level) why.push("it's a " + r.rarity + " item, usually for heroes level " + r.min_level + " and up");
      if (r.use_by.length && !r.use_by.includes(cls.id)) why.push("usually only " + r.use_by.map(clsName).join(", ") + " can use it");
      return why.length ? "Talk to your DM: by the usual rules " + why.join(", and ") + "." : "";
    };
    out.itemRarity = (n) => (itemBy[n] ? itemBy[n].rarity : "");
    out.itemCard = (n) => (itemBy[n] ? itemBy[n].card : null);
    let dflt;
    try { dflt = buildCharacter(tables, Object.assign({}, req, { items: null })); }
    catch (e) { dflt = buildCharacter(tables, Object.assign({}, req, { items: null, choices: [], cantrips: null, spells: null, path_spells: null })); }
    out.defaultItems = dflt.cards.filter((c) => c.section === "Potions & Magic Items").map((c) => c.name);
    if (caster.kind === "none") return out;
    const slotRow = table(tables, "slots").find((r) => r.kind === caster.kind && r.level === level);
    let maxSpell = 0;
    (slotRow ? slotRow.slots : []).forEach((n, i) => { if (n > 0) maxSpell = Math.max(maxSpell, i + 1); });
    const sp = table(tables, "spells");
    const byName = Object.fromEntries(sp.map((s) => [s.name, s]));
    const ch = buildCharacter(tables, Object.assign({}, req, { choices: [], cantrips: null, spells: null, path_spells: null, items: null }));
    const mod = ch.abilities.find((a) => a.key === caster.ability);
    const cmod = mod ? mod.mod : 0;
    out.maxSpell = maxSpell;
    out.nCan = caster.cantrips[li];
    out.nSp = maxSpell === 0 ? 0 : caster.mode === "known" ? caster.known[li] :
      Math.min(Math.max(1, cmod + Math.floor(level * caster.level_mult)), caster.cap);
    out.bookAuto = (subActive ? sub.auto_spells : []).filter((a) => a.lvl <= level && byName[a.spell] &&
      byName[a.spell].lvl > 0 && byName[a.spell].lvl <= maxSpell).map((a) => a.spell);
    out.auto = req.path_spells != null ? req.path_spells.filter((n) => byName[n] && byName[n].lvl >= 1 && byName[n].lvl <= maxSpell) : out.bookAuto;
    out.anyPool = sp.filter((s) => s.lvl >= 1 && s.lvl <= maxSpell).map((s) => s.name).sort();
    out.bonusCantrips = subActive ? sub.extra_cantrips.slice() : [];
    const ordered = (order, okLvl) => {
      const first = order.filter((n) => byName[n] && okLvl(byName[n].lvl));
      const rest = sp.filter((s) => s.classes.includes(cls.id) && okLvl(s.lvl) && !first.includes(s.name))
        .map((s) => s.name).sort();
      return first.concat(rest);
    };
    out.cantripPool = ordered(cls.cantrip_order, (l) => l === 0);
    out.spellPool = ordered(cls.spell_order, (l) => l >= 1 && l <= maxSpell).filter((n) => !out.auto.includes(n));
    out.spellLevel = (n) => (byName[n] ? byName[n].lvl : 0);
    out.spellCard = (n) => (byName[n] ? byName[n].card : null);
    out.defaults = { cantrips: ch.cards.filter((c) => c.section === "Free Magic" && c.note !== "bonus").map((c) => c.name),
      spells: ch.cards.filter((c) => /^Level \d+ Spells$/.test(c.section) && !out.bookAuto.includes(c.name)).map((c) => c.name) };
    return out;
  }

  const api = { buildCharacter, sheetHtml, expand, CharError, options };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Charsheet = api;
})(typeof window !== "undefined" ? window : globalThis);
