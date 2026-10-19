import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

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
    await page.waitForFunction(() => {
      const cards = document.querySelector("#scaler .page.back .cards");
      return cards instanceof HTMLElement && getComputedStyle(cards).getPropertyValue("--fs") !== "";
    });
    const got = await page.evaluate(() => {
      const pages = document.querySelectorAll("#scaler .page").length;
      const error = document.querySelector("#error");
      const shown = error instanceof HTMLElement && !error.hidden && error.textContent ? error.textContent : "";
      const cards = document.querySelector("#scaler .page.back .cards");
      if (!(cards instanceof HTMLElement)) return { pages, fs: 0, overflow: true, shown };
      const fs = Number.parseFloat(getComputedStyle(cards).getPropertyValue("--fs"));
      let overflow = cards.scrollHeight > cards.clientHeight + 1 || cards.scrollWidth > cards.clientWidth + 1;
      const box = cards.getBoundingClientRect();
      const tol = 1 + box.width / 400;
      for (const node of cards.querySelectorAll(".cd, .sec h3")) {
        const rect = node.getBoundingClientRect();
        if (rect.right > box.right + tol || rect.bottom > box.bottom + tol) overflow = true;
      }
      return { pages, fs, overflow, shown };
    });
    if (got.pages !== 2 || got.overflow || !(got.fs >= 9.5) || got.shown) {
      bad.push(`${sub.class_id}/${sub.id} ${JSON.stringify(got)}`);
    }
  }
  return bad;
}
