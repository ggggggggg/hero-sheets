# Hero Sheet Builder: notes for Claude Code

A kids' D&D-style character builder. It turns a few picks into a printable 2-page hero sheet (PDF).

## Layout
- `charsheet/`: the Python side. `data.py` holds every rules table as a polars DataFrame. `build.py` has the pure function `build_character(tables, request)`. `render.py` makes the sheet HTML/PDF. `custom.py` merges custom content packs. `site.py` builds the website.
- `web/`: the browser side. `core.js` is a line-for-line JS port of build + render, and tests require identical output. `custom.js` is the JS pack merger. `app.js` is the builder UI. `export.js` makes the PDF in the browser.
- `examples/*.json`: content packs (plain JSON) that get published to the site.
- `CUSTOM_CONTENT_GUIDE.md`: the pack format, written for an AI to follow. The builder embeds it behind its "Download AI instructions" button.
- `docs/`: the built website, served by GitHub Pages (main branch, /docs). **It is generated, so don't hand-edit it.**

## Rebuild the site after any change
```bash
python3 -m charsheet.site docs --pages   # writes docs/index.html, docs/packs/*.json, docs/packs/index.json
```

## Tests (run before every push)
```bash
pip install polars hypothesis pytest playwright && playwright install chromium   # first time only
python3 -m pytest -q
```
- Python and JS must agree exactly (`tests/test_web_parity.py`, `tests/test_custom.py`).
- Fuzz tests check that editing a table row a hero uses changes their sheet, and that editing rows they don't use changes nothing.

## Rules of the house
- Built-in content covers levels 1–7 and every hero has to fit on 2 printed pages. New stuff goes in packs.
- Card text is kid-friendly, short and fun. No spell components or other boring rules details.
- Never say a choice is "best". Defaults are "usually fine", and anything off the usual rules says "talk to your DM".
- Commits use the project identity, not a personal name: `git config user.name "Hero Sheets"` and `git config user.email "hero-sheets@users.noreply.github.com"` (set per repo).

## Publish
`gh auth switch --user <the hero-sheets account>`, then commit and `git push`. Pages updates within about a minute.

To publish the first time, follow `PUBLISH.md`.
