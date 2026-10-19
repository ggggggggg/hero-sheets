"""The website runs a JavaScript copy of the builder and the sheet renderer (web/core.js).
These tests make sure it gives exactly the same character and the same sheet HTML
as the Python version, for every combo and for fuzzed requests and fuzzed tables."""
import json
import shutil
import subprocess
from pathlib import Path

import polars as pl
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from charsheet.build import build_character, make_request
from charsheet.render import sheet_html
from charsheet.site import tables_json
from strategies import random_choice_request, random_full_request, random_tables, request_for

NODE = shutil.which("node")
RUNNER = Path(__file__).resolve().parents[1] / "web" / "run_node.js"
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
FUZZ = settings(max_examples=80, deadline=None, suppress_health_check=[HealthCheck.too_slow])


def run_js(tables, requests):
    payload = json.dumps({"tables": json.loads(tables_json(tables)), "requests": [r.row(0, named=True) for r in requests]})
    res = subprocess.run([NODE, str(RUNNER)], input=payload, capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def py_result(tables, req):
    try:
        ch = build_character(tables, req).row(0, named=True)
    except (ValueError, KeyError) as err:
        return {"ok": False, "kind": type(err).__name__}
    return {"ok": True, "character": ch, "html": sheet_html(ch)}


def same(py, js):
    assert js["ok"] == py["ok"], js.get("msg")
    if not py["ok"]:
        assert js["kind"] == py["kind"]
        return
    assert js["character"] == py["character"]
    assert js["html"] == py["html"]


def test_every_combo_matches(tables):
    reqs = []
    for race in tables["races"]["id"]:
        for c in tables["classes"]["id"]:
            for s in tables["subclasses"].filter(pl.col("class_id") == c)["id"]:
                for lvl in (1, 3, 5, 7):
                    reqs.append(make_request(name="Kid", race=race, cls=c, subclass=s, level=lvl))
    for req, js in zip(reqs, run_js(tables, reqs)):
        same(py_result(tables, req), js)


def test_path_spell_overrides_match(tables):
    reqs = [make_request(cls="cleric", subclass="life", level=5, path_spells=["Fireball", "Bless"]),
            make_request(cls="cleric", subclass="life", level=5, path_spells=[]),
            make_request(cls="cleric", subclass="life", level=1, path_spells=["Fireball"]),
            make_request(cls="fighter", level=3, path_spells=["Bless"]),
            make_request(portrait="data:image/png;base64,AAAA", portrait_credit="Art by Someone"),
            make_request(portrait=None, portrait_credit="ignored when no picture"),
            make_request(cls="fighter", level=7, item_seed="12345"),
            make_request(cls="rogue", level=5, item_seed="\u00e9\u00df\u4e2d"),
            make_request(cls="wizard", level=3, items=["Bag of Tricks", "Smoke Bomb"]),
            make_request(cls="wizard", level=3, items=["Potion of Heroism"]),
            make_request(cls="bard", level=4, base_scores={"STR": 3, "DEX": 18, "CON": 12, "INT": 9, "WIS": 10, "CHA": 17}),
            make_request(cls="fighter", armor="Leather armor", shield=False),
            make_request(cls="warlock", subclass="fiend", level=7, spells=["Hellish Rebuke", "Armor of Agathys", "Hold Person", "Shatter"]),
            make_request(cls="warlock", subclass="archfey", level=4),
            make_request(race="elf", cls="fighter", armor="Plate armor", base_scores={"STR": 8, "DEX": 15, "CON": 14, "INT": 10, "WIS": 12, "CHA": 13}),
            make_request(cls="wizard", armor="Leather armor"),
            make_request(cls="rogue", shield=True),
            make_request(race="dwarf", cls="wizard", level=3, subrace="mountain"),
            make_request(cls="fighter", level=5, shield=False),
            make_request(cls="fighter", level=5, shield=False, choices={"fighting_style": ["Dueling"]}),
            make_request(cls="paladin", level=3, weapon="Maul"),
            make_request(cls="rogue", weapon="Shortsword"),
            make_request(cls="monk", weapon="Spear"),
            make_request(cls="cleric", shield=False),
            make_request(race="elf", cls="fighter", level=5, subrace="high"),
            make_request(race="gnome", cls="bard", subrace="forest"),
            make_request(race="halfling", cls="rogue", subrace="stout"),
            make_request(cls="bard", level=4, base_scores={"STR": 30, "DEX": 18, "CON": 12, "INT": 9, "WIS": 10, "CHA": 17})]
    for req, js in zip(reqs, run_js(tables, reqs)):
        same(py_result(tables, req), js)


def test_errors_match(tables):
    reqs = [make_request(race="nope"), make_request(level=9), make_request(cls="wizard", spells=["Fireball"]),
            make_request(cls="fighter", choices={"fighting_style": ["Nope"]}),
            make_request(race="elf", subrace="hill"), make_request(cls="paladin", weapon="Maul", shield=True),
            make_request(cls="wizard", weapon="Greatsword")]
    for req, js in zip(reqs, run_js(tables, reqs)):
        same(py_result(tables, req), js)


@FUZZ
@given(st.data())
def test_fuzz_requests_match(tables, data):
    reqs = [data.draw(random_choice_request(tables)) for _ in range(3)] + [data.draw(request_for(tables, free_text=True))] + \
        [data.draw(random_full_request(tables)) for _ in range(3)]
    for req, js in zip(reqs, run_js(tables, reqs)):
        same(py_result(tables, req), js)


@FUZZ
@given(st.data())
def test_fuzz_random_tables_match(data):
    t = data.draw(random_tables())
    reqs = [data.draw(request_for(t)) for _ in range(3)] + [data.draw(random_full_request(t)) for _ in range(3)]
    for req, js in zip(reqs, run_js(t, reqs)):
        same(py_result(t, req), js)
