"""Make a character sheet PDF.

  python -m charsheet --name Tobin --race dwarf --cls warlock --subclass fiend --level 5 \
      --choice invocations="Agonizing Blast,Fiendish Vigor,Eldritch Spear" --out tobin.pdf
  python -m charsheet --list
"""
import argparse
import base64
import mimetypes
import sys
from pathlib import Path

import polars as pl

from .build import build_character, make_request
from .data import default_tables
from .render import load_assets, render_html, render_pdf


def main(argv=None):
    p = argparse.ArgumentParser(prog="charsheet")
    p.add_argument("--name", default="Hero")
    p.add_argument("--race", default="human")
    p.add_argument("--cls", default="fighter")
    p.add_argument("--subclass")
    p.add_argument("--level", type=int, default=1)
    p.add_argument("--choice", action="append", default=[], help='group="Pick A,Pick B"')
    p.add_argument("--spells", help="comma list (otherwise picked for you)")
    p.add_argument("--cantrips", help="comma list (otherwise picked for you)")
    p.add_argument("--inventory", help="comma list (otherwise class gear)")
    p.add_argument("--notes", default="")
    p.add_argument("--portrait", help="image file for the portrait box")
    p.add_argument("--out", default="character.pdf")
    p.add_argument("--html", help="also save the HTML here")
    p.add_argument("--list", action="store_true", help="show races, classes, subclasses and choice groups")
    p.add_argument("--custom", help="custom content JSON file (see CUSTOM_CONTENT_GUIDE.md)")
    a = p.parse_args(argv)
    t = default_tables()
    if a.custom:
        from .custom import merge_custom, parse_custom_text
        t = merge_custom(t, parse_custom_text(Path(a.custom).read_text()))
    if a.list:
        print("races:", ", ".join(t["races"]["id"]))
        for c in t["classes"].iter_rows(named=True):
            subs = t["subclasses"].filter(pl.col("class_id") == c["id"])["id"].to_list()
            print(f"{c['id']:<10} subclasses: {', '.join(subs)}")
        for c in t["choices"].iter_rows(named=True):
            print(f"choice {c['group']:<18} ({c['owner_kind']} {c['owner_id']}): " + " | ".join(o["name"] for o in c["options"]))
        return 0
    split = lambda s: [x.strip() for x in s.split(",") if x.strip()] if s else None  # noqa: E731
    choices = {}
    for c in a.choice:
        k, _, v = c.partition("=")
        choices[k.strip()] = split(v)
    portrait = None
    if a.portrait:
        mime = mimetypes.guess_type(a.portrait)[0] or "image/png"
        portrait = f"data:{mime};base64," + base64.b64encode(Path(a.portrait).read_bytes()).decode()
    ch = build_character(t, make_request(name=a.name, race=a.race, cls=a.cls, subclass=a.subclass, level=a.level,
                                         choices=choices, spells=split(a.spells), cantrips=split(a.cantrips),
                                         inventory=split(a.inventory), notes=a.notes, portrait=portrait))
    html = render_html(ch, load_assets())
    if a.html:
        Path(a.html).write_text(html)
    pdf, info = render_pdf(html)
    Path(a.out).write_bytes(pdf)
    print(f"wrote {a.out} (back page text {info['fs']}px, fit: {info['fit']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
