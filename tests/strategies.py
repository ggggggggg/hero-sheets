"""Hypothesis strategies: random rules tables, random requests, random characters."""
from __future__ import annotations

import string

import polars as pl
from hypothesis import strategies as st

from charsheet import data as D
from charsheet.build import CHARACTER_SCHEMA, make_request

ABILS = D.ABILS
# Words drawn from an alphabet that never appears in the default data, so any
# string that leaks into the output from somewhere other than the tables shows up.
word = st.text(alphabet="qxzjkvwy", min_size=3, max_size=8)
phrase = st.lists(word, min_size=1, max_size=5).map(" ".join)
ident = st.text(alphabet=string.ascii_lowercase, min_size=3, max_size=8)
TAG = st.sampled_from(["A", "B", "R", "ON", "F"])


@st.composite
def random_tables(draw):
    """A complete, self-consistent set of rules tables with random content."""
    n_skills = draw(st.integers(2, 6))
    skill_names = draw(st.lists(phrase, min_size=n_skills, max_size=n_skills, unique=True))
    skills = pl.DataFrame({"name": skill_names, "ability": [draw(st.sampled_from(ABILS)) for _ in skill_names]})
    max_level = 7
    rules = pl.DataFrame([{
        "standard_array": sorted(draw(st.lists(st.integers(3, 18), min_size=6, max_size=6)), reverse=True),
        "prof_by_level": draw(st.lists(st.integers(1, 6), min_size=7, max_size=7)),
        "cantrip_dice": draw(st.lists(st.integers(1, 4), min_size=7, max_size=7)),
        "asi": {"amount": draw(st.integers(0, 4)), "cap": draw(st.integers(18, 30))},
        "dc_base": draw(st.integers(5, 12)),
        "max_level": max_level,
        "item_slots": draw(st.lists(st.integers(0, 4), min_size=7, max_size=7)),
        "option_floor": draw(st.lists(st.integers(0, 12), min_size=7, max_size=7)),
        "point_buy": {"low": 8, "costs": [0, 1, 2, 3, 4, 5, 7, 9], "budget": 27},
    }])
    kinds = ["full", "half", "pact", "none"]
    slot_rows = []
    for k in kinds:
        for lv in range(1, 8):
            s = [] if k == "none" else draw(st.lists(st.integers(0, 4), max_size=4))
            slot_rows.append({"kind": k, "level": lv, "slots": s, "rest": draw(st.sampled_from(["short", "long"]))})
    slots = pl.DataFrame(slot_rows, schema={"kind": pl.Utf8, "level": pl.Int64, "slots": pl.List(pl.Int64), "rest": pl.Utf8})

    race_ids = draw(st.lists(ident, min_size=1, max_size=3, unique=True))
    races = pl.DataFrame([{
        "id": r, "name": draw(phrase), "speed": draw(st.integers(20, 40)),
        "asi": {a: draw(st.integers(0, 2)) for a in ABILS},
        "skills": draw(st.lists(st.sampled_from(skill_names), max_size=2, unique=True)),
        "hp_per_level": draw(st.integers(0, 2)), "languages": draw(phrase)} for r in race_ids],
        schema=D.races_table().schema)

    n_sp = draw(st.integers(0, 6))
    spell_names = draw(st.lists(phrase, min_size=n_sp, max_size=n_sp, unique=True))
    class_ids = draw(st.lists(ident.filter(lambda x: x not in race_ids), min_size=1, max_size=3, unique=True))
    spells = pl.DataFrame([{"name": s, "lvl": draw(st.integers(0, 4)), "classes": class_ids,
                            "card": {"name": s, "tag": draw(TAG), "note": draw(phrase), "desc": draw(phrase)},
                            "scale": draw(st.one_of(st.none(), st.fixed_dictionaries({"base": st.integers(1, 9), "per": st.integers(0, 3),
                                                                                      "unit": st.sampled_from(["", "d6", "d10"])})))}
                           for s in spell_names], schema=D.SPELL_SCHEMA)
    classes, subs, feats, choices = [], [], [], []
    taken = set(race_ids) | set(class_ids)
    for c in class_ids:
        primary = list(draw(st.permutations(ABILS)))
        kind = draw(st.sampled_from(kinds))
        classes.append(dict(
            id=c, name=draw(phrase), hit_die=draw(st.sampled_from([6, 8, 10, 12])), primary=primary,
            saves=draw(st.lists(st.sampled_from(ABILS), max_size=2, unique=True)),
            skills=draw(st.lists(st.sampled_from(skill_names), max_size=3, unique=True)),
            expertise=[{"lvl": draw(st.integers(1, 7)), "skills": draw(st.lists(st.sampled_from(skill_names), max_size=2, unique=True))}],
            armor=D.A(draw(st.integers(10, 16)), draw(st.integers(0, 99)), draw(st.lists(st.sampled_from(ABILS), max_size=1)),
                      draw(st.integers(0, 2)), draw(st.booleans())),
            armor_prof=draw(st.lists(st.sampled_from(["light", "medium", "heavy"]), max_size=3, unique=True)),
            shield_prof=(sp := draw(st.booleans())), shield_default=sp and draw(st.booleans()),
            weapon_prof=draw(st.lists(st.sampled_from(["simple", "martial"]), max_size=2, unique=True)), melee_slot=draw(st.sampled_from([-1, 0])),
            weapons=[D.W(draw(phrase), "1d" + str(draw(st.integers(4, 12))), draw(st.sampled_from(["STR", "DEX", "FIN", "SPELL"])),
                         draw(st.sampled_from(["melee", "ranged"])), draw(st.sampled_from(["one", "two"])), draw(phrase))],
            caster=D.C(kind, draw(st.sampled_from(ABILS)), draw(st.lists(st.integers(0, 3), min_size=7, max_size=7)),
                       draw(st.sampled_from(["known", "prepared"])), draw(st.lists(st.integers(0, 4), min_size=7, max_size=7)),
                       draw(st.sampled_from([0.5, 1.0])), draw(st.integers(1, 6))),
            spell_order=[s for s in spell_names if draw(st.booleans())],
            cantrip_order=[s for s in spell_names if draw(st.booleans())],
            subclass_level=draw(st.integers(1, 4)), asi_levels=draw(st.lists(st.integers(1, 7), max_size=2)),
            speed_bonus=draw(st.lists(st.integers(0, 15), min_size=7, max_size=7)),
            look={"accent": "#" + draw(st.text(alphabet="0123456789abcdef", min_size=6, max_size=6)), "tagline": draw(phrase)},
            gear=draw(st.lists(phrase, max_size=4))))
        for _ in range(draw(st.integers(1, 2))):
            sid = draw(ident.filter(lambda x: x not in taken))
            taken.add(sid)
            subs.append(dict(id=sid, class_id=c, name=draw(phrase), hp_per_level=draw(st.integers(0, 1)),
                             armor=None, armor_prof_add=draw(st.lists(st.sampled_from(["light", "medium", "heavy"]), max_size=1)),
                             extra_skills=[], extra_cantrips=[],
                             auto_spells=[{"lvl": draw(st.integers(1, 7)), "spell": s} for s in spell_names if draw(st.booleans())]))
    subraces = []
    for r in race_ids:
        for _ in range(draw(st.integers(0, 2))):
            rid = draw(ident.filter(lambda x: x not in taken))
            taken.add(rid)
            subraces.append({"id": rid, "race_id": r, "name": draw(phrase), "asi": {a: draw(st.integers(0, 2)) for a in ABILS},
                             "speed": draw(st.integers(0, 10)), "hp_per_level": draw(st.integers(0, 1)),
                             "skills": draw(st.lists(st.sampled_from(skill_names), max_size=1)),
                             "armor_prof_add": draw(st.lists(st.sampled_from(["light", "medium"]), max_size=1))})
    for kind, oid in ([("race", r) for r in race_ids] + [("class", c) for c in class_ids] + [("subclass", s["id"]) for s in subs]
                      + [("subrace", x["id"]) for x in subraces]):
        for _ in range(draw(st.integers(0, 3))):
            uses = draw(st.sampled_from(["", "1", "2", "3"]))
            feats.append({"owner_kind": kind, "owner_id": oid, "lvl": draw(st.integers(1, 7)),
                          "card": {"name": draw(phrase), "tag": draw(TAG), "note": draw(phrase), "desc": draw(phrase)},
                          "tracker": {"uses": uses, "rest": draw(st.sampled_from(["short", "long"])) if uses else ""}})
        if draw(st.booleans()):
            opts = draw(st.lists(phrase, min_size=2, max_size=4, unique=True))
            choices.append({"owner_kind": kind, "owner_id": oid, "group": f"g_{oid}", "label": draw(phrase),
                            "count": draw(st.lists(st.integers(0, 2), min_size=7, max_size=7)),
                            "options": [{"name": o, "tag": draw(TAG), "desc": draw(phrase),
                                         "effect": {"ac": draw(st.integers(0, 2)), "ranged_hit": draw(st.integers(0, 2)),
                                                    "onehand_dmg": draw(st.integers(0, 2)), "init": draw(st.integers(0, 3)), "vars": []}} for o in opts]})
    return {
        "rules": rules, "skills": skills, "slots": slots, "races": races,
        "subraces": pl.DataFrame(subraces, schema=D.SUBRACE_SCHEMA),
        "classes": pl.DataFrame(classes, schema=D.CLASS_SCHEMA),
        "subclasses": pl.DataFrame(subs, schema=D.SUB_SCHEMA),
        "scaling": pl.DataFrame(schema=D.scaling_table().schema),
        "features": pl.DataFrame(feats, schema=D.FEATURE_SCHEMA),
        "choices": pl.DataFrame(choices, schema=D.CHOICE_SCHEMA),
        "spells": spells,
        "weapons": pl.DataFrame([{"name": n, "cat": draw(st.sampled_from(["simple", "martial"])), "die": draw(st.sampled_from(["1d6", "1d8", "2d6", "1d12"])),
                                  "ability": draw(st.sampled_from(["STR", "FIN"])), "hands": draw(st.sampled_from(["one", "two"])), "note": draw(phrase)}
                                 for n in draw(st.lists(phrase, max_size=4, unique=True))], schema=D.WEAPON_TABLE_SCHEMA),
        "armor": pl.DataFrame([{"name": n, "kind": draw(st.sampled_from(["light", "medium", "heavy"])), "base": draw(st.integers(10, 18)),
                                "dex_cap": draw(st.sampled_from([0, 2, 99])), "str_req": draw(st.sampled_from([0, 13, 15])),
                                "default_level": draw(st.integers(1, 7))}
                               for n in draw(st.lists(phrase, max_size=5, unique=True))], schema=D.ARMOR_TABLE_SCHEMA),
        "items": pl.DataFrame([{"name": n, "rarity": draw(phrase), "tier": draw(st.integers(1, 3)), "min_level": draw(st.integers(1, 7)),
                                "use_by": draw(st.lists(st.sampled_from(class_ids), max_size=1)), "card": {"name": n, "tag": draw(TAG), "note": draw(phrase), "desc": draw(phrase)},
                                "uses": draw(st.integers(1, 9)), "rest": draw(st.sampled_from(["used", "long"]))}
                               for n in draw(st.lists(phrase, max_size=6, unique=True))], schema=D.ITEM_SCHEMA),
    }


@st.composite
def request_for(draw, tables, *, free_text=False):
    """A valid request for the given tables (lets the builder pick spells/choices unless told)."""
    race = draw(st.sampled_from(tables["races"]["id"].to_list()))
    cls = draw(st.sampled_from(tables["classes"]["id"].to_list()))
    subs = tables["subclasses"].filter(pl.col("class_id") == cls)["id"].to_list()
    sub = draw(st.sampled_from(subs)) if subs else None
    level = draw(st.integers(1, tables["rules"]["max_level"][0]))
    text = st.text(min_size=0, max_size=40) if free_text else st.just("")
    return make_request(name=draw(st.text(min_size=1, max_size=24)) if free_text else "Hero", race=race, cls=cls,
                        subclass=sub, level=level, notes=draw(text),
                        inventory=draw(st.lists(st.text(min_size=1, max_size=30), max_size=8)) if free_text else None)


@st.composite
def random_choice_request(draw, tables):
    """A request with randomly chosen (valid) picks for every choice group, using default tables."""
    base = draw(request_for(tables)).row(0, named=True)
    li = base["level"] - 1
    owners = {("race", base["race"]), ("class", base["cls"])}
    cls = tables["classes"].filter(pl.col("id") == base["cls"]).row(0, named=True)
    if base["subclass"] and base["level"] >= cls["subclass_level"]:
        owners.add(("subclass", base["subclass"]))
    picks = {}
    for c in tables["choices"].iter_rows(named=True):
        if (c["owner_kind"], c["owner_id"]) in owners and c["count"][li] > 0:
            names = [o["name"] for o in c["options"]]
            picks[c["group"]] = draw(st.lists(st.sampled_from(names), min_size=c["count"][li], max_size=c["count"][li], unique=True))
    return make_request(**{k: base[k] for k in ("name", "race", "cls", "subclass", "level")}, choices=picks)


@st.composite
def random_character(draw):
    """A character DataFrame made directly (not via the builder) to fuzz the renderer."""
    t = st.text(min_size=0, max_size=30)
    n_cards = draw(st.integers(0, 20))
    cards = [{"section": draw(st.sampled_from(["Powers", "Stuff", "Free Magic", "Level 1 Spells"])), "name": draw(st.text(min_size=1, max_size=24)),
              "tag": draw(st.sampled_from(["A", "B", "R", "ON", "F", ""])), "note": draw(t), "desc": draw(st.text(max_size=120)),
              "uses": draw(st.one_of(st.none(), st.integers(1, 40))), "rest": draw(st.sampled_from([None, "short", "long", "turn"]))}
             for _ in range(n_cards)]
    has_magic = draw(st.booleans())
    row = {
        "identity": {"name": draw(st.text(min_size=1, max_size=30)), "race": draw(t), "cls": draw(t),
                     "subclass": draw(st.one_of(st.none(), t)), "level": draw(st.integers(1, 7)),
                     "accent": "#" + draw(st.text(alphabet="0123456789abcdef", min_size=6, max_size=6)),
                     "tagline": draw(t), "languages": draw(t)},
        "abilities": [{"key": a, "score": draw(st.integers(1, 20)), "mod": draw(st.integers(-5, 5)), "save": draw(st.integers(-5, 12)),
                       "save_prof": draw(st.booleans())} for a in ABILS],
        "combat": {"ac": draw(st.integers(5, 25)), "speed": draw(st.integers(10, 60)), "initiative": draw(st.integers(-3, 8)),
                   "prof": draw(st.integers(2, 6)), "passive_perception": draw(st.integers(5, 25)), "max_hp": draw(st.integers(1, 200)),
                   "hit_die": "d8", "hit_dice": draw(st.integers(1, 7)), "armor": draw(t)},
        "skills": [{"name": draw(st.text(min_size=1, max_size=16)), "ability": "DEX", "bonus": draw(st.integers(-5, 15)),
                    "prof": draw(st.booleans()), "expert": draw(st.booleans())} for _ in range(draw(st.integers(0, 18)))],
        "attacks": [{"name": draw(st.text(min_size=1, max_size=20)), "to_hit": draw(st.integers(-2, 12)), "damage": draw(t), "note": draw(t)}
                    for _ in range(draw(st.integers(0, 4)))],
        "spellcasting": {"ability": "INT", "attack": draw(st.integers(0, 12)), "dc": draw(st.integers(8, 20)),
                         "slots": [{"level": i + 1, "count": draw(st.integers(1, 4))} for i in range(draw(st.integers(0, 4)))],
                         "rest": draw(st.sampled_from(["short", "long"]))} if has_magic else None,
        "cards": cards,
        "inventory": draw(st.lists(st.text(min_size=1, max_size=30), max_size=10)),
        "extras": {"notes": draw(st.text(max_size=200)), "portrait": None, "portrait_credit": None},
    }
    return pl.DataFrame([row], schema=CHARACTER_SCHEMA)


ABIL6 = ["STR", "DEX", "CON", "INT", "WIS", "CHA"]


@st.composite
def random_full_request(draw, tables):
    """Like request_for, but also fiddles with every optional knob a hero can turn in the builder:
    subrace, main weapon, armor, shield, picked items, item seed, base scores and race bonus.
    Some combos are illegal on purpose (a wizard asking for a greatsword) — those must fail cleanly."""
    base = draw(request_for(tables)).row(0, named=True)
    srs = tables["subraces"].filter(pl.col("race_id") == base["race"])["id"].to_list()
    weapons = tables["weapons"]["name"].to_list()
    armor = ["No armor"] + tables["armor"]["name"].to_list()
    items = tables["items"]["name"].to_list()
    maybe = lambda s: draw(st.one_of(st.none(), s))  # noqa: E731
    return make_request(
        name="Hero", race=base["race"], cls=base["cls"], subclass=base["subclass"], level=base["level"],
        subrace=maybe(st.sampled_from(srs)) if srs else None,
        weapon=maybe(st.sampled_from(weapons)) if weapons else None,
        armor=maybe(st.sampled_from(armor)),
        shield=maybe(st.booleans()),
        items=maybe(st.lists(st.sampled_from(items), max_size=3, unique=True)) if items else None,
        item_seed=maybe(st.text(max_size=6)),
        base_scores=maybe(st.fixed_dictionaries({a: st.integers(3, 18) for a in ABIL6})),
        race_asi=maybe(st.fixed_dictionaries({a: st.integers(0, 3) for a in ABIL6})),
    )
