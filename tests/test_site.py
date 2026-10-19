"""The website: builds, has no script errors, reacts to clicks, and prints 2 pages."""
import pathlib
import re

import fitz
import pytest

from charsheet.data import default_tables
from charsheet.render import load_assets
from charsheet.site import WEB, build_site

FIX = pathlib.Path(__file__).parent / "fixtures" / "dicebear"

pytestmark = pytest.mark.pdf


@pytest.fixture(scope="module")
def site_file(tmp_path_factory):
    html = build_site(default_tables(), (WEB / "core.js").read_text(), (WEB / "app.js").read_text(), standalone=True,
                      assets=load_assets(), export_js=(WEB / "export.js").read_text(), custom_js=(WEB / "custom.js").read_text(),
                      guide_md=(WEB.parent / "CUSTOM_CONTENT_GUIDE.md").read_text())
    p = tmp_path_factory.mktemp("site") / "site.html"
    p.write_text(html)
    return "file://" + str(p)


def _dicebear(route):
    m = re.search(r"@dicebear/([a-z-]+)@", route.request.url)
    route.fulfill(status=200, body=(FIX / f"esm_{m.group(1)}.js").read_text(),
                  headers={"content-type": "application/javascript", "access-control-allow-origin": "*"})


def open_page(browser, url, width=1400):
    page = browser.new_context(accept_downloads=True, viewport={"width": width, "height": 900}).new_page()
    page.route("https://cdn.jsdelivr.net/npm/@dicebear/**", _dicebear)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("try{localStorage.clear()}catch(e){}; window.CHARSHEET_FIXED_START = true")
    page.goto(url)
    page.wait_for_selector("#scaler .page.back", state="attached")
    return page, errors


def test_site_loads_and_reacts(browser, site_file):
    page, errors = open_page(browser, site_file)
    assert page.locator("#scaler .page").count() == 2
    page.click(".field:has-text('Class') >> text=Rogue")
    page.wait_for_timeout(200)
    assert "Rogue" in page.locator("#scaler .back .bhead").inner_text()
    assert page.locator("#scaler .cd[data-card='Sneak Attack']").count() == 1
    page.click(".field:has-text('Level') >> text=7")
    page.wait_for_timeout(200)
    assert page.locator("#scaler .cd[data-card='Evasion']").count() == 1
    page.click("#surprise")
    page.wait_for_timeout(200)
    assert page.locator("#scaler .page").count() == 2
    assert not errors
    page.close()


def test_site_spell_swap(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.click(".field:has-text('Class') >> text=Wizard")
    page.wait_for_timeout(200)
    before = page.locator("#scaler .back .cards").inner_text()
    spells = page.locator(".field:has(.flabel:text-is('Spells')) ul.spells")
    spells.locator("button.sname").first.click()
    page.wait_for_timeout(200)
    opts = page.locator(".picker .popt")
    assert opts.count() > 3
    assert "{" not in page.locator(".picker .popts").first.inner_text()  # numbers filled in
    opts.filter(has_not=page.locator(".on")).nth(1).click()
    page.wait_for_timeout(200)
    assert page.locator(".picker").count() == 0
    assert page.locator("#scaler .back .cards").inner_text() != before
    assert not errors
    page.close()


def test_site_prints_two_pages(browser, site_file):
    page, errors = open_page(browser, site_file)
    pdf = page.pdf(width="8.5in", height="11in", print_background=True, margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
    assert len(fitz.open(stream=pdf, filetype="pdf")) == 2
    page.close()


def test_site_phone_width_no_sideways_scroll(browser, site_file):
    page, errors = open_page(browser, site_file, width=390)
    assert page.evaluate("document.documentElement.scrollWidth") <= 390
    assert not errors
    page.close()


def _download(page, button):
    with page.expect_download() as d:
        page.click(button)
    return pathlib.Path(d.value.path()).read_bytes(), d.value.suggested_filename


def test_download_pdf_two_letter_pages(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.click(".field:has-text('Class') >> text=Bard")
    data, name = _download(page, "#pdf")
    assert name.endswith(".pdf") and "Bard" in name
    doc = fitz.open(stream=data, filetype="pdf")
    assert len(doc) == 2
    assert all(abs(p.rect.width - 612) < 1 and abs(p.rect.height - 792) < 1 for p in doc)
    pix = doc[1].get_pixmap(dpi=40)
    assert len(set(pix.samples[i:i + 3] for i in range(0, len(pix.samples), 3 * 97))) > 20, "page looks blank"
    assert not errors
    page.close()


def test_pdf_filename_has_name_level_class_path(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.fill("#name", "Pip/Squeak")
    page.click(".field:has-text('Class') >> text=Rogue")
    page.click(".field:has-text('Level') >> text=3")
    page.click(".field:has-text('Path') >> text=Thief")
    page.wait_for_timeout(200)
    _, name = _download(page, "#pdf")
    assert name == "PipSqueak - Level 3 Rogue (Thief).pdf"
    page.click(".field:has-text('Level') >> text=1")
    page.wait_for_timeout(200)
    _, name = _download(page, "#pdf")
    assert name == "PipSqueak - Level 1 Rogue.pdf"
    assert page.locator("#savehtml").count() == 0
    page.close()


def test_cartoon_portrait_with_credit(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.click(".field:has-text('Picture') >> text=Pixel")
    page.wait_for_selector("#scaler .portrait img")
    assert "CC0" in page.locator("#scaler .portrait .credit").inner_text()
    before = page.locator("#scaler .portrait img").get_attribute("src")
    page.click("button[aria-label='Random face']")
    page.wait_for_timeout(200)
    assert page.locator("#scaler .portrait img").get_attribute("src") != before
    page.click(".field:has-text('Picture') >> text=Remove")
    page.wait_for_timeout(200)
    assert page.locator("#scaler .portrait img").count() == 0
    assert not errors
    page.close()


def test_cartoon_portrait_offline_message(browser, site_file):
    page = browser.new_page()
    page.route("https://cdn.jsdelivr.net/**", lambda r: r.abort())
    page.add_init_script("try{localStorage.clear()}catch(e){}; window.CHARSHEET_FIXED_START = true")
    page.goto(site_file)
    page.wait_for_selector("#scaler .page.back")
    page.click(".field:has-text('Picture') >> text=Doodle")
    page.wait_for_timeout(500)
    assert "Couldn't load" in page.locator("#avatar-msg").inner_text()
    page.close()


@pytest.mark.parametrize("w,h", [(390, 844), (820, 1180), (1180, 820)])
def test_touch_devices(browser, site_file, w, h):
    ctx = browser.new_context(viewport={"width": w, "height": h}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("window.CHARSHEET_FIXED_START = true")
    page.goto(site_file)
    page.wait_for_selector("#scaler .page.back", state="attached")
    assert page.evaluate("document.documentElement.scrollWidth") <= w
    small = page.evaluate("""() => [...document.querySelectorAll('#controls button, .actions button, .tabs button')]
        .filter(b => b.offsetParent).map(b => b.getBoundingClientRect()).filter(r => r.height < 36).length""")
    assert small == 0, f"{small} buttons are too small to tap"
    if w < 980:
        assert page.locator(".tabs").is_visible()
        assert not page.locator("#preview").is_visible()
        page.tap("#tab-sheet")
        page.wait_for_timeout(200)
        assert page.locator("#preview").is_visible() and not page.locator("#controls").is_visible()
        assert page.locator("#scaler").bounding_box()["height"] > 400
        page.tap("#tab-build")
        assert page.locator("#controls").is_visible()
    else:
        assert not page.locator(".tabs").is_visible()
        assert page.locator("#preview").is_visible() and page.locator("#controls").is_visible()
    assert not errors
    ctx.close()


def test_every_inline_script_parses(site_file, tmp_path):
    """A syntax error in any inline script silently kills the page on phones."""
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    html = pathlib.Path(site_file[len("file://"):]).read_text()
    scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
    assert len(scripts) >= 4
    for i, sc in enumerate(scripts):
        f = tmp_path / f"s{i}.js"
        f.write_text(sc)
        r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
        assert r.returncode == 0, f"script {i}: {r.stderr[:300]}"


def test_boot_message_clears(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.wait_for_function("document.documentElement.dataset.booted === '1'")
    assert not page.locator("#bootmsg").is_visible()
    page.close()


def test_safari_engine_smoke(site_file):
    """Run the page in WebKit (Safari's engine) when WebKitGTK is installed."""
    import shutil
    import subprocess
    tool = pathlib.Path(__file__).resolve().parents[1] / "tools" / "webkit_check.py"
    py = shutil.which("python3.12")
    if not (py and shutil.which("xvfb-run")):
        pytest.skip("WebKitGTK runner not available")
    probe = subprocess.run([py, "-c", "import gi; gi.require_version('WebKit2','4.1')"], capture_output=True)
    if probe.returncode:
        pytest.skip("WebKitGTK not installed")
    out = subprocess.run(["xvfb-run", "-a", py, str(tool), site_file[len("file://"):], "/dev/null", "390", "844"],
                         capture_output=True, text=True, timeout=90).stdout
    line = next(l for l in out.splitlines() if l.startswith("RESULT:"))
    import json
    res = json.loads(line[len("RESULT: "):])
    assert res["errs"] == [] and res["controls"] > 5 and res["pages"] == 2, res


def test_safari_engine_makes_pdf(site_file):
    """WebKit ignores viewBox scaling for foreignObject; make sure the PDF still fills the page there."""
    import json
    import shutil
    import subprocess
    tool = pathlib.Path(__file__).resolve().parents[1] / "tools" / "webkit_check.py"
    py = shutil.which("python3.12")
    if not (py and shutil.which("xvfb-run")) or subprocess.run([py, "-c", "import gi; gi.require_version('WebKit2','4.1')"],
                                                               capture_output=True).returncode:
        pytest.skip("WebKitGTK not available")
    js = ("window.CharsheetExport.makePdf(window.Charsheet.sheetHtml(window.Charsheet.buildCharacter(window.CHARSHEET_TABLES,"
          "{name:'T',race:'elf',cls:'bard',level:3,choices:[]})),'T').then(b=>b.arrayBuffer()).then(a=>{let s='';"
          "const u=new Uint8Array(a);for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);window.__errs.push('B64:'+btoa(s))})"
          ".catch(e=>window.__errs.push('PDFERR '+e.message))")
    out = subprocess.run(["xvfb-run", "-a", py, str(tool), site_file[len("file://"):], "/dev/null", "820", "1180", js, "20000"],
                         capture_output=True, text=True, timeout=120).stdout
    line = next(l for l in out.splitlines() if l.startswith("RESULT:"))
    errs = json.loads(line[len("RESULT: "):])["errs"]
    assert errs and errs[0].startswith("B64:"), errs
    import base64
    doc = fitz.open(stream=base64.b64decode(errs[0][4:]), filetype="pdf")
    assert len(doc) == 2
    # the bottom-right of page 2 must have ink (the legend), not be empty like the old viewBox bug
    pix = doc[1].get_pixmap(dpi=30, clip=fitz.Rect(0, 700, 612, 792))
    dark = sum(1 for i in range(0, len(pix.samples), 3) if pix.samples[i] < 200)
    assert dark > 20


def test_surprise_gives_a_picture(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.click("#surprise")
    page.wait_for_selector("#scaler .portrait img")
    assert "DiceBear" in page.locator("#scaler .portrait .credit").inner_text() or "CC0" in page.locator("#scaler .portrait .credit").inner_text()
    assert not errors
    page.close()


def test_face_code_is_repeatable(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.click(".field:has-text('Picture') >> text=Big smile")
    page.wait_for_selector("#face-seed")
    page.fill("#face-seed", "grumpy-otter-7")
    page.wait_for_timeout(600)
    first = page.locator("#scaler .portrait img").get_attribute("src")
    page.click("button[aria-label='Random face']")
    page.wait_for_timeout(300)
    assert page.input_value("#face-seed") != "grumpy-otter-7"
    assert page.locator("#scaler .portrait img").get_attribute("src") != first
    page.fill("#face-seed", "grumpy-otter-7")
    page.wait_for_timeout(600)
    assert page.locator("#scaler .portrait img").get_attribute("src") == first
    assert not errors
    page.close()


def test_potion_picker(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.click(".field:has-text('Class') >> text=Fighter")
    page.click(".field:has-text('Level') >> text=5")
    page.wait_for_timeout(200)
    field = page.locator(".field:has-text('Potions & Magic Items')")
    assert field.locator("li.spell").count() == 3
    assert page.locator("#scaler .back .sec:has-text('Potions & Magic Items') .cd").count() == 3
    first = field.locator("button.sname b").first.inner_text()
    field.locator("button.sname").first.click()
    page.wait_for_timeout(200)
    page.locator(".picker .popt:not(.on)").first.click()
    page.wait_for_timeout(200)
    assert field.locator("button.sname b").first.inner_text() != first
    page.click("button[aria-label='Random potions']")
    page.wait_for_timeout(200)
    assert field.locator("li.spell").count() == 3
    page.click(".field:has-text('Class') >> text=Wizard")
    page.wait_for_timeout(200)
    assert page.locator(".field:has-text('Potions & Magic Items') li.spell").count() == 0
    assert not errors
    page.close()



def test_ability_score_editor(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.click("details.adv summary")
    f = page.locator(".field:has-text('Ability scores')")
    assert "27 of 27" in f.locator(".pbline").first.inner_text()
    before = page.locator("#scaler .front .ab").first.inner_text()
    page.click("button[aria-label='Raise Strength']")
    page.wait_for_timeout(200)
    assert "28 of 27" in f.locator(".pbline").first.inner_text()
    assert page.locator("#scaler .front .ab").first.inner_text() != before
    while page.locator("button[aria-label='Lower Strength']").is_enabled():
        page.click("button[aria-label='Lower Strength']")
    page.wait_for_timeout(200)
    assert "off the point-buy chart" in f.locator(".pbline").first.inner_text()
    assert page.locator("button[aria-label='Lower Strength']").is_disabled()
    f.locator(".link:text('reset')").click()
    page.wait_for_timeout(200)
    assert "27 of 27" in f.locator(".pbline").first.inner_text()
    page.click("button[aria-label='Random stats']")
    page.wait_for_timeout(200)
    assert "27 of 27" in f.locator(".pbline").first.inner_text()
    assert not errors
    page.close()



def test_armor_picker_and_fine_tune_is_tucked_away(browser, site_file):
    page, errors = open_page(browser, site_file)
    assert not page.locator(".field:has-text('Ability scores')").is_visible()  # collapsed by default
    page.click(".field:has-text('Class') >> text=Fighter")
    page.click("details.adv summary")
    page.wait_for_timeout(200)
    tile = page.locator("#scaler .back .tile").first
    assert "Plate armor" in tile.inner_text()  # default hero is level 5
    page.click("details.adv >> text=/Chain shirt/")
    page.wait_for_timeout(200)
    assert "Chain shirt" in tile.inner_text()
    page.click("details.adv >> text=Shield +2")
    page.wait_for_timeout(200)
    assert "shield" not in tile.inner_text().lower()
    page.click(".field:has-text('Armor') .link:text('reset')")
    page.wait_for_timeout(200)
    assert "Plate armor + shield" in tile.inner_text()
    page.click(".field:has-text('Class') >> text=Wizard")
    page.wait_for_timeout(200)
    assert page.locator("details.adv .field:has-text('Armor') .armrow").count() == 1  # only "No armor"
    assert not errors
    page.close()


def test_subrace_picker_is_tucked_away(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.click(".field:has-text('Race') >> text=\"Dwarf\"")
    page.wait_for_timeout(200)
    assert not page.locator("details.adv .field:has-text('Subrace')").is_visible()
    assert "Hill Dwarf" in page.locator("#scaler").inner_text()
    page.click("details.adv summary")
    page.click("details.adv .field:has-text('Subrace') >> text=Mountain Dwarf")
    page.wait_for_timeout(200)
    txt = page.locator("#scaler").inner_text()
    assert "Mountain Dwarf" in txt and "Dwarven Armor Training" in txt
    page.click(".field:has-text('Race') >> text=Elf")
    page.wait_for_timeout(200)
    assert "Wood Elf" in page.locator("#scaler").inner_text()  # switching race goes back to the usual subrace
    assert not errors
    page.close()


def _hover_tip(page, sel):
    page.mouse.move(0, 0)
    page.locator(sel).scroll_into_view_if_needed()
    page.wait_for_timeout(250)
    page.hover(sel)
    page.wait_for_timeout(500)
    tip = page.locator("#tip")
    return tip.inner_text() if tip.is_visible() else ""


def test_tooltips_explain_choices(browser, site_file):
    page, errors = open_page(browser, site_file)
    assert "Darkvision" in _hover_tip(page, ".field:has-text('Race') >> text=\"Dwarf\"")
    assert "hit die" in _hover_tip(page, ".field:has-text('Class') >> text=Wizard")
    assert "HP" in _hover_tip(page, ".field:has-text('Level') .chip-btn >> nth=2")
    page.click(".field:has-text('Class') >> text=Fighter")
    page.wait_for_timeout(200)
    assert "Armor" in _hover_tip(page, ".field:has-text('Fighting') .chip-btn >> nth=0")
    page.click("details.adv summary")
    page.wait_for_timeout(200)
    assert "Strength 15" in _hover_tip(page, "details.adv .chip-btn >> text=/Plate armor/")
    t = _hover_tip(page, "details.adv .chip-btn >> text=Mountain Dwarf")
    assert "+2 Strength" in t and "Dwarven Armor Training" in t
    page.mouse.move(0, 0)
    page.wait_for_timeout(300)
    assert not page.locator("#tip").is_visible()
    assert not errors
    page.close()


def test_press_and_hold_shows_tip_without_picking(browser, site_file):
    page, errors = open_page(browser, site_file)
    btn = page.locator(".field:has-text('Race') >> text=\"Gnome\"")
    btn.dispatch_event("pointerdown", {"pointerType": "touch", "isPrimary": True, "bubbles": True})
    page.wait_for_timeout(700)
    assert page.locator("#tip").is_visible() and "Gnome" in page.locator("#tip").inner_text()
    btn.dispatch_event("pointerup", {"pointerType": "touch", "isPrimary": True, "bubbles": True})
    btn.dispatch_event("click")
    page.wait_for_timeout(200)
    assert btn.get_attribute("aria-pressed") == "false"  # holding only explains, it doesn't pick
    btn.dispatch_event("pointerdown", {"pointerType": "touch", "isPrimary": True, "bubbles": True})
    btn.dispatch_event("pointerup", {"pointerType": "touch", "isPrimary": True, "bubbles": True})
    btn.dispatch_event("click")
    page.wait_for_timeout(200)
    assert page.locator(".field:has-text('Race') >> text=\"Gnome\"").get_attribute("aria-pressed") == "true"  # a quick tap still picks
    assert not errors
    page.close()


def test_first_visit_is_a_random_hero_and_start_over_rerolls(browser, site_file):
    seen = set()
    for _ in range(4):
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()
        page.route("https://cdn.jsdelivr.net/npm/@dicebear/**", _dicebear)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(site_file)
        page.wait_for_selector("#scaler .page.back", state="attached")
        page.wait_for_timeout(300)
        seen.add(page.locator("#scaler .front").inner_text()[:60])
        assert page.locator(".field:has-text('Picture') .pic > .chips .chip-btn.on").count() == 1  # a random face too
        assert not errors
        ctx.close()
    assert len(seen) > 1
    page, errors = open_page(browser, site_file)
    page.click("#surprise")
    page.wait_for_timeout(300)
    book = page.evaluate("JSON.parse(localStorage.getItem('charsheet-heroes-v1'))")
    assert len(book["heroes"]) == 1 and not book["heroes"][0]["edited"]  # an untouched default gets re-rolled in place
    page.close()


def test_weapon_pick_and_free_race_bonus(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.click(".field:has-text('Class') >> text=Fighter")
    page.click("details.adv summary")
    page.wait_for_timeout(200)
    page.click(".field:has-text('Main weapon') .chip-btn >> text=/^Maul/")
    page.wait_for_timeout(200)
    back = page.locator("#scaler .back").inner_text()
    assert "Maul" in back and "shield" not in page.locator("#scaler .back .tile").first.inner_text().lower()
    page.click("details.adv >> text=Shield +2")  # picking the shield puts the one-hander back
    page.wait_for_timeout(200)
    assert "Longsword" in page.locator("#scaler .back").inner_text()
    str_box = lambda: page.locator("#scaler .front").inner_text()
    before = page.locator(".abrow:has-text('STR') .abfinal").inner_text()
    page.click("button[aria-label='Raise race bonus for Strength']")
    page.wait_for_timeout(200)
    after = page.locator(".abrow:has-text('STR') .abfinal").inner_text()
    assert int(after.split()[0]) == int(before.split()[0]) + 1
    assert "check with your DM" in page.locator(".field:has-text('Ability scores')").inner_text()
    page.click("text=usual race bonus")
    page.wait_for_timeout(200)
    assert page.locator(".abrow:has-text('STR') .abfinal").inner_text() == before
    assert "best" not in page.locator("#controls").inner_text().lower()
    assert not errors
    page.close()


def test_picture_look_follows_name(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.fill("#name", "Olivia")
    page.click(".field:has-text('Picture') >> text=Adventurer")
    page.wait_for_timeout(600)
    pic = page.locator(".field:has-text('Picture')")
    assert pic.locator(".chip-btn.on:text('Girl')").count() == 1 and "matches the name" in pic.inner_text()
    page.fill("#name", "Henry")
    page.wait_for_timeout(1000)
    assert pic.locator(".chip-btn.on:text('Boy')").count() == 1
    page.fill("#name", "Zorblax")
    page.wait_for_timeout(1000)
    assert "coin flip" in pic.inner_text()
    page.click(".field:has-text('Picture') .chip-btn:text('Girl')")
    page.wait_for_timeout(600)
    assert pic.locator(".chip-btn.on:text('Girl')").count() == 1 and "match name" in pic.inner_text()
    assert not errors
    page.close()


CUSTOM = (pathlib.Path(__file__).parent / "fixtures" / "custom" / "hero-custom.json").read_text()



def test_custom_file_can_be_loaded_and_problems_are_shown(browser, site_file, tmp_path):
    page, errors = open_page(browser, site_file)
    assert page.locator(".field:has-text('Race') .chip-btn:has-text('Turtle-folk')").count() == 0
    page.click("details.custom summary")
    page.fill("#custom-paste", CUSTOM)  # pasting works the same as loading a file
    page.click("text=Add pasted pack")
    page.wait_for_timeout(800)
    assert page.locator(".field:has-text('Race') .chip-btn:has-text('Turtle-folk')").count() == 1
    assert "✓" in page.locator("details.custom").inner_text()
    bad = tmp_path / "bad.json"
    bad.write_text('{"races": [{"id": "x", "name": "X", "desc": "oops"}]}')
    page.set_input_files("#custom-file", str(bad))
    page.wait_for_timeout(800)
    assert "unknown field" in page.locator("details.custom").inner_text()
    broken = tmp_path / "broken.json"
    broken.write_text('{"features": [{"owner_kind": "race", "owner_id": "human", "card": {"name": "Zap", "desc": "{NOPE} damage"}}]}')
    page.set_input_files("#custom-file", str(broken))
    page.wait_for_timeout(1500)
    assert "NOPE" in page.locator("details.custom").inner_text()
    assert "wasn't added" in page.locator("details.custom").inner_text()
    page.locator("details.custom .customlist .link:text('remove')").first.click()  # the good pack is still there; remove it
    page.wait_for_timeout(500)
    assert page.locator(".field:has-text('Race') .chip-btn:has-text('Turtle-folk')").count() == 0  # its content is gone
    assert not errors
    page.close()


def test_custom_content_from_a_link(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.route("https://example.test/pack.js", lambda r: r.fulfill(status=200, body=CUSTOM,
               headers={"content-type": "text/plain", "access-control-allow-origin": "*"}))
    page.route("https://nocors.test/pack.js", lambda r: r.abort())  # what a blocked (no CORS) read looks like to the page
    page.click("details.custom summary")
    page.fill("#custom-url", "https://nocors.test/pack.js")
    page.click("text=Load link")
    page.wait_for_timeout(800)
    assert "Couldn't read that link" in page.locator("details.custom").inner_text()
    page.fill("#custom-url", "https://example.test/pack.js")
    page.click("text=Load link")
    page.wait_for_timeout(1000)
    assert page.locator(".field:has-text('Race') .chip-btn:has-text('Turtle-folk')").count() == 1
    assert "Checked for updates" in page.locator("details.custom").inner_text()
    # opening again re-reads the saved link
    page.click("text=forget link")
    page.wait_for_timeout(500)
    assert page.locator(".field:has-text('Race') .chip-btn:has-text('Turtle-folk')").count() == 0
    assert not errors
    page.close()


def test_saved_heroes_keep_hand_made_ones_apart_from_dice_rolls(browser, site_file):
    ctx = browser.new_context(viewport={"width": 1400, "height": 900})
    page = ctx.new_page()
    page.route("https://cdn.jsdelivr.net/npm/@dicebear/**", _dicebear)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(site_file)
    page.wait_for_timeout(800)
    book = lambda: page.evaluate("JSON.parse(localStorage.getItem('charsheet-heroes-v1'))")
    assert [h["edited"] for h in book()["heroes"]] == [False]  # first visit: one random roll, not "yours"
    page.fill("#name", "Dragen")
    page.wait_for_timeout(600)
    assert [h["edited"] for h in book()["heroes"]] == [True]  # changed by hand: it's yours now
    page.click("#surprise")
    page.wait_for_timeout(800)
    page.click("#surprise")  # an untouched roll gets re-rolled in place, so no pile-up
    page.wait_for_timeout(800)
    b = book()
    assert len(b["heroes"]) == 2 and sorted(h["edited"] for h in b["heroes"]) == [False, True]
    page.click("#heroes-btn")
    page.wait_for_timeout(200)
    panel = page.locator(".field.heroes")
    assert "Dragen" in panel.locator(":scope > .herolist").inner_text()
    assert "Random rolls (1)" in panel.inner_text()
    panel.locator(".heroname:has-text('Dragen')").click()
    page.wait_for_timeout(300)
    assert page.locator("#name").input_value() == "Dragen"
    page.reload()
    page.wait_for_timeout(800)
    assert page.locator("#name").input_value() == "Dragen"  # comes back to the last hero you had open
    assert not errors
    ctx.close()


TOBIN = (pathlib.Path(__file__).resolve().parents[1] / "examples" / "tobin-flame-master.json").read_text()


def test_tobin_pack_rebuilds_the_original_flame_master(browser, site_file, tmp_path):
    page, errors = open_page(browser, site_file)
    page.click("details.custom summary")
    f = tmp_path / "tobin.json"
    f.write_text(TOBIN)
    page.set_input_files("#custom-file", str(f))
    page.wait_for_timeout(2500)
    assert "\u26a0" not in page.locator("details.custom").inner_text()
    page.click("text=Start as Tobin aka Flame Master")
    page.wait_for_timeout(500)
    back = page.locator("#scaler .back").inner_text()
    front = page.locator("#scaler .front").inner_text()
    for want in ["48", "Breastplate", "Flame Blast", "1d10+4", "Dragon Strike", "Fireball", "8d6", "4d10", "DC 15", "Potion of Spider Climb"]:
        assert want in back, want
    tiles = page.locator("#scaler .back .tile").all_inner_texts()
    assert any(t.startswith("16") for t in tiles) and any(t.startswith("+5") for t in tiles)  # Armor 16, initiative +5
    for want in ["Tobin aka Flame Master", "Hill Dwarf", "Warlock (The Fiend)", "19", "Intimidation"]:
        assert want in front, want
    assert page.locator("#scaler .portrait img").count() == 1
    assert not errors
    page.close()


def test_any_item_can_be_picked_with_a_dm_warning(browser, site_file):
    page, errors = open_page(browser, site_file)
    page.click(".field:has-text('Class') >> text=Fighter")
    page.click(".field:has-text('Level') .chip-btn >> nth=0")
    page.wait_for_timeout(200)
    field = page.locator(".field:has-text('Potions & Magic Items')")
    field.locator(".sname").first.click()
    page.wait_for_timeout(200)
    opt = page.locator(".picker .popt:has-text('Necklace of Fireballs')")
    assert "Talk to your DM" in opt.inner_text()  # rare at level 1: allowed, but flagged
    opt.click()
    page.wait_for_timeout(300)
    assert "Necklace of Fireballs" in page.locator("#scaler .back").inner_text()
    warn = field.locator(".icon.warn")
    assert warn.count() == 1
    warn.click()
    page.wait_for_timeout(200)
    assert "level 5 and up" in page.locator("#tip").inner_text()
    assert not errors
    page.close()


def test_level_hint_and_pixel_is_the_default_face(browser, site_file):
    page, errors = open_page(browser, site_file)
    assert "ask your DM what level to start at" in page.locator(".field:has-text('Level')").first.inner_text()
    page.click("#surprise")
    page.wait_for_timeout(800)
    assert page.locator(".field:has-text('Picture') .pic > .chips .chip-btn.on").inner_text() == "Pixel"
    assert not errors
    page.close()


def test_a_hero_keeps_its_own_pack(browser, site_file, tmp_path):
    page, errors = open_page(browser, site_file)
    page.click("details.custom summary")
    f = tmp_path / "tobin.json"
    f.write_text(TOBIN)
    page.set_input_files("#custom-file", str(f))
    page.wait_for_timeout(2500)
    page.click("text=Start as Tobin aka Flame Master")
    page.wait_for_timeout(500)
    page.click("#surprise")  # go make someone else
    page.wait_for_timeout(800)
    page.click("details.custom summary") if not page.locator("details.custom[open]").count() else None
    page.locator("details.custom .customlist .link:text('remove')").first.click()  # throw the pack away
    page.wait_for_timeout(1000)
    assert page.locator(".field:has-text('Class') .chip-btn:has-text('\u2726')").count() == 0
    page.click("#heroes-btn")
    page.locator(".heroname:has-text('Tobin aka Flame Master')").click()  # Tobin brings his pack back with him
    page.wait_for_timeout(2500)
    back = page.locator("#scaler .back").inner_text()
    assert "Flame Blast" in back and "Dragon Strike" in back and "48" in back
    assert not errors
    page.close()


# a self-contained pack: its own race and class, so it can stand in for the built-in content
SOLO_PACK = ('{"title": "Solo World", "races": [{"id": "bot", "name": "Robot"}], '
             '"classes": [{"id": "scav", "name": "Scavenger", '
             '"weapons": [{"name": "Zap Stick", "die": "1d6", "ability": "STR", "kind": "melee", "hands": "one", "note": ""}]}]}')


def test_builtin_content_is_a_source_you_can_leave_out(browser, site_file, tmp_path):
    page, errors = open_page(browser, site_file)
    page.click("details.custom summary")
    f = tmp_path / "solo.json"
    f.write_text(SOLO_PACK)
    page.set_input_files("#custom-file", str(f))
    page.wait_for_timeout(1500)
    # the built-in content and the pack are both offered (Tiefling has no subrace, so it matches cleanly)
    assert page.locator(".field:has-text('Race') .chip-btn:has-text('Tiefling')").count() == 1
    assert page.locator(".field:has-text('Race') .chip-btn:has-text('Robot')").count() == 1
    # leave the built-in content out: only the pack's content is left
    page.uncheck("#use-builtin")
    page.wait_for_timeout(800)
    assert page.locator(".field:has-text('Race') .chip-btn:has-text('Tiefling')").count() == 0
    assert page.locator(".field:has-text('Race') .chip-btn:has-text('Robot')").count() == 1
    assert page.locator(".field:has-text('Class') .chip-btn:has-text('Scavenger')").count() == 1
    assert page.locator("#scaler .page").count() == 2  # it still builds a 2-page sheet
    # put it back
    page.check("#use-builtin")
    page.wait_for_timeout(800)
    assert page.locator(".field:has-text('Race') .chip-btn:has-text('Tiefling')").count() == 1
    assert not errors
    page.close()


def test_toggling_content_keeps_a_hand_edited_hero_safe(browser, site_file, tmp_path):
    page, errors = open_page(browser, site_file)
    page.click("details.custom summary")
    f = tmp_path / "solo.json"
    f.write_text(SOLO_PACK)
    page.set_input_files("#custom-file", str(f))
    page.wait_for_timeout(1500)
    page.click(".field:has-text('Race') >> text=Tiefling")  # hand-pick a built-in race: now it's "yours"
    page.wait_for_timeout(400)
    page.uncheck("#use-builtin")  # the edited hero no longer fits the content
    page.wait_for_timeout(1200)
    assert "safe in Saved heroes" in page.locator("#status").inner_text()
    assert "Scavenger" in page.locator(".field:has-text('Class') .chip-btn[aria-pressed='true']").first.inner_text()  # the fresh hero uses the pack
    page.click("#heroes-btn")
    page.wait_for_timeout(300)
    assert page.locator(".heroname").count() >= 2  # the edited hero is kept alongside the new roll
    assert not errors
    page.close()


def test_works_fully_offline_from_the_single_file(browser, site_file):
    """The whole builder is in the one HTML file; with every network request blocked it still makes a sheet."""
    ctx = browser.new_context(viewport={"width": 1400, "height": 900}, offline=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**", lambda r: r.abort() if r.request.url.startswith(("http://", "https://")) else r.continue_())
    page.add_init_script("try{localStorage.clear()}catch(e){}; window.CHARSHEET_FIXED_START = true")
    page.goto(site_file)
    page.wait_for_selector("#scaler .page.back", state="attached")
    assert page.locator("#scaler .page").count() == 2
    page.click(".field:has-text('Class') >> text=Wizard")
    page.wait_for_timeout(200)
    assert "Wizard" in page.locator("#scaler .back .bhead").inner_text()
    assert not errors
    page.close()
    ctx.close()


def test_hosted_site_lists_and_loads_packs_next_to_it(browser, tmp_path):
    """What GitHub Pages would serve: index.html + packs/. Packs come from the same site, so no link pasting."""
    import http.server
    import threading
    from charsheet.site import build_pages
    html = build_site(default_tables(), (WEB / "core.js").read_text(), (WEB / "app.js").read_text(), standalone=True,
                      assets=load_assets(), export_js=(WEB / "export.js").read_text(), custom_js=(WEB / "custom.js").read_text(),
                      guide_md=(WEB.parent / "CUSTOM_CONTENT_GUIDE.md").read_text())
    build_pages(tmp_path, html, WEB.parent / "examples")
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(tmp_path), **k)  # noqa: E731
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    try:
        page, errors = open_page(browser, base)
        page.click("details.custom summary")
        page.wait_for_timeout(500)
        box = page.locator("details.custom")
        assert "Packs on this site" in box.inner_text() and "Tobin aka Flame Master" in box.inner_text()
        box.locator("li:has-text('Turtles & Pirates') .link:text('add')").click()
        page.wait_for_timeout(2000)
        assert page.locator(".field:has-text('Race') .chip-btn:has-text('Turtle-folk')").count() == 1
        page.close()
        # ?pack=name adds that pack straight away (a link you can hand out)
        page, errors = open_page(browser, base + "?pack=tobin-flame-master")
        page.wait_for_timeout(3000)
        page.click("details.custom summary") if not page.locator("details.custom[open]").count() else None
        assert page.locator("button:has-text('Start as Tobin aka Flame Master')").count() == 1
        assert not errors
        page.close()
    finally:
        srv.shutdown()
