"""Part 1: tables + request -> character DataFrame.

`build_character(tables, request)` is a pure function: no IO, no globals, no
defaults from anywhere except the `tables` and `request` it is given.
"""
from __future__ import annotations

import math
import re

import polars as pl

ABILS = ("STR", "DEX", "CON", "INT", "WIS", "CHA")
_PH = re.compile(r"\{([A-Z0-9_]+)\}")

REQUEST_SCHEMA = {
    "name": pl.Utf8, "race": pl.Utf8, "cls": pl.Utf8, "subclass": pl.Utf8, "level": pl.Int64,
    "choices": pl.List(pl.Struct({"group": pl.Utf8, "picks": pl.List(pl.Utf8)})),
    "cantrips": pl.List(pl.Utf8), "spells": pl.List(pl.Utf8), "inventory": pl.List(pl.Utf8),
    "notes": pl.Utf8, "portrait": pl.Utf8, "portrait_credit": pl.Utf8,
    "path_spells": pl.List(pl.Utf8),  # off-book: replace the subclass's bonus spells
    "items": pl.List(pl.Utf8),  # potions & magic items (None = pick for me)
    "item_seed": pl.Utf8,  # changes which potions get picked for you
    "base_scores": pl.Struct({a: pl.Int64 for a in ABILS}),  # before race bonus (None = standard array)
    "armor": pl.Utf8,  # armor name or "No armor" (None = best AC you can wear)
    "shield": pl.Boolean,  # None = class default
    "subrace": pl.Utf8,
    "weapon": pl.Utf8,
    "race_asi": pl.Struct({a: pl.Int64 for a in ABILS}),  # free choice of race bonuses (None = the race's usual ones)  # None = the class's usual main weapon (a two-hander when there's no shield and it hits harder)  # None = the race's first (most common) subrace
}

CARD_OUT = pl.Struct({"section": pl.Utf8, "name": pl.Utf8, "tag": pl.Utf8, "note": pl.Utf8, "desc": pl.Utf8,
                      "uses": pl.Int64, "rest": pl.Utf8, "conc": pl.Boolean})
CHARACTER_SCHEMA = {
    "identity": pl.Struct({"name": pl.Utf8, "race": pl.Utf8, "cls": pl.Utf8, "subclass": pl.Utf8, "level": pl.Int64,
                           "accent": pl.Utf8, "tagline": pl.Utf8, "languages": pl.Utf8}),
    "abilities": pl.List(pl.Struct({"key": pl.Utf8, "score": pl.Int64, "mod": pl.Int64, "save": pl.Int64, "save_prof": pl.Boolean})),
    "combat": pl.Struct({"ac": pl.Int64, "speed": pl.Int64, "initiative": pl.Int64, "prof": pl.Int64,
                         "passive_perception": pl.Int64, "max_hp": pl.Int64, "hit_die": pl.Utf8, "hit_dice": pl.Int64,
                         "armor": pl.Utf8}),
    "skills": pl.List(pl.Struct({"name": pl.Utf8, "ability": pl.Utf8, "bonus": pl.Int64, "prof": pl.Boolean, "expert": pl.Boolean})),
    "attacks": pl.List(pl.Struct({"name": pl.Utf8, "to_hit": pl.Int64, "damage": pl.Utf8, "note": pl.Utf8})),
    "spellcasting": pl.Struct({"ability": pl.Utf8, "attack": pl.Int64, "dc": pl.Int64,
                               "slots": pl.List(pl.Struct({"level": pl.Int64, "count": pl.Int64})), "rest": pl.Utf8}),
    "cards": pl.List(CARD_OUT),
    "inventory": pl.List(pl.Utf8),
    "extras": pl.Struct({"notes": pl.Utf8, "portrait": pl.Utf8, "portrait_credit": pl.Utf8}),
}


def make_request(name="Hero", race="human", cls="fighter", subclass=None, level=1, choices=None,
                 cantrips=None, spells=None, inventory=None, notes="", portrait=None, path_spells=None, portrait_credit=None, items=None, item_seed=None, base_scores=None, armor=None, shield=None, subrace=None, weapon=None, race_asi=None) -> pl.DataFrame:
    ch = [{"group": g, "picks": list(p)} for g, p in (choices or {}).items()]
    return pl.DataFrame([{"name": name, "race": race, "cls": cls, "subclass": subclass, "level": level, "choices": ch,
                          "cantrips": cantrips, "spells": spells, "inventory": inventory, "notes": notes,
                          "portrait": portrait, "path_spells": path_spells, "portrait_credit": portrait_credit, "items": items, "item_seed": item_seed, "base_scores": base_scores,
                          "armor": armor, "shield": shield, "subrace": subrace, "weapon": weapon, "race_asi": race_asi}], schema=REQUEST_SCHEMA)


def signed(n: int) -> str:
    return f"+{n}" if n >= 0 else str(n)


def expand(text: str, vars: dict) -> str:
    out = text or ""
    for _ in range(4):
        new = _PH.sub(lambda m: _lookup(vars, m.group(1)), out)
        if new == out:
            break
        out = new
    if _PH.search(out):
        raise KeyError(f"unresolved placeholder in: {out!r}")
    return out


def _lookup(vars, key):
    if key not in vars:
        raise KeyError(f"no value for placeholder {{{key}}}")
    return str(vars[key])


def _one(df: pl.DataFrame, what: str, **eq) -> dict:
    m = df
    for k, v in eq.items():
        m = m.filter(pl.col(k) == v)
    if m.height != 1:
        raise ValueError(f"unknown {what}: {eq}")
    return m.row(0, named=True)


def _avg(die: str) -> float:
    """Average roll of "NdM" (anything else counts as 0)."""
    n, _, m = die.partition("d")
    return int(n) * (int(m) + 1) / 2 if n.isdigit() and m.isdigit() else 0.0


def seed_hash(text: str) -> int:
    """Small string hash that gives the same number in Python and JavaScript (UTF-16 code units)."""
    b = text.encode("utf-16-le")
    h = 7
    for i in range(0, len(b), 2):
        h = (h * 31 + (b[i] | (b[i + 1] << 8))) % 2147483647
    return h


def pick_items(eligible: list[dict], k: int, seed: str) -> list[str]:
    """Shuffle each rarity tier with the seed, then deal rarest-first: rare, uncommon, common, rare, ..."""
    if k <= 0:
        return []
    tiers: dict[int, list[str]] = {}
    for r in eligible:
        tiers.setdefault(r["tier"], []).append(r["name"])
    for t in tiers:
        tiers[t].sort(key=lambda n: (seed_hash(seed + "|" + n), n))
    order = sorted(tiers, reverse=True)
    out: list[str] = []
    i = 0
    while len(out) < k and any(i < len(tiers[t]) for t in order):
        for t in order:
            if i < len(tiers[t]) and len(out) < k:
                out.append(tiers[t][i])
        i += 1
    return out


def build_character(tables: dict[str, pl.DataFrame], request: pl.DataFrame) -> pl.DataFrame:
    req = request.row(0, named=True)
    rules = tables["rules"].row(0, named=True)
    level = int(req["level"])
    if not 1 <= level <= rules["max_level"]:
        raise ValueError(f"level must be 1..{rules['max_level']}")
    li = level - 1

    race = _one(tables["races"], "race", id=req["race"])
    srs = tables["subraces"].filter(pl.col("race_id") == race["id"])
    if req.get("subrace"):
        sr = _one(srs, "subrace", id=req["subrace"])
    else:
        sr = srs.row(0, named=True) if srs.height else None
    base_race_name = race["name"]
    race = dict(race, armor_prof_add=[])
    if sr is not None:
        race = dict(race, name=sr["name"], speed=race["speed"] + sr["speed"], hp_per_level=race["hp_per_level"] + sr["hp_per_level"],
                    asi={a: (race["asi"] or {}).get(a, 0) + (sr["asi"] or {}).get(a, 0) for a in ABILS},
                    skills=list(dict.fromkeys(list(race["skills"]) + list(sr["skills"]))), armor_prof_add=list(sr["armor_prof_add"]))
    cls = _one(tables["classes"], "class", id=req["cls"])
    subs = tables["subclasses"].filter(pl.col("class_id") == cls["id"])
    if req["subclass"]:
        sub = _one(subs, "subclass", id=req["subclass"])
    elif subs.height:
        sub = subs.row(0, named=True)
    else:
        sub = None
    sub_active = sub is not None and level >= cls["subclass_level"]
    prof = rules["prof_by_level"][li]

    # ---- ability scores
    if req.get("base_scores") is not None:
        scores = dict(req["base_scores"])
        for a in ABILS:
            if scores.get(a) is None or not 1 <= scores[a] <= 20:
                raise ValueError(f"{a} must be 1 to 20")
    else:
        scores = dict(zip(cls["primary"], rules["standard_array"]))
    if req.get("race_asi") is not None:
        rasi = dict(req["race_asi"])
        for a in ABILS:
            if rasi.get(a) is None or not 0 <= rasi[a] <= 3:
                raise ValueError(f"race bonus for {a} must be 0 to 3")
    else:
        rasi = race["asi"] or {}
    for a in ABILS:
        scores[a] = scores.get(a, 10) + rasi.get(a, 0)
    for asi_lvl in cls["asi_levels"]:
        if asi_lvl <= level:
            left = rules["asi"]["amount"]
            for a in cls["primary"]:
                add = min(left, rules["asi"]["cap"] - scores[a])
                scores[a] += max(add, 0)
                left -= max(add, 0)
                if left <= 0:
                    break
    mods = {a: (scores[a] - 10) // 2 for a in ABILS}

    # ---- choices
    owners = [("race", race["id"]), ("class", cls["id"])] + ([("subclass", sub["id"])] if sub_active else []) + \
        ([("subrace", sr["id"])] if sr is not None else [])
    ch = tables["choices"].filter(pl.struct(["owner_kind", "owner_id"]).is_in(
        [{"owner_kind": k, "owner_id": i} for k, i in owners]))
    asked = {c["group"]: c["picks"] for c in (req["choices"] or [])}
    picked = []  # (owner_kind, owner_id, option)
    for c in ch.iter_rows(named=True):
        n = c["count"][li]
        if n <= 0:
            continue
        names = [o["name"] for o in c["options"]]
        want = asked.get(c["group"])
        if want is None:
            want = names[:n]
        if len(want) != n or len(set(want)) != n or any(w not in names for w in want):
            raise ValueError(f"choice {c['group']!r} needs {n} distinct picks from {names}")
        for w in want:
            picked.append((c["owner_kind"], c["owner_id"], c["options"][names.index(w)]))
    eff_ac = sum(o["effect"]["ac"] for _, _, o in picked)
    eff_rhit = sum(o["effect"]["ranged_hit"] for _, _, o in picked)
    eff_dmg = sum(o["effect"]["onehand_dmg"] for _, _, o in picked)
    eff_init = sum(o["effect"]["init"] for _, _, o in picked)

    # ---- spellcasting numbers
    caster = cls["caster"]
    slot_row = _one(tables["slots"], "slot row", kind=caster["kind"], level=level)
    slots = slot_row["slots"]
    max_spell = max([i + 1 for i, n in enumerate(slots) if n > 0], default=0)
    cmod = mods.get(caster["ability"], 0) if caster["ability"] else 0
    is_caster = caster["kind"] != "none"

    # ---- template variables
    v = {"LVL": level, "PROF": prof, "HALFPROF": prof // 2, "HALFPROFUP": math.ceil(prof / 2),
         "CD": rules["cantrip_dice"][li]}
    for a in ABILS:
        v[a] = signed(mods[a])
        v[a + "N"] = mods[a]
    dcb = rules["dc_base"]
    v.update(INTATK=signed(prof + mods["INT"]), CHADC=dcb + prof + mods["CHA"], CONDC=dcb + prof + mods["CON"], DC_WIS=dcb + prof + mods["WIS"],
             MANDC=dcb + prof + max(mods["STR"], mods["DEX"]), CHANMIN1=max(1, mods["CHA"]),
             WISMIN1=max(1, mods["WIS"]), CHAPLUS1=1 + mods["CHA"], DOB=mods["CHA"] + level,
             WARD=2 * level + mods["INT"])
    if is_caster:
        v.update(SPATK=signed(prof + cmod), DC=dcb + prof + cmod, MOD=signed(cmod), MODN=max(cmod, 1))
    for r in tables["scaling"].iter_rows(named=True):
        if (r["owner_kind"], r["owner_id"]) in owners:
            v[r["key"]] = r["values"][li]
    for _, _, o in picked:
        for kv in o["effect"]["vars"]:
            v[kv["key"]] = kv["value"]

    # ---- defense, hp, speed
    ua = sub["armor"] if (sub_active and sub["armor"]) else cls["armor"]
    profs = set(cls["armor_prof"]) | (set(sub["armor_prof_add"]) if sub_active else set()) | set(race["armor_prof_add"])
    options = [{"name": "No armor", "kind": "none", "ac": ua["base"] + mods["DEX"] + sum(mods[a] for a in ua["add"]), "str_req": 0, "dl": 1}]
    for a in tables["armor"].iter_rows(named=True):
        if a["kind"] in profs:
            options.append({"name": a["name"], "kind": a["kind"], "ac": a["base"] + min(mods["DEX"], a["dex_cap"]), "str_req": a["str_req"],
                            "dl": a["default_level"]})
    if req.get("armor") is not None:
        worn = next((o for o in options if o["name"] == req["armor"]), None)
        if worn is None:
            raise ValueError(f"can't wear {req['armor']!r} (choices: {[o['name'] for o in options]})")
    else:
        worn = options[0]
        for o in options:
            if o["str_req"] <= scores["STR"] and o["dl"] <= level and o["ac"] > worn["ac"]:
                worn = o
    # ---- main melee weapon (swappable; a shield needs a free hand)
    wprof = set(cls["weapon_prof"])
    wopts = [w for w in tables["weapons"].iter_rows(named=True) if w["cat"] in wprof or w["name"] in wprof]
    slot = cls["melee_slot"]
    base_w = cls["weapons"][slot] if 0 <= slot < len(cls["weapons"]) else None
    if req.get("weapon") is not None:
        main = next((w for w in wopts if w["name"] == req["weapon"]), None)
        if main is None or base_w is None:
            raise ValueError(f"can't use {req['weapon']!r} (choices: {[w['name'] for w in wopts]})")
    else:
        main = None
    if req.get("shield") is not None:
        shield = bool(req["shield"])
    else:
        shield = cls["shield_default"] and not (main is not None and main["hands"] == "two")
    if shield and not cls["shield_prof"]:
        raise ValueError(f"{cls['name']} can't use a shield")
    if shield and main is not None and main["hands"] == "two":
        raise ValueError("a two-handed weapon and a shield don't fit together")
    if main is None and base_w is not None and not shield and base_w["ability"] == "STR" and base_w["hands"] == "one":
        best = None
        for w in wopts:
            if w["hands"] == "two" and w["ability"] == "STR" and (best is None or _avg(w["die"]) > _avg(best["die"])):
                best = w
        if best is not None and _avg(best["die"]) > _avg(base_w["die"]) + eff_dmg:
            main = best
    weapons = list(cls["weapons"])
    if main is not None:
        weapons[slot] = {"name": main["name"], "die": main["die"], "ability": main["ability"], "kind": "melee",
                         "hands": main["hands"], "note": main["note"]}
    ac = worn["ac"] + (2 if shield else 0) + (eff_ac if worn["kind"] != "none" else 0)
    armor_label = (worn["name"] if worn["kind"] != "none" else "No armor") + (" + shield" if shield else "")
    hd = cls["hit_die"]
    hp = hd + mods["CON"] + (level - 1) * (hd // 2 + 1 + mods["CON"])
    hp += race["hp_per_level"] * level + (sub["hp_per_level"] * level if sub_active else 0)
    speed = race["speed"] + cls["speed_bonus"][li] - (10 if scores["STR"] < worn["str_req"] else 0)

    # ---- skills
    prof_sk = set(cls["skills"]) | set(race["skills"]) | (set(sub["extra_skills"]) if sub_active else set())
    expert = {s for e in cls["expertise"] if e["lvl"] <= level for s in e["skills"]}
    skills = []
    for s in tables["skills"].iter_rows(named=True):
        p, e = s["name"] in prof_sk, s["name"] in expert
        skills.append({"name": s["name"], "ability": s["ability"], "bonus": mods[s["ability"]] + prof * (2 if e else 1 if p else 0),
                       "prof": p, "expert": e})
    perception = next(s["bonus"] for s in skills if s["name"] == "Perception") if any(
        s["name"] == "Perception" for s in skills) else mods["WIS"]

    # ---- attacks
    attacks = []
    for w in weapons:
        if w["ability"] == "SPELL":
            to_hit, dmg = prof + cmod, expand(w["die"], v)
        else:
            m = max(mods["STR"], mods["DEX"]) if w["ability"] == "FIN" else mods[w["ability"]]
            to_hit = prof + m + (eff_rhit if w["kind"] == "ranged" else 0)
            bonus = m + (eff_dmg if (w["kind"] == "melee" and w["hands"] == "one") else 0)
            dmg = expand(w["die"], v) + (signed(bonus) if bonus else "")
        attacks.append({"name": w["name"], "to_hit": to_hit, "damage": dmg, "note": expand(w["note"], v) or ("melee" if w["kind"] == "melee" else "")})

    # ---- cards
    cards = []

    def card(section, c, uses="", rest=""):
        u = expand(uses, v) if uses else ""
        n = int(u) if u.strip().lstrip("-").isdigit() else None
        if n is not None and n <= 0:
            return
        cards.append({"section": section, "name": expand(c["name"], v), "tag": c["tag"], "note": expand(c["note"], v),
                      "desc": expand(c["desc"], v), "uses": n, "rest": expand(rest, v) if rest else None,
                      "conc": bool(c.get("conc", False))})

    feats = tables["features"]
    cls_sec, race_sec = f"{cls['name']} Powers", f"{base_race_name} Stuff"
    sub_sec = sub["name"] if sub_active else None
    sections = [("class", cls["id"], cls_sec)] + ([("subclass", sub["id"], sub_sec)] if sub_active else []) + \
               [("race", race["id"], race_sec)] + ([("subrace", sr["id"], race_sec)] if sr is not None else [])
    for kind, oid, sec in sections:
        for r in feats.filter((pl.col("owner_kind") == kind) & (pl.col("owner_id") == oid) & (pl.col("lvl") <= level)).iter_rows(named=True):
            card(sec, r["card"], r["tracker"]["uses"], r["tracker"]["rest"])
        for k, i, o in picked:
            if (k, i) == (kind, oid):
                card(sec, {"name": o["name"], "tag": o["tag"], "note": "", "desc": o["desc"]})

    # ---- spells
    spellcasting = None
    sp = tables["spells"]
    if is_caster:
        def spell(name):
            m = sp.filter(pl.col("name") == name)
            if m.height != 1:
                raise ValueError(f"unknown spell {name!r}")
            return m.row(0, named=True)

        n_can = caster["cantrips"][li]
        cantrips = req["cantrips"] if req["cantrips"] is not None else [
            c for c in cls["cantrip_order"] if sp.filter(pl.col("name") == c).height][:n_can]
        if len(cantrips) > n_can:
            raise ValueError(f"too many cantrips (max {n_can})")
        bonus_can = [c for c in (sub["extra_cantrips"] if sub_active else []) if c not in cantrips]
        if req.get("path_spells") is not None:
            auto = list(dict.fromkeys(req["path_spells"]))
            for a in auto:
                if not 1 <= spell(a)["lvl"] <= max_spell:
                    raise ValueError(f"{a} is level {spell(a)['lvl']}; you can cast up to level {max_spell}")
        else:
            auto = [a["spell"] for a in (sub["auto_spells"] if sub_active else []) if a["lvl"] <= level]
            auto = [a for a in auto if 0 < spell(a)["lvl"] <= max(max_spell, 0)]
        if max_spell == 0:
            n_sp = 0
        elif caster["mode"] == "known":
            n_sp = caster["known"][li]
        else:
            n_sp = min(max(1, cmod + math.floor(level * caster["level_mult"])), caster["cap"])
        if req["spells"] is not None:
            picks = list(req["spells"])
            if len(picks) > n_sp:
                raise ValueError(f"too many spells (max {n_sp})")
            for p in picks:
                s = spell(p)
                if not 1 <= s["lvl"] <= max_spell:
                    raise ValueError(f"{p} is level {s['lvl']}; you can cast up to level {max_spell}")
        else:
            picks = [s for s in cls["spell_order"] if s not in auto and sp.filter(pl.col("name") == s).height
                     and 1 <= spell(s)["lvl"] <= max_spell][:n_sp]
        def scaled(row):
            sc = row.get("scale")
            k = max(0, max_spell - row["lvl"]) if caster["kind"] == "pact" and row["lvl"] > 0 else 0
            v["S"] = "" if sc is None else f"{sc['base'] + sc['per'] * k}{sc['unit']}"
            return k

        for c in cantrips:
            scaled(spell(c))
            card("Free Magic", spell(c)["card"])
        for c in bonus_can:
            scaled(spell(c))
            card("Free Magic", {**spell(c)["card"], "note": "bonus"})
        for lv in range(1, max_spell + 1):
            for s in picks + auto:
                row = spell(s)
                if row["lvl"] == lv:
                    c = dict(row["card"])
                    if scaled(row) and row.get("scale") is not None:
                        c["note"] = (c["note"] + f" \u2022 cast at lvl {max_spell}").strip(" \u2022")
                    if s in auto:
                        c["note"] = (c["note"] + " • bonus").strip(" •")
                    card(f"Level {lv} Spells", c)
        if cantrips or slots:
            spellcasting = {"ability": caster["ability"], "attack": prof + cmod, "dc": dcb + prof + cmod,
                            "slots": [{"level": i + 1, "count": n} for i, n in enumerate(slots) if n > 0],
                            "rest": slot_row["rest"]}

    # ---- potions & magic items
    it_tab = tables["items"]
    slots_n = rules["item_slots"][li]
    # the hero's own picks can be anything (the builder warns); the automatic ones follow the usual rules
    eligible = [r for r in it_tab.iter_rows(named=True) if r["min_level"] <= level and (not r["use_by"] or cls["id"] in r["use_by"])]
    by_name = {r["name"]: r for r in it_tab.iter_rows(named=True)}
    if req.get("items") is not None:
        chosen = list(dict.fromkeys(req["items"]))
        if len(chosen) > slots_n:
            raise ValueError(f"too many magic items (max {slots_n})")
        for n in chosen:
            if n not in by_name:
                raise ValueError(f"unknown magic item {n!r}")
    else:
        busy = sum(1 for c in cards if c["tag"] in ("A", "B"))  # powers, cantrips and spells all count
        want = min(slots_n, max(0, rules["option_floor"][li] - busy))
        chosen = pick_items(eligible, want, f"{cls['id']}|{race['id']}|{req.get('item_seed') or ''}")
    for n in chosen:
        r = by_name[n]
        card("Potions & Magic Items", r["card"], str(r["uses"]), r["rest"])

    ident = {"name": req["name"], "race": race["name"], "cls": cls["name"], "subclass": sub["name"] if sub_active else None,
             "level": level, "accent": cls["look"]["accent"], "tagline": cls["look"]["tagline"], "languages": race["languages"]}
    out = {
        "identity": ident,
        "abilities": [{"key": a, "score": scores[a], "mod": mods[a], "save": mods[a] + (prof if a in cls["saves"] else 0),
                       "save_prof": a in cls["saves"]} for a in ABILS],
        "combat": {"ac": ac, "speed": speed, "initiative": mods["DEX"] + eff_init, "prof": prof, "passive_perception": 10 + perception,
                   "max_hp": hp, "hit_die": f"d{hd}", "hit_dice": level, "armor": armor_label},
        "skills": skills, "attacks": attacks, "spellcasting": spellcasting, "cards": cards,
        "inventory": list(req["inventory"]) if req["inventory"] is not None else
        ([worn["name"]] if worn["kind"] != "none" else []) + (["Shield"] if shield else []) +
        [(main["name"] if (main is not None and g == base_w["name"]) else g) for g in cls["gear"]],
        "extras": {"notes": req["notes"] or "", "portrait": req["portrait"],
                   "portrait_credit": (req.get("portrait_credit") or None) if req["portrait"] else None},
    }
    return pl.DataFrame([out], schema=CHARACTER_SCHEMA)
