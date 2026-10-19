"""Part 2: character DataFrame -> two-page sheet.

`render_html(character, assets)` is pure (string in, string out).
`render_pdf(html)` drives a headless browser and is the only IO here.
`load_assets()` reads the bundled fonts from disk.
"""
from __future__ import annotations

import base64
import html as _h
from pathlib import Path

import polars as pl

ICON = {
    "A": '<svg viewBox="0 0 24 24"><path d="M14.5 3H21v6.5L10 20.5l-2-2-3 3-2.5-2.5 3-3-2-2z" fill="currentColor"/></svg>',
    "B": '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor"/></svg>',
    "R": '<svg viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5z" fill="currentColor"/></svg>',
    "ON": '<svg viewBox="0 0 24 24"><path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill="currentColor"/></svg>',
    "F": '<svg viewBox="0 0 24 24"><path d="M12 1c.6 5 2 9.4 11 11-9 1.6-10.4 6-11 11-.6-5-2-9.4-11-11 9-1.6 10.4-6 11-11z" fill="currentColor"/></svg>',
}
TAGS = {"A": ("ACTION", "#222"), "B": ("BONUS", "#e08a00"), "R": ("REACTION", "#2878c8"), "ON": ("ALWAYS ON", "#7a7a7a"),
        "F": ("FREE", "#2a9d5c")}
ABIL_NAME = {"STR": "Strength", "DEX": "Dexterity", "CON": "Constitution", "INT": "Intelligence", "WIS": "Wisdom", "CHA": "Charisma"}
STAR = ('<svg viewBox="0 0 24 24"><path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" '
        'fill="#fff" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>')
BOX_LIMIT = 12  # more uses than this -> a write-in "__ / N" box instead of tick boxes


def load_assets(folder: str | Path | None = None) -> dict[str, str]:
    folder = Path(folder or Path(__file__).parent / "assets")
    return {p.stem: base64.b64encode(p.read_bytes()).decode() for p in sorted(folder.glob("*.woff2"))}


def e(s) -> str:
    return _h.escape("" if s is None else str(s))


def sg(n: int) -> str:
    return f"+{n}" if n >= 0 else str(n)


def _fonts_css(assets: dict[str, str]) -> str:
    out = []
    for stem, b64 in assets.items():
        fam = "Fredoka" if stem.startswith("fredoka") else "Nunito"
        weight = stem.split("-")[2]
        out.append(f"@font-face{{font-family:{fam};font-weight:{weight};src:url(data:font/woff2;base64,{b64}) format('woff2')}}")
    return "\n".join(out)


CSS = """
@page { size: letter; margin: 0 }
.sheet, .sheet * { box-sizing: border-box; margin: 0; padding: 0 }
.sheet { font-family: Nunito, 'Trebuchet MS', sans-serif; color: #222; -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff }
.page { width: 816px; height: 1056px; padding: 34px 38px 32px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: #fff; page-break-after: always; break-after: page }
.page:last-child { page-break-after: auto; break-after: auto }
.disp { font-family: Fredoka, 'Trebuchet MS', sans-serif; font-weight: 600 }
.lbl { font-size: 9.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: #555 }
.head { background: var(--ac); color: #fff; border-radius: 16px; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px }
.head .nm { font-size: 38px; line-height: 1 }
.head .sub { font-family: Fredoka, sans-serif; font-size: 15px; margin-top: 3px }
.head .tag { font-size: 12.5px; font-style: italic; font-weight: 700; margin-top: 2px }
.head .lv { text-align: center; background: #fff; color: var(--ac); border-radius: 12px; padding: 4px 12px 5px; min-width: 70px }
.head .lv b { display: block; font-family: Fredoka, sans-serif; font-size: 30px; line-height: 1 }
.player { font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; border-bottom: 2px solid rgba(255,255,255,.8); padding-bottom: 12px; min-width: 150px }
.fr1 { display: grid; grid-template-columns: 250px 1fr; gap: 12px; margin-top: 10px }
.portrait { height: 300px; border: 3px dashed var(--ac); border-radius: 18px; display: flex; align-items: center; justify-content: center; text-align: center; color: #aaa; font-family: Fredoka, sans-serif; font-size: 17px; overflow: hidden; background: var(--tint) }
.portrait { position: relative }
.portrait img { width: 100%; height: 100%; object-fit: cover }
.portrait .credit { position: absolute; left: 6px; right: 6px; bottom: 4px; font-family: Nunito, sans-serif; font-size: 7.5px; color: #666; background: rgba(255,255,255,.75); border-radius: 4px; padding: 1px 4px }
.abil { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px }
.ab { border-radius: 14px; background: var(--tint); text-align: center; padding: 8px 4px; border-top: 6px solid var(--ac); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px }
.ab .m { font-family: Fredoka, sans-serif; font-weight: 600; font-size: 40px; line-height: 1; color: var(--ac) }
.ab .sc { font-weight: 800; font-size: 12px; border: 1.5px solid #999; border-radius: 10px; padding: 0 8px; background: #fff }
.ab .sv { font-size: 11.5px; font-weight: 700; color: #444 }
.pd { display: inline-block; width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid #333; vertical-align: 0 }
.pd.on { background: #333 }
.pd.ex { background: var(--ac); border-color: var(--ac) }
.box { border: 2px solid #ddd; border-radius: 12px; padding: 6px 10px }
.box h4 { font-family: Fredoka, sans-serif; font-weight: 600; font-size: 15px; color: var(--ac); margin-bottom: 3px }
.skills { margin-top: 10px }
.skgrid { display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 18px }
.sk { display: flex; justify-content: space-between; font-size: 12px; line-height: 1.45; gap: 4px }
.sk b { font-weight: 800 }
.facts { display: flex; gap: 18px; margin-top: 5px; font-size: 11.5px; font-weight: 700; color: #444; flex-wrap: wrap }
.facts b { color: var(--ac); font-family: Fredoka, sans-serif; font-size: 15px }
.inv { flex: 1; display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; margin-top: 10px; min-height: 0 }
.col { display: flex; flex-direction: column; min-height: 0 }
.lines { background-image: repeating-linear-gradient(transparent 0 23px, #cfcfcf 23px 24px); line-height: 24px; font-size: 13px; font-weight: 700; flex: 1; overflow: hidden }
.coins { display: flex; gap: 6px; margin-top: 6px }
.coins div { flex: 1; border: 2px solid #ddd; border-radius: 8px; text-align: center; font-size: 9.5px; font-weight: 800; color: #666; padding: 2px 0 18px }
.bhead { display: flex; justify-content: space-between; align-items: center; background: var(--ac); color: #fff; border-radius: 16px; padding: 8px 16px }
.bhead .nm { font-size: 28px }
.combat { display: grid; grid-template-columns: 1fr 2.6fr 1fr 1fr; gap: 8px; margin-top: 8px }
.tile { border: 2.5px solid var(--ac); border-radius: 12px; text-align: center; padding: 3px 4px 4px; display: flex; flex-direction: column; justify-content: center }
.tile .worn { display: block; font-size: 8.5px; font-weight: 700; color: #666; line-height: 1.1; margin-top: 1px }
.tile b { display: block; font-family: Fredoka, sans-serif; font-weight: 600; font-size: 26px; line-height: 1.1; color: var(--ac) }
.hp { display: grid; grid-template-columns: 1fr 1.4fr 1fr; gap: 6px; align-items: end }
.hp .w { background: #fff; border: 2px dashed #bbb; border-radius: 9px; height: 38px }
.hp .mx b { font-size: 30px }
.mini { display: flex; gap: 18px; align-items: center; font-weight: 800; font-size: 11.5px; flex-wrap: wrap; margin-top: 6px }
.dot { display: inline-block; width: 14px; height: 14px; border: 2px solid #333; border-radius: 50%; background: #fff; vertical-align: -3px; margin-right: 2px }
.cmb2 { display: grid; grid-template-columns: 1.5fr 1fr; gap: 10px; margin-top: 7px; align-items: start }
table.atk { width: 100%; border-collapse: collapse; font-size: 12px }
table.atk th { text-align: left; font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; color: #666; padding: 1px 4px; border-bottom: 2px solid #eee }
table.atk td { padding: 2px 4px; border-bottom: 1px dotted #ccc; font-weight: 700 }
table.atk td.n { font-weight: 800 }
.magic { background: var(--tint); border-radius: 12px; padding: 6px 10px; font-weight: 800; font-size: 12px; display: flex; flex-wrap: wrap; gap: 3px 14px; align-items: center }
.magic .big, .magic small { flex-basis: 100% }
.magic .big { font-family: Fredoka, sans-serif; color: var(--ac); font-size: 15px }
.magic i { display: inline-block; width: 18px; height: 18px; color: var(--ac); vertical-align: -4px }
.magic small { font-weight: 400; color: #666; font-size: 10px }
.cards { flex: 1 1 0; min-height: 0; margin-top: 8px; column-count: 2; column-gap: 12px; column-fill: balance; font-size: var(--fs) }
.sec h3 { font-family: Fredoka, sans-serif; font-weight: 600; color: var(--ac); font-size: 1.22em; margin: 3px 0 4px; break-after: avoid }
.cd { break-inside: avoid; background: var(--tint); border-left: 5px solid var(--ac); border-radius: 4px 12px 12px 4px; padding: 3px 7px 4px; margin-bottom: 4px }
.cd .n { font-family: Fredoka, sans-serif; font-weight: 600; font-size: 1.1em }
.chip { display: inline-flex; align-items: center; gap: 3px; font-size: .64em; font-weight: 800; letter-spacing: .03em; border-radius: 20px; padding: 1px 7px 1px 5px; white-space: nowrap; color: #fff; vertical-align: 2px; margin-left: 4px }
.chip svg { width: 1.15em; height: 1.15em }
.chip.conc { background: #5b6bd6 }
.note { color: #444; background: #fff; border: 1.5px solid #bbb; padding: 0 6px }
.cd .d { line-height: 1.24; margin-top: 1px }
.bx { display: flex; gap: 5px; align-items: center; margin-top: 4px; flex-wrap: wrap }
.bx i { width: 15px; height: 15px; border: 2.4px solid var(--ac); border-radius: 4px; background: #fff; display: inline-block }
.bx .wr { width: 46px; height: 18px; border: 2px dashed var(--ac); border-radius: 5px; background: #fff; display: inline-block }
.bx small { font-size: .72em; font-weight: 700; color: #555 }
.foot { margin-top: 6px; border-top: 3px dotted var(--ac); padding-top: 5px; display: flex; gap: 5px; flex-wrap: wrap; align-items: center; font-size: 10.5px; color: #333 }
"""

FIT_JS = """
<script>
(async () => {
  try { await document.fonts.ready } catch (e) {}
  const c = document.querySelector('.page.back .cards');
  const fits = () => { if (c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1) return false; const box = c.getBoundingClientRect(); const tol = 1 + box.width / 400; for (const k of c.querySelectorAll('.cd, .sec h3')) { const r = k.getBoundingClientRect(); if (r.right > box.right + tol || r.bottom > box.bottom + tol) return false; } return true; };
  let fs = 16;
  c.style.setProperty('--fs', fs + 'px');
  while (!fits() && fs > 8) { fs -= 0.25; c.style.setProperty('--fs', fs + 'px'); }
  document.documentElement.dataset.fit = fits() ? 'ok' : 'overflow';
  document.documentElement.dataset.fs = fs;
})();
</script>
"""


def _tint(hex_color: str) -> str:
    return hex_color + "1a" if len(hex_color) == 7 else "#f2f2f2"


def _uses(n, rest):
    if n is None:
        return ""
    rest_txt = {"short": "back after a short rest", "long": "back after a long rest", "turn": "once per turn", "used": "gone when used"}.get(rest or "", rest or "")
    boxes = "<i></i>" * n if n <= BOX_LIMIT else '<span class="wr"></span><b>/ ' + str(n) + '</b>'
    return '<div class="bx">' + boxes + '<small>' + e(rest_txt) + '</small></div>'


def front_html(ch: dict) -> str:
    idn, cb = ch["identity"], ch["combat"]
    sub = " (" + e(idn["subclass"]) + ")" if idn["subclass"] else ""
    portrait = ('<img src="' + e(ch["extras"]["portrait"]) + '" alt="">') if ch["extras"]["portrait"] else "Draw your hero here!"
    if ch["extras"].get("portrait_credit"):
        portrait += '<span class="credit">' + e(ch["extras"]["portrait_credit"]) + '</span>'
    abil = "".join(
        '<div class="ab"><div class="lbl">' + e(ABIL_NAME.get(a["key"], a["key"])) + '</div><div class="m">' + sg(a["mod"]) +
        '</div><div class="sc">' + str(a["score"]) + '</div><div class="sv"><i class="pd' + (" on" if a["save_prof"] else "") +
        '"></i> save ' + sg(a["save"]) + '</div></div>'
        for a in ch["abilities"])
    skills = "".join(
        '<div class="sk"><span><i class="pd' + (" ex" if s["expert"] else " on" if s["prof"] else "") + '"></i> ' + e(s["name"]) +
        '</span><b>' + sg(s["bonus"]) + '</b></div>'
        for s in ch["skills"])
    inv = "".join("<div>" + e(x) + "</div>" for x in ch["inventory"])
    return ('<section class="page front">'
            '<div class="head"><div><div class="nm disp">' + e(idn["name"]) + '</div>'
            '<div class="sub">' + e(idn["race"]) + ' \u2022 ' + e(idn["cls"]) + sub + '</div>'
            '<div class="tag">' + e(idn["tagline"]) + '</div></div>'
            '<div class="lv"><b>' + str(idn["level"]) + '</b><span class="lbl">Level</span></div></div>'
            '<div class="fr1"><div class="portrait" data-role="portrait">' + portrait + '</div><div class="abil">' + abil + '</div></div>'
            '<div class="box skills"><h4>Skills</h4><div class="skgrid">' + skills + '</div>'
            '<div class="facts"><span>Proficiency <b>' + sg(cb["prof"]) + '</b></span><span>Notice <b>' + str(cb["passive_perception"]) +
            '</b></span><span>Speaks: ' + e(idn["languages"]) + '</span><span class="player">Player</span></div></div>'
            '<div class="inv"><div class="box col" data-role="inventory"><h4>Inventory</h4><div class="lines">' + inv + '</div>'
            '<div class="coins"><div>GOLD</div><div>SILVER</div><div>COPPER</div></div></div>'
            '<div class="box col" data-role="notes"><h4>Notes</h4><div class="lines">' + e(ch["extras"]["notes"]) + '</div></div></div>'
            '</section>')


def back_html(ch: dict) -> str:
    idn, cb, sc = ch["identity"], ch["combat"], ch["spellcasting"]
    sub = " (" + e(idn["subclass"]) + ")" if idn["subclass"] else ""
    tiles = ('<div class="tile"><b>' + str(cb["ac"]) + '</b><span class="lbl">Armor</span><span class="worn">' + e(cb.get("armor") or "") + '</span></div>'
             '<div class="tile hp"><div class="mx"><b>' + str(cb["max_hp"]) + '</b><span class="lbl">Max HP</span></div>'
             '<div><div class="w"></div><span class="lbl">HP now</span></div><div><div class="w"></div><span class="lbl">Temp HP</span></div></div>'
             '<div class="tile"><b>' + str(cb["speed"]) + '</b><span class="lbl">Speed (ft)</span></div>'
             '<div class="tile"><b>' + sg(cb["initiative"]) + '</b><span class="lbl">Initiative</span></div>')
    mini = ('<div class="mini"><span>Death saves &nbsp;OK ' + '<i class="dot"></i>' * 3 + ' &nbsp;Uh-oh ' + '<i class="dot"></i>' * 3 +
            '</span></div>')
    atk = "".join('<tr><td class="n">' + e(a["name"]) + '</td><td>' + sg(a["to_hit"]) + '</td><td>' + e(a["damage"]) +
                  '</td><td>' + e(a["note"]) + '</td></tr>' for a in ch["attacks"])
    atk = '<div class="box"><table class="atk"><tr><th>Attack</th><th>To hit</th><th>Damage</th><th>Range</th></tr>' + atk + '</table></div>'
    magic = ""
    if sc:
        rows = "".join('<span>Level ' + str(s["level"]) + ' ' + ("<i>" + STAR + "</i>") * s["count"] + '</span>' for s in sc["slots"])
        rest = "short" if sc["rest"] == "short" else "long"
        magic = ('<div class="magic"><span class="big">Spell attack ' + sg(sc["attack"]) + ' \u2022 DC ' + str(sc["dc"]) + '</span>' + rows +
                 ('<small>color a star per spell \u2022 back after a ' + rest + ' rest</small>' if sc["slots"] else '') + '</div>')
    secs: dict = {}
    for c in ch["cards"]:
        secs.setdefault(c["section"], []).append(c)
    body = ""
    for name, items in secs.items():
        cards = ""
        for c in items:
            lab, col = TAGS.get(c["tag"], (c["tag"], "#555"))
            chip = ('<span class="chip" style="background:' + col + '">' + ICON.get(c["tag"], "") + e(lab) + '</span>') if c["tag"] else ""
            note = ('<span class="chip note">' + e(c["note"]) + '</span>') if c["note"] else ""
            conc = '<span class="chip conc">Concentration</span>' if c["conc"] else ""
            cards += ('<div class="cd" data-card="' + e(c["name"]) + '"><span class="n">' + e(c["name"]) + '</span>' + chip + note + conc +
                      '<div class="d">' + e(c["desc"]) + '</div>' + _uses(c["uses"], c["rest"]) + '</div>')
        body += '<div class="sec"><h3>' + e(name) + '</h3>' + cards + '</div>'
    legend = "".join('<span class="chip" style="background:' + c + ';margin:0">' + ICON[k] + l + '</span>' for k, (l, c) in TAGS.items())
    return ('<section class="page back">'
            '<div class="bhead"><div class="nm disp">' + e(idn["name"]) + '</div><div class="disp" style="font-size:15px">' +
            e(idn["cls"]) + sub + ' \u2022 Level ' + str(idn["level"]) + '</div></div>'
            '<div class="combat">' + tiles + '</div>' + mini +
            '<div class="cmb2">' + atk + magic + '</div>'
            '<div class="cards">' + body + '</div>'
            '<div class="foot">' + legend + '<span><b>Action</b> = your main thing. <b>Bonus</b> = a quick extra thing. '
            '<b>Reaction</b> = once a round, even on someone else\'s turn.</span></div>'
            '</section>')


def sheet_html(ch: dict) -> str:
    """The two pages, inside a .sheet wrapper with the colour variables set."""
    ac = ch["identity"]["accent"] or "#444444"
    return ('<div class="sheet" style="--ac:' + e(ac) + ';--tint:' + _tint(ac) + '">' + front_html(ch) + back_html(ch) + '</div>')


def render_html(character: pl.DataFrame, assets: dict[str, str]) -> str:
    if character.height != 1:
        raise ValueError("render one character at a time")
    ch = character.row(0, named=True)
    return ('<!doctype html><html><head><meta charset="utf-8"><title>' + e(ch["identity"]["name"]) + '</title>'
            '<style>' + _fonts_css(assets) + "\nbody{margin:0}\n" + CSS + '</style></head><body>' + sheet_html(ch) + FIT_JS + '</body></html>')


def render_pdf(html: str, *, browser=None) -> tuple[bytes, dict]:
    """Print the HTML to a 2-page letter PDF. Returns (pdf bytes, info from the page)."""
    from playwright.sync_api import sync_playwright

    def go(b):
        page = b.new_page()
        page.set_content(html)
        page.wait_for_function("document.documentElement.dataset.fit !== undefined", timeout=15000)
        info = page.evaluate("({fit: document.documentElement.dataset.fit, fs: +document.documentElement.dataset.fs,"
                             " pages: document.querySelectorAll('.page').length})")
        pdf = page.pdf(width="8.5in", height="11in", print_background=True, margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
        page.close()
        return pdf, info

    if browser is not None:
        return go(browser)
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            return go(b)
        finally:
            b.close()
