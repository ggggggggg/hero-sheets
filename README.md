# Hero Sheet Builder

## ▶ Play now → https://tinyurl.com/24pj3dbx

Every fresh visit rolls a brand-new random hero.

[![tests](https://github.com/ggggggggg/hero-sheets/actions/workflows/tests.yml/badge.svg)](https://github.com/ggggggggg/hero-sheets/actions/workflows/tests.yml)

A quick, easy character builder that makes 2-page hero sheets kids actually want to use. It
plays up the fun stuff and leaves out the boring details — no spell components, no fiddly rules
footnotes, just a hero your kid can read and play. Pick a race, class and level, roll some dice,
and print.

It's totally open: copy it, change it, host your own — do whatever you like with it.

**Content packs.** You can add your own races, classes, spells and more as plain JSON packs:
press "Download AI instructions" in the builder, hand the file to an AI, and drop the JSON it
writes into `examples/`. Want yours available to everyone on the site? Send a pull request and
we'll publish it.

> **Open content only.** Packs submitted here must contain only open-source / Creative Commons
> licensed material (e.g. the D&D 5.1 SRD under CC-BY-4.0). No copyrighted or trademarked content.
> Include the license and attribution for anything you adapt.

- **Share a content pack:** https://tinyurl.com/2yccbgrs (`?pack=tobin-flame-master`)

Developer notes are in `CLAUDE.md`.


---

# charsheet

Kid-friendly 5e character sheets (levels 1-7), built from polars tables.

```
tables (dict of DataFrames) + request (1-row DataFrame)
        │  build.build_character      ← pure: no IO, no hidden defaults
        ▼
character (1-row DataFrame, struct columns)
        │  render.render_html          ← pure: string in, string out
        ▼
HTML ── render.render_pdf ──▶ 2-page letter PDF (front: stats, portrait, inventory, notes; back: powers & spells)
```

## Make a sheet

    python -m charsheet --list
    python -m charsheet --name Tobin --race dwarf --cls warlock --subclass fiend --level 5 \
        --choice invocations="Agonizing Blast,Fiendish Vigor,Eldritch Spear" --out tobin.pdf

Leave out `--choice`, `--spells` and `--cantrips` and sensible picks are made for you.

## Tables (`charsheet/data.py`)

| table | what's in it | struct columns |
|---|---|---|
| rules | standard array, proficiency by level, cantrip dice, level-up boost, DC base | `asi` |
| skills | 18 skills and their ability | |
| slots | spell slots per caster kind and level | |
| races | speed, ability boosts, skills, languages | `asi` |
| classes | hit die, saves, armor, weapons, casting, spell picks, look | `armor`, `weapons[]`, `caster`, `look`, `expertise[]` |
| subclasses | extra HP/armor/skills/cantrips, bonus spells | `armor`, `auto_spells[]` |
| scaling | per-level numbers used in text ({RAGES}, {SNEAK}, {KI}...) | |
| features | powers by owner and level | `card`, `tracker` |
| choices | pick-one-or-more groups (fighting style, invocations...) | `options[]{effect{vars[]}}` |
| spells | the fun part of each spell | `card` |

Text uses `{PLACEHOLDERS}`; anything not filled from the tables raises an error.

## Website

    python -m charsheet.site Hero_Sheet_Builder.html          # standalone file
    python -m charsheet.site page.html --artifact              # body-only, for a hosted page

`web/core.js` is a JavaScript copy of the builder and sheet renderer (tests keep it identical to the
Python output). `web/export.js` makes the 2-page PDF in the browser with no libraries: each page is
drawn by the browser (SVG foreignObject), turned into a 288-dpi JPEG and wrapped in a small
hand-written PDF. It also saves a print-ready 2-page HTML. Cartoon portraits come from DiceBear,
loaded from jsDelivr only when you ask for one; the art credit prints in the portrait corner.

## Tests

Everything is pinned in `pyproject.toml`; the project uses [uv](https://docs.astral.sh/uv/).

    uv sync                             # create the env
    uv run playwright install chromium  # first time only
    uv run pytest                       # everything (~2 min)
    uv run pytest -m "not pdf"          # skip the browser

Every push runs the same suite on GitHub Actions (`.github/workflows/tests.yml`), with node
installed so the JavaScript parity tests actually run.

* `tests/test_build.py` – every race × class × subclass × level; changing any input
  table changes the output; purity (no file access, inputs unchanged); fuzzing with
  completely random tables whose words appear nowhere else, so any hidden default
  would show up in the output.
* `tests/test_render.py` – HTML is pure and complete; every subclass at level 7
  prints to exactly 2 pages with the back page fitting at ≥10px; portrait, inventory
  and notes areas exist; fuzzing with random built characters and random hand-made
  character rows.
