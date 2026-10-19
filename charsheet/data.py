"""Default rules tables (5e-flavoured, simplified for kids, levels 1-7).

Everything the builder knows lives in these DataFrames. `build.build_character`
never reads anything else, so you can swap any table for your own.

Text uses {PLACEHOLDERS}. Generic ones are computed by the builder
(LVL, PROF, HALFPROF, STR..CHA signed mods, STRN..CHAN raw mods, SPATK, DC, MOD, CD).
Everything else comes from the `scaling` table (one value per level).
Tags: A action, B bonus action, R reaction, ON always on, F free.
"""
from __future__ import annotations

import polars as pl

ABILS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"]
L7 = lambda *v: list(v)  # noqa: E731  (7 values, one per level)


def _rows(rows, schema):
    return pl.DataFrame(rows, schema=schema, orient="row") if rows else pl.DataFrame(schema=schema)


# --------------------------------------------------------------------------- rules
def rules_table() -> pl.DataFrame:
    return pl.DataFrame([{
        "standard_array": [15, 14, 13, 12, 10, 8],
        "prof_by_level": [2, 2, 2, 2, 3, 3, 3],
        "cantrip_dice": [1, 1, 1, 1, 2, 2, 2],
        "asi": {"amount": 2, "cap": 20},
        "dc_base": 8,
        "max_level": 7,
        # potions & magic items: how many a hero may carry, and the "things to do" floor that
        # default potions top up (counts action + bonus-action powers, not spells or attacks)
        "item_slots": [1, 1, 2, 2, 3, 3, 4],
        "option_floor": [4, 4, 5, 5, 6, 6, 7],
        # point-buy price of scores 8..15 (shown in the builder, never enforced)
        "point_buy": {"low": 8, "costs": [0, 1, 2, 3, 4, 5, 7, 9], "budget": 27},
    }])


def skills_table() -> pl.DataFrame:
    s = [("Acrobatics", "DEX"), ("Animal Handling", "WIS"), ("Arcana", "INT"), ("Athletics", "STR"),
         ("Deception", "CHA"), ("History", "INT"), ("Insight", "WIS"), ("Intimidation", "CHA"),
         ("Investigation", "INT"), ("Medicine", "WIS"), ("Nature", "INT"), ("Perception", "WIS"),
         ("Performance", "CHA"), ("Persuasion", "CHA"), ("Religion", "INT"), ("Sleight of Hand", "DEX"),
         ("Stealth", "DEX"), ("Survival", "WIS")]
    return pl.DataFrame({"name": [a for a, _ in s], "ability": [b for _, b in s]})


def slots_table() -> pl.DataFrame:
    # slots[i] = number of spell slots of spell level i+1
    full = [[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1]]
    half = [[], [2], [3], [3], [4, 2], [4, 2], [4, 3]]
    pact = [[1], [2], [0, 2], [0, 2], [0, 0, 2], [0, 0, 2], [0, 0, 0, 2]]
    rows = []
    for kind, table, rest in (("full", full, "long"), ("half", half, "long"), ("pact", pact, "short")):
        for i, s in enumerate(table):
            rows.append({"kind": kind, "level": i + 1, "slots": s, "rest": rest})
    for i in range(7):
        rows.append({"kind": "none", "level": i + 1, "slots": [], "rest": "long"})
    return pl.DataFrame(rows, schema={"kind": pl.Utf8, "level": pl.Int64, "slots": pl.List(pl.Int64), "rest": pl.Utf8})


# --------------------------------------------------------------------------- races
def races_table() -> pl.DataFrame:
    def asi(**k):
        return {a: k.get(a, 0) for a in ABILS}
    r = [
        ("human", "Human", 30, asi(STR=1, DEX=1, CON=1, INT=1, WIS=1, CHA=1), [], 0, "Common + one more"),
        ("dwarf", "Dwarf", 25, asi(CON=2), [], 0, "Common, Dwarvish"),
        ("elf", "Elf", 30, asi(DEX=2), ["Perception"], 0, "Common, Elvish"),
        ("halfling", "Halfling", 25, asi(DEX=2), [], 0, "Common, Halfling"),
        ("gnome", "Gnome", 25, asi(INT=2), [], 0, "Common, Gnomish"),
        ("halforc", "Half-Orc", 30, asi(STR=2, CON=1), ["Intimidation"], 0, "Common, Orc"),
        ("tiefling", "Tiefling", 30, asi(CHA=2, INT=1), [], 0, "Common, Infernal"),
        ("dragonborn", "Dragonborn", 30, asi(STR=2, CHA=1), [], 0, "Common, Draconic"),
    ]
    return pl.DataFrame(
        [{"id": a, "name": b, "speed": c, "asi": d, "skills": e, "hp_per_level": f, "languages": g} for a, b, c, d, e, f, g in r],
        schema={"id": pl.Utf8, "name": pl.Utf8, "speed": pl.Int64,
                "asi": pl.Struct({a: pl.Int64 for a in ABILS}), "skills": pl.List(pl.Utf8),
                "hp_per_level": pl.Int64, "languages": pl.Utf8})


# --------------------------------------------------------------------------- subraces (first one per race is the default)
SUBRACE_SCHEMA = {"id": pl.Utf8, "race_id": pl.Utf8, "name": pl.Utf8, "asi": pl.Struct({a: pl.Int64 for a in ABILS}),
                  "speed": pl.Int64, "hp_per_level": pl.Int64, "skills": pl.List(pl.Utf8), "armor_prof_add": pl.List(pl.Utf8)}


def subraces_table() -> pl.DataFrame:
    def asi(**k):
        return {a: k.get(a, 0) for a in ABILS}
    r = [("hill", "dwarf", "Hill Dwarf", asi(WIS=1), 0, 1, [], []),
         ("mountain", "dwarf", "Mountain Dwarf", asi(STR=2), 0, 0, [], ["light", "medium"]),
         ("wood", "elf", "Wood Elf", asi(WIS=1), 5, 0, [], []),
         ("high", "elf", "High Elf", asi(INT=1), 0, 0, [], []),
         ("lightfoot", "halfling", "Lightfoot Halfling", asi(CHA=1), 0, 0, [], []),
         ("stout", "halfling", "Stout Halfling", asi(CON=1), 0, 0, [], []),
         ("rock", "gnome", "Rock Gnome", asi(CON=1), 0, 0, [], []),
         ("forest", "gnome", "Forest Gnome", asi(DEX=1), 0, 0, [], [])]
    return pl.DataFrame([dict(zip(SUBRACE_SCHEMA, x)) for x in r], schema=SUBRACE_SCHEMA)


# --------------------------------------------------------------------------- classes
WEAPON = pl.Struct({"name": pl.Utf8, "die": pl.Utf8, "ability": pl.Utf8, "kind": pl.Utf8, "hands": pl.Utf8, "note": pl.Utf8})
ARMOR = pl.Struct({"base": pl.Int64, "dex_cap": pl.Int64, "add": pl.List(pl.Utf8), "shield": pl.Int64, "worn": pl.Boolean})
CASTER = pl.Struct({"kind": pl.Utf8, "ability": pl.Utf8, "cantrips": pl.List(pl.Int64), "mode": pl.Utf8,
                    "known": pl.List(pl.Int64), "level_mult": pl.Float64, "cap": pl.Int64})


def W(name, die, ability, kind="melee", hands="one", note=""):
    return {"name": name, "die": die, "ability": ability, "kind": kind, "hands": hands, "note": note}


def A(base, dex_cap=99, add=(), shield=0, worn=True):
    return {"base": base, "dex_cap": dex_cap, "add": list(add), "shield": shield, "worn": worn}


def C(kind="none", ability="", cantrips=(0,) * 7, mode="none", known=(0,) * 7, level_mult=0.0, cap=0):
    return {"kind": kind, "ability": ability, "cantrips": list(cantrips), "mode": mode, "known": list(known),
            "level_mult": level_mult, "cap": cap}


CLASS_SCHEMA = {
    "id": pl.Utf8, "name": pl.Utf8, "hit_die": pl.Int64, "primary": pl.List(pl.Utf8), "saves": pl.List(pl.Utf8),
    "skills": pl.List(pl.Utf8), "expertise": pl.List(pl.Struct({"lvl": pl.Int64, "skills": pl.List(pl.Utf8)})),
    "armor": ARMOR,  # unarmored defense: base + DEX + listed abilities
    "armor_prof": pl.List(pl.Utf8), "shield_prof": pl.Boolean, "shield_default": pl.Boolean,
    "weapons": pl.List(WEAPON), "caster": CASTER, "spell_order": pl.List(pl.Utf8),
    "cantrip_order": pl.List(pl.Utf8), "subclass_level": pl.Int64, "asi_levels": pl.List(pl.Int64),
    "speed_bonus": pl.List(pl.Int64),
    "weapon_prof": pl.List(pl.Utf8),  # "simple"/"martial" or exact weapon names
    "melee_slot": pl.Int64,  # which entry of `weapons` is the swappable main melee weapon (-1 = none)
    "look": pl.Struct({"accent": pl.Utf8, "tagline": pl.Utf8}), "gear": pl.List(pl.Utf8),
}


def classes_table() -> pl.DataFrame:
    rows = [
        dict(id="barbarian", weapon_prof=['simple', 'martial'], melee_slot=0, name="Barbarian", hit_die=12, primary=["STR", "CON", "DEX", "WIS", "CHA", "INT"],
             saves=["STR", "CON"], skills=["Athletics", "Survival"], expertise=[],
             armor=A(10, 99, ["CON"], 0, False), armor_prof=["light", "medium"], shield_prof=True, shield_default=False,
             weapons=[W("Greataxe", "1d12", "STR", hands="two"), W("Handaxe (x2)", "1d6", "STR", note="throw 20 ft")],
             caster=C(), spell_order=[], cantrip_order=[], subclass_level=3, asi_levels=[4],
             speed_bonus=L7(0, 0, 0, 0, 10, 10, 10),
             look={"accent": "#c0392b", "tagline": "Big, loud, and VERY hard to knock down."},
             gear=["Greataxe", "2 handaxes", "Explorer's pack", "4 javelins"]),
        dict(id="bard", weapon_prof=['simple', 'Hand crossbow', 'Longsword', 'Rapier', 'Shortsword'], melee_slot=0, name="Bard", hit_die=8, primary=["CHA", "DEX", "CON", "WIS", "INT", "STR"],
             saves=["DEX", "CHA"], skills=["Performance", "Persuasion", "Deception"],
             expertise=[{"lvl": 3, "skills": ["Performance", "Persuasion"]}],
             armor=A(10, 99, [], 0, False), armor_prof=["light"], shield_prof=False, shield_default=False, weapons=[W("Rapier", "1d8", "FIN")],
             caster=C("full", "CHA", L7(2, 2, 2, 3, 3, 3, 3), "known", L7(4, 5, 6, 7, 8, 9, 10)),
             spell_order=["Healing Word", "Dissonant Whispers", "Faerie Fire", "Tasha's Hideous Laughter", "Heat Metal",
                          "Shatter", "Hypnotic Pattern", "Greater Invisibility", "Invisibility", "Dispel Magic", "Sleep",
                          "Thunderwave", "Heroism", "Cure Wounds", "Hold Person", "Suggestion", "Silence", "Polymorph",
                          "Dimension Door", "Charm Person", "Feather Fall", "Speak with Animals", "Lesser Restoration"],
             cantrip_order=["Vicious Mockery", "Minor Illusion", "Mage Hand", "Prestidigitation", "Light"],
             subclass_level=3, asi_levels=[4], speed_bonus=L7(0, 0, 0, 0, 0, 0, 0),
             look={"accent": "#c2307a", "tagline": "Music, jokes, and magic that makes friends stronger."},
             gear=["Rapier", "Lute", "Entertainer's pack"]),
        dict(id="cleric", weapon_prof=['simple'], melee_slot=0, name="Cleric", hit_die=8, primary=["WIS", "CON", "STR", "DEX", "CHA", "INT"],
             saves=["WIS", "CHA"], skills=["Insight", "Medicine"], expertise=[],
             armor=A(10, 99, [], 0, False), armor_prof=["light", "medium"], shield_prof=True, shield_default=True, weapons=[W("Mace", "1d6", "STR")],
             caster=C("full", "WIS", L7(3, 3, 3, 4, 4, 4, 4), "prepared", level_mult=1.0, cap=4),
             spell_order=["Healing Word", "Guiding Bolt", "Spiritual Weapon", "Spirit Guardians", "Shield of Faith",
                          "Sanctuary", "Aid", "Hold Person", "Mass Healing Word", "Banishment", "Death Ward", "Revivify",
                          "Dispel Magic", "Cure Wounds", "Bless", "Lesser Restoration", "Silence", "Detect Magic",
                          "Guardian of Faith"],
             cantrip_order=["Sacred Flame", "Guidance", "Spare the Dying", "Thaumaturgy", "Light"],
             subclass_level=1, asi_levels=[4], speed_bonus=L7(0, 0, 0, 0, 0, 0, 0),
             look={"accent": "#a87800", "tagline": "Holy power to heal friends and blast monsters."},
             gear=["Mace", "Holy symbol", "Priest's pack"]),
        dict(id="druid", weapon_prof=['Club', 'Dagger', 'Javelin', 'Mace', 'Quarterstaff', 'Scimitar', 'Sickle', 'Spear'], melee_slot=0, name="Druid", hit_die=8, primary=["WIS", "CON", "DEX", "INT", "STR", "CHA"],
             saves=["INT", "WIS"], skills=["Nature", "Animal Handling"], expertise=[],
             armor=A(10, 99, [], 0, False), armor_prof=["light", "medium"], shield_prof=True, shield_default=True, weapons=[W("Scimitar", "1d6", "FIN")],
             caster=C("full", "WIS", L7(2, 2, 2, 3, 3, 3, 3), "prepared", level_mult=1.0, cap=8),
             spell_order=["Healing Word", "Entangle", "Moonbeam", "Call Lightning", "Goodberry", "Faerie Fire",
                          "Flaming Sphere", "Conjure Animals", "Polymorph", "Thunderwave", "Pass without Trace",
                          "Spike Growth", "Heat Metal", "Ice Storm", "Cure Wounds", "Fog Cloud", "Speak with Animals",
                          "Lesser Restoration", "Dispel Magic", "Wall of Fire", "Hold Person"],
             cantrip_order=["Produce Flame", "Shillelagh", "Guidance", "Thorn Whip", "Druidcraft"],
             subclass_level=2, asi_levels=[4], speed_bonus=L7(0, 0, 0, 0, 0, 0, 0),
             look={"accent": "#2e7d32", "tagline": "Nature magic and turning into animals."},
             gear=["Scimitar", "Herbalism kit", "Explorer's pack"]),
        dict(id="fighter", weapon_prof=['simple', 'martial'], melee_slot=0, name="Fighter", hit_die=10, primary=["STR", "CON", "DEX", "WIS", "INT", "CHA"],
             saves=["STR", "CON"], skills=["Athletics", "Perception"], expertise=[],
             armor=A(10, 99, [], 0, False), armor_prof=["light", "medium", "heavy"], shield_prof=True, shield_default=True, weapons=[W("Longsword", "1d8", "STR"), W("Heavy crossbow", "1d10", "DEX", "ranged", "two", "100 ft")],
             caster=C(), spell_order=[], cantrip_order=[], subclass_level=3, asi_levels=[4, 6],
             speed_bonus=L7(0, 0, 0, 0, 0, 0, 0),
             look={"accent": "#4f6472", "tagline": "Trained for every kind of fight. Simple and strong."},
             gear=["Longsword", "Heavy crossbow + 20 bolts", "Dungeoneer's pack"]),
        dict(id="monk", weapon_prof=['simple', 'Shortsword'], melee_slot=1, name="Monk", hit_die=8, primary=["DEX", "WIS", "CON", "STR", "INT", "CHA"],
             saves=["STR", "DEX"], skills=["Acrobatics", "Stealth"], expertise=[],
             armor=A(10, 99, ["WIS"], 0, False), armor_prof=[], shield_prof=False, shield_default=False,
             weapons=[W("Unarmed strike", "{MA}", "FIN"), W("Shortsword", "1d6", "FIN"), W("Darts (10)", "1d4", "DEX", "ranged", "one", "20 ft")],
             caster=C(), spell_order=[], cantrip_order=[], subclass_level=3, asi_levels=[4],
             speed_bonus=L7(0, 10, 10, 10, 10, 15, 15),
             look={"accent": "#1f8a8a", "tagline": "Fast fists, wall-running, and catching arrows."},
             gear=["Shortsword", "10 darts", "Explorer's pack"]),
        dict(id="paladin", weapon_prof=['simple', 'martial'], melee_slot=0, name="Paladin", hit_die=10, primary=["STR", "CHA", "CON", "WIS", "DEX", "INT"],
             saves=["WIS", "CHA"], skills=["Athletics", "Persuasion"], expertise=[],
             armor=A(10, 99, [], 0, False), armor_prof=["light", "medium", "heavy"], shield_prof=True, shield_default=True, weapons=[W("Longsword", "1d8", "STR"), W("Javelins (5)", "1d6", "STR", "ranged", "one", "throw 30 ft")],
             caster=C("half", "CHA", L7(0, 0, 0, 0, 0, 0, 0), "prepared", level_mult=0.5, cap=6),
             spell_order=["Bless", "Cure Wounds", "Aid", "Shield of Faith", "Find Steed", "Thunderous Smite", "Divine Favor",
                          "Magic Weapon", "Heroism", "Searing Smite", "Detect Magic", "Lesser Restoration"],
             cantrip_order=[], subclass_level=3, asi_levels=[4], speed_bonus=L7(0, 0, 0, 0, 0, 0, 0),
             look={"accent": "#2c6db5", "tagline": "A shining knight with holy smites."},
             gear=["Longsword", "5 javelins", "Holy symbol"]),
        dict(id="ranger", weapon_prof=['simple', 'martial'], melee_slot=1, name="Ranger", hit_die=10, primary=["DEX", "WIS", "CON", "STR", "INT", "CHA"],
             saves=["STR", "DEX"], skills=["Survival", "Stealth", "Perception"], expertise=[],
             armor=A(10, 99, [], 0, False), armor_prof=["light", "medium"], shield_prof=True, shield_default=False, weapons=[W("Longbow", "1d8", "DEX", "ranged", "two", "150 ft"), W("Shortswords (x2)", "1d6", "FIN", "melee", "light")],
             caster=C("half", "WIS", L7(0, 0, 0, 0, 0, 0, 0), "known", L7(0, 2, 3, 3, 4, 4, 5)),
             spell_order=["Hunter's Mark", "Cure Wounds", "Goodberry", "Pass without Trace", "Spike Growth",
                          "Ensnaring Strike", "Fog Cloud", "Speak with Animals", "Barkskin", "Silence", "Lesser Restoration",
                          "Detect Magic"],
             cantrip_order=[], subclass_level=3, asi_levels=[4], speed_bonus=L7(0, 0, 0, 0, 0, 0, 0),
             look={"accent": "#5d7a1f", "tagline": "Tracker, archer, monster hunter."},
             gear=["Longbow + 20 arrows", "2 shortswords", "Explorer's pack"]),
        dict(id="rogue", weapon_prof=['simple', 'Hand crossbow', 'Longsword', 'Rapier', 'Shortsword'], melee_slot=0, name="Rogue", hit_die=8, primary=["DEX", "CON", "INT", "WIS", "CHA", "STR"],
             saves=["DEX", "INT"], skills=["Stealth", "Sleight of Hand", "Acrobatics", "Perception"],
             expertise=[{"lvl": 1, "skills": ["Stealth", "Sleight of Hand"]}, {"lvl": 6, "skills": ["Acrobatics", "Perception"]}],
             armor=A(10, 99, [], 0, False), armor_prof=["light"], shield_prof=False, shield_default=False, weapons=[W("Rapier", "1d8", "FIN"), W("Shortbow", "1d6", "DEX", "ranged", "two", "80 ft")],
             caster=C(), spell_order=[], cantrip_order=[], subclass_level=3, asi_levels=[4],
             speed_bonus=L7(0, 0, 0, 0, 0, 0, 0),
             look={"accent": "#4b4a73", "tagline": "Sneaky, quick, and full of tricks."},
             gear=["Rapier", "Shortbow + 20 arrows", "Thieves' tools", "Burglar's pack"]),
        dict(id="sorcerer", weapon_prof=['Dagger', 'Quarterstaff'], melee_slot=0, name="Sorcerer", hit_die=6, primary=["CHA", "CON", "DEX", "WIS", "INT", "STR"],
             saves=["CON", "CHA"], skills=["Arcana", "Persuasion"], expertise=[],
             armor=A(10, 99, [], 0, False), armor_prof=[], shield_prof=False, shield_default=False, weapons=[W("Dagger", "1d4", "FIN", note="throw 20 ft")],
             caster=C("full", "CHA", L7(4, 4, 4, 5, 5, 5, 5), "known", L7(2, 3, 4, 5, 6, 7, 8)),
             spell_order=["Magic Missile", "Shield", "Scorching Ray", "Misty Step", "Fireball", "Haste", "Polymorph",
                          "Burning Hands", "Sleep", "Mirror Image", "Counterspell", "Fly", "Greater Invisibility",
                          "Thunderwave", "Mage Armor", "Hold Person", "Lightning Bolt", "Dimension Door", "Banishment",
                          "Ice Storm", "Wall of Fire"],
             cantrip_order=["Fire Bolt", "Mage Hand", "Prestidigitation", "Shocking Grasp", "Ray of Frost",
                            "Minor Illusion", "Light", "Chill Touch"],
             subclass_level=1, asi_levels=[4], speed_bonus=L7(0, 0, 0, 0, 0, 0, 0),
             look={"accent": "#d6451b", "tagline": "Magic in your blood. Raw power!"},
             gear=["2 daggers", "Arcane focus (a glowing crystal)", "Explorer's pack"]),
        dict(id="warlock", weapon_prof=['simple'], melee_slot=1, name="Warlock", hit_die=8, primary=["CHA", "CON", "DEX", "WIS", "INT", "STR"],
             saves=["WIS", "CHA"], skills=["Arcana", "Deception"], expertise=[],
             armor=A(10, 99, [], 0, False), armor_prof=["light"], shield_prof=False, shield_default=False, weapons=[W("Eldritch Blast", "1d10{EBADD}", "SPELL", "ranged", "one", "{BEAMS}, 120 ft"), W("Dagger", "1d4", "FIN")],
             caster=C("pact", "CHA", L7(2, 2, 2, 3, 3, 3, 3), "known", L7(2, 3, 4, 5, 6, 7, 8)),
             spell_order=["Hex", "Armor of Agathys", "Hellish Rebuke", "Misty Step", "Hold Person", "Hunger of Hadar",
                          "Counterspell", "Fly", "Dimension Door", "Banishment", "Shatter", "Invisibility",
                          "Mirror Image", "Darkness", "Suggestion", "Charm Person", "Hypnotic Pattern"],
             cantrip_order=["Eldritch Blast", "Minor Illusion", "Mage Hand", "Prestidigitation", "Chill Touch"],
             subclass_level=1, asi_levels=[4], speed_bonus=L7(0, 0, 0, 0, 0, 0, 0),
             look={"accent": "#6a1b9a", "tagline": "Made a deal with something powerful."},
             gear=["2 daggers", "Arcane focus", "Scholar's pack"]),
        dict(id="wizard", weapon_prof=['Dagger', 'Quarterstaff'], melee_slot=0, name="Wizard", hit_die=6, primary=["INT", "CON", "DEX", "WIS", "CHA", "STR"],
             saves=["INT", "WIS"], skills=["Arcana", "History"], expertise=[],
             armor=A(10, 99, [], 0, False), armor_prof=[], shield_prof=False, shield_default=False, weapons=[W("Quarterstaff", "1d6", "STR", hands="two")],
             caster=C("full", "INT", L7(3, 3, 3, 4, 4, 4, 4), "prepared", level_mult=1.0, cap=8),
             spell_order=["Magic Missile", "Shield", "Sleep", "Misty Step", "Scorching Ray", "Fireball", "Counterspell",
                          "Polymorph", "Mage Armor", "Burning Hands", "Thunderwave", "Haste", "Fly", "Mirror Image",
                          "Invisibility", "Hold Person", "Lightning Bolt", "Greater Invisibility", "Dimension Door",
                          "Banishment", "Ice Storm", "Wall of Fire", "Feather Fall", "Tasha's Hideous Laughter"],
             cantrip_order=["Fire Bolt", "Mage Hand", "Prestidigitation", "Ray of Frost", "Shocking Grasp",
                            "Minor Illusion", "Light", "Chill Touch"],
             subclass_level=2, asi_levels=[4], speed_bonus=L7(0, 0, 0, 0, 0, 0, 0),
             look={"accent": "#3949ab", "tagline": "Spellbook full of tricks. Brains beat brawn."},
             gear=["Quarterstaff", "Spellbook", "Arcane focus", "Scholar's pack"]),
    ]
    return pl.DataFrame(rows, schema=CLASS_SCHEMA)


# --------------------------------------------------------------------------- subclasses
SUB_SCHEMA = {"id": pl.Utf8, "class_id": pl.Utf8, "name": pl.Utf8, "hp_per_level": pl.Int64,
              "armor": ARMOR, "armor_prof_add": pl.List(pl.Utf8), "extra_skills": pl.List(pl.Utf8), "extra_cantrips": pl.List(pl.Utf8),
              "auto_spells": pl.List(pl.Struct({"lvl": pl.Int64, "spell": pl.Utf8}))}


def subclasses_table() -> pl.DataFrame:
    def S(id, cls, name, hp=0, armor=None, skills=(), cantrips=(), auto=(), armor_add=()):
        return dict(id=id, class_id=cls, name=name, hp_per_level=hp, armor=armor, armor_prof_add=list(armor_add), extra_skills=list(skills),
                    extra_cantrips=list(cantrips), auto_spells=[{"lvl": l, "spell": s} for l, s in auto])
    rows = [
        S("berserker", "barbarian", "Path of the Berserker"),
        S("totem", "barbarian", "Path of the Totem Warrior"),
        S("lore", "bard", "College of Lore", skills=["Insight", "History", "Arcana"], auto=[(6, "Fireball"), (6, "Counterspell")]),
        S("valor", "bard", "College of Valor"),
        S("life", "cleric", "Life Domain", armor_add=["heavy"],
          auto=[(1, "Bless"), (1, "Cure Wounds"), (3, "Lesser Restoration"), (3, "Spiritual Weapon"), (5, "Beacon of Hope"),
                (5, "Revivify"), (7, "Death Ward"), (7, "Guardian of Faith")]),
        S("light", "cleric", "Light Domain", cantrips=["Light"],
          auto=[(1, "Burning Hands"), (1, "Faerie Fire"), (3, "Flaming Sphere"), (3, "Scorching Ray"), (5, "Daylight"),
                (5, "Fireball"), (7, "Guardian of Faith"), (7, "Wall of Fire")]),
        S("moon", "druid", "Circle of the Moon"),
        S("land", "druid", "Circle of the Land (Forest)", cantrips=["Thorn Whip"],
          auto=[(3, "Barkskin"), (3, "Spider Climb"), (5, "Call Lightning"), (5, "Plant Growth"), (7, "Freedom of Movement")]),
        S("champion", "fighter", "Champion"),
        S("battlemaster", "fighter", "Battle Master"),
        S("openhand", "monk", "Way of the Open Hand"),
        S("shadow", "monk", "Way of Shadow", cantrips=["Minor Illusion"]),
        S("devotion", "paladin", "Oath of Devotion",
          auto=[(3, "Protection from Evil and Good"), (3, "Sanctuary"), (5, "Lesser Restoration"), (5, "Zone of Truth")]),
        S("vengeance", "paladin", "Oath of Vengeance",
          auto=[(3, "Bane"), (3, "Hunter's Mark"), (5, "Hold Person"), (5, "Misty Step")]),
        S("hunter", "ranger", "Hunter"),
        S("beastmaster", "ranger", "Beast Master"),
        S("thief", "rogue", "Thief"),
        S("assassin", "rogue", "Assassin"),
        S("draconic", "sorcerer", "Draconic Bloodline", hp=1, armor=A(13, 99, [], 0, False)),
        S("wild", "sorcerer", "Wild Magic"),
        S("fiend", "warlock", "The Fiend"),
        S("archfey", "warlock", "The Archfey"),
        S("evocation", "wizard", "School of Evocation"),
        S("abjuration", "wizard", "School of Abjuration"),
    ]
    return pl.DataFrame(rows, schema=SUB_SCHEMA)


# --------------------------------------------------------------------------- scaling values (one per level)
def scaling_table() -> pl.DataFrame:
    s = [
        ("class", "barbarian", "RAGES", L7(2, 2, 3, 3, 3, 4, 4)),
        ("class", "barbarian", "RAGEDMG", L7(2, 2, 2, 2, 2, 2, 2)),
        ("class", "bard", "BIDIE", L7("d6", "d6", "d6", "d6", "d8", "d8", "d8")),
        ("class", "bard", "BIREST", L7("long", "long", "long", "long", "short", "short", "short")),
        ("class", "cleric", "CHANNELS", L7(0, 1, 1, 1, 1, 2, 2)),
        ("class", "cleric", "PRESERVE", L7(5, 10, 15, 20, 25, 30, 35)),
        ("class", "druid", "WSCR", L7("-", "1/4 (no flying or swimming)", "1/4 (no flying or swimming)", "1/2 (no flying)",
                                       "1/2 (no flying)", "1/2 (no flying)", "1/2 (no flying)")),
        ("class", "druid", "WSHOURS", L7(0, 1, 1, 2, 2, 3, 3)),
        ("class", "fighter", "SUPDICE", L7(0, 0, 4, 4, 4, 4, 5)),
        ("class", "monk", "MA", L7("1d4", "1d4", "1d4", "1d4", "1d6", "1d6", "1d6")),
        ("class", "monk", "KI", L7(0, 2, 3, 4, 5, 6, 7)),
        ("class", "monk", "SLOWFALL", L7(5, 10, 15, 20, 25, 30, 35)),
        ("class", "monk", "WHOLE", L7(3, 6, 9, 12, 15, 18, 21)),
        ("class", "paladin", "LOH", L7(5, 10, 15, 20, 25, 30, 35)),
        ("class", "rogue", "SNEAK", L7(1, 1, 2, 2, 3, 3, 4)),
        ("class", "sorcerer", "SP", L7(0, 2, 3, 4, 5, 6, 7)),
        ("class", "warlock", "BEAMS", L7("1 beam", "1 beam", "1 beam", "1 beam", "2 beams", "2 beams", "2 beams")),
        ("class", "warlock", "EBADD", L7("", "", "", "", "", "", "")),
        ("class", "wizard", "RECOVER", L7(1, 1, 2, 2, 3, 3, 4)),
        ("class", "druid", "RECOVER", L7(1, 1, 2, 2, 3, 3, 4)),
        ("subclass", "moon", "WSCR", L7("-", "1", "1", "1", "1", "2", "2")),
        ("race", "dragonborn", "DBDICE", L7(2, 2, 2, 2, 2, 3, 3)),
        ("race", "dragonborn", "DBTYPE", L7(*["fire"] * 7)),
        ("race", "dragonborn", "DBSHAPE", L7(*["15-ft cone"] * 7)),
        ("race", "dragonborn", "DBSAVE", L7(*["Dex"] * 7)),
        ("subclass", "draconic", "ELEMENT", L7(*["fire"] * 7)),
    ]
    return pl.DataFrame([{"owner_kind": a, "owner_id": b, "key": c, "values": [str(x) for x in d]} for a, b, c, d in s],
                        schema={"owner_kind": pl.Utf8, "owner_id": pl.Utf8, "key": pl.Utf8, "values": pl.List(pl.Utf8)})


# --------------------------------------------------------------------------- features
CARD = pl.Struct({"name": pl.Utf8, "tag": pl.Utf8, "note": pl.Utf8, "desc": pl.Utf8, "conc": pl.Boolean})
TRACK = pl.Struct({"uses": pl.Utf8, "rest": pl.Utf8})
FEATURE_SCHEMA = {"owner_kind": pl.Utf8, "owner_id": pl.Utf8, "lvl": pl.Int64, "card": CARD, "tracker": TRACK}


def features_table() -> pl.DataFrame:
    F = []

    def f(kind, owner, lvl, name, tag, desc, note="", uses="", rest=""):
        F.append({"owner_kind": kind, "owner_id": owner, "lvl": lvl,
                  "card": {"name": name, "tag": tag, "note": note, "desc": desc, "conc": False},
                  "tracker": {"uses": uses, "rest": rest}})

    R = "race"
    f(R, "human", 1, "Quick Learner", "ON", "You pick up new languages and tricks fast.")
    f(R, "dwarf", 1, "Darkvision", "ON", "See in the dark up to 60 ft.")
    f(R, "dwarf", 1, "Dwarven Resilience", "ON", "Poison only does half damage to you.")
    SR = "subrace"
    f(SR, "hill", 1, "Dwarven Toughness", "ON", "+1 HP every level (already counted).")
    f(SR, "mountain", 1, "Dwarven Armor Training", "ON", "You can wear light and medium armor.")
    f(R, "dwarf", 1, "Stonecunning", "ON", "You know stonework: who built it, how old, and where the secret doors might be.")
    f(R, "elf", 1, "Darkvision", "ON", "See in the dark up to 60 ft.")
    f(R, "elf", 1, "Fey Ancestry", "ON", "Advantage against being charmed, and magic can't put you to sleep.")
    f("subrace", "wood", 1, "Fleet of Foot", "ON", "35 ft speed (already counted).")
    f("subrace", "wood", 1, "Mask of the Wild", "ON", "You can hide in light rain, falling leaves, mist or tall grass.")
    f("subrace", "high", 1, "Elf Magic: Fire Bolt", "A", "Throw fire (120 ft): {INTATK} to hit, {CD}d10 fire. Use it as much as you want.")
    f(R, "halfling", 1, "Lucky", "ON", "Roll a 1 on a d20? Roll it again!")
    f(R, "halfling", 1, "Brave & Nimble", "ON", "Advantage against being frightened. You can walk right through the space of bigger creatures.")
    f("subrace", "lightfoot", 1, "Naturally Stealthy", "ON", "You can hide behind someone bigger than you.")
    f("subrace", "stout", 1, "Stout Resilience", "ON", "Poison only does half damage to you, and you're hard to poison.")
    f(R, "gnome", 1, "Darkvision", "ON", "See in the dark up to 60 ft.")
    f(R, "gnome", 1, "Gnome Cunning", "ON", "Advantage on Int, Wis and Cha saves against magic.")
    f("subrace", "forest", 1, "Gnome Illusions", "A", "Make a fake sound or a fake little object (Minor Illusion), any time.")
    f("subrace", "forest", 1, "Speak with Small Beasts", "ON", "Chat with squirrels, mice, birds and other little animals.")
    f("subrace", "rock", 1, "Tinker", "A", "Build tiny clockwork toys: a music box, a fire starter, a walking wind-up critter.")
    f(R, "halforc", 1, "Darkvision", "ON", "See in the dark up to 60 ft.")
    f(R, "halforc", 1, "Relentless Endurance", "R", "When you drop to 0 HP, drop to 1 instead!", uses="1", rest="long")
    f(R, "halforc", 1, "Savage Attacks", "ON", "When you crit with a melee weapon, roll one extra weapon die.")
    f(R, "tiefling", 1, "Darkvision", "ON", "See in the dark up to 60 ft.")
    f(R, "tiefling", 1, "Hellish Resistance", "ON", "Fire only does half damage to you.")
    f(R, "tiefling", 1, "Infernal Legacy", "A", "You know Thaumaturgy: a booming voice, flickering flames, shaking ground.")
    f(R, "tiefling", 3, "Hellish Rebuke (racial)", "R", "Someone hurts you? Burst them with fire: Dex save (DC {CHADC}) or 3d10 fire, half if they save.", uses="1", rest="long")
    f(R, "tiefling", 5, "Darkness (racial)", "A", "Make a 15-ft bubble of magical darkness for 10 minutes.", uses="1", rest="long")
    f(R, "dragonborn", 1, "Breath Weapon", "A", "Breathe {DBTYPE}! {DBDICE}d6 damage in a {DBSHAPE}. {DBSAVE} save (DC {CONDC}), half if they save.", uses="1", rest="short")
    f(R, "dragonborn", 1, "Dragon Hide", "ON", "{DBTYPE} damage only does half damage to you.")

    K = "class"
    for c in ["barbarian", "fighter", "monk", "paladin", "ranger"]:
        f(K, c, 5, "Extra Attack", "ON", "When you take the Attack action, you attack 2 times!")

    f(K, "barbarian", 1, "Rage", "B", "Get SUPER angry for 1 minute: +{RAGEDMG} damage on Strength hits, advantage on Strength checks and saves, and weapons only do half damage to you.", uses="{RAGES}", rest="long")
    f(K, "barbarian", 1, "Unarmored Defense", "ON", "No armor needed: Armor = 10 + Dex + Con (already counted).")
    f(K, "barbarian", 2, "Reckless Attack", "F", "Swing wild! Advantage on your Strength attacks this turn, but enemies get advantage on you until your next turn.")
    f(K, "barbarian", 2, "Danger Sense", "ON", "Advantage on Dex saves against things you can see: traps, explosions, spells.")
    f(K, "barbarian", 7, "Feral Instinct", "ON", "Advantage on initiative. Can't be caught off guard if you rage.")
    f("subclass", "berserker", 3, "Frenzy", "B", "While raging, make one extra attack as a bonus action every turn. You'll be wiped out (exhausted) after.")
    f("subclass", "berserker", 6, "Mindless Rage", "ON", "While raging you can't be charmed or frightened.")
    f("subclass", "totem", 3, "Spirit Seeker", "A", "You can talk to animals (Speak with Animals) as a 10-minute ritual.")

    f(K, "bard", 1, "Bardic Inspiration", "B", "Cheer on a friend within 60 ft: they get a {BIDIE} to add to one attack, check or save.", uses="{CHANMIN1}", rest="{BIREST}")
    f(K, "bard", 2, "Jack of All Trades", "ON", "Add +{HALFPROF} to checks you're not trained in.")
    f(K, "bard", 2, "Song of Rest", "ON", "Friends who heal during a short rest get +1d6 extra HP.")
    f(K, "bard", 3, "Expertise", "ON", "Double bonus in two skills (already on your sheet).")
    f(K, "bard", 6, "Countercharm", "A", "Start a song: you and friends within 30 ft get advantage on saves against fear and charm.")
    f("subclass", "lore", 3, "Cutting Words", "R", "When an enemy within 60 ft rolls, spend an Inspiration: subtract a {BIDIE} from its roll!")
    f("subclass", "lore", 6, "Magical Secrets", "ON", "You stole two spells from other classes: Fireball and Counterspell.")
    f("subclass", "valor", 3, "Combat Inspiration", "ON", "Friends can also add your Inspiration die to damage, or to their Armor against one hit.")
    f("subclass", "valor", 6, "Extra Attack", "ON", "When you take the Attack action, you attack 2 times!")

    f(K, "cleric", 2, "Channel Divinity", "A", "Holy power! Use it for Turn Undead or your domain's special move.", uses="{CHANNELS}", rest="short")
    f(K, "cleric", 2, "Turn Undead", "A", "Undead within 30 ft make a Wis save (DC {DC}) or run away from you for 1 minute.")
    f(K, "cleric", 5, "Destroy Undead", "ON", "Weak undead (like zombies) that fail Turn Undead are destroyed!")
    f("subclass", "life", 1, "Disciple of Life", "ON", "Your healing spells heal extra: +2 + the spell's level.")
    f("subclass", "life", 2, "Preserve Life", "A", "Channel Divinity: heal {PRESERVE} HP split among friends within 30 ft.")
    f("subclass", "life", 6, "Blessed Healer", "ON", "When you heal someone else, you heal 2 + spell level too.")
    f("subclass", "light", 1, "Warding Flare", "R", "Flash bright light when something attacks you: it gets disadvantage.", uses="{WISMIN1}", rest="long")
    f("subclass", "light", 2, "Radiance of the Dawn", "A", "Channel Divinity: sunlight bursts out! Enemies within 30 ft: Con save or 2d10+{LVL} radiant (half on save).")
    f("subclass", "light", 6, "Improved Flare", "ON", "Use Warding Flare to protect friends too.")

    f(K, "druid", 1, "Druidic", "ON", "You know the secret druid language.")
    f(K, "druid", 2, "Wild Shape", "A", "Turn into an animal you've seen (up to CR {WSCR}) for {WSHOURS} hour(s). Use its body and HP; when that runs out, you pop back.", uses="2", rest="short")
    f("subclass", "moon", 2, "Combat Wild Shape", "B", "Wild Shape as a bonus action. As an animal, spend a spell slot to heal 1d8 per slot level.")
    f("subclass", "moon", 6, "Primal Strike", "ON", "Your animal attacks count as magical.")
    f("subclass", "land", 2, "Natural Recovery", "F", "During a short rest, get back spell slots adding up to {RECOVER} levels.", uses="1", rest="long")
    f("subclass", "land", 3, "Circle Spells", "ON", "Forest magic is always ready for you (marked as bonus spells).")
    f("subclass", "land", 6, "Land's Stride", "ON", "Plants and rough ground don't slow you down or scratch you.")

    f(K, "fighter", 1, "Second Wind", "B", "Catch your breath: heal 1d10+{LVL}.", uses="1", rest="short")
    f(K, "fighter", 2, "Action Surge", "F", "Take one whole extra action on your turn!", uses="1", rest="short")
    f("subclass", "champion", 3, "Improved Critical", "ON", "You crit on a 19 OR 20!")
    f("subclass", "champion", 7, "Remarkable Athlete", "ON", "+{HALFPROFUP} on Str, Dex and Con checks you're not trained in; you jump farther.")
    f("subclass", "battlemaster", 3, "Superiority Dice", "F", "Spend a d8 to pull off a maneuver. Enemies save against DC {MANDC}.", uses="{SUPDICE}", rest="short")
    f("subclass", "battlemaster", 7, "Know Your Enemy", "A", "Watch a creature for 1 minute to learn if it's stronger or weaker than you.")

    f(K, "monk", 1, "Unarmored Defense", "ON", "No armor: Armor = 10 + Dex + Wis (already counted).")
    f(K, "monk", 1, "Martial Arts", "B", "After you attack, punch once more as a bonus action: {MA}{DEX}.")
    f(K, "monk", 2, "Ki", "F", "Special energy for your moves. Comes back after a short rest.", uses="{KI}", rest="short")
    f(K, "monk", 2, "Flurry of Blows", "B", "1 ki: after attacking, punch TWICE with your bonus action.")
    f(K, "monk", 2, "Patient Defense", "B", "1 ki: Dodge. Attacks against you have disadvantage.")
    f(K, "monk", 2, "Step of the Wind", "B", "1 ki: Dash or Disengage, and jump twice as far.")
    f(K, "monk", 3, "Deflect Missiles", "R", "Arrow or rock hits you? Reduce the damage by 1d10{DEX}+{LVL}. If it hits 0, catch it and throw it back (1 ki).")
    f(K, "monk", 4, "Slow Fall", "R", "Take {SLOWFALL} less falling damage.")
    f(K, "monk", 5, "Stunning Strike", "F", "1 ki: when you hit, the target makes a Con save (DC {DC_WIS}) or is STUNNED until the end of your next turn.")
    f(K, "monk", 6, "Ki-Empowered Strikes", "ON", "Your punches count as magical.")
    f(K, "monk", 7, "Evasion", "ON", "Dex save for half? Succeed: take nothing. Fail: take half.")
    f("subclass", "openhand", 3, "Open Hand Technique", "ON", "When Flurry of Blows hits, pick one: knock it down (Dex save), push it 15 ft (Str save), or it can't react.")
    f("subclass", "openhand", 6, "Wholeness of Body", "A", "Heal yourself {WHOLE} HP.", uses="1", rest="long")
    f("subclass", "shadow", 3, "Shadow Arts", "A", "2 ki: cast Darkness, Darkvision, Pass without Trace or Silence.")
    f("subclass", "shadow", 6, "Shadow Step", "B", "In dim light or darkness, teleport 60 ft to another shadow and get advantage on your next hit.")

    f(K, "paladin", 1, "Divine Sense", "A", "Sense celestials, fiends and undead within 60 ft.", uses="{CHAPLUS1}", rest="long")
    f(K, "paladin", 1, "Lay on Hands", "A", "Touch to heal from a pool of {LOH} HP. Spend 5 to cure poison or sickness.", uses="{LOH}", rest="long")
    f(K, "paladin", 2, "Divine Smite", "F", "When you hit, spend a spell slot: +2d8 radiant (+1d8 per slot level above 1st, +1d8 vs undead and fiends).")
    f(K, "paladin", 3, "Divine Health", "ON", "You never get sick.")
    f(K, "paladin", 3, "Channel Divinity", "A", "Holy power for your oath's special moves.", uses="1", rest="short")
    f(K, "paladin", 6, "Aura of Protection", "ON", "You and friends within 10 ft add {CHA} to every saving throw!")
    f("subclass", "devotion", 3, "Sacred Weapon", "A", "Channel Divinity: for 1 minute add {CHA} to your attacks, and your weapon glows.")
    f("subclass", "devotion", 3, "Turn the Unholy", "A", "Channel Divinity: fiends and undead within 30 ft make a Wis save (DC {DC}) or run away.")
    f("subclass", "devotion", 7, "Aura of Devotion", "ON", "You and friends within 10 ft can't be charmed.")
    f("subclass", "vengeance", 3, "Vow of Enmity", "B", "Channel Divinity: advantage on attacks against one creature for 1 minute.")
    f("subclass", "vengeance", 3, "Abjure Enemy", "A", "Channel Divinity: one creature makes a Wis save (DC {DC}) or is frightened and can't move.")
    f("subclass", "vengeance", 7, "Relentless Avenger", "ON", "When you hit with an opportunity attack, you can also move half your speed.")

    f(K, "ranger", 3, "Primeval Awareness", "A", "Spend a spell slot to sense fey, fiends, undead, dragons and other strange creatures within 1 mile.")
    f("subclass", "beastmaster", 3, "Ranger's Companion", "A", "An animal friend (like a wolf) fights beside you. Use your action to tell it to attack, Dash, Dodge or Help. It adds +{PROF} to its rolls.")
    f("subclass", "beastmaster", 7, "Exceptional Training", "B", "Tell your companion to Dash, Disengage, Dodge or Help as a bonus action. Its bites count as magical.")

    f(K, "rogue", 1, "Sneak Attack", "F", "Once per turn, +{SNEAK}d6 damage with a finesse or ranged weapon if you have advantage OR a friend is next to the target.", uses="1", rest="turn")
    f(K, "rogue", 1, "Thieves' Cant", "ON", "A secret thief code: hidden messages in normal talk and secret signs.")
    f(K, "rogue", 1, "Expertise", "ON", "Double bonus in your chosen skills (already on your sheet).")
    f(K, "rogue", 2, "Cunning Action", "B", "Dash, Disengage or Hide as a bonus action.")
    f(K, "rogue", 5, "Uncanny Dodge", "R", "When an attack you can see hits you, take half damage.")
    f(K, "rogue", 7, "Evasion", "ON", "Dex save for half? Succeed: take nothing. Fail: take half.")
    f("subclass", "thief", 3, "Fast Hands", "B", "Pick a lock, disarm a trap or use an item as a bonus action.")
    f("subclass", "thief", 3, "Second-Story Work", "ON", "Climb as fast as you walk; jump extra far.")
    f("subclass", "assassin", 3, "Assassinate", "ON", "Advantage on attacks against creatures that haven't gone yet. Hits on surprised creatures are critical hits!")

    f(K, "sorcerer", 2, "Sorcery Points", "B", "Turn 2/3/5 points into a level 1/2/3 spell slot, or turn a slot into points.", uses="{SP}", rest="long")
    f("subclass", "draconic", 1, "Dragon Scales", "ON", "+1 HP every level and Armor 13 + Dex without armor (already counted).")
    f("subclass", "draconic", 6, "Elemental Affinity", "ON", "Add {CHA} to {ELEMENT} spell damage. Spend 1 point to shrug off {ELEMENT} for an hour.")
    f("subclass", "wild", 1, "Wild Magic Surge", "ON", "After you cast a spell, the DM may have you roll a d20. On a 1, something random and magical happens!")
    f("subclass", "wild", 1, "Tides of Chaos", "F", "Give yourself advantage on one roll. The DM can trigger a surge to give it back.", uses="1", rest="long")
    f("subclass", "wild", 6, "Bend Luck", "R", "2 sorcery points: add or subtract 1d4 from someone's roll.")

    f(K, "warlock", 1, "Pact Magic", "ON", "Your spell slots come back after a SHORT rest!")
    f("subclass", "fiend", 1, "Dark One's Blessing", "ON", "Drop an enemy to 0 HP: gain {DOB} temporary HP.")
    f("subclass", "fiend", 6, "Dark One's Own Luck", "F", "Add a d10 to one check or save.", uses="1", rest="short")
    f("subclass", "archfey", 1, "Fey Presence", "A", "Creatures in a 10-ft cube make a Wis save (DC {DC}) or are charmed or frightened (your pick) until your next turn.", uses="1", rest="short")
    f("subclass", "archfey", 6, "Misty Escape", "R", "When you get hurt, turn invisible and teleport up to 60 ft.", uses="1", rest="short")

    f(K, "wizard", 1, "Arcane Recovery", "F", "Once a day during a short rest, get back spell slots adding up to {RECOVER} levels.", uses="1", rest="long")
    f(K, "wizard", 1, "Spellbook", "ON", "Find a scroll or spellbook? Copy new spells into yours!")
    f("subclass", "evocation", 2, "Sculpt Spells", "ON", "Friends caught in your blasts automatically save and take NO damage.")
    f("subclass", "evocation", 6, "Potent Cantrip", "ON", "Enemies that save against your cantrips still take half damage.")
    f("subclass", "abjuration", 2, "Arcane Ward", "ON", "Casting a protection spell (like Shield or Mage Armor) gives you a magic ward with {WARD} HP that soaks damage first.")
    f("subclass", "abjuration", 6, "Projected Ward", "R", "Use your ward to soak damage for a friend within 30 ft.")
    return pl.DataFrame(F, schema=FEATURE_SCHEMA)


# --------------------------------------------------------------------------- choices
EFFECT = pl.Struct({"ac": pl.Int64, "ranged_hit": pl.Int64, "onehand_dmg": pl.Int64, "init": pl.Int64,
                    "vars": pl.List(pl.Struct({"key": pl.Utf8, "value": pl.Utf8}))})
OPTION = pl.Struct({"name": pl.Utf8, "tag": pl.Utf8, "desc": pl.Utf8, "effect": EFFECT})
CHOICE_SCHEMA = {"owner_kind": pl.Utf8, "owner_id": pl.Utf8, "group": pl.Utf8, "label": pl.Utf8,
                 "count": pl.List(pl.Int64), "options": pl.List(OPTION)}


def choices_table() -> pl.DataFrame:
    def O(name, tag, desc, ac=0, ranged_hit=0, onehand_dmg=0, init=0, **vars):
        return {"name": name, "tag": tag, "desc": desc,
                "effect": {"ac": ac, "ranged_hit": ranged_hit, "onehand_dmg": onehand_dmg, "init": init,
                           "vars": [{"key": k, "value": v} for k, v in vars.items()]}}
    styles = {
        "Archery": O("Archery", "ON", "+2 to hit with ranged weapons (already counted).", ranged_hit=2),
        "Defense": O("Defense", "ON", "+1 Armor while wearing armor (already counted).", ac=1),
        "Dueling": O("Dueling", "ON", "+2 damage with a one-handed weapon (already counted).", onehand_dmg=2),
        "Great Weapon Fighting": O("Great Weapon Fighting", "ON", "Reroll 1s and 2s on two-handed weapon damage."),
        "Protection": O("Protection", "R", "With a shield, give an enemy disadvantage when it attacks a friend next to you."),
        "Two-Weapon Fighting": O("Two-Weapon Fighting", "ON", "Add your bonus to the damage of your off-hand attack."),
    }
    rows = []

    def ch(kind, owner, group, label, count, opts):
        rows.append({"owner_kind": kind, "owner_id": owner, "group": group, "label": label, "count": list(count), "options": opts})

    ch("class", "fighter", "fighting_style", "Fighting Style", L7(1, 1, 1, 1, 1, 1, 1),
       [styles[k] for k in ["Defense", "Dueling", "Archery", "Great Weapon Fighting", "Protection", "Two-Weapon Fighting"]])
    ch("class", "paladin", "fighting_style", "Fighting Style", L7(0, 1, 1, 1, 1, 1, 1),
       [styles[k] for k in ["Defense", "Dueling", "Great Weapon Fighting", "Protection"]])
    ch("class", "ranger", "fighting_style", "Fighting Style", L7(0, 1, 1, 1, 1, 1, 1),
       [styles[k] for k in ["Archery", "Defense", "Dueling", "Two-Weapon Fighting"]])
    ch("class", "ranger", "favored_enemy", "Favored Enemy", L7(1, 1, 1, 1, 1, 1, 1),
       [O(f"Favored Enemy: {x}", "ON", f"Advantage on checks to track {x.lower()} and remember facts about them.")
        for x in ["Monstrosities", "Beasts", "Undead", "Fiends", "Dragons", "Giants"]])
    ch("class", "ranger", "terrain", "Favored Terrain", L7(1, 1, 1, 1, 1, 1, 1),
       [O(f"Natural Explorer: {x}", "ON", f"In the {x.lower()}: your group can't get lost, rough ground doesn't slow you, and you find extra food.")
        for x in ["Forest", "Underdark", "Mountain", "Swamp", "Coast", "Grassland", "Arctic", "Desert"]])
    ch("subclass", "hunter", "hunters_prey", "Hunter's Prey", L7(0, 0, 1, 1, 1, 1, 1), [
        O("Colossus Slayer", "ON", "Once per turn, +1d8 damage to a creature that's already hurt."),
        O("Horde Breaker", "ON", "Once per turn, attack a second enemy standing next to your target."),
        O("Giant Killer", "R", "When a big creature next to you attacks, attack it right back.")])
    ch("subclass", "hunter", "defensive_tactics", "Defensive Tactics", L7(0, 0, 0, 0, 0, 0, 1), [
        O("Multiattack Defense", "ON", "After something hits you, get +4 Armor against its other attacks this turn."),
        O("Escape the Horde", "ON", "Free hits against you when you run past have disadvantage."),
        O("Steel Will", "ON", "Advantage on saves against being frightened.")])
    ch("subclass", "totem", "totem", "Totem Spirit", L7(0, 0, 1, 1, 1, 1, 1), [
        O("Bear Spirit", "ON", "While raging, ALL damage except psychic only does half to you."),
        O("Wolf Spirit", "ON", "While raging, friends get advantage on melee attacks against enemies next to you."),
        O("Eagle Spirit", "ON", "While raging, free hits against you have disadvantage and you can Dash as a bonus action.")])
    ch("subclass", "totem", "aspect", "Aspect of the Beast", L7(0, 0, 0, 0, 0, 1, 1), [
        O("Aspect of the Bear", "ON", "Carry twice as much; advantage on Strength checks to push, pull, lift or smash."),
        O("Aspect of the Wolf", "ON", "Track while moving fast and sneak at normal speed."),
        O("Aspect of the Eagle", "ON", "See up to 1 mile away as clearly as if it were 100 ft.")])
    ch("subclass", "battlemaster", "maneuvers", "Maneuvers", L7(0, 0, 3, 3, 3, 3, 5), [
        O("Trip Attack", "F", "On a hit, add a d8 to damage; the target makes a Str save or falls down."),
        O("Riposte", "R", "When an enemy misses you, attack it back and add a d8 to damage."),
        O("Menacing Attack", "F", "On a hit, add a d8 to damage; the target makes a Wis save or is frightened."),
        O("Pushing Attack", "F", "On a hit, add a d8 to damage; the target makes a Str save or flies back 15 ft."),
        O("Disarming Attack", "F", "On a hit, add a d8 to damage; the target makes a Str save or drops what it's holding."),
        O("Precision Attack", "F", "Add a d8 to an attack roll."),
        O("Rally", "B", "A friend gains d8 + {CHAN} temporary HP."),
        O("Parry", "R", "When hit, reduce the damage by d8 + {DEXN}.")])
    ch("class", "sorcerer", "metamagic", "Metamagic", L7(0, 0, 2, 2, 2, 2, 2), [
        O("Quickened Spell", "F", "2 points: cast an action spell as a bonus action."),
        O("Twinned Spell", "F", "Points = spell level: a one-target spell hits a second target."),
        O("Empowered Spell", "F", "1 point: reroll up to {CHAN} damage dice."),
        O("Heightened Spell", "F", "3 points: one target has disadvantage on its first save."),
        O("Careful Spell", "F", "1 point: friends automatically make the save against your spell."),
        O("Subtle Spell", "F", "1 point: cast without words or waving. Nobody knows it was you!")])
    ch("subclass", "draconic", "dragon", "Dragon Ancestor", L7(1, 1, 1, 1, 1, 1, 1), [
        O("Red Dragon Blood", "ON", "Your dragon ancestor breathed fire.", ELEMENT="fire"),
        O("Blue Dragon Blood", "ON", "Your dragon ancestor breathed lightning.", ELEMENT="lightning"),
        O("White Dragon Blood", "ON", "Your dragon ancestor breathed ice.", ELEMENT="cold"),
        O("Black Dragon Blood", "ON", "Your dragon ancestor spat acid.", ELEMENT="acid")])
    ch("class", "warlock", "invocations", "Eldritch Invocations", L7(0, 2, 2, 2, 3, 3, 4), [
        O("Agonizing Blast", "ON", "Adds {CHA} damage to each Eldritch Blast beam (already counted).", EBADD="{CHA}"),
        O("Repelling Blast", "ON", "Each Eldritch Blast beam that hits pushes the target 10 ft away."),
        O("Devil's Sight", "ON", "See perfectly in darkness, even magical darkness, up to 120 ft."),
        O("Fiendish Vigor", "A", "Give yourself 1d4+4 temporary HP whenever you want."),
        O("Mask of Many Faces", "A", "Disguise yourself as anyone, whenever you want."),
        O("Beast Speech", "A", "Talk to animals whenever you want."),
        O("Eldritch Spear", "ON", "Eldritch Blast reaches 300 ft.")])
    ch("class", "warlock", "pact", "Pact Boon", L7(0, 0, 1, 1, 1, 1, 1), [
        O("Pact of the Chain", "A", "A magic pet (imp, pseudodragon, quasit or sprite) that scouts, talks to you in your head, and can attack."),
        O("Pact of the Blade", "B", "Summon a magic weapon of any kind into your hand, any time."),
        O("Pact of the Tome", "ON", "A Book of Shadows with 3 extra cantrips from any class.")])
    ch("race", "dragonborn", "ancestry", "Dragon Ancestry", L7(1, 1, 1, 1, 1, 1, 1), [
        O("Red Dragon Ancestry", "ON", "Your breath is fire.", DBTYPE="fire", DBSHAPE="15-ft cone", DBSAVE="Dex"),
        O("Blue Dragon Ancestry", "ON", "Your breath is lightning.", DBTYPE="lightning", DBSHAPE="30-ft line", DBSAVE="Dex"),
        O("White Dragon Ancestry", "ON", "Your breath is freezing cold.", DBTYPE="cold", DBSHAPE="15-ft cone", DBSAVE="Con"),
        O("Green Dragon Ancestry", "ON", "Your breath is poison gas.", DBTYPE="poison", DBSHAPE="15-ft cone", DBSAVE="Con"),
        O("Black Dragon Ancestry", "ON", "Your breath is acid.", DBTYPE="acid", DBSHAPE="30-ft line", DBSAVE="Dex")])
    return pl.DataFrame(rows, schema=CHOICE_SCHEMA)


# --------------------------------------------------------------------------- spells (the fun part only)
# scale: what {S} shows. It grows by `per` for each slot level above the spell's level. Only pact casters
# (warlocks) get the bigger number, because every warlock slot is their highest level.
SCALE = pl.Struct({"base": pl.Int64, "per": pl.Int64, "unit": pl.Utf8})
SPELL_SCHEMA = {"name": pl.Utf8, "lvl": pl.Int64, "classes": pl.List(pl.Utf8), "card": CARD, "scale": SCALE}


def spells_table() -> pl.DataFrame:
    rows = []

    def sp(name, lvl, classes, tag, note, desc, scale=None, conc=False):
        rows.append({"name": name, "lvl": lvl, "classes": classes.split(), "card": {"name": name, "tag": tag, "note": note, "desc": desc, "conc": conc},
                     "scale": None if scale is None else {"base": scale[0], "per": scale[1], "unit": scale[2]}})

    # cantrips
    sp("Fire Bolt", 0, "sorcerer wizard", "A", "120 ft", "Throw fire! {SPATK} to hit, {CD}d10 fire. Lights things on fire.")
    sp("Ray of Frost", 0, "sorcerer wizard", "A", "60 ft", "Icy beam: {SPATK} to hit, {CD}d8 cold, and it slows down 10 ft.")
    sp("Shocking Grasp", 0, "sorcerer wizard", "A", "touch", "ZAP: {SPATK} to hit, {CD}d8 lightning. It can't hit you as you run away.")
    sp("Chill Touch", 0, "sorcerer warlock wizard", "A", "120 ft", "Ghostly hand: {SPATK} to hit, {CD}d8 necrotic. It can't heal until your next turn.")
    sp("Mage Hand", 0, "bard sorcerer warlock wizard", "A", "30 ft", "A floating ghost hand that carries small things.")
    sp("Minor Illusion", 0, "bard sorcerer warlock wizard", "A", "30 ft", "Make a fake sound or a fake little object.")
    sp("Prestidigitation", 0, "bard sorcerer warlock wizard", "A", "", "Little magic tricks: sparks, smells, clean or warm things, light a candle.")
    sp("Light", 0, "bard cleric sorcerer wizard", "A", "touch", "Make an object glow like a torch for 1 hour.")
    sp("Vicious Mockery", 0, "bard", "A", "60 ft", "Insult with magic! Wis save (DC {DC}) or {CD}d4 psychic and disadvantage on its next attack.")
    sp("Eldritch Blast", 0, "warlock", "A", "120 ft", "Crackling beams of power: {BEAMS}. Each: {SPATK} to hit, 1d10{EBADD} force.")
    sp("Sacred Flame", 0, "cleric", "A", "60 ft", "Holy fire from above: Dex save (DC {DC}) or {CD}d8 radiant.")
    sp("Guidance", 0, "cleric druid", "A", "touch", "A friend adds 1d4 to one ability check.")
    sp("Spare the Dying", 0, "cleric", "A", "touch", "A friend at 0 HP stops dying.")
    sp("Thaumaturgy", 0, "cleric", "A", "", "A BOOMING voice, flickering flames, shaking ground.")
    sp("Produce Flame", 0, "druid", "A", "30 ft", "Flame in your hand for light, or throw it: {SPATK} to hit, {CD}d8 fire.")
    sp("Shillelagh", 0, "druid", "B", "", "Your staff or club glows: hits with {MOD} and does 1d8.")
    sp("Thorn Whip", 0, "druid", "A", "30 ft", "Vine whip: {SPATK} to hit, {CD}d6 and pull it 10 ft toward you.")
    sp("Druidcraft", 0, "druid", "A", "", "Tiny nature magic: make flowers bloom, predict the weather.")
    # level 1
    sp("Healing Word", 1, "bard cleric druid", "B", "60 ft", "Shout and a friend heals 1d4{MOD}.")
    sp("Cure Wounds", 1, "bard cleric druid paladin ranger", "A", "touch", "Heal a friend 1d8{MOD}.")
    sp("Bless", 1, "cleric paladin", "A", "", "Up to 3 friends add 1d4 to attacks and saves for 1 minute.")
    sp("Bane", 1, "bard cleric paladin", "A", "", "Up to 3 enemies: Cha save or subtract 1d4 from attacks and saves.")
    sp("Shield of Faith", 1, "cleric paladin", "B", "60 ft", "A friend gets +2 Armor for 10 minutes.")
    sp("Guiding Bolt", 1, "cleric", "A", "120 ft", "Bolt of light: {SPATK} to hit, 4d6 radiant, and the next attack on it has advantage.")
    sp("Sanctuary", 1, "cleric", "B", "30 ft", "Protect a friend: enemies must make a Wis save to attack them.")
    sp("Protection from Evil and Good", 1, "cleric paladin warlock wizard", "A", "touch", "Monsters like fiends and undead have disadvantage attacking your friend.")
    sp("Detect Magic", 1, "bard cleric druid paladin ranger sorcerer wizard", "A", "", "See a glow around magic things nearby for 10 minutes.")
    sp("Thunderwave", 1, "bard druid sorcerer wizard", "A", "15-ft cube", "BOOM! Con save (DC {DC}) or 2d8 thunder and blasted 10 ft away.")
    sp("Magic Missile", 1, "sorcerer wizard", "A", "120 ft", "{S} glowing darts that NEVER miss: 1d4+1 each.", (3, 1, ""))
    sp("Shield", 1, "sorcerer wizard", "R", "", "When hit, +5 Armor until your next turn. That hit might miss!")
    sp("Mage Armor", 1, "sorcerer wizard", "A", "8 hours", "No armor? Armor becomes 13 + Dex.")
    sp("Sleep", 1, "bard sorcerer wizard", "A", "90 ft", "Roll 5d8: creatures with that many HP (weakest first) fall asleep.")
    sp("Burning Hands", 1, "sorcerer wizard", "A", "15-ft cone", "Flames shoot from your fingers: Dex save (DC {DC}), {S} fire, half if they save.", (3, 1, "d6"))
    sp("Faerie Fire", 1, "bard druid", "A", "60 ft", "Sparkly glow: Dex save or attacks against them get advantage. No hiding!")
    sp("Dissonant Whispers", 1, "bard", "A", "60 ft", "Creepy whisper: Wis save (DC {DC}) or 3d6 psychic and it runs away.")
    sp("Tasha's Hideous Laughter", 1, "bard wizard", "A", "30 ft", "Wis save or it falls down laughing for up to 1 minute.")
    sp("Heroism", 1, "bard paladin", "A", "touch", "A friend can't be scared and gets {MODN} temporary HP every turn.")
    sp("Charm Person", 1, "bard druid sorcerer warlock wizard", "A", "30 ft", "Up to {S} people: Wis save or they think you're their friend for an hour.", (1, 1, ""))
    sp("Feather Fall", 1, "bard sorcerer wizard", "R", "60 ft", "Up to 5 falling people float down gently.")
    sp("Speak with Animals", 1, "bard druid ranger", "A", "", "Talk with animals for 10 minutes.")
    sp("Hex", 1, "warlock", "B", "90 ft", "Curse a creature: +1d6 necrotic every time you hit it.")
    sp("Armor of Agathys", 1, "warlock", "A", "", "Icy armor: {S} temporary HP, and anything that hits you up close takes {S} cold.", (5, 5, ""))
    sp("Hellish Rebuke", 1, "warlock", "R", "60 ft", "Someone hurt you? Hellfire! Dex save (DC {DC}), {S} fire, half if they save.", (2, 1, "d10"))
    sp("Entangle", 1, "druid", "A", "90 ft", "Grabby vines: Str save or stuck in place.")
    sp("Goodberry", 1, "druid ranger", "A", "", "10 magic berries. Each one heals 1 HP and is a full meal.")
    sp("Fog Cloud", 1, "druid ranger sorcerer wizard", "A", "120 ft", "A big cloud of fog nobody can see through.")
    sp("Hunter's Mark", 1, "ranger", "B", "90 ft", "Mark a creature: +1d6 damage every time you hit it.")
    sp("Ensnaring Strike", 1, "ranger", "B", "", "Your next hit grows thorny vines: Str save or stuck.")
    sp("Divine Favor", 1, "paladin", "B", "", "Your weapon hits do +1d4 radiant for 1 minute.")
    sp("Thunderous Smite", 1, "paladin", "B", "", "Your next hit BOOMS: +2d6 thunder; Str save or knocked down and pushed 10 ft.")
    sp("Searing Smite", 1, "paladin", "B", "", "Your next hit sets it on fire: +1d6 fire, and it keeps burning.")
    # level 2
    sp("Scorching Ray", 2, "sorcerer wizard", "A", "120 ft", "{S} fire rays: each {SPATK} to hit, 2d6 fire.", (3, 1, ""))
    sp("Misty Step", 2, "sorcerer warlock wizard", "B", "30 ft", "Poof! Teleport to a spot you can see.")
    sp("Invisibility", 2, "bard sorcerer warlock wizard", "A", "touch", "Up to {S} of you and your friends turn invisible for an hour (ends if you attack).", (1, 1, ""))
    sp("Hold Person", 2, "bard cleric druid sorcerer warlock wizard", "A", "60 ft", "Up to {S} people: Wis save (DC {DC}) or frozen stiff. Hits up close are crits!", (1, 1, ""))
    sp("Spiritual Weapon", 2, "cleric", "B", "60 ft", "Conjure a floating weapon, then swing it every turn with your bonus action: {SPATK} to hit, 1d8{MOD} force.")
    sp("Lesser Restoration", 2, "bard cleric druid paladin ranger", "A", "touch", "Cure poison, sickness, blindness or deafness.")
    sp("Aid", 2, "cleric paladin", "A", "30 ft", "Up to 3 friends get +5 max HP for 8 hours.")
    sp("Moonbeam", 2, "druid", "A", "120 ft", "A beam of moonlight: Con save, 2d10 radiant. Move it each turn.")
    sp("Flaming Sphere", 2, "druid wizard", "A", "60 ft", "A rolling ball of fire: Dex save, 2d6 fire. Roll it around!")
    sp("Heat Metal", 2, "bard druid", "B", "60 ft", "Make metal red-hot: 2d8 fire every turn. They drop it or suffer!")
    sp("Pass without Trace", 2, "druid ranger", "A", "", "Your whole group gets +10 to Stealth for an hour.")
    sp("Shatter", 2, "bard sorcerer warlock wizard", "A", "60 ft", "Painful BOOM in a 10-ft ball: Con save, {S} thunder, half if they save.", (3, 1, "d8"))
    sp("Mirror Image", 2, "sorcerer warlock wizard", "A", "", "3 fake copies of you. Attacks might hit a copy instead.")
    sp("Darkness", 2, "sorcerer warlock wizard", "A", "60 ft", "A 15-ft ball of magical darkness.")
    sp("Spike Growth", 2, "druid ranger", "A", "150 ft", "The ground grows hidden spikes: 2d4 damage for every 5 ft walked.")
    sp("Barkskin", 2, "druid ranger", "A", "touch", "Grow tough tree-bark skin for 1 hour: +1 Armor. That makes your Armor {AC1}.")
    sp("Barkskin (OG)", 2, "druid ranger", "A", "touch", "The old, clunky version: your Armor can't drop below 16 — that's {AC16} for you.", conc=True)
    sp("Silence", 2, "bard cleric ranger", "A", "120 ft", "A 20-ft bubble of total silence. No spells with words inside.")
    sp("Suggestion", 2, "bard sorcerer warlock wizard", "A", "30 ft", "Wis save or it does what you suggest (if it sounds reasonable).")
    sp("Magic Weapon", 2, "paladin wizard", "B", "touch", "A weapon becomes +1 magic for an hour.")
    sp("Find Steed", 2, "paladin", "A", "", "A loyal magic horse (or pony, or camel) comes when you call.")
    sp("Spider Climb", 2, "sorcerer warlock wizard", "A", "touch", "Walk up walls and on ceilings for an hour.")
    sp("Zone of Truth", 2, "bard cleric paladin", "A", "60 ft", "Nobody inside can tell a lie.")
    # level 3
    sp("Fireball", 3, "sorcerer wizard", "A", "150 ft", "KA-BOOM! 20-ft ball of fire: Dex save (DC {DC}), {S} fire, half if they save.", (8, 1, "d6"))
    sp("Lightning Bolt", 3, "sorcerer wizard", "A", "100-ft line", "A giant bolt of lightning: Dex save, 8d6, half if they save.")
    sp("Counterspell", 3, "sorcerer warlock wizard", "R", "60 ft", "Stop an enemy's spell! (Big spells need a roll.)")
    sp("Fly", 3, "sorcerer warlock wizard", "A", "touch", "Up to {S} of you and your friends can fly (60 ft) for 10 minutes.", (1, 1, ""))
    sp("Haste", 3, "sorcerer wizard", "A", "30 ft", "A friend gets double speed, +2 Armor, and an extra action.")
    sp("Hypnotic Pattern", 3, "bard sorcerer warlock wizard", "A", "120 ft", "Swirly colors: Wis save or they stand there, dazed.")
    sp("Spirit Guardians", 3, "cleric", "A", "", "Spirits circle you: enemies near you take 3d8 radiant (Wis save for half) and move slowly.")
    sp("Revivify", 3, "cleric paladin", "A", "touch", "Bring back a friend who died in the last minute, with 1 HP!")
    sp("Mass Healing Word", 3, "cleric", "B", "60 ft", "Up to 6 friends each heal 1d4{MOD}.")
    sp("Beacon of Hope", 3, "cleric", "A", "30 ft", "Friends get advantage on Wis and death saves and heal the most possible.")
    sp("Call Lightning", 3, "druid", "A", "120 ft", "A storm cloud! Each turn, call a bolt: Dex save, 3d10 lightning.")
    sp("Conjure Animals", 3, "druid ranger", "A", "60 ft", "Summon friendly animals (like 2 wolves) to fight with you.")
    sp("Hunger of Hadar", 3, "warlock", "A", "150 ft", "Freezing darkness full of grabby tentacles. Cold and acid damage.")
    sp("Dispel Magic", 3, "bard cleric druid paladin sorcerer warlock wizard", "A", "120 ft", "End a spell on someone or something.")
    sp("Daylight", 3, "cleric druid paladin ranger sorcerer", "A", "60 ft", "A 60-ft ball of sunlight. Magical darkness is gone.")
    sp("Plant Growth", 3, "bard druid ranger", "A", "150 ft", "Plants go wild: everyone moving through crawls super slowly.")
    # level 4
    sp("Polymorph", 4, "bard druid sorcerer wizard", "A", "60 ft", "Turn a creature into an animal! (Wis save if it doesn't want to.)")
    sp("Greater Invisibility", 4, "bard sorcerer wizard", "A", "touch", "Invisible for a minute, even while attacking.")
    sp("Banishment", 4, "cleric paladin sorcerer warlock wizard", "A", "60 ft", "Up to {S} creatures: Cha save or they vanish to another place.", (1, 1, ""))
    sp("Dimension Door", 4, "bard sorcerer warlock wizard", "A", "500 ft", "Teleport far away, and bring a friend.")
    sp("Ice Storm", 4, "druid sorcerer wizard", "A", "300 ft", "Hail! Dex save, 2d8 + 4d6, and the ground gets slippery.")
    sp("Wall of Fire", 4, "druid sorcerer wizard", "A", "120 ft", "A wall of flames: 5d8 fire to anyone who touches it.")
    sp("Death Ward", 4, "cleric paladin", "A", "touch", "The next time a friend would drop to 0 HP, they stay at 1.")
    sp("Guardian of Faith", 4, "cleric", "A", "30 ft", "A giant glowing guardian: enemies who come close take 20 radiant.")
    sp("Freedom of Movement", 4, "bard cleric druid ranger", "A", "touch", "Nothing can slow or trap a friend for an hour.")
    # Concentration spells: you can only keep up one at a time. The sheet shows a "Concentration" marker; no extra rules.
    concentration = {
        "Bane", "Bless", "Detect Magic", "Divine Favor", "Ensnaring Strike", "Entangle", "Faerie Fire", "Fog Cloud",
        "Heroism", "Hex", "Hunter's Mark", "Protection from Evil and Good", "Searing Smite", "Shield of Faith",
        "Tasha's Hideous Laughter", "Barkskin (OG)", "Darkness", "Flaming Sphere", "Heat Metal", "Hold Person", "Invisibility",
        "Magic Weapon", "Moonbeam", "Pass without Trace", "Silence", "Spider Climb", "Spike Growth", "Suggestion",
        "Beacon of Hope", "Call Lightning", "Conjure Animals", "Fly", "Haste", "Hunger of Hadar", "Hypnotic Pattern",
        "Spirit Guardians", "Banishment", "Greater Invisibility", "Polymorph", "Wall of Fire",
    }
    for r in rows:
        if r["name"] in concentration:
            r["card"]["conc"] = True
    return pl.DataFrame(rows, schema=SPELL_SCHEMA)


# --------------------------------------------------------------------------- armor
# default_level: the builder only picks this armor for you from this level on (you can always choose it)
ARMOR_TABLE_SCHEMA = {"name": pl.Utf8, "kind": pl.Utf8, "base": pl.Int64, "dex_cap": pl.Int64, "str_req": pl.Int64,
                      "default_level": pl.Int64}


WEAPON_TABLE_SCHEMA = {"name": pl.Utf8, "cat": pl.Utf8, "die": pl.Utf8, "ability": pl.Utf8, "hands": pl.Utf8, "note": pl.Utf8}


def weapons_table() -> pl.DataFrame:
    """Melee weapons a hero can swap in as their main weapon (FIN = Strength or Dexterity, whichever is better)."""
    rows = [("Club", "simple", "1d4", "STR", "one", ""), ("Dagger", "simple", "1d4", "FIN", "one", "throw 20 ft"),
            ("Greatclub", "simple", "1d8", "STR", "two", ""), ("Handaxe", "simple", "1d6", "STR", "one", "throw 20 ft"),
            ("Javelin", "simple", "1d6", "STR", "one", "throw 30 ft"), ("Mace", "simple", "1d6", "STR", "one", ""),
            ("Quarterstaff", "simple", "1d6", "STR", "two", ""), ("Sickle", "simple", "1d4", "STR", "one", ""),
            ("Spear", "simple", "1d6", "STR", "one", "throw 20 ft"),
            ("Battleaxe", "martial", "1d8", "STR", "one", ""), ("Flail", "martial", "1d8", "STR", "one", ""),
            ("Longsword", "martial", "1d8", "STR", "one", ""), ("Morningstar", "martial", "1d8", "STR", "one", ""),
            ("Warhammer", "martial", "1d8", "STR", "one", ""), ("Rapier", "martial", "1d8", "FIN", "one", ""),
            ("Scimitar", "martial", "1d6", "FIN", "one", ""), ("Shortsword", "martial", "1d6", "FIN", "one", ""),
            ("Whip", "martial", "1d4", "FIN", "one", "reach 10 ft"), ("Trident", "martial", "1d6", "STR", "one", "throw 20 ft"),
            ("Greataxe", "martial", "1d12", "STR", "two", ""), ("Greatsword", "martial", "2d6", "STR", "two", ""),
            ("Maul", "martial", "2d6", "STR", "two", ""), ("Glaive", "martial", "1d10", "STR", "two", "reach 10 ft"),
            ("Halberd", "martial", "1d10", "STR", "two", "reach 10 ft")]
    return pl.DataFrame([dict(zip(WEAPON_TABLE_SCHEMA, r)) for r in rows], schema=WEAPON_TABLE_SCHEMA)


def armor_table() -> pl.DataFrame:
    rows = [("Leather armor", "light", 11, 99, 0), ("Studded leather", "light", 12, 99, 0),
            ("Hide armor", "medium", 12, 2, 0), ("Chain shirt", "medium", 13, 2, 0), ("Scale mail", "medium", 14, 2, 0),
            ("Breastplate", "medium", 14, 2, 0), ("Half plate", "medium", 15, 2, 0),
            ("Ring mail", "heavy", 14, 0, 0), ("Chain mail", "heavy", 16, 0, 13), ("Splint armor", "heavy", 17, 0, 15),
            ("Plate armor", "heavy", 18, 0, 15, 4)]
    rows = [r if len(r) == 6 else r + (1,) for r in rows]
    return pl.DataFrame([dict(zip(ARMOR_TABLE_SCHEMA, r)) for r in rows], schema=ARMOR_TABLE_SCHEMA)


# --------------------------------------------------------------------------- potions & magic items
ITEM_SCHEMA = {"name": pl.Utf8, "rarity": pl.Utf8, "tier": pl.Int64, "min_level": pl.Int64, "use_by": pl.List(pl.Utf8), "card": CARD,
               "uses": pl.Int64, "rest": pl.Utf8}


def items_table() -> pl.DataFrame:
    rows = []

    def it(name, rarity, tag, desc, note="", uses=1, rest="used"):
        tier, lvl = {"common": (1, 1), "uncommon": (2, 3), "rare": (3, 5)}[rarity]
        rows.append({"name": name, "rarity": rarity, "tier": tier, "min_level": lvl, "use_by": [],
                     "card": {"name": name, "tag": tag, "note": note or rarity, "desc": desc, "conc": False}, "uses": uses, "rest": rest})

    it("Potion of Healing", "common", "A", "Glug glug! Heal 2d4+2. You can also pour it into a friend at 0 HP to wake them up.")
    it("Potion of Climbing", "common", "A", "For 1 hour you climb as fast as you walk, and climbing checks are easy (advantage).")
    it("Alchemist's Fire", "common", "A", "Throw it (20 ft): d20 + Dex to hit. Whoosh! 1d4 fire every turn until they spend an action patting it out.")
    it("Acid Vial", "common", "A", "Throw it (20 ft): d20 + Dex to hit. Splash! 2d6 acid.")
    it("Holy Water", "common", "A", "Throw it (20 ft) at undead or fiends: d20 + Dex to hit. Sizzle! 2d6 radiant.")
    it("Smoke Bomb", "common", "A", "Throw it: a 20-ft cloud of thick smoke for 1 minute. Nobody can see in or through it. Great for escaping!")
    it("Potion of Greater Healing", "uncommon", "A", "Heal 4d4+4.")
    it("Potion of Fire Breath", "uncommon", "B", "Drink it, then breathe fire (bonus action) up to 3 times in the next hour: "
       "30 ft at one target, Dex save (DC 13) or 4d6 fire, half if they save.", uses=1)
    it("Potion of Growth", "uncommon", "A", "You grow HUGE for 10 minutes: twice as big, advantage on Strength, and your weapon hits do +1d4.")
    it("Potion of Hill Giant Strength", "uncommon", "A", "For 1 hour your Strength is 21: hit and smash like a giant (+5 Strength).")
    it("Potion of Water Breathing", "uncommon", "A", "Breathe underwater for 1 hour.")
    it("Potion of Animal Friendship", "uncommon", "A", "For 1 hour, talk animals into being your friend (Wis save DC 13 or they're charmed).")
    it("Dust of Disappearance", "uncommon", "A", "Throw it in the air: you and friends within 10 ft turn invisible for 2d4 minutes (ends if you attack).")
    it("Bag of Tricks", "uncommon", "A", "Pull out a fuzzy ball and throw it: it becomes a random animal friend that fights for you (ask the DM which!).",
       note="3 per day", uses=3, rest="long")
    it("Wand of Magic Missiles", "uncommon", "A", "Point and zap: 3 glowing darts that never miss, 1d4+1 each.", note="7 charges", uses=7, rest="long")
    it("Potion of Superior Healing", "rare", "A", "Heal 8d4+8. BIG heal!")
    it("Potion of Heroism", "rare", "A", "For 1 hour: 10 temporary HP, and add 1d4 to attacks and saves. Can't be scared.")
    it("Potion of Gaseous Form", "rare", "A", "Turn into a cloud of mist for 1 hour: fly, slip under doors, and weapons barely hurt you.")
    it("Potion of Mind Reading", "rare", "A", "For 1 minute, hear what a creature you can see is thinking.")
    it("Potion of Diminution", "rare", "A", "Shrink to mouse size for 1d4 hours: sneak through tiny holes and be very hard to spot.")
    it("Necklace of Fireballs", "rare", "A", "Pull off a bead and throw it (60 ft): KA-BOOM, 20-ft fireball, Dex save (DC 15) or 5d6 fire.",
       note="3 beads", uses=3)
    return pl.DataFrame(rows, schema=ITEM_SCHEMA)


def default_tables() -> dict[str, pl.DataFrame]:
    return {
        "rules": rules_table(), "skills": skills_table(), "slots": slots_table(), "races": races_table(),
        "subraces": subraces_table(),
        "classes": classes_table(), "subclasses": subclasses_table(), "scaling": scaling_table(),
        "features": features_table(), "choices": choices_table(), "spells": spells_table(),
        "items": items_table(), "armor": armor_table(), "weapons": weapons_table(),
    }
