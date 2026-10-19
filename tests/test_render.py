"""Part 2 tests: character DataFrame -> HTML -> 2-page PDF.

* render_html is pure and shows everything in the character
* every default class/subclass at level 7 prints to exactly 2 pages and fits
* the front page always has a portrait space, inventory and notes
* fuzz: random built characters AND random hand-made characters always print 2 pages
"""
import base64
import io
import pathlib
import re

import fitz  # pymupdf
import polars as pl
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from charsheet.build import build_character, make_request
from charsheet.render import render_html, render_pdf
from strategies import random_character, random_choice_request

PDF_FUZZ = settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture])
HTML_FUZZ = settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])

PNG_1PX = "data:image/png;base64," + base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360f8ffff3f0005fe02fea7d6a4b20000000049454e44ae426082")).decode()


def pdf_text(pdf: bytes) -> list[str]:
    doc = fitz.open(stream=pdf, filetype="pdf")
    return [p.get_text() for p in doc]


def squash(s: str) -> str:
    return re.sub(r"\s+", "", s)


def char(tables, **kw):
    return build_character(tables, make_request(**kw))


# ----------------------------------------------------------------------------- html (pure)
def test_render_html_pure_and_complete(tables, assets):
    ch = char(tables, name="Tobin", race="dwarf", cls="warlock", subclass="fiend", level=5, notes="Owes Bob a favor",
              inventory=["Silver dagger", "Potion of Spider Climb"])
    a, b = render_html(ch, assets), render_html(ch, assets)
    assert a == b
    r = ch.row(0, named=True)
    for c in r["cards"]:
        assert f'data-card="{c["name"].replace(chr(39), "&#x27;")}"' in a
    for item in r["inventory"]:
        assert item in a
    assert "Owes Bob a favor" in a
    assert 'data-role="portrait"' in a and 'data-role="inventory"' in a and 'data-role="notes"' in a
    assert a.count('class="page') == 2


def test_render_escapes_user_text(tables, assets):
    ch = char(tables, name="<script>alert(1)</script>", notes="<b>x</b>")
    h = render_html(ch, assets)
    assert "<script>alert(1)" not in h and "&lt;script&gt;" in h


def test_front_is_roleplay_back_is_combat(tables, assets):
    """No double-ups: who-you-are on the front, fighting on the back."""
    h = render_html(char(tables, cls="paladin", subclass="devotion", level=6), assets)
    front, back = h.split('<section class="page back">')
    for combat_only in ['class="cd"', "Max HP", "Initiative", "Armor", "Death saves", 'class="atk"']:
        assert combat_only not in front, combat_only
    for roleplay_only in ["Skills", "Inventory", "Notes", 'data-role="portrait"', "Proficiency"]:
        assert roleplay_only not in back, roleplay_only


@HTML_FUZZ
@given(random_character())
def test_fuzz_html_never_crashes(assets, ch):
    h = render_html(ch, assets)
    assert h.count('<section class="page') == 2
    assert ch.row(0, named=True)["identity"]["name"].strip() == "" or "<title>" in h


# ----------------------------------------------------------------------------- pdf
def every_level7(tables):
    for c in tables["classes"]["id"]:
        for s in tables["subclasses"].filter(pl.col("class_id") == c)["id"]:
            yield c, s


@pytest.mark.pdf
@pytest.mark.parametrize("race", ["human", "tiefling"])
@pytest.mark.parametrize("cls,sub", list(every_level7(__import__("charsheet.data", fromlist=["x"]).default_tables())))
def test_every_subclass_level7_prints_two_pages_that_fit(tables, assets, browser, cls, sub, race):
    ch = char(tables, name="Test Hero", race=race, cls=cls, subclass=sub, level=7)
    pdf, info = render_pdf(render_html(ch, assets), browser=browser)
    pages = pdf_text(pdf)
    assert len(pages) == 2
    assert info["fit"] == "ok", f"back page overflows even at {info['fs']}px"
    assert info["fs"] >= 9.5, f"text got too small ({info['fs']}px)"
    back = squash(pages[1])
    for c in ch.row(0, named=True)["cards"]:
        assert squash(c["name"]) in back


FPA_PACK = (pathlib.Path(__file__).resolve().parents[1] / "examples" / "mutants-and-meltdowns.json").read_text()


@pytest.mark.pdf
@pytest.mark.parametrize("cls,sub", [(s["class_id"], s["id"]) for s in __import__("json").loads(FPA_PACK)["subclasses"]])
def test_fpa_subclass_level7_fits_two_pages(assets, browser, cls, sub):
    from charsheet.custom import merge_custom, parse_custom_text
    from charsheet.data import default_tables
    T = merge_custom(default_tables(), parse_custom_text(FPA_PACK))
    ch = build_character(T, make_request(name="Test", race="mutant", cls=cls, subclass=sub, level=7))
    pdf, info = render_pdf(render_html(ch, assets), browser=browser)
    assert len(pdf_text(pdf)) == 2
    assert info["fit"] == "ok" and info["fs"] >= 9.5


@pytest.mark.pdf
def test_portrait_image_lands_on_front(tables, assets, browser):
    ch = char(tables, name="Pic", portrait=PNG_1PX)
    pdf, _ = render_pdf(render_html(ch, assets), browser=browser)
    doc = fitz.open(stream=pdf, filetype="pdf")
    assert len(doc[0].get_images()) >= 1
    plain, _ = render_pdf(render_html(char(tables, name="NoPic"), assets), browser=browser)
    assert "Draw your hero here!" in pdf_text(plain)[0]


@pytest.mark.pdf
def test_front_layout_regions(tables, assets, browser):
    """Portrait box, inventory and notes are real, roomy areas on page 1."""
    pdf, _ = render_pdf(render_html(char(tables, cls="rogue", level=3), assets), browser=browser)
    page = fitz.open(stream=pdf, filetype="pdf")[0]
    words = {w[4]: w for w in page.get_text("words")}
    W, H = page.rect.width, page.rect.height
    inv, notes, gold = words["Inventory"], words["Notes"], words["GOLD"]
    assert gold[1] - inv[1] > H * 0.25, "inventory box is too small"
    assert notes[1] < H * 0.62, "notes start too low to have room"
    assert squash("Draw your hero here!") in squash(page.get_text())


@pytest.mark.pdf
@PDF_FUZZ
@given(st.data())
def test_fuzz_built_characters_print(tables, assets, browser, data):
    req = data.draw(random_choice_request(tables))
    ch = build_character(tables, req)
    pdf, info = render_pdf(render_html(ch, assets), browser=browser)
    pages = pdf_text(pdf)
    assert len(pages) == 2 and info["fit"] == "ok"
    assert squash(ch.row(0, named=True)["identity"]["cls"]) in squash(pages[0])


@pytest.mark.pdf
@PDF_FUZZ
@given(random_character())
def test_fuzz_random_characters_always_two_pages(assets, browser, ch):
    pdf, info = render_pdf(render_html(ch, assets), browser=browser)
    assert len(pdf_text(pdf)) == 2
    assert info["fit"] in ("ok", "overflow")
