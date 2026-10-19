"""Custom content: extra races, classes, spells, items... written as plain JSON (see CUSTOM_CONTENT_GUIDE.md).

merge_custom(tables, custom) -> tables   (pure; web/custom.js does exactly the same thing)

A custom file only needs the fields that differ from the defaults below. A row whose key matches an
existing row replaces it; anything else is added. Unknown tables or fields are an error, so typos show up.
"""
from __future__ import annotations

import copy

import polars as pl

ABILS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"]
Z6 = {a: 0 for a in ABILS}
CARD = {"name": None, "tag": "ON", "note": "", "desc": ""}  # name None = copy the row's name
SEVEN = lambda x: [x] * 7  # noqa: E731

# Missing fields get these. A list holding one dict means "a list of these" (each entry is filled in too).
TEMPLATES = {
    "races": {"id": None, "name": None, "speed": 30, "asi": Z6, "skills": [], "hp_per_level": 0, "languages": "Common"},
    "subraces": {"id": None, "race_id": None, "name": None, "asi": Z6, "speed": 0, "hp_per_level": 0, "skills": [], "armor_prof_add": []},
    "classes": {
        "id": None, "name": None, "hit_die": 8, "primary": ABILS, "saves": [], "skills": [],
        "expertise": [{"lvl": 1, "skills": []}],
        "armor": {"base": 10, "dex_cap": 99, "add": [], "shield": 0, "worn": False},
        "armor_prof": [], "shield_prof": False, "shield_default": False,
        "weapons": [{"name": None, "die": "1d6", "ability": "STR", "kind": "melee", "hands": "one", "note": ""}],
        "caster": {"kind": "none", "ability": "", "cantrips": SEVEN(0), "mode": "none", "known": SEVEN(0), "level_mult": 0.0, "cap": 0},
        "spell_order": [], "cantrip_order": [], "subclass_level": 3, "asi_levels": [4], "speed_bonus": SEVEN(0),
        "weapon_prof": ["simple"], "melee_slot": -1, "look": {"accent": "#555555", "tagline": ""}, "gear": [],
    },
    "subclasses": {"id": None, "class_id": None, "name": None, "hp_per_level": 0, "armor": None, "armor_prof_add": [],
                   "extra_skills": [], "extra_cantrips": [], "auto_spells": [{"lvl": 1, "spell": None}]},
    "features": {"owner_kind": None, "owner_id": None, "lvl": 1, "card": CARD, "tracker": {"uses": "", "rest": ""}},
    "choices": {"owner_kind": None, "owner_id": None, "group": None, "label": None, "count": SEVEN(1),
                "options": [{"name": None, "tag": "ON", "desc": "",
                             "effect": {"ac": 0, "ranged_hit": 0, "onehand_dmg": 0, "init": 0, "vars": [{"key": None, "value": None}]}}]},
    "scaling": {"owner_kind": None, "owner_id": None, "key": None, "values": None},
    "spells": {"name": None, "lvl": 0, "classes": [], "card": dict(CARD, tag="A"), "scale": None},
    "items": {"name": None, "rarity": "common", "tier": None, "min_level": None, "use_by": [], "card": dict(CARD, tag="A", note=None), "uses": 1, "rest": "used"},
    "armor": {"name": None, "kind": "light", "base": 11, "dex_cap": 99, "str_req": 0, "default_level": 1},
    "weapons": {"name": None, "cat": "simple", "die": "1d6", "ability": "STR", "hands": "one", "note": ""},
}
REQUIRED = {"races": ["id", "name"], "subraces": ["id", "race_id", "name"], "classes": ["id", "name"],
            "subclasses": ["id", "class_id", "name"], "features": ["owner_kind", "owner_id", "card.name"],
            "choices": ["owner_kind", "owner_id", "group"], "scaling": ["owner_kind", "owner_id", "key", "values"],
            "spells": ["name"], "items": ["name"], "armor": ["name"], "weapons": ["name"]}
KEYS = {"races": ["id"], "subraces": ["id"], "classes": ["id"], "subclasses": ["id"], "spells": ["name"], "items": ["name"],
        "armor": ["name"], "weapons": ["name"], "features": ["owner_kind", "owner_id", "card.name"],
        "choices": ["owner_kind", "owner_id", "group"], "scaling": ["owner_kind", "owner_id", "key"]}
SCALE = {"base": 0, "per": 0, "unit": ""}
RARITY = {"common": (1, 1), "uncommon": (2, 3), "rare": (3, 5)}


class CustomError(ValueError):
    pass


def _fill(val, tmpl, where):
    if isinstance(tmpl, dict):
        if val is None:
            val = {}
        if not isinstance(val, dict):
            raise CustomError(f"{where} should be an object")
        extra = [k for k in val if k not in tmpl]
        if extra:
            raise CustomError(f"{where}: unknown field(s) {extra} (allowed: {list(tmpl)})")
        return {k: _fill(val.get(k), t, f"{where}.{k}") for k, t in tmpl.items()}
    if isinstance(tmpl, list) and len(tmpl) == 1 and isinstance(tmpl[0], dict):
        if val is None:
            return []
        if not isinstance(val, list):
            raise CustomError(f"{where} should be a list")
        return [_fill(x, tmpl[0], f"{where}[{i}]") for i, x in enumerate(val)]
    return copy.deepcopy(tmpl) if val is None else val


def _get(row, path):
    for p in path.split("."):
        row = row.get(p) if isinstance(row, dict) else None
    return row


def fill_row(table: str, row: dict, i: int = 0) -> dict:
    where = f"{table}[{i}]"
    if not isinstance(row, dict):
        raise CustomError(f"{where} should be an object")
    # the scale struct is optional (None = no scaling), but when given it gets its own defaults
    tmpl = TEMPLATES[table]
    if table == "spells" and row.get("scale") is not None:
        tmpl = dict(tmpl, scale=SCALE)
    if table == "subclasses" and row.get("armor") is not None:
        tmpl = dict(tmpl, armor=TEMPLATES["classes"]["armor"])
    out = _fill(row, tmpl, where)
    for r in REQUIRED[table]:
        if _get(out, r) in (None, ""):
            raise CustomError(f"{where} needs {r!r}")
    if "card" in out and out["card"]["name"] is None:
        out["card"]["name"] = out["name"]
    if table == "items":
        t, lv = RARITY.get(out["rarity"], (1, 1))
        out["tier"] = t if out["tier"] is None else out["tier"]
        out["min_level"] = lv if out["min_level"] is None else out["min_level"]
        if out["card"]["note"] is None:
            out["card"]["note"] = out["rarity"]
    for k in ("auto_spells",):
        for e in out.get(k) or []:
            if e["spell"] is None:
                raise CustomError(f"{where}.{k} entries need 'spell'")
    for o in out.get("options") or []:
        if o["name"] is None:
            raise CustomError(f"{where}.options entries need 'name'")
        for kv in o["effect"]["vars"]:
            if kv["key"] is None or kv["value"] is None:
                raise CustomError(f"{where}.options vars need 'key' and 'value'")
    if table == "choices" and out["label"] is None:
        out["label"] = out["group"]
    return out


def merge_rows(table: str, base: list[dict], add: list[dict]) -> list[dict]:
    keys = KEYS[table]
    key = lambda r: tuple(_get(r, k) for k in keys)  # noqa: E731
    out = [dict(r) for r in base]
    at = {key(r): i for i, r in enumerate(out)}
    for i, r in enumerate(add):
        r = fill_row(table, r, i)
        if key(r) in at:
            out[at[key(r)]] = r
        else:
            at[key(r)] = len(out)
            out.append(r)
    return out


def merge_custom(tables: dict[str, pl.DataFrame], custom: dict) -> dict[str, pl.DataFrame]:
    """Pure: new tables with the custom rows merged in (originals untouched)."""
    if not isinstance(custom, dict):
        raise CustomError("custom content should be one JSON object")
    bad = [k for k in custom if k not in TEMPLATES and k not in ("title", "about", "heroes")]  # heroes: ready-made picks, used by the web page
    if bad:
        raise CustomError(f"unknown table(s) {bad} (allowed: {list(TEMPLATES)})")
    out = dict(tables)
    for name in TEMPLATES:
        if name in custom:
            if not isinstance(custom[name], list):
                raise CustomError(f"{name} should be a list")
            rows = merge_rows(name, tables[name].to_dicts(), custom[name])
            try:
                out[name] = pl.DataFrame(rows, schema=tables[name].schema)
            except Exception as err:  # noqa: BLE001  (polars type errors)
                raise CustomError(f"{name}: a value has the wrong type ({err})") from None
    return out


def parse_custom_text(text: str) -> dict:
    """A custom content file is plain JSON."""
    import json
    try:
        return json.loads(text)
    except json.JSONDecodeError as err:
        raise CustomError(f"not valid JSON: {err}") from None
