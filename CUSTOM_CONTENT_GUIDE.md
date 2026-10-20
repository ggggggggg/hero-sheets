# Hero Sheet Builder: how to write a custom content file

These instructions are for an AI assistant (or a person) writing **custom content** for the Hero Sheet Builder: new races, subraces, classes, subclasses, features, spells, potions and magic items, weapons and armor. The builder makes 2-page character sheets for D&D-style games at levels 1 to 7. The sheets are written for kids, about 9 years old and up, and the adults playing with them.

## What to hand back

Hand back **one JSON file named `hero-custom.json`** with this shape:

```json
{
  "title": "Short name for this pack",
  "races": [ ... ],
  "spells": [ ... ]
}
```

- It must be **strict JSON**: double quotes, no trailing commas and no comments.
- Include only the tables you need. Allowed tables: `races`, `subraces`, `classes`, `subclasses`, `features`, `choices`, `scaling`, `spells`, `items`, `weapons`, `armor`. Optional extras: `title`, `about`, `emoji`, and `heroes` (ready-made characters, see below).
- `emoji` is one mark, such as `"✦"`, shown after every name from this pack. Leave it out and the names stay plain. Built-in choices have no mark.
- **Leave out any field you don't need.** Missing fields get the defaults listed below. Unknown fields are an error, which keeps typos from slipping in.
- A row whose key matches an existing row **replaces** it. For example, `{"id": "dwarf", ...}` in `races` changes the built-in Dwarf. A row with a new key is **added**.
- The user loads it with "Load a file" in the builder, or pastes a link to it (see below).
- The builder test-builds every hero your content touches and lists any problems. If the user pastes those problems back to you, fix the file.

## Sharing a file with a link (optional)

The builder can also load the file from a web link. It reads the file as data and never runs it. The site hosting the file has to allow other pages to read it, which is called CORS. Hosts that do:

- **GitHub Gist:** make a gist, paste the file and click **Raw**. Use that `https://gist.githubusercontent.com/...` link.
- **GitHub repository:** use the `raw.githubusercontent.com/...` link, or `https://cdn.jsdelivr.net/gh/USER/REPO@main/hero-custom.json`.

Google Drive and Dropbox "share" links usually **don't** allow it, so they fail with "Couldn't read that link".

To share a builder that preloads your pack, add `?custom=` and the link to the address of the downloaded builder file. A saved link is checked for updates every time the builder opens.

## Writing style for the card text

- Talk to the player as "you". Write short and punchy: one or two sentences per card. Kid-friendly and fun ("KA-BOOM!", "Glug glug!").
- Skip boring rules details: no spell components, no concentration rules and no long conditions. Give only the numbers the player needs (to hit, save DC, damage, range).
- Use **placeholders** in braces, so numbers come out right for each hero and level. Writing `{DC}` prints the hero's real save DC. An unknown placeholder is an error.

### Placeholders you can use in `desc`, `note` and tracker `uses`

| Placeholder | Means |
|---|---|
| `{LVL}` | character level |
| `{PROF}` | proficiency bonus (+2 to +3) |
| `{HALFPROF}`, `{HALFPROFUP}` | half proficiency, rounded down or up |
| `{STR}` `{DEX}` `{CON}` `{INT}` `{WIS}` `{CHA}` | ability modifier with sign, e.g. `+3` |
| `{STRN}` `{DEXN}` ... `{CHAN}` | the same modifier as a plain number, e.g. `3` |
| `{SPATK}` | spell attack bonus (spellcasting classes only) |
| `{DC}` | spell save DC (spellcasting classes only) |
| `{MOD}`, `{MODN}` | spellcasting modifier with sign; `{MODN}` is a plain number, at least 1 |
| `{CHADC}` `{CONDC}` `{DC_WIS}` | save DC of 8 + proficiency + that ability (works for any class) |
| `{MANDC}` | 8 + proficiency + the better of STR and DEX |
| `{INTATK}` | proficiency + INT, as an attack bonus |
| `{CHANMIN1}`, `{WISMIN1}` | CHA or WIS modifier, at least 1 |
| `{CD}` | cantrip dice count: 1 at levels 1–4, 2 at levels 5–7 (write `{CD}d10`) |
| `{S}` | spells only: the spell's scaled amount (see `scale`) |
| your own | anything you define in `scaling`, or in a choice option's `effect.vars` |

## Tables and fields

Below, the value after each field is its default. Fields marked **required** have no default and must be given.

### `races`
```json
{"id": "turtlefolk", "name": "Turtle-folk", "speed": 25, "swim": 30,
 "asi": {"STR": 2, "DEX": 0, "CON": 1, "INT": 0, "WIS": 0, "CHA": 0},
 "skills": ["Survival"], "hp_per_level": 0, "languages": "Common, Aquan"}
```
- `id` and `name` are **required**. Ids are lowercase with no spaces.
- `speed` (default 30) is walking speed in feet.
- `swim` (default 0) is swim speed in feet. Leave it out when the race does not swim. Heavy armor that the hero is not strong enough for slows swim speed by 10 ft too.
- `asi` (default all 0) is the race's usual ability bonus. Players can move it around in the builder.
- `skills` (default `[]`) are skills the race is trained in. Use the exact names from the skill list below.
- `hp_per_level` (default 0) is extra HP for every level.
- `languages` defaults to `"Common"`.
- Give a race its powers with `features` rows using `"owner_kind": "race"`.

### `subraces`
```json
{"id": "sea_turtle", "race_id": "turtlefolk", "name": "Sea Turtle-folk", "asi": {"DEX": 1}, "speed": 5}
```
- `id`, `race_id` and `name` are **required**.
- The other fields are added on top of the race: `asi` (default 0s), `speed` (0), `hp_per_level` (0), `skills` (`[]`), and `armor_prof_add` (`[]`, any of `"light"`, `"medium"`, `"heavy"`).
- The first subrace listed for a race is its default. Features use `"owner_kind": "subrace"`.
- A subrace's `name` is shown as the hero's race.

### `classes`
```json
{"id": "tinkerer", "name": "Tinkerer", "hit_die": 8,
 "primary": ["INT", "DEX", "CON", "WIS", "CHA", "STR"], "saves": ["INT", "CON"],
 "skills": ["Investigation", "Arcana"], "armor_prof": ["light", "medium"], "shield_prof": true, "shield_default": false,
 "weapons": [{"name": "Hammer", "die": "1d8", "ability": "STR"},
             {"name": "Hand crossbow", "die": "1d6", "ability": "DEX", "kind": "ranged", "note": "30 ft"}],
 "weapon_prof": ["simple"], "melee_slot": 0,
 "caster": {"kind": "half", "ability": "INT", "mode": "prepared", "level_mult": 0.5, "cap": 6},
 "spell_order": ["Cure Wounds", "Faerie Fire"], "cantrip_order": [],
 "look": {"accent": "#8a5a00", "tagline": "Builds gadgets that go ZAP."},
 "gear": ["Hammer", "Hand crossbow + 20 bolts", "Tinker's tools"]}
```
- `id` and `name` are **required**.
- `hit_die` (default 8) is one of 6, 8, 10 or 12.
- `primary` (default STR, DEX, CON, INT, WIS, CHA) lists all six abilities, most important first. The standard array 15/14/13/12/10/8 goes in that order, and level-up boosts go to the first ones.
- `saves` (default `[]`) are the abilities whose saving throws the class is trained in.
- `skills` (default `[]`) are trained skills. `expertise` (default `[]`) is a list like `[{"lvl": 1, "skills": ["Stealth"]}]`, which doubles those skills from that level.
- `armor` is unarmored defense: base 10 + DEX + the abilities listed in `add`. Default `{"base": 10, "dex_cap": 99, "add": [], "shield": 0, "worn": false}`. A barbarian-style class uses `"add": ["CON"]`.
- `armor_prof` (default `[]`) can hold `"light"`, `"medium"` and `"heavy"`. The builder puts on the best-fitting armor by itself.
- `shield_prof` and `shield_default` (both false) control whether the class can carry a shield, and whether it starts with one.
- `weapons` (default `[]`) are the attacks on the sheet. Each one has:
  - `name` (**required**);
  - `die`: like `"1d8"`, or a placeholder;
  - `ability`: `"STR"`, `"DEX"`, `"FIN"` (the better of STR and DEX) or `"SPELL"` (uses the spellcasting ability);
  - `kind`: `"melee"` or `"ranged"`;
  - `hands`: `"one"` or `"two"`, or `"light"` for a pair of weapons;
  - `note`: range text such as `"80 ft"` or `"throw 20 ft"`.
- `weapon_prof` (default `["simple"]`) holds `"simple"`, `"martial"` and/or exact weapon names. `melee_slot` (default -1) says which `weapons` entry the player may swap for another weapon they're trained with. Use -1 for no swap.
- `caster` sets up spellcasting. Default `{"kind": "none", ...}`, meaning no spells. Its fields:
  - `kind`: `"full"` (like a wizard), `"half"` (like a paladin: spells start at level 2), `"pact"` (like a warlock: few slots that come back on a short rest, always cast at the highest level) or `"none"`;
  - `ability`: the spellcasting ability;
  - `cantrips`: 7 numbers, one for each of levels 1–7;
  - `mode`: `"known"` uses `known`, 7 numbers for spells known; `"prepared"` uses ability mod + floor(level × `level_mult`), capped at `cap`.
- `spell_order` and `cantrip_order` (default `[]`) list the spells a new hero starts with, in order. Every name must exist in `spells`, either built-in or in your file.
- `subclass_level` (default 3) is when the subclass (called "Path" in the builder) kicks in. `asi_levels` (default `[4]`) are the levels with a +2 ability boost. `speed_bonus` (default seven 0s) is extra speed at each of levels 1–7.
- `look` sets the sheet's `accent` color as a hex color, and `tagline`, a one-line pitch shown under the name.
- `gear` (default `[]`) is the inventory list. If an entry exactly matches the swappable weapon's name, it follows the swap.
- Every class should have at least one subclass, plus `features` rows for its powers.

### `subclasses`
```json
{"id": "pirate", "class_id": "rogue", "name": "Pirate", "hp_per_level": 0,
 "extra_skills": ["Athletics"], "extra_cantrips": [], "auto_spells": [], "armor_prof_add": []}
```
- `id`, `class_id` and `name` are **required**.
- `hp_per_level`, `extra_skills`, `extra_cantrips` (spell names) and `armor_prof_add` all apply once the class's `subclass_level` is reached.
- `auto_spells` are always-prepared spells: `[{"lvl": 3, "spell": "Fog Cloud"}]`.
- `armor` (default null) replaces the class's unarmored defense.

### `features` — the power cards
```json
{"owner_kind": "subclass", "owner_id": "pirate", "lvl": 3,
 "card": {"name": "Swashbuckle", "tag": "B", "note": "", "desc": "Swing on a rope or chandelier up to 30 ft, then attack with {DEX} to hit."},
 "tracker": {"uses": "{PROF}", "rest": "long"}}
```
- `owner_kind` is `"race"`, `"subrace"`, `"class"` or `"subclass"`. `owner_id` is that row's `id`. Both are **required**.
- `lvl` (default 1) is the level the card appears at.
- `card` has:
  - `name` (**required**);
  - `tag`: `"A"` (action), `"B"` (bonus action), `"R"` (reaction), `"ON"` (always on, the default) or `"F"` (free);
  - `note`: tiny text such as a range;
  - `desc`: the card text.
  - `conc` (default `false`): set `true` for a spell that needs concentration. The card shows a "Concentration" marker; no other rules text is added. (Mostly used on `spells`.)
- `tracker` adds tick boxes:
  - `uses`: how many, e.g. `"2"` or `"{PROF}"`. Leave it empty for none.
  - `rest`: when they come back. `"short"`, `"long"`, `"turn"` or `"used"` (gone once used).
- A row with the same owner and card name as a built-in card replaces that card. To make a power grow with level, don't add a second card: use a `scaling` placeholder in its text (see `scaling` below).

### `choices` — pick-one or pick-several options (like Fighting Style)
```json
{"owner_kind": "class", "owner_id": "tinkerer", "group": "gadget", "label": "Favorite Gadget",
 "count": [1, 1, 1, 1, 1, 2, 2],
 "options": [{"name": "Zap Glove", "tag": "A", "desc": "Touch: {SPATK} to hit, 1d10 lightning."},
             {"name": "Grapple Gun", "tag": "B", "desc": "Zip 30 ft to a spot you can see."}]}
```
- `group` is a **required** id, unique per owner. `label` is the heading shown in the builder.
- `count` gives how many to pick at each of levels 1–7. Use 0 for "not yet".
- Each option has `name` (**required**), `tag` and `desc`.
- An option can also have `effect`: `{"ac": 1}` adds Armor while wearing armor; `"ranged_hit"` adds to ranged to-hit; `"onehand_dmg"` adds damage with one-handed melee weapons; `"vars"` is `[{"key": "MYVAR", "value": "2d6"}]` and defines placeholders.

### `scaling` — your own placeholders that change by level
```json
{"owner_kind": "class", "owner_id": "tinkerer", "key": "ZAP", "values": ["1d6", "1d6", "1d8", "1d8", "2d6", "2d6", "2d8"]}
```
- Seven text values, one for each of levels 1–7. Use them as `{ZAP}` in that owner's cards.

### `spells`
```json
{"name": "Bubble Shield", "lvl": 1, "classes": ["wizard", "tinkerer"],
 "card": {"tag": "R", "note": "self", "desc": "POP! A bubble gives you +5 Armor until your next turn."}}
```
- `name` is **required**.
- `lvl` 0 means a cantrip; otherwise it's the spell level, 1 to 4.
- `classes` lists the class ids that can pick it.
- `card.name` defaults to the spell name and `card.tag` defaults to `"A"`.
- `scale` is optional and makes `{S}` work. With `{"base": 3, "per": 1, "unit": "d6"}`, `{S}` prints "3d6", plus `per` for each slot level above the spell's level. Only pact casters (warlock-style) cast above the base level automatically. Others always show `base`.

### `items` — potions and magic items
```json
{"name": "Potion of Bounciness", "rarity": "uncommon",
 "card": {"tag": "A", "desc": "Glug! For 1 minute you jump 3 times as far and take no falling damage."},
 "uses": 1, "rest": "used"}
```
- `rarity`: `"common"` (any level), `"uncommon"` (level 3 and up) or `"rare"` (level 5 and up). It sets `tier` and `min_level` unless you give them yourself.
- `use_by` (default `[]`, meaning anyone) lists class ids that can normally use the item, e.g. `["wizard", "sorcerer"]`. Heroes can still pick it, but the builder shows a "talk to your DM" warning, and it's never handed out automatically to other classes.
- `uses` (default 1) gives tick boxes. `rest` is `"used"` (gone once used) or `"long"` (charges come back each long rest).

### `weapons` — melee weapons heroes can swap in
```json
{"name": "Anchor", "cat": "martial", "die": "2d6", "ability": "STR", "hands": "two", "note": "reach 10 ft"}
```
- `cat` is `"simple"` or `"martial"` and is matched against a class's `weapon_prof`. `ability` is `"STR"` or `"FIN"`.

### `armor`
```json
{"name": "Coral armor", "kind": "medium", "base": 14, "dex_cap": 2, "str_req": 0, "default_level": 1}
```
- `kind` is light, medium or heavy.
- Armor value = `base` + DEX, but at most `dex_cap` from DEX. Use 99 for no cap, or 0 for "DEX doesn't help".
- `str_req` is the Strength needed to wear it without moving 10 ft slower.
- `default_level` is the lowest level at which the builder hands out this armor by default.

### `heroes` — ready-made characters (optional)
These show up as "Start as ..." buttons, with every pick already made.
```json
{"name": "Shelly", "race": "turtlefolk", "cls": "rogue", "subclass": "pirate", "level": 3,
 "choices": {"invocations": ["Agonizing Blast"]}, "cantrips": [], "spells": [], "items": ["Potion of Bounciness"],
 "armor": "Leather armor", "weapon": "Rapier", "base_scores": {"STR": 8, "DEX": 15, "CON": 14, "INT": 10, "WIS": 12, "CHA": 13},
 "notes": "Never leaves a friend behind."}
```
- `name`, `race` and `cls` are **required**. Everything else is optional and falls back to the builder's usual picks.
- Other fields you can use: `subrace`, `subclass`, `level`, `choices` (choice group → list of picks), `cantrips`, `spells`, `path_spells`, `items`, `armor`, `shield` (true/false), `weapon`, `base_scores` (before race bonus), `race_asi` (race bonus, 0–3 each), `inventory` (list of lines), `notes`, `portrait` (an image `data:` URL), `portrait_credit`.

## Skill names (use exactly)

Acrobatics, Animal Handling, Arcana, Athletics, Deception, History, Insight, Intimidation, Investigation, Medicine, Nature, Perception, Performance, Persuasion, Religion, Sleight of Hand, Stealth, Survival.

## Built-in ids you can hook into

- **Classes:** barbarian, bard, cleric, druid, fighter, monk, paladin, ranger, rogue, sorcerer, warlock, wizard.
- **Races:** human, dwarf, elf, halfling, gnome, halforc, tiefling, dragonborn.
- **Subraces:** hill and mountain (dwarf), wood and high (elf), lightfoot and stout (halfling), rock and forest (gnome).

## Checklist before you answer

1. Strict JSON, and the file is named `hero-custom.json`.
2. Every new class has a subclass and some `features`. Every `owner_id`, `class_id`, `race_id` and spell name you mention exists, either built-in or in this file.
3. Lists that go by level (`count`, `cantrips`, `known`, `speed_bonus`, scaling `values`) have exactly 7 entries.
4. Only placeholders from the table above, or ones you defined yourself.
5. Keep it fun, short and balanced next to the built-in content (levels 1–7).

## Full example file

```json
{
  "title": "Turtles & Pirates",
  "races": [
    {"id": "turtlefolk", "name": "Turtle-folk", "speed": 25, "swim": 30, "asi": {"STR": 2, "CON": 1}, "languages": "Common, Aquan"}
  ],
  "features": [
    {"owner_kind": "race", "owner_id": "turtlefolk", "card": {"name": "Shell Defense", "tag": "A",
      "desc": "Pull into your shell: +10 Armor and resistance to all damage. You can't move or attack until you pop out (bonus action)."}},
    {"owner_kind": "race", "owner_id": "turtlefolk", "card": {"name": "Hold Breath", "desc": "Hold your breath for 1 hour."}},
    {"owner_kind": "subclass", "owner_id": "pirate", "lvl": 3, "card": {"name": "Swashbuckle", "tag": "B",
      "desc": "Swing on a rope up to 30 ft, then your next attack this turn gets {PROF} extra damage."},
      "tracker": {"uses": "{PROF}", "rest": "long"}}
  ],
  "subclasses": [
    {"id": "pirate", "class_id": "rogue", "name": "Pirate", "extra_skills": ["Athletics"]}
  ],
  "spells": [
    {"name": "Bubble Shield", "lvl": 1, "classes": ["wizard", "sorcerer"],
     "card": {"tag": "R", "note": "self", "desc": "POP! A bubble gives you +5 Armor until your next turn."}}
  ],
  "items": [
    {"name": "Potion of Bounciness", "rarity": "uncommon",
     "card": {"desc": "Glug! For 1 minute you jump 3 times as far and take no falling damage."}}
  ],
  "weapons": [
    {"name": "Anchor", "cat": "martial", "die": "2d6", "hands": "two", "note": "reach 10 ft"}
  ]
}
```

## PAF packs

The PAF page (`paf.html`) has its own packs. A PAF pack is not a D&D pack. It needs `"kind": "paf"`. A row with the same `id` (origins and capstones) or the same `name` (everything else) replaces the built-in row. A new key is added. The built-in set still needs an origin whose id is `baseline`.

Allowed lists: `origins`, `skills`, `armor`, `weapons`, `flux`, `relics`, `capstones`, `heroes`. Optional: `title`, `about`.

An origin needs `id`, `name`, `primary` (STR, DEX, CON, INT, WIS, or CHA), `skill` (one of the ten PAF skills), `trait`, `novice`, `utility`, `expert`, and `crit`. Powers use `{LVL}` and `{STRATK}` `{DEXATK}` `{CONATK}` `{INTATK}` `{WISATK}` `{CHAATK}`. Do not use `{PROF}`.

```json
{
  "kind": "paf",
  "title": "Lamp-saint",
  "about": "One more origin.",
  "origins": [
    {
      "id": "lampsaint",
      "name": "Lamp-saint",
      "primary": "WIS",
      "skill": "Insight",
      "speed": 30,
      "speaks": "Trade-talk",
      "accent": "#f4c430",
      "tagline": "A walking lantern.",
      "trait": "Your head is a lamp. You can shine or go dark.",
      "novice": { "name": "Lantern beam", "tag": "A", "desc": "To hit {WISATK}, range 40 ft. Damage 1d8 radiant." },
      "utility": { "name": "Warm light", "tag": "B", "desc": "Once a fight, one friend you can see heals 1d6." },
      "expert": { "name": "Blinding flash", "tag": "A", "desc": "Once a fight, creatures next to you can't see you until your next turn." },
      "crit": { "name": "Sunspot", "desc": "On a crit, the target can't hide until your next turn." }
    }
  ]
}
```
