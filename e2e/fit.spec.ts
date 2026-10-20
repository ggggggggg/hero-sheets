import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { FIT_PASS_PX } from "../src/fit";
import { measureSheet } from "./helpers";

interface OriginCard {
  id: string;
  trait: string;
  novice: { name: string; desc: string };
  utility: { name: string; desc: string };
  expert: { name: string; desc: string };
  crit: { name: string; desc: string };
}

interface SubRow {
  id: string;
  class_id: string;
  name: string;
}

const content = JSON.parse(readFileSync("src/content.json", "utf8")) as { subclasses: SubRow[] };
const fpa = JSON.parse(readFileSync("examples/mutants-and-meltdowns.json", "utf8")) as {
  races: { id: string }[];
  subclasses: SubRow[];
};

test.describe.configure({ timeout: 180_000 });

test("every built-in subclass at level 7 is two pages and the back fits", async ({ page }) => {
  await boot(page);
  const bad = await checkAll(page, "human", content.subclasses);
  expect(bad).toEqual([]);
});

test("every Mutants & Meltdowns subclass at level 7 fits on two pages", async ({ page }) => {
  await boot(page, "/?pack=mutants-and-meltdowns.json");
  await page.waitForSelector(".chip-btn:has-text('Mutant')");
  const race = fpa.races[0]?.id;
  if (!race) throw new Error("the pack has no race");
  const bad = await checkAll(page, race, fpa.subclasses);
  expect(bad).toEqual([]);
});

test("the wordiest level-10 PAF pair is two pages and the back fits", async ({ page }) => {
  await boot(page, "/paf.html");
  const [first, second] = wordiestPair();
  await page.evaluate(
    ({ first, second }) => {
      const set = window.__setPaf;
      if (!set) throw new Error("missing __setPaf");
      set(first, second, 10);
    },
    { first, second },
  );
  const got = await measureSheet(page);
  expect(got.shown, JSON.stringify(got)).toBe("");
  expect(got.pages, JSON.stringify(got)).toBe(2);
  expect(got.overflow, JSON.stringify(got)).toBe(false);
  expect(got.fs, JSON.stringify(got)).toBeGreaterThanOrEqual(FIT_PASS_PX);
});

async function boot(page: Page, url = "/"): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();
    window.CHARSHEET_FIXED_START = true;
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(url);
  await page.waitForSelector("#scaler .page.back");
}

async function checkAll(page: Page, race: string, subs: SubRow[]): Promise<string[]> {
  const bad: string[] = [];
  for (const sub of subs) {
    await page.evaluate(
      ({ race, cls, sub, level }) => {
        const set = window.__setHero;
        if (!set) throw new Error("missing __setHero");
        set(race, cls, sub, level);
      },
      { race, cls: sub.class_id, sub: sub.id, level: 7 },
    );
    const got = await measureSheet(page);
    if (got.pages !== 2 || got.overflow || !(got.fs >= FIT_PASS_PX) || got.shown) {
      bad.push(`${sub.class_id}/${sub.id} ${JSON.stringify(got)}`);
    }
  }
  return bad;
}

function wordiestPair(): [string, string] {
  const paf = JSON.parse(readFileSync("src/paf/content.json", "utf8")) as { origins: OriginCard[] };
  const ranked = paf.origins
    .map((origin) => ({
      id: origin.id,
      words: [origin.trait, origin.novice, origin.utility, origin.expert, origin.crit]
        .map((part) => (typeof part === "string" ? part : `${part.name} ${part.desc}`))
        .join(" ").length,
    }))
    .sort((a, b) => b.words - a.words);
  const first = ranked[0];
  const second = ranked.find((origin) => origin.id !== first?.id);
  if (!first || !second) throw new Error("PAF needs two origins");
  return [first.id, second.id];
}
