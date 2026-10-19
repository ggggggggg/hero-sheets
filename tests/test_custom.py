"""Custom content files: merge rules, errors, and Python == JavaScript."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from charsheet.build import build_character, make_request
from charsheet.custom import CustomError, merge_custom, parse_custom_text
from charsheet.site import tables_json

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = (Path(__file__).parent / "fixtures" / "custom" / "hero-custom.json").read_text()
NODE = shutil.which("node")


def js_merge(tables, custom):
    payload = json.dumps({"tables": json.loads(tables_json(tables)), "custom": custom})
    res = subprocess.run([NODE, str(ROOT / "web" / "run_custom_node.js")], input=payload, capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_guide_example_is_the_test_file():
    guide = (ROOT / "CUSTOM_CONTENT_GUIDE.md").read_text()
    assert EXAMPLE.strip() in guide


def test_example_file_builds(tables):
    t = merge_custom(tables, parse_custom_text(EXAMPLE))
    r = build_character(t, make_request(race="turtlefolk", cls="rogue", subclass="pirate", level=5)).row(0, named=True)
    assert r["identity"]["race"] == "Turtle-folk" and r["identity"]["subclass"] == "Pirate"
    names = [c["name"] for c in r["cards"]]
    assert "Shell Defense" in names and "Swashbuckle" in names
    assert build_character(t, make_request(cls="fighter", weapon="Anchor")).row(0, named=True)["attacks"][0]["damage"].startswith("2d6")
    assert tables["races"].height + 1 == t["races"].height  # originals untouched, one race added


def test_same_key_replaces(tables):
    t = merge_custom(tables, {"races": [{"id": "dwarf", "name": "Dwarf", "speed": 35}]})
    assert t["races"].height == tables["races"].height
    assert build_character(t, make_request(race="dwarf", cls="wizard")).row(0, named=True)["combat"]["speed"] == 35


@pytest.mark.parametrize("bad", [
    {"racez": []}, {"races": [{"id": "x"}]}, {"races": [{"id": "x", "name": "X", "sped": 30}]},
    {"spells": [{"name": "Zap", "card": {"desc": "hi", "colour": "red"}}]}, {"races": {"id": "x"}},
    {"choices": [{"owner_kind": "class", "owner_id": "fighter", "group": "g", "options": [{"desc": "no name"}]}]},
])
def test_mistakes_are_explained(tables, bad):
    with pytest.raises(CustomError):
        merge_custom(tables, bad)


def test_text_forms():
    assert parse_custom_text('{"title": "a"}') == {"title": "a"}
    for bad in ('window.CHARSHEET_CUSTOM = {"title": "a"};', "{title: 'a'}", '{"title": "a",}'):
        with pytest.raises(CustomError):
            parse_custom_text(bad)


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_js_merge_matches_python(tables):
    custom = parse_custom_text(EXAMPLE)
    py = json.loads(tables_json(merge_custom(tables, custom)))
    js = js_merge(tables, custom)
    assert js["ok"] and js["tables"] == py


@pytest.mark.skipif(NODE is None, reason="node not installed")
@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture])
@given(st.data())
def test_fuzz_js_and_python_agree_on_any_custom(tables, data):
    word = st.text(alphabet="abcxyz", min_size=1, max_size=5)
    row = st.fixed_dictionaries({}, optional={"id": word, "name": word, "speed": st.integers(0, 40), "bogus": st.just(1),
                                              "asi": st.fixed_dictionaries({}, optional={"STR": st.integers(0, 2), "XYZ": st.just(1)})})
    custom = data.draw(st.fixed_dictionaries({}, optional={"races": st.lists(row, max_size=3), "nope": st.just([])}))
    try:
        py = {"ok": True, "tables": json.loads(tables_json(merge_custom(tables, custom)))}
    except CustomError:
        py = {"ok": False}
    js = js_merge(tables, custom)
    assert js["ok"] == py["ok"], js.get("msg")
    if py["ok"]:
        assert js["tables"] == py["tables"]


def test_tobin_pack_matches_the_original_sheet(tables):
    """The hand-made Flame Master sheet, rebuilt from a custom content file (Python side)."""
    pack = parse_custom_text((ROOT / "examples" / "tobin-flame-master.json").read_text())
    t = merge_custom(tables, pack)
    h = pack["heroes"][0]
    req = make_request(name=h["name"], race=h["race"], subrace=h["subrace"], cls=h["cls"], subclass=h["subclass"], level=h["level"],
                       base_scores=h["base_scores"], choices=h["choices"], cantrips=h["cantrips"], spells=h["spells"],
                       items=h["items"], armor=h["armor"], inventory=h["inventory"], notes=h["notes"])
    r = build_character(t, req).row(0, named=True)
    c = r["combat"]
    assert (c["max_hp"], c["ac"], c["speed"], c["initiative"], c["prof"]) == (48, 16, 25, 5, 3)
    assert {a["key"]: a["score"] for a in r["abilities"]} == {"STR": 8, "DEX": 14, "CON": 16, "INT": 10, "WIS": 13, "CHA": 19}
    assert [(a["name"], a["to_hit"], a["damage"]) for a in r["attacks"]] == [("Flame Blast", 7, "1d10+4"), ("Silver dagger", 5, "1d4+2")]
    assert (r["spellcasting"]["attack"], r["spellcasting"]["dc"], r["spellcasting"]["slots"]) == (7, 15, [{"level": 3, "count": 2}])
    cards = {x["name"]: x for x in r["cards"]}
    assert "4d10" in cards["Hellish Rebuke"]["desc"] and "8d6" in cards["Fireball"]["desc"]
    assert "9 shield HP" in cards["Dark One's Blessing"]["desc"] and cards["Dragon Strike"]["uses"] == 1
    assert {s["name"] for s in r["skills"] if s["prof"]} == {"Arcana", "History", "Intimidation", "Perception"}
