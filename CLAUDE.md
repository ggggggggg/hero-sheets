# Hero Sheet Builder: notes for Claude Code

A kids' D&D-style character builder. It turns a few picks into a printable 2-page hero sheet (PDF).

## Layout
- `src/core.ts`: `buildCharacter`, `sheetHtml`, `options`. The rules engine.
- `src/fit.ts`: the shared page-fit and preview scale. `src/text.ts`: placeholders, escaping, PDF names. `src/tags.ts`: the action chips. `src/face.ts`: the cartoon face maker. `src/pack-ui.ts`: the content-pack panel.
- `src/custom.ts`: merges a content pack into the rules tables.
- `src/export.ts`: builds the PDF in the browser.
- `src/app.ts`: the builder UI. `src/main.ts` starts it.
- `src/content.json`: the built-in rules, levels 1–7.
- `src/styles/sheet.css`: the printed sheet. `src/styles/ui.css`: the builder. `src/styles/fonts.css` points at `src/assets/*.woff2`.
- `index.html`: the D&D page shell, including the SRD footer. `paf.html` and `src/paf/` are the post-apocalyptic builder.
- `examples/*.json`: D&D content packs. `examples/paf/*.json`: PAF packs. The build inlines them, so the site does not fetch them.
- `CUSTOM_CONTENT_GUIDE.md`: the pack format, written for an AI to follow. The builder links to it.

## Commands
```bash
npm install
npm run dev          # local builder
npm test             # vitest: every combo, pack merge, fuzz
npm run e2e          # playwright: the built site, including the 2-page fit check
npm run demo         # record demo/builder.gif for the README
npm run lint         # biome, including a ban on written `any`
npm run typecheck
npm run build        # dist/index.html and dist/paf.html, each self-contained
```

`npm run build` writes `dist/index.html` and `dist/paf.html`. GitHub Actions publishes `dist/`. Don't hand-edit a generated site.

## Tests
- `tests/build.test.ts` and `tests/custom.test.ts` run against `src/`. Editing a content row a hero uses changes their sheet, and editing a row they don't use changes nothing.
- `e2e/site.spec.ts` checks the live builder, including a fresh random hero, loading a pack, the built-in content toggle, and a fully blocked network.
- `e2e/fit.spec.ts` checks that every subclass at level 7 is exactly two `.page` elements and the back page fits.
- `tools/webkit_check.py` is the old fit checker. The fit check that matters is `npm run e2e`.

## Rules of the house
- Built-in content covers levels 1–7 and every hero has to fit on 2 printed pages. New stuff goes in packs.
- Card text is kid-friendly, short and fun. No spell components or other boring rules details.
- Never say a choice is "best". Defaults are "usually fine", and anything off the usual rules says "talk to your DM".
- A written `any` is a lint error. Pack loading and cartoon-portrait fetches are the places that handle outside data. A throw while building the built-in rules is a bug in the repo.
- Commits use the project identity, not a personal name: `git config user.name "Hero Sheets"` and `git config user.email "hero-sheets@users.noreply.github.com"` (set per repo).

## Publish
`gh auth switch --user ggggggggg`, then commit and `git push`. The Pages workflow deploys `dist/` when `main` updates.
