"""Export the tables for the website and assemble the single-page site."""
from __future__ import annotations

import json
from pathlib import Path

import polars as pl

from .render import CSS, _fonts_css, load_assets

WEB = Path(__file__).resolve().parents[1] / "web"


def tables_json(tables: dict[str, pl.DataFrame]) -> str:
    """Pure: the tables as JSON (lists of row dicts, struct columns become nested objects)."""
    return json.dumps({k: v.to_dicts() for k, v in tables.items()}, separators=(",", ":"))


def request_json(request: pl.DataFrame) -> dict:
    return request.row(0, named=True)


UI_CSS = r"""
:root { --bg: #f2f3f8; --panel: #ffffff; --fg: #1c1f2e; --muted: #5d6275; --line: #d8dae6; --ac: #6a1b9a;
  --display: 'Fredoka', 'Trebuchet MS', sans-serif; --body: 'Nunito', 'Trebuchet MS', sans-serif }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #12141c; --panel: #1b1e29; --fg: #e8e9f1; --muted: #9ea3b8; --line: #2e3243; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #12141c; --panel: #1b1e29; --fg: #e8e9f1; --muted: #9ea3b8; --line: #2e3243; color-scheme: dark }
html, body { height: 100% }
body { background: var(--bg); color: var(--fg); font-family: var(--body); font-size: 14px; margin: 0 }
.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding-block: 10px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  border-bottom: 1px solid var(--line); background: var(--panel) }
.brand { font-family: var(--display); font-weight: 600; font-size: 22px; white-space: nowrap; display: flex; align-items: center; gap: 10px }
.brand i { width: 26px; height: 26px; border-radius: 8px; background: var(--ac); display: inline-block; transition: background .3s }
.actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap }
button { font: inherit; cursor: pointer }
.actions button, .ghost { border: 1.5px solid var(--line); background: var(--panel); color: var(--fg); border-radius: 10px; padding: 6px 12px; font-weight: 700 }
.actions button#pdf { background: var(--ac); border-color: var(--ac); color: #fff }
.actions button:disabled { opacity: .6; cursor: progress }
.bootmsg { padding: 10px 16px; font-weight: 700; color: var(--muted); white-space: pre-wrap }
.bootmsg.bad { background: #fde8e8; color: #8a1c1c; font-size: 13px }
html[data-booted="1"] .bootmsg:not(.bad) { display: none }
#status { font-size: 12.5px; font-weight: 700; color: var(--muted); flex-basis: 100%; text-align: right }
.sitefoot { padding: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11.5px; line-height: 1.55 }
.sitefoot p { margin: 4px 0 } .sitefoot a { color: var(--muted) }
.sm { display: none }
.tabs { display: none }
@media (max-width: 979px) {
  .lg { display: none } .sm { display: inline }
  .top { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; padding-block: 8px }
  body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--panel) }
  .brand { font-size: 18px } .brand i { width: 20px; height: 20px }
  .actions { gap: 6px } .actions button { padding: 7px 10px }
  #status { text-align: left }
  .tabs { display: flex; flex-basis: 100%; gap: 8px }
  .tabs button { flex: 1; border: 1.5px solid var(--line); background: var(--panel); color: var(--fg); border-radius: 12px; padding: 10px; font-weight: 800; font-size: 15px }
  .tabs button[aria-pressed="true"] { background: var(--ac); border-color: var(--ac); color: #fff }
  .layout { padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px)) }
  body[data-view="build"] .previewcol { display: none }
  body[data-view="sheet"] #controls { display: none }
}
@media (pointer: coarse) {
  .chip-btn { min-height: 40px; padding: 8px 14px; font-size: 14px }
  .icon, .dice { min-width: 40px; min-height: 40px; font-size: 18px }
  .step { height: 40px }
  .abrow { grid-template-columns: 36px 38px 24px 38px 32px 20px 32px minmax(0, 1fr) 30px; gap: 3px }
  .sname { padding: 9px 10px }
  .popt { padding: 10px 12px }
  .ghost, .filebtn, .addbtn, .actions button { min-height: 42px }
  .link { min-height: 36px; padding: 0 8px }
  input[type=text], input[type=url], select, textarea { font-size: 16px }
}
@media (min-width: 980px) and (max-width: 1239px) { .layout { grid-template-columns: 340px minmax(0, 1fr) !important } }
#status.bad { color: #b3261e }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap }
.pic { display: flex; flex-direction: column; gap: 8px }
.filebtn { display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border: 1.5px solid var(--line); border-radius: 10px; padding: 6px 12px; font-weight: 700 }
#portrait:focus-visible + .filebtn, .filebtn:focus-within { outline: 3px solid var(--ac) }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 3px solid var(--ac); outline-offset: 2px }
.layout { display: grid; grid-template-columns: 1fr; gap: 16px; padding-block: 16px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)) }
@media (min-width: 980px) { .layout { grid-template-columns: 400px minmax(0, 1fr); align-items: start }
  #controls { position: sticky; top: 12px; max-height: calc(100vh - 90px); overflow: auto } }
#controls { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 14px; min-width: 0 }
.field { display: flex; flex-direction: column; gap: 6px; min-width: 0 }
.flabel { font-family: var(--display); font-weight: 600; font-size: 15px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px }
.hint { font-family: var(--body); font-weight: 600; font-size: 12px; color: var(--muted) }
.hint.block { margin: 0 }
.chips { display: flex; flex-wrap: wrap; gap: 6px }
.chip-btn { border: 1.5px solid var(--line); background: var(--panel); color: var(--fg); border-radius: 999px; padding: 5px 11px; font-weight: 700; font-size: 13px }
.chip-btn:hover { border-color: var(--c, var(--ac)) }
.chip-btn.on { background: var(--c, var(--ac)); border-color: var(--c, var(--ac)); color: #fff }
.tagline { margin: -6px 0 0; color: var(--muted); font-style: italic }
.has-tip { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none }
#tip { position: fixed; z-index: 50; background: var(--panel); color: var(--fg); border: 1.5px solid var(--ac); border-radius: 12px;
  padding: 10px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.22); font-size: 13px; line-height: 1.4; pointer-events: none; max-height: 60vh; overflow: hidden }
#tip[hidden] { display: none }
#tip .tt { display: block; font-size: 14px; margin-bottom: 4px; color: var(--ac) }
#tip p { margin: 4px 0 0 }
.tiphint { margin: 0; color: var(--muted); font-size: 12px }
.tiphint .touch { display: none }
@media (hover: none) { .tiphint .mouse { display: none } .tiphint .touch { display: inline } }
@media print { #tip { display: none !important } }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap }
input[type=text], input[type=url], select, textarea { font: inherit; color: var(--fg); background: var(--bg); border: 1.5px solid var(--line); border-radius: 10px; padding: 7px 10px; min-width: 0 }
input[type=text], input[type=url] { flex: 1 }
.hint.bad { color: #b3261e }
textarea { resize: vertical; width: 100%; box-sizing: border-box }
select { width: 100% }
.adv { border-top: 1.5px dashed var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 14px }
.adv summary { cursor: pointer; font-family: var(--display); font-weight: 700; font-size: 17px; color: var(--fg); list-style: none;
  border: 2px solid var(--ac); border-radius: 14px; padding: 14px 16px; background: color-mix(in srgb, var(--ac) 8%, var(--panel)); display: block; min-height: 48px }
.adv summary::-webkit-details-marker { display: none }
.adv summary::before { content: "\25B8"; display: inline-block; margin-right: 8px; color: var(--ac); transition: transform .15s }
.adv[open] summary::before { transform: rotate(90deg) }
.adv summary .hint { display: block; font-family: var(--body, inherit); font-size: 13px; font-weight: 600; margin: 4px 0 0 22px }
.adv[open] summary { margin-bottom: 4px }
.armgrid { display: flex; flex-direction: column; gap: 6px }
.armrow { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 8px; align-items: start }
.armkind { font-size: 12px; font-weight: 800; color: var(--muted); padding-top: 6px }
.abgrid { display: flex; flex-direction: column; gap: 4px }
.abrow { display: grid; grid-template-columns: 40px 32px 28px 32px 26px 24px 26px minmax(0, 1fr) 38px; gap: 4px; align-items: center; font-size: 13px }
.step.mini { height: 26px; font-size: 14px; border-radius: 7px }
.abfull { display: none }
.abshort { font-weight: 800 }
.abhead { font-size: 10.5px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: .04em }
.abname { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.abbase { text-align: center; font-family: var(--display); font-size: 17px }
.step { border: 1.5px solid var(--line); background: var(--panel); color: var(--fg); border-radius: 8px; height: 30px; font-weight: 800; font-size: 16px }
.step:disabled { opacity: .35 }
.abbonus { color: var(--ac); font-weight: 800; text-align: center }
.abfinal { font-weight: 800; white-space: nowrap }
.customlist { margin: 6px 0; padding-left: 18px; font-size: 13px; display: flex; flex-direction: column; gap: 3px }
.customlist .bad { color: #b3261e }
.icon.warn { color: #b26a00; font-size: 16px }
.pwarn { display: block; color: #b26a00; font-size: 12px; font-weight: 700; margin-top: 3px }
.herolist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px }
.herorow { display: flex; align-items: center; gap: 6px; border: 1.5px solid var(--line); border-radius: 10px; padding: 2px 6px 2px 2px }
.herorow.on { border-color: var(--ac); background: color-mix(in srgb, var(--ac) 8%, var(--panel)) }
.heroname { flex: 1; text-align: left; background: none; border: 0; color: var(--fg); font: inherit; font-weight: 700; padding: 8px; min-height: 36px; cursor: pointer }
.rolls summary { cursor: pointer; font-weight: 700; color: var(--muted); font-size: 13px; min-height: 32px }
.heroes { border: 1.5px dashed var(--line); border-radius: 12px; padding: 10px }
.custom .field { display: flex; flex-direction: column; gap: 8px }
.abcost { color: var(--muted); font-size: 12px; text-align: right }
.pbline { margin: 4px 0 0; font-size: 12.5px; font-weight: 700; color: var(--muted) }
.pbline.warn { color: #b36b00 }
.picked { margin: 0; padding-left: 18px; color: var(--muted); font-size: 12.5px; display: flex; flex-direction: column; gap: 2px }
.picked b { color: var(--fg) }
ul.spells { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px }
li.spell { display: flex; gap: 4px; align-items: stretch; border: 1.5px solid var(--line); border-radius: 12px; padding: 2px 4px 2px 2px }
li.spell.open { border-color: var(--ac) }
li.spell.locked { border-style: dashed; background: var(--bg) }
li.spell.locked div.sname { cursor: default }
li.spell.locked .swaphint { color: var(--muted) }
li.spell.offbook { border-color: #d98a00; border-style: solid }
li.spell.offbook .swaphint { color: #b36b00 }
li.offnote { list-style: none; background: #fff3d6; color: #6b4200; border: 1.5px solid #e9b44c; border-radius: 12px; padding: 8px 10px; font-size: 12.5px; font-weight: 700 }
li.offnote .link { color: #6b4200 }
.sname { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 0 6px; align-items: baseline; text-align: left; border: 0; background: transparent;
  color: var(--fg); padding: 6px 8px; border-radius: 10px }
.sname:hover { background: var(--bg) }
.sname small { flex-basis: 100%; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.swaphint { margin-left: auto; font-size: 11.5px; font-weight: 800; color: var(--ac) }
.lvl { font-size: 11px; font-weight: 800; color: var(--ac) }
.icon { border: 0; background: transparent; color: var(--muted); font-size: 15px; width: 30px; border-radius: 8px; flex: none }
.icon:hover { background: var(--bg); color: var(--fg) }
.addbtn { width: 100%; border: 1.5px dashed var(--ac); background: transparent; color: var(--ac); border-radius: 12px; padding: 8px; font-weight: 800 }
.pwrap { list-style: none }
.picker { border: 1.5px solid var(--ac); border-radius: 14px; background: var(--bg); padding: 8px; display: flex; flex-direction: column; gap: 8px;
  max-height: 420px; overflow: auto }
.phead { display: flex; justify-content: space-between; align-items: center; position: sticky; top: -8px; background: var(--bg); padding: 2px 0 4px; z-index: 1 }
.plvl { font-family: var(--display); font-weight: 600; font-size: 13px; color: var(--ac); margin: 2px 0 4px }
.popts { display: grid; grid-template-columns: 1fr; gap: 5px }
.popt { text-align: left; border: 1.5px solid var(--line); background: var(--panel); color: var(--fg); border-radius: 10px; padding: 7px 9px;
  display: flex; flex-direction: column; gap: 2px }
.popt:hover { border-color: var(--ac) }
.popt.on { border-color: var(--ac); box-shadow: inset 0 0 0 1.5px var(--ac) }
.ptop { display: flex; gap: 6px; align-items: center; flex-wrap: wrap }
.ptag { font-size: 10px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; color: #fff; border-radius: 20px; padding: 1px 7px; background: #555 }
.ptag.tA { background: #222 } .ptag.tB { background: #b86f00 } .ptag.tR { background: #2878c8 } .ptag.tON { background: #6d6d6d } .ptag.tF { background: #23854e }
.pnote { font-size: 11px; font-weight: 700; color: var(--muted) }
.pdesc { font-size: 12.5px; color: var(--muted); line-height: 1.35 }
.dice { border: 0; background: transparent; font-size: 15px; line-height: 1; padding: 2px 4px; border-radius: 8px; flex: none; cursor: pointer }
.dice:hover { background: var(--bg) }
.link { border: 0; background: none; color: var(--ac); font-weight: 700; padding: 0; text-decoration: underline }
.previewcol { min-width: 0 }
#error { background: #fde8e8; color: #8a1c1c; border-radius: 12px; padding: 10px 14px; margin-bottom: 12px; font-weight: 700 }
#preview { width: 100%; overflow: hidden }
#scaler { position: relative }
#scaler .sheet { transform-origin: top left; position: absolute; top: 0; left: 0; display: flex; flex-direction: column; gap: 24px; background: transparent }
#scaler .sheet.side { flex-direction: row }
#scaler .page { box-shadow: 0 2px 14px rgba(0,0,0,.18); border-radius: 4px; flex: none }
@media (prefers-reduced-motion: reduce) { * { transition: none !important } }
@media print {
  .top, #controls, #error, .tabs, .sitefoot { display: none !important }
  .previewcol { display: block !important }
  body { background: #fff }
  .layout { display: block; padding: 0 }
  #scaler { height: auto !important }
  #scaler .sheet { position: static; transform: none !important; display: block }
  #scaler .page { box-shadow: none; border-radius: 0 }
}
@media (pointer: coarse) { .abrow .step, .abrow .step.mini { height: 40px } }
"""

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600&family=Nunito:wght@400;700;800&display=swap">')

BODY = """
<div id="bootmsg" class="bootmsg">Loading the builder&hellip;</div>
<noscript><div class="bootmsg bad">This builder needs JavaScript, and it's turned off here.</div></noscript>
<script>
(function () {
  var shown = false;
  function show(msg) {
    var b = document.getElementById("bootmsg");
    if (!b) return;
    b.className = "bootmsg bad";
    b.textContent = (shown ? b.textContent + " | " : "Something went wrong starting the builder (please screenshot this): ") + msg;
    shown = true;
  }
  window.addEventListener("error", function (e) { show((e.message || "error") + " [" + (e.lineno || "?") + ":" + (e.colno || "?") + "]"); });
  window.addEventListener("unhandledrejection", function (e) { var r = e.reason; show("promise: " + (r && (r.message || r)) ); });
  setTimeout(function () {
    if (document.documentElement.getAttribute("data-booted") !== "1") show("the page script never finished loading.");
    else if (!shown) { var b = document.getElementById("bootmsg"); if (b) b.remove(); }
  }, 6000);
})();
</script>
<header class="top">
  <div class="brand"><i aria-hidden="true"></i>Hero Sheet Builder</div>
  <div class="actions">
    <button type="button" id="surprise"><span aria-hidden="true">&#x1F3B2;</span> <span class="lg">Surprise me</span><span class="sm">Surprise</span></button>
    <button type="button" id="heroes-btn"><span class="lg">My heroes</span><span class="sm">Heroes</span></button>
    <button type="button" id="pdf"><span class="lg">Download PDF</span><span class="sm">PDF</span></button>
  </div>
  <nav class="tabs" aria-label="Switch view">
    <button type="button" id="tab-build" aria-pressed="true">Build</button>
    <button type="button" id="tab-sheet" aria-pressed="false">See the sheet</button>
  </nav>
  <span id="status" role="status" hidden></span>
</header>
<main class="layout">
  <aside id="controls" aria-label="Build your hero"></aside>
  <section class="previewcol" aria-label="Your sheet">
    <div id="error" hidden></div>
    <div id="preview"><div id="scaler"></div></div>
  </section>
</main>
<footer class="sitefoot">
  <p>This work includes material taken from the System Reference Document 5.1 (&quot;SRD 5.1&quot;) by Wizards of the Coast LLC and available at <a href="https://dnd.wizards.com/resources/systems-reference-document">dnd.wizards.com</a>. The SRD 5.1 is licensed under the <a href="https://creativecommons.org/licenses/by/4.0/legalcode">Creative Commons Attribution 4.0 International License</a>.</p>
  <p>Hero Sheet Builder &mdash; code and content packs alike &mdash; is MIT-licensed. Source: <a href="https://github.com/ggggggggg/hero-sheets">github.com/ggggggggg/hero-sheets</a>.</p>
</footer>
"""


def build_site(tables: dict[str, pl.DataFrame], core_js: str, app_js: str, *, standalone: bool,
               assets: dict[str, str] | None = None, export_js: str = "", custom_js: str = "", guide_md: str = "") -> str:
    """Pure: the whole website as one HTML string (standalone file, or artifact body)."""
    data = tables_json(tables).replace("</", "<\\/")
    fonts_css = _fonts_css(assets) if assets else ""
    head = ("<title>Hero Sheet Builder</title>" + ('<meta name="claude:viewport-fit-sides" content="cover">' if not standalone else "") +
            ("" if assets else FONTS) + '<style id="sheet-css">' + fonts_css + "\n" + CSS + "</style><style>" + UI_CSS + "</style>")
    guide = json.dumps(guide_md).replace("</", "<\\/")
    body = (BODY + "<script>window.CHARSHEET_TABLES=" + data + ";window.CHARSHEET_GUIDE=" + guide + ";</script><script>" + core_js +
            "</script><script>" + export_js + "</script><script>" + custom_js + "</script><script>" + app_js + "</script>")
    if standalone:
        return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
                + head + "</head><body>" + body + "</body></html>")
    return head + body


def main(argv=None):
    import argparse
    from .data import default_tables
    p = argparse.ArgumentParser(prog="charsheet.site")
    p.add_argument("out")
    p.add_argument("--artifact", action="store_true", help="write the body-only version for a hosted page")
    p.add_argument("--pages", action="store_true", help="treat OUT as a folder: index.html + packs/ (ready for GitHub Pages)")
    a = p.parse_args(argv)
    html = build_site(default_tables(), (WEB / "core.js").read_text(), (WEB / "app.js").read_text(), standalone=not a.artifact,
                      assets=load_assets(), export_js=(WEB / "export.js").read_text(), custom_js=(WEB / "custom.js").read_text(),
                      guide_md=(WEB.parent / "CUSTOM_CONTENT_GUIDE.md").read_text())
    if a.pages:
        build_pages(Path(a.out), html, WEB.parent / "examples")
        print("wrote", a.out, "(index.html + packs/)")
        return
    Path(a.out).write_text(html)
    print("wrote", a.out, len(html) // 1024, "KB")


def build_pages(out: Path, html: str, packs_src: Path) -> None:
    """A folder you can publish as-is: index.html, packs/*.json and packs/index.json (the list the builder shows)."""
    (out / "packs").mkdir(parents=True, exist_ok=True)
    (out / "index.html").write_text(html)
    (out / ".nojekyll").write_text("")
    listing = []
    for f in sorted(packs_src.glob("*.json")):
        pack = json.loads(f.read_text())
        (out / "packs" / f.name).write_text(f.read_text())
        listing.append({"file": f.name, "title": pack.get("title", f.stem), "about": pack.get("about", "")})
    existing = {p.name for p in (out / "packs").glob("*.json")} - {"index.json"}
    for name in sorted(existing - {x["file"] for x in listing}):  # packs you dropped in by hand are listed too
        pack = json.loads((out / "packs" / name).read_text())
        listing.append({"file": name, "title": pack.get("title", name[:-5]), "about": pack.get("about", "")})
    (out / "packs" / "index.json").write_text(json.dumps({"packs": listing}, indent=1))


if __name__ == "__main__":
    main()
