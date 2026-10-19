"""Part 1 tests: f(tables, request) -> character DataFrame.

* every race x class x subclass x level builds with the default tables
* changing a cell in an input table changes the output the way it should
* the function is pure: no IO, inputs untouched, same input -> same output
* fuzz: completely random tables (made of words that appear nowhere else) still
  build, and every word in the output came from those tables
"""
import builtins
import itertools
import math
import pathlib
import re

import polars as pl
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from charsheet.build import CHARACTER_SCHEMA, build_character, make_request
from strategies import random_choice_request, random_full_request, random_tables, request_for

FUZZ = settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large])


def row(df):
    return df.row(0, named=True)


def cards(ch):
    return {c["name"]: c for c in row(ch)["cards"]}


def all_text(ch):
    """Every string in the character, flattened."""
    out = []

    def walk(x):
        if isinstance(x, str):
            out.append(x)
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(row(ch))
    return out


def set_cell(df, mask, col, value):
    return df.with_columns(pl.when(mask).then(pl.lit(value, dtype=df.schema[col])).otherwise(pl.col(col)).alias(col))


# ----------------------------------------------------------------------------- every combo
def all_combos(t):
    for race in t["races"]["id"]:
        for c in t["classes"].iter_rows(named=True):
            for s in t["subclasses"].filter(pl.col("class_id") == c["id"])["id"]:
                yield race, c["id"], s


def test_every_combo_builds_with_valid_schema(tables):
    n = 0
    for race, cls, sub in all_combos(tables):
        for lvl in range(1, 8):
            ch = build_character(tables, make_request(race=race, cls=cls, subclass=sub, level=lvl))
            assert ch.schema == pl.Schema(CHARACTER_SCHEMA)
            assert ch.height == 1
            assert not any("{" in s or "}" in s for s in all_text(ch)), "unexpanded placeholder"
            n += 1
    assert n == 8 * 24 * 7


# ----------------------------------------------------------------------------- known characters
def test_tobin_level5(tables):
    ch = build_character(tables, make_request(name="Tobin", race="dwarf", cls="warlock", subclass="fiend", level=5,
                                              choices={"invocations": ["Agonizing Blast", "Fiendish Vigor", "Eldritch Spear"],
                                                       "pact": ["Pact of the Chain"]}))
    r = row(ch)
    assert r["identity"]["subclass"] == "The Fiend"
    assert r["combat"]["max_hp"] == 8 + 3 + 4 * (5 + 3) + 5  # d8, CON 14+2 dwarf = 16 (+3), dwarf +1/level
    assert r["spellcasting"]["slots"] == [{"level": 3, "count": 2}] and r["spellcasting"]["rest"] == "short"
    eb = next(a for a in r["attacks"] if a["name"] == "Eldritch Blast")
    assert eb["damage"] == "1d10+3" and eb["note"].startswith("2 beams")
    assert "Pact of the Chain" in cards(ch) and "Dark One's Blessing" in cards(ch)


def test_subclass_waits_for_its_level(tables):
    early = row(build_character(tables, make_request(cls="fighter", subclass="champion", level=2)))
    late = row(build_character(tables, make_request(cls="fighter", subclass="champion", level=3)))
    assert early["identity"]["subclass"] is None and late["identity"]["subclass"] == "Champion"
    assert "Improved Critical" not in {c["name"] for c in early["cards"]}
    assert "Improved Critical" in {c["name"] for c in late["cards"]}


def test_fighting_style_effects(tables):
    base = row(build_character(tables, make_request(cls="fighter", choices={"fighting_style": ["Great Weapon Fighting"]})))
    defense = row(build_character(tables, make_request(cls="fighter", choices={"fighting_style": ["Defense"]})))
    dueling = row(build_character(tables, make_request(cls="fighter", choices={"fighting_style": ["Dueling"]})))
    archery = row(build_character(tables, make_request(cls="fighter", choices={"fighting_style": ["Archery"]})))
    assert defense["combat"]["ac"] == base["combat"]["ac"] + 1
    sword = lambda r: next(a for a in r["attacks"] if a["name"] == "Longsword")  # noqa: E731
    xbow = lambda r: next(a for a in r["attacks"] if a["name"] == "Heavy crossbow")  # noqa: E731
    assert sword(dueling)["damage"] != sword(base)["damage"]
    assert xbow(archery)["to_hit"] == xbow(base)["to_hit"] + 2


def test_dragonborn_ancestry_changes_breath(tables):
    blue = cards(build_character(tables, make_request(race="dragonborn", choices={"ancestry": ["Blue Dragon Ancestry"]})))
    assert "lightning" in blue["Breath Weapon"]["desc"] and "30-ft line" in blue["Breath Weapon"]["desc"]


def test_level_progression_monotone(tables):
    for race, cls, sub in all_combos(tables):
        hps = [row(build_character(tables, make_request(race=race, cls=cls, subclass=sub, level=l)))["combat"]["max_hp"] for l in range(1, 8)]
        assert hps == sorted(hps) and len(set(hps)) == 7


# ----------------------------------------------------------------------------- errors
@pytest.mark.parametrize("kw", [dict(race="nope"), dict(cls="nope"), dict(level=0), dict(level=8),
                                dict(cls="fighter", subclass="fiend"),
                                dict(cls="fighter", choices={"fighting_style": ["Defense", "Archery"]}),
                                dict(cls="fighter", choices={"fighting_style": ["Not A Style"]}),
                                dict(cls="wizard", level=1, spells=["Fireball"]),
                                dict(cls="wizard", level=1, spells=["Magic Missile"] * 9),
                                dict(cls="wizard", level=1, spells=["Made Up Spell"])])
def test_bad_requests_raise_value_error(tables, kw):
    with pytest.raises(ValueError):
        build_character(tables, make_request(**kw))


@pytest.mark.parametrize("missing", ["rules", "races", "classes", "subclasses", "slots", "features", "choices", "spells", "skills", "scaling", "items", "armor", "subraces", "weapons"])
def test_every_table_is_required(tables, missing):
    t = {k: v for k, v in tables.items() if k != missing}
    with pytest.raises(KeyError):
        build_character(t, make_request(cls="wizard", level=3))


# ----------------------------------------------------------------------------- purity
def test_pure_no_io_no_mutation(tables, monkeypatch):
    req = make_request(race="tiefling", cls="sorcerer", subclass="draconic", level=6)
    snapshot = {k: v.clone() for k, v in tables.items()}

    def boom(*a, **k):
        raise AssertionError("build_character touched the file system")
    monkeypatch.setattr(builtins, "open", boom)
    monkeypatch.setattr(pathlib.Path, "read_text", boom)
    monkeypatch.setattr(pathlib.Path, "read_bytes", boom)
    a = build_character(tables, req)
    b = build_character(tables, req)
    monkeypatch.undo()
    assert a.equals(b)
    for k in tables:
        assert tables[k].equals(snapshot[k]), f"{k} was mutated"


# ----------------------------------------------------------------------------- change input -> change output
def test_mutation_hit_die(tables):
    req = make_request(cls="wizard", level=4)
    t = dict(tables, classes=set_cell(tables["classes"], pl.col("id") == "wizard", "hit_die", 12))
    before, after = row(build_character(tables, req)), row(build_character(t, req))
    assert after["combat"]["max_hp"] - before["combat"]["max_hp"] == (12 - 6) + 3 * ((12 // 2 + 1) - (6 // 2 + 1))
    assert after["combat"]["hit_die"] == "d12"


def test_mutation_feature_text(tables):
    req = make_request(cls="rogue", level=1)
    f = tables["features"]
    mask = (pl.col("owner_id") == "rogue") & (pl.col("card").struct.field("name") == "Sneak Attack")
    new = f.with_columns(pl.when(mask).then(pl.struct(pl.lit("Backstab").alias("name"), pl.lit("F").alias("tag"),
                                                      pl.lit("").alias("note"), pl.lit("Stab them for {SNEAK} dice!").alias("desc")))
                         .otherwise(pl.col("card")).alias("card"))
    c = cards(build_character(dict(tables, features=new), req))
    assert "Sneak Attack" not in c and c["Backstab"]["desc"] == "Stab them for 1 dice!"


def test_mutation_rules_numbers(tables):
    req = make_request(cls="bard", level=3)
    r = tables["rules"].with_columns(pl.lit([9, 9, 9, 9, 9, 9, 9]).alias("prof_by_level"),
                                     pl.lit([18, 17, 16, 15, 14, 13]).alias("standard_array"))
    a, b = row(build_character(tables, req)), row(build_character(dict(tables, rules=r), req))
    assert b["combat"]["prof"] == 9 and a["combat"]["prof"] == 2
    assert max(x["score"] for x in b["abilities"]) > max(x["score"] for x in a["abilities"])


def test_mutation_scaling(tables):
    req = make_request(cls="barbarian", level=1)
    s = tables["scaling"].with_columns(
        pl.when((pl.col("owner_id") == "barbarian") & (pl.col("key") == "RAGES")).then(pl.lit(["9"] * 7))
        .otherwise(pl.col("values")).alias("values"))
    assert cards(build_character(tables, req))["Rage"]["uses"] == 2
    assert cards(build_character(dict(tables, scaling=s), req))["Rage"]["uses"] == 9


def test_mutation_slots_and_spells(tables):
    req = make_request(cls="wizard", level=1)
    sl = tables["slots"].with_columns(pl.when((pl.col("kind") == "full") & (pl.col("level") == 1)).then(pl.lit([7]))
                                      .otherwise(pl.col("slots")).alias("slots"))
    assert row(build_character(dict(tables, slots=sl), req))["spellcasting"]["slots"] == [{"level": 1, "count": 7}]
    sp = tables["spells"].with_columns(pl.when(pl.col("name") == "Magic Missile").then(
        pl.struct(pl.lit("Magic Missile").alias("name"), pl.lit("A").alias("tag"), pl.lit("").alias("note"), pl.lit("Pew pew.").alias("desc")))
        .otherwise(pl.col("card")).alias("card"))
    assert cards(build_character(dict(tables, spells=sp), req))["Magic Missile"]["desc"] == "Pew pew."


def test_mutation_race_and_choice_effect(tables):
    req = make_request(race="elf", cls="fighter", choices={"fighting_style": ["Defense"]})
    races = set_cell(tables["races"], pl.col("id") == "elf", "speed", 99)
    assert row(build_character(dict(tables, races=races), req))["combat"]["speed"] == 99 + 5  # + Wood Elf
    ch = tables["choices"].with_columns(pl.col("options").list.eval(
        pl.struct(pl.element().struct.field("name"), pl.element().struct.field("tag"), pl.element().struct.field("desc"),
                  pl.element().struct.field("effect").struct.with_fields(pl.lit(5).alias("ac")).alias("effect"))))
    assert row(build_character(dict(tables, choices=ch), req))["combat"]["ac"] == row(build_character(tables, req))["combat"]["ac"] + 4


# ----------------------------------------------------------------------------- fuzz: default tables, random requests
@FUZZ
@given(st.data())
def test_fuzz_requests_default_tables(tables, data):
    req = data.draw(random_choice_request(tables))
    ch = row(build_character(tables, req))
    r = req.row(0, named=True)
    picked = {p for c in r["choices"] for p in c["picks"]}
    names = {c["name"] for c in ch["cards"]}
    assert picked <= names
    assert ch["combat"]["max_hp"] > 0 and ch["combat"]["ac"] >= 10
    assert all("{" not in s for s in all_text(build_character(tables, req)))
    if ch["spellcasting"]:
        assert all(s["count"] > 0 for s in ch["spellcasting"]["slots"])


# ----------------------------------------------------------------------------- fuzz: random tables (all data must come from df_in)
WORD = re.compile(r"[qxzjkvwy]{3,8}")


def table_words(t):
    words = set()
    for df in t.values():
        for v in df.to_dicts():
            words |= set(WORD.findall(str(v)))
    return words


@FUZZ
@given(st.data())
def test_fuzz_random_tables(data):
    t = data.draw(random_tables())
    req = data.draw(request_for(t))
    try:
        ch = build_character(t, req)
    except ValueError:
        return  # e.g. random tables with too few choice options: a clean, explained refusal is fine
    r = row(ch)
    # 1) nothing appears that isn't in the tables (no hidden defaults)
    out_words = set(WORD.findall(" ".join(all_text(ch))))
    assert out_words <= table_words(t)
    # 2) identity comes from the chosen rows
    q = req.row(0, named=True)
    race = t["races"].filter(pl.col("id") == q["race"]).row(0, named=True)
    cls = t["classes"].filter(pl.col("id") == q["cls"]).row(0, named=True)
    srs = t["subraces"].filter(pl.col("race_id") == q["race"])
    sr = srs.row(0, named=True) if srs.height else {"name": race["name"], "hp_per_level": 0, "speed": 0}
    assert r["identity"]["race"] == sr["name"] and r["identity"]["cls"] == cls["name"]
    race = {**race, "hp_per_level": race["hp_per_level"] + sr["hp_per_level"], "speed": race["speed"] + sr["speed"]}
    # 3) numbers follow the table values
    con = next(a for a in r["abilities"] if a["key"] == "CON")["mod"]
    lvl = q["level"]
    sub = t["subclasses"].filter(pl.col("id") == q["subclass"]).row(0, named=True) if q["subclass"] else None
    sub_hp = sub["hp_per_level"] * lvl if sub and lvl >= cls["subclass_level"] else 0
    hd = cls["hit_die"]
    assert r["combat"]["max_hp"] == hd + con + (lvl - 1) * (hd // 2 + 1 + con) + race["hp_per_level"] * lvl + sub_hp
    assert r["combat"]["prof"] == t["rules"]["prof_by_level"][0][lvl - 1]
    assert r["combat"]["speed"] == race["speed"] + cls["speed_bonus"][lvl - 1]
    slot, wnames = cls["melee_slot"], set(t["weapons"]["name"].to_list())
    names = [a["name"] for a in r["attacks"]]
    assert len(names) == len(cls["weapons"])
    for i, (got, w) in enumerate(zip(names, cls["weapons"])):
        assert got == w["name"] or (i == slot and got in wnames)
    tail = r["inventory"][len(r["inventory"]) - len(cls["gear"]):]
    for got, g in zip(tail, cls["gear"]):
        assert got == g or (slot >= 0 and g == cls["weapons"][slot]["name"] and got in wnames)
    # 4) every card is a feature, option or spell from the tables
    sources = set(t["features"]["card"].struct.field("name").to_list()) | set(t["spells"]["name"].to_list()) | set(t["items"]["name"].to_list()) | \
        {o["name"] for opts in t["choices"]["options"].to_list() for o in opts}
    assert {c["name"] for c in r["cards"]} <= sources


@FUZZ
@given(st.data())
def test_fuzz_changing_any_feature_desc_changes_output(data):
    t = data.draw(random_tables())
    req = data.draw(request_for(t))
    try:
        before = build_character(t, req)
    except ValueError:
        return
    shown = [c for c in row(before)["cards"] if c["desc"]]
    if not shown:
        return
    target = data.draw(st.sampled_from(shown))
    marker = "qqqqzzzz"
    f = t["features"].with_columns(pl.col("card").struct.with_fields(
        pl.when(pl.col("card").struct.field("desc") == target["desc"]).then(pl.lit(marker))
        .otherwise(pl.col("card").struct.field("desc")).alias("desc")))
    sp = t["spells"].with_columns(pl.col("card").struct.with_fields(
        pl.when(pl.col("card").struct.field("desc") == target["desc"]).then(pl.lit(marker))
        .otherwise(pl.col("card").struct.field("desc")).alias("desc")))
    ch = t["choices"].with_columns(pl.col("options").list.eval(pl.element().struct.with_fields(
        pl.when(pl.element().struct.field("desc") == target["desc"]).then(pl.lit(marker))
        .otherwise(pl.element().struct.field("desc")).alias("desc"))))
    it = t["items"].with_columns(pl.col("card").struct.with_fields(
        pl.when(pl.col("card").struct.field("desc") == target["desc"]).then(pl.lit(marker))
        .otherwise(pl.col("card").struct.field("desc")).alias("desc")))
    after = build_character(dict(t, features=f, spells=sp, choices=ch, items=it), req)
    assert marker in {c["desc"] for c in row(after)["cards"]}


def test_path_spells_override(tables):
    book = cards(build_character(tables, make_request(cls="cleric", subclass="life", level=5)))
    off = cards(build_character(tables, make_request(cls="cleric", subclass="life", level=5, path_spells=["Fireball"])))
    assert "Beacon of Hope" in book and "Beacon of Hope" not in off and "Fireball" in off
    with pytest.raises(ValueError):
        build_character(tables, make_request(cls="cleric", subclass="life", level=1, path_spells=["Fireball"]))



# ----------------------------------------------------------------------------- potions & magic items
def potions(ch):
    return [c["name"] for c in row(ch)["cards"] if c["section"] == "Potions & Magic Items"]


def test_martial_classes_get_potions_casters_dont(tables):
    for lvl in range(1, 8):
        slots = tables["rules"]["item_slots"][0][lvl - 1]
        assert len(potions(build_character(tables, make_request(cls="fighter", subclass="champion", level=lvl)))) == slots
        assert len(potions(build_character(tables, make_request(cls="rogue", subclass="thief", level=lvl)))) == slots
        assert potions(build_character(tables, make_request(cls="wizard", subclass="evocation", level=lvl))) == []
        assert potions(build_character(tables, make_request(cls="cleric", subclass="life", level=lvl))) == []


def test_default_potions_get_rarer_with_level(tables):
    tier = {r["name"]: r["tier"] for r in tables["items"].iter_rows(named=True)}
    best = [max([tier[p] for p in potions(build_character(tables, make_request(cls="barbarian", level=l)))] or [0]) for l in (1, 3, 5)]
    assert best == [1, 2, 3]


def test_item_seed_changes_picks_and_is_stable(tables):
    a = potions(build_character(tables, make_request(cls="fighter", level=7, item_seed="1")))
    assert a == potions(build_character(tables, make_request(cls="fighter", level=7, item_seed="1")))
    seen = {tuple(potions(build_character(tables, make_request(cls="fighter", level=7, item_seed=str(i))))) for i in range(12)}
    assert len(seen) > 3


def test_items_can_be_picked_and_validated(tables):
    ch = build_character(tables, make_request(cls="wizard", level=3, items=["Bag of Tricks", "Smoke Bomb"]))
    c = cards(ch)
    assert c["Bag of Tricks"]["uses"] == 3 and c["Bag of Tricks"]["rest"] == "long"
    assert c["Smoke Bomb"]["rest"] == "used"
    # any item can be picked (the builder warns about rarer ones); unknown names and too many still fail
    assert "Potion of Heroism" in cards(build_character(tables, make_request(cls="wizard", level=3, items=["Potion of Heroism"])))
    for bad in (["Nope"], ["Smoke Bomb", "Acid Vial", "Holy Water"]):
        with pytest.raises(ValueError):
            build_character(tables, make_request(cls="wizard", level=3, items=bad))
    assert potions(build_character(tables, make_request(cls="fighter", level=7, items=[]))) == []


def test_mutation_items_table(tables):
    it = tables["items"].with_columns(pl.col("card").struct.with_fields(
        pl.when(pl.col("name") == "Smoke Bomb").then(pl.lit("Poof!")).otherwise(pl.col("card").struct.field("desc")).alias("desc")))
    assert cards(build_character(dict(tables, items=it), make_request(level=1, items=["Smoke Bomb"])))["Smoke Bomb"]["desc"] == "Poof!"
    r = tables["rules"].with_columns(pl.lit([0] * 7).alias("item_slots"))
    assert potions(build_character(dict(tables, rules=r), make_request(cls="fighter", level=7))) == []



# ----------------------------------------------------------------------------- ability scores
def test_base_scores_override(tables):
    base = {"STR": 8, "DEX": 8, "CON": 8, "INT": 8, "WIS": 8, "CHA": 18}
    r = row(build_character(tables, make_request(race="human", cls="fighter", level=1, base_scores=base)))
    sc = {a["key"]: a["score"] for a in r["abilities"]}
    assert sc == {"STR": 9, "DEX": 9, "CON": 9, "INT": 9, "WIS": 9, "CHA": 19}  # human +1 everywhere
    lvl4 = row(build_character(tables, make_request(race="human", cls="fighter", level=4, base_scores=base)))
    assert {a["key"]: a["score"] for a in lvl4["abilities"]}["STR"] == 11  # level-up boost still goes to STR first
    for bad in ({**base, "STR": 0}, {**base, "STR": 21}, {**base, "DEX": None}):
        with pytest.raises(ValueError):
            build_character(tables, make_request(base_scores=bad))


def test_default_base_is_standard_array(tables):
    r = row(build_character(tables, make_request(race="human", cls="wizard", level=1)))
    sc = sorted((a["score"] - 1 for a in r["abilities"]), reverse=True)
    assert sc == [15, 14, 13, 12, 10, 8]



# ----------------------------------------------------------------------------- armor
def test_default_armor_is_best_wearable(tables):
    f = row(build_character(tables, make_request(race="human", cls="fighter", level=1, choices={"fighting_style": ["Dueling"]})))
    assert not f["combat"]["armor"].startswith("Plate") and f["combat"]["ac"] == 19  # plate is only picked from level 4
    f4 = row(build_character(tables, make_request(race="human", cls="fighter", level=4, choices={"fighting_style": ["Dueling"]})))
    assert f4["combat"]["armor"] == "Plate armor + shield" and f4["combat"]["ac"] == 20
    weak = {"STR": 8, "DEX": 10, "CON": 15, "INT": 14, "WIS": 12, "CHA": 13}
    w = row(build_character(tables, make_request(race="elf", cls="fighter", level=1, base_scores=weak, choices={"fighting_style": ["Dueling"]})))
    assert w["combat"]["armor"].split(" +")[0] not in ("Chain mail", "Splint armor", "Plate armor")  # need more Strength
    assert row(build_character(tables, make_request(cls="wizard")))["combat"]["armor"] == "No armor"
    b = row(build_character(tables, make_request(race="human", cls="barbarian")))
    assert b["combat"]["armor"] == "Half plate"  # beats Unarmored Defense with the default stats
    strong = {"STR": 15, "DEX": 10, "CON": 14, "INT": 8, "WIS": 15, "CHA": 10}
    life = row(build_character(tables, make_request(cls="cleric", subclass="life", level=4, base_scores=strong)))
    light = row(build_character(tables, make_request(cls="cleric", subclass="light", level=4, base_scores=strong)))
    assert life["combat"]["armor"].startswith("Plate")  # Life Domain adds heavy armor
    assert light["combat"]["armor"].startswith("Half plate")


def test_pick_armor_and_shield(tables):
    r = row(build_character(tables, make_request(cls="fighter", armor="Leather armor", shield=False, choices={"fighting_style": ["Dueling"]})))
    dex = next(a for a in r["abilities"] if a["key"] == "DEX")["mod"]
    assert r["combat"]["ac"] == 11 + dex and r["combat"]["armor"] == "Leather armor"
    assert r["inventory"][0] == "Leather armor"
    slow = row(build_character(tables, make_request(race="elf", cls="fighter", armor="Plate armor",
                                                       base_scores={"STR": 8, "DEX": 15, "CON": 14, "INT": 10, "WIS": 12, "CHA": 13})))
    assert slow["combat"]["speed"] == 35 - 10
    for bad in (dict(cls="wizard", armor="Leather armor"), dict(cls="rogue", shield=True), dict(cls="fighter", armor="Mithril")):
        with pytest.raises(ValueError):
            build_character(tables, make_request(**bad))
    defense = row(build_character(tables, make_request(cls="fighter", armor="No armor", shield=False, choices={"fighting_style": ["Defense"]})))
    dueling = row(build_character(tables, make_request(cls="fighter", armor="No armor", shield=False, choices={"fighting_style": ["Dueling"]})))
    assert defense["combat"]["ac"] == dueling["combat"]["ac"]  # Defense only counts while wearing armor



def test_warlock_spells_scale_to_pact_slot(tables):
    def c(level, cls="warlock", **kw):
        return cards(build_character(tables, make_request(cls=cls, subclass="fiend" if cls == "warlock" else None, level=level,
                                                          spells=kw.get("spells"))))
    assert "2d10 fire" in c(1, spells=["Hellish Rebuke"])["Hellish Rebuke"]["desc"]
    l5 = c(5, spells=["Hellish Rebuke", "Armor of Agathys", "Hold Person"])
    assert "4d10 fire" in l5["Hellish Rebuke"]["desc"] and "cast at lvl 3" in l5["Hellish Rebuke"]["note"]
    assert "15 temporary HP" in l5["Armor of Agathys"]["desc"]
    assert "Up to 2 people" in l5["Hold Person"]["desc"]
    assert "5d10 fire" in c(7, spells=["Hellish Rebuke"])["Hellish Rebuke"]["desc"]
    # everyone else lists the base numbers
    wiz = cards(build_character(tables, make_request(cls="wizard", level=7, spells=["Magic Missile", "Burning Hands"])))
    assert wiz["Magic Missile"]["desc"].startswith("3 glowing") and "3d6 fire" in wiz["Burning Hands"]["desc"]
    assert "cast at" not in wiz["Magic Missile"]["note"]


def test_subrace_defaults_to_first_and_can_be_picked(tables):
    hill = row(build_character(tables, make_request(race="dwarf", cls="wizard", level=3)))
    assert hill["identity"]["race"] == "Hill Dwarf"
    assert any(c["name"] == "Dwarven Toughness" for c in hill["cards"])
    mtn = row(build_character(tables, make_request(race="dwarf", cls="wizard", level=3, subrace="mountain")))
    assert mtn["identity"]["race"] == "Mountain Dwarf"
    assert mtn["combat"]["max_hp"] == hill["combat"]["max_hp"] - 3
    assert mtn["combat"]["armor"] != "No armor"  # medium armor training kicks in for a wizard
    assert next(a for a in mtn["abilities"] if a["key"] == "STR")["score"] == next(a for a in hill["abilities"] if a["key"] == "STR")["score"] + 2
    high = row(build_character(tables, make_request(race="elf", cls="fighter", subrace="high")))
    assert any(c["name"].startswith("Elf Magic") for c in high["cards"])
    with pytest.raises(ValueError):
        build_character(tables, make_request(race="elf", subrace="hill"))


def test_no_shield_means_a_two_hander_when_it_hits_harder(tables):
    sword = row(build_character(tables, make_request(cls="fighter", level=5)))
    assert sword["attacks"][0]["name"] == "Longsword" and "shield" in sword["combat"]["armor"]
    big = row(build_character(tables, make_request(cls="fighter", level=5, shield=False)))
    assert big["attacks"][0]["name"] == "Greatsword" and "Greatsword" in big["inventory"] and "Longsword" not in big["inventory"]
    rogue = row(build_character(tables, make_request(cls="rogue", level=5)))
    assert rogue["attacks"][0]["name"] == "Rapier"  # Dexterity heroes keep their light blade
    maul = row(build_character(tables, make_request(cls="paladin", level=3, weapon="Maul")))
    assert maul["attacks"][0]["name"] == "Maul" and "shield" not in maul["combat"]["armor"]  # a two-hander drops the shield
    with pytest.raises(ValueError):
        build_character(tables, make_request(cls="paladin", weapon="Maul", shield=True))
    with pytest.raises(ValueError):
        build_character(tables, make_request(cls="wizard", weapon="Greatsword"))  # not trained with it



# ----------------------------------------------------------------------------- fuzz: every table really feeds the sheet
def _mutations(t, q, r):
    """Edits to the rows THIS hero uses, each of which must show up in the output (name, edit)."""
    out = []
    race = t["races"].filter(pl.col("id") == q["race"]).row(0, named=True)
    out.append(("race speed", dict(t, races=set_cell(t["races"], pl.col("id") == q["race"], "speed", race["speed"] + 7))))
    srs = t["subraces"].filter(pl.col("race_id") == q["race"])
    if srs.height:
        sid = q["subrace"] or srs["id"][0]
        out.append(("subrace name", dict(t, subraces=set_cell(t["subraces"], pl.col("id") == sid, "name", "zzsubrace"))))
    cls = t["classes"].filter(pl.col("id") == q["cls"]).row(0, named=True)
    out.append(("hit die", dict(t, classes=set_cell(t["classes"], pl.col("id") == q["cls"], "hit_die", cls["hit_die"] + 2))))
    out.append(("tagline", dict(t, classes=t["classes"].with_columns(pl.when(pl.col("id") == q["cls"]).then(
        pl.col("look").struct.with_fields(pl.lit("zztagline").alias("tagline"))).otherwise(pl.col("look")).alias("look")))))
    prof = list(t["rules"]["prof_by_level"][0])
    prof[q["level"] - 1] += 1
    out.append(("proficiency", dict(t, rules=t["rules"].with_columns(pl.Series("prof_by_level", [prof])))))
    out.append(("skill name", dict(t, skills=t["skills"].with_columns(
        pl.when(pl.int_range(pl.len()) == 0).then(pl.lit("Zzskill")).otherwise(pl.col("name")).alias("name")))))
    worn = r["combat"]["armor"].replace(" + shield", "")
    if worn != "No armor":
        out.append(("armor base", dict(t, armor=t["armor"].with_columns(
            pl.when(pl.col("name") == worn).then(pl.col("base") + 3).otherwise(pl.col("base")).alias("base")))))
    slot = cls["melee_slot"]
    swapped = [r["attacks"][slot]["name"]] if 0 <= slot < len(cls["weapons"]) and (
        q["weapon"] or r["attacks"][slot]["name"] != cls["weapons"][slot]["name"]) else []
    if swapped:
        out.append(("weapon note", dict(t, weapons=set_cell(t["weapons"], pl.col("name") == swapped[0], "note", "zzreach"))))
    shown_items = [c["name"] for c in r["cards"] if c["section"] == "Potions & Magic Items"]
    if shown_items:
        out.append(("item text", dict(t, items=t["items"].with_columns(pl.when(pl.col("name") == shown_items[0]).then(
            pl.col("card").struct.with_fields(pl.lit("zzpotion").alias("desc"))).otherwise(pl.col("card")).alias("card")))))
    if r["spellcasting"] and r["spellcasting"]["slots"]:
        sl = t["slots"]
        kind = cls["caster"]["kind"]
        out.append(("spell slots", dict(t, slots=sl.with_columns(pl.when((pl.col("kind") == kind) & (pl.col("level") == q["level"])).then(
            pl.col("slots").list.eval(pl.element() + 1)).otherwise(pl.col("slots")).alias("slots")))))
    return out


def _isolation(t, q):
    """Edits to rows this hero does NOT use: the output must stay exactly the same."""
    out = []
    others = t["races"].filter(pl.col("id") != q["race"])
    if others.height:
        out.append(("other race", dict(t, races=set_cell(t["races"], pl.col("id") == others["id"][0], "speed", 3))))
    others = t["classes"].filter(pl.col("id") != q["cls"])
    if others.height:
        out.append(("other class", dict(t, classes=set_cell(t["classes"], pl.col("id") == others["id"][0], "hit_die", 99))))
    other_lvls = [lv for lv in range(1, 8) if lv != q["level"]]
    prof = list(t["rules"]["prof_by_level"][0])
    prof[other_lvls[0] - 1] += 5
    out.append(("other level", dict(t, rules=t["rules"].with_columns(pl.Series("prof_by_level", [prof])))))
    return out


@FUZZ
@given(st.data())
def test_fuzz_every_table_feeds_the_output_and_nothing_else_does(data):
    t = data.draw(random_tables())
    req = data.draw(st.one_of(request_for(t), random_full_request(t)))
    try:
        before = build_character(t, req)
    except ValueError:
        return
    q, r = row(req), row(before)
    for name, t2 in _mutations(t, q, r):
        try:
            after = build_character(t2, req)
        except ValueError:
            continue  # e.g. a bigger slot table makes the picks illegal: still a change, just a refusal
        assert not after.equals(before), f"changing the {name} didn't change the sheet"
    for name, t2 in _isolation(t, q):
        assert build_character(t2, req).equals(before), f"changing the {name} changed the sheet"


@FUZZ
@given(st.data())
def test_fuzz_every_builder_knob_on_default_tables(tables, data):
    req = data.draw(random_full_request(tables))
    try:
        r = row(build_character(tables, req))
    except ValueError:
        return  # illegal combos must be refused with a clear ValueError, never a crash
    q = row(req)
    if q["weapon"] and q["weapon"] in {w["name"] for w in tables["weapons"].iter_rows(named=True)}:
        assert q["weapon"] in [a["name"] for a in r["attacks"]]
    if q["armor"]:
        assert r["combat"]["armor"].startswith(q["armor"])
    if q["shield"] is not None:
        assert r["combat"]["armor"].endswith("+ shield") == q["shield"]
    if q["items"] is not None:
        assert [c["name"] for c in r["cards"] if c["section"] == "Potions & Magic Items"] == q["items"]


def test_items_for_one_class_are_never_handed_out_to_others(tables):
    it = tables["items"].with_columns(pl.when(pl.col("tier") >= 1).then(pl.lit(["wizard"])).otherwise(pl.col("use_by")).alias("use_by"))
    t = dict(tables, items=it)
    for seed in range(10):
        assert not [c for c in row(build_character(t, make_request(cls="fighter", level=7, item_seed=str(seed))))["cards"]
                    if c["section"] == "Potions & Magic Items"]
    # but a fighter can still pick one on purpose
    assert "Bag of Tricks" in cards(build_character(t, make_request(cls="fighter", level=7, items=["Bag of Tricks"])))
