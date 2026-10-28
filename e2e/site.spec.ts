import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { FIT_PASS_PX } from "../src/fit";
import { field, hoverTip, measureSheet } from "./helpers";

const SOLO_PACK = JSON.stringify({
  title: "Solo World",
  races: [{ id: "bot", name: "Robot" }],
  classes: [
    {
      id: "scav",
      name: "Scavenger",
      weapons: [{ name: "Zap Stick", die: "1d6", ability: "STR", kind: "melee", hands: "one", note: "" }],
    },
  ],
});

async function sheetFits(page: Page) {
  return page.evaluate(() => {
    const preview = document.querySelector("#preview");
    const pages = [...document.querySelectorAll("#scaler .page")];
    if (!(preview instanceof HTMLElement) || pages.length < 2) {
      return { inside: false, sideBySide: false, stacked: false };
    }
    const box = preview.getBoundingClientRect();
    const rects = pages.map((node) => node.getBoundingClientRect());
    const inside = rects.every(
      (rect) =>
        rect.width > 40 &&
        rect.left >= box.left - 1 &&
        rect.right <= box.right + 1 &&
        rect.top >= box.top - 1 &&
        rect.bottom <= box.bottom + 1,
    );
    const first = rects[0];
    const second = rects[1];
    if (!first || !second) return { inside, sideBySide: false, stacked: false };
    return {
      inside,
      sideBySide: Math.abs(first.top - second.top) < 4 && second.left > first.right - 2,
      stacked: second.top > first.bottom - 2,
    };
  });
}

test.describe("builder", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      window.CHARSHEET_FIXED_START = true;
    });
    page.on("pageerror", (error) => {
      throw error;
    });
  });

  test("loads, reacts, and keeps the SRD credit", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await expect(page.locator("#scaler .page")).toHaveCount(2);
    await expect(page.locator("#controls .lead")).toHaveText("Build a D&D 5e inspired hero:");
    await page.locator("#open-pdf").hover();
    await expect(page.locator("#tip")).toContainText("That hero comes back");
    await page.locator("#pdf").hover();
    await expect(page.locator("#tip")).toContainText("Saves this hero as a PDF");
    await hoverTip(page, page.locator("#name"));
    await expect(page.locator("#tip")).toContainText("name printed on the sheet");
    await hoverTip(page, page.getByRole("button", { name: "Random name" }));
    await expect(page.locator("#tip")).toContainText("Picks a different one at random");
    await expect(page.locator(".sitefoot")).toContainText("SRD 5.1");
    await expect(page.locator(".sitefoot a[href*='creativecommons.org/licenses/by/4.0/legalcode']")).toHaveCount(1);
    await field(page, "Class").getByRole("button", { name: "Rogue", exact: true }).click();
    await expect(page.locator("#scaler .back .bhead")).toContainText("Rogue");
    await expect(page.locator("#scaler .cd[data-card='Sneak Attack']")).toHaveCount(1);
    await field(page, "Level").getByRole("button", { name: "7", exact: true }).click();
    await expect(page.locator("#scaler .cd[data-card='Evasion']")).toHaveCount(1);
    await expect(page.locator("#controls")).not.toContainText(/best/i);
    await page.locator("#surprise").click();
    await expect(page.locator("#scaler .page")).toHaveCount(2);
  });

  test("the main page does not resume a saved Tobin", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem(
        "charsheet-heroes-v1",
        JSON.stringify({
          current: "h1",
          heroes: [
            {
              id: "h1",
              state: { name: "Tobin", race: "dwarf", cls: "warlock", level: 5 },
              edited: true,
              updated: 1,
            },
          ],
        }),
      );
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => {
      throw error;
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("html[data-booted='1']");
    await expect(page.locator("#scaler .head .nm")).not.toHaveText(/^Tobin/);
    await page.locator("#heroes-btn").click();
    await expect(page.locator(".heroname", { hasText: "Tobin" })).toHaveCount(1);
    await context.close();

    const kept = await browser.newContext();
    await kept.addInitScript(() => {
      localStorage.setItem(
        "charsheet-heroes-v1",
        JSON.stringify({
          current: "h2",
          heroes: [
            {
              id: "h2",
              state: { name: "Mira", race: "elf", cls: "wizard", level: 3 },
              edited: true,
              updated: 1,
            },
          ],
        }),
      );
    });
    const mira = await kept.newPage();
    mira.on("pageerror", (error) => {
      throw error;
    });
    await mira.goto("/");
    await mira.waitForSelector("html[data-booted='1']");
    await expect(mira.locator("#scaler .head .nm")).toHaveText("Mira");
    await kept.close();
  });

  test("a saved multiclass hero names both classes", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem(
        "charsheet-heroes-v1",
        JSON.stringify({
          current: "h1",
          heroes: [
            {
              id: "h1",
              state: {
                name: "Rune",
                race: "human",
                cls: "rogue",
                subclass: "thief",
                level: 5,
                use_multiclass: true,
                dip: { cls: "bard", subclass: "lore", level: 1, cantrips: null, spells: null, path_spells: null },
              },
              edited: true,
              updated: 1,
            },
          ],
        }),
      );
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => {
      throw error;
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("html[data-booted='1']");
    await page.locator("#heroes-btn").click();
    const saved = page.locator(".heroname");
    await expect(saved).toHaveCount(1);
    await expect(saved).toHaveText("Rune • Rogue (Thief) 4 • Bard 1");
    await context.close();
  });

  test("a fresh visit rolls a random hero", async ({ browser }) => {
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
      await page.goto("/");
      await page.waitForSelector("#scaler .page.back");
      const front = await page.locator("#scaler .front").innerText();
      seen.add(front.slice(0, 80));
      await page.close();
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test("loads a site pack and the built-in toggle keeps a hand-edited hero", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await expect(page.locator("#packs-btn")).toHaveCount(0);
    await expect(page.locator("header.top")).not.toContainText("Content packs");
    await expect(page.locator("#controls > *").last()).toHaveAttribute("id", "optional-rules");
    await expect(page.locator("#content-packs")).not.toHaveAttribute("open", "");
    await page.locator("#content-packs summary").click();
    await expect(page.locator("#content-packs")).toHaveAttribute("open", "");
    await expect(page.locator("#content-packs summary")).toContainText("Content packs");
    await expect(
      page.locator(
        "details.custom a[href='https://github.com/ggggggggg/hero-sheets/blob/main/CUSTOM_CONTENT_GUIDE.md']",
      ),
    ).toHaveCount(1);
    await expect(page.locator("details.custom")).not.toContainText("Download AI");
    await expect(page.locator("details.custom")).not.toContainText("to any AI chat");
    await expect(page.locator("#content-packs").getByRole("button", { name: "add", exact: true })).toHaveCount(0);
    await expect(page.locator("#content-packs").getByRole("button", { name: "remove", exact: true })).toHaveCount(0);
    await page.locator("li", { hasText: "Turtles & Pirates" }).getByRole("checkbox").check();
    await expect(field(page, "Race").getByRole("button", { name: /Turtle-folk/ })).toHaveCount(1);

    await page.locator("#custom-paste").fill(SOLO_PACK);
    await page.getByRole("button", { name: "Add pasted pack" }).click();
    await expect(field(page, "Race").getByRole("button", { name: "Robot", exact: false })).toHaveCount(1);
    await expect(field(page, "Race").getByRole("button", { name: "Tiefling", exact: true })).toHaveCount(1);

    await field(page, "Race").getByRole("button", { name: "Tiefling", exact: true }).click();
    await page.locator("#use-builtin").uncheck();
    await expect(page.locator("#status")).toContainText("safe in Saved heroes");
    await expect(field(page, "Race").getByRole("button", { name: "Tiefling", exact: true })).toHaveCount(0);
    await expect(field(page, "Race").getByRole("button", { name: "Robot", exact: false })).toHaveCount(1);
    await expect(field(page, "Class").getByRole("button", { name: /Scavenger/ })).toHaveCount(1);
    await expect(page.locator("#scaler .page")).toHaveCount(2);
    await page.locator("#heroes-btn").click();
    await expect(page.locator(".heroname")).toHaveCount(2);

    await page.locator("#use-builtin").check();
    await expect(field(page, "Race").getByRole("button", { name: "Tiefling", exact: true })).toHaveCount(1);
  });

  test("shows the pack hero gallery only while a pack with heroes is enabled", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");

    const gallery = page.locator("#pack-heroes");
    await expect(gallery).toBeHidden();
    await page.locator("#content-packs summary").click();
    const tobin = page.locator("li", { hasText: "Tobin aka Flame Master" }).getByRole("checkbox");
    await tobin.check();
    await expect(gallery).toBeVisible();

    await tobin.uncheck();
    await expect(gallery).toBeHidden();
    await tobin.check();
    await expect(gallery).toBeVisible();

    await gallery.click();
    await expect(page.locator("#controls")).toHaveAttribute("aria-label", "Pack Hero Gallery");
    await expect(page.locator("#controls .flabel")).toHaveText("Pack Hero Gallery");
    await expect(page.locator("#premade-note")).toContainText("Tobin aka Flame Master");
  });

  test("armor training shows on the class and on each armor", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await page.locator("#content-packs summary").click();
    await page.locator("li", { hasText: "Tobin aka Flame Master" }).getByRole("checkbox").check();
    const hoverChoice = async (locator: ReturnType<typeof field>) => {
      await locator.scrollIntoViewIfNeeded();
      await page.mouse.move(8, 8);
      await locator.hover();
    };
    const tip = page.locator("#tip");
    const dwarf = field(page, "Race").getByRole("button", { name: "Dwarf", exact: true });
    await hoverChoice(dwarf);
    await expect(tip.getByRole("button", { name: "Mountain Dwarf" })).toBeVisible();
    await tip.getByRole("button", { name: "Mountain Dwarf" }).click();
    await expect(page.locator("#scaler .head .sub")).toContainText("Mountain Dwarf");
    const flame = field(page, "Class").getByRole("button", { name: "Warlock ✦" });
    await flame.click();
    await hoverChoice(flame);
    await expect(tip).toContainText("From Tobin aka Flame Master");
    await expect(tip).toContainText("Armor training");
    await expect(tip).toContainText("light armor");
    await expect(tip).not.toContainText("medium");
    await field(page, "Cantrips").locator("button.sname").first().click();
    await expect(page.locator(".popt", { hasText: "Flame Blast" })).toContainText("From Tobin aka Flame Master");
    await page.locator(".picker").getByRole("button", { name: "Close" }).click();
    await page.locator("#fine-tune summary").click();
    await expect(page.getByRole("button", { name: /Plate armor/ })).toContainText("off book");
    await expect(page.getByRole("button", { name: /Half plate/ })).not.toContainText("off book");
    await hoverChoice(page.getByRole("button", { name: /Half plate/ }));
    await expect(tip).toContainText("Armor training");
    await expect(tip).toContainText("Warlock gives light armor");
    await expect(tip).toContainText("Mountain Dwarf gives light and medium armor");
    await page.getByRole("button", { name: /Plate armor/ }).click();
    await expect(page.locator("#scaler .tile .worn")).toContainText("off book");
    await expect(field(page, "Armor")).toContainText("off the list for this hero. Check with your DM.");
    const plain = field(page, "Class").getByRole("button", { name: "Warlock", exact: true });
    await hoverChoice(plain);
    await expect(tip).toContainText("Armor training");
    await expect(tip).toContainText("light armor");
    await expect(tip).not.toContainText("medium");
    await expect(tip).not.toContainText("From Tobin aka Flame Master");
    await field(page, "Class").getByRole("button", { name: "Cleric", exact: true }).click();
    await hoverChoice(field(page, "Path").getByRole("button", { name: "Life Domain", exact: true }));
    await expect(tip).toContainText("also heavy armor");
  });

  test("the armor section has a shield checkbox", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await page.locator("#fine-tune summary").click();
    const box = field(page, "Armor").getByRole("checkbox", { name: "Adds 2 Armor" });
    await expect(box).toBeVisible();
    await expect(box).not.toBeChecked();
    await box.check();
    const armor = page.locator("#scaler [data-edit='armor']");
    await expect(armor).toContainText("+ shield");
    await expect(armor).toContainText("off book");
    await expect(field(page, "Armor")).toContainText("A shield is off the list for this hero. Check with your DM.");
  });

  test("content packs expand at the bottom of the build column", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForSelector("html[data-booted='1']");
    await expect(page.locator("#packs-btn")).toHaveCount(0);
    await expect(page.locator("header.top")).not.toContainText("Content packs");
    await page.locator("#tab-sheet").click();
    await expect(page.locator("#controls")).toBeHidden();
    await page.locator("#tab-build").click();
    await expect(page.locator("#controls")).toBeVisible();
    await expect(page.locator("#content-packs")).not.toHaveAttribute("open", "");
    const place = await page.evaluate(() => {
      const packs = document.getElementById("content-packs");
      const race = document.querySelector("#controls .field");
      return {
        last:
          packs?.parentElement?.lastElementChild?.id === "optional-rules" &&
          (packs.nextElementSibling?.id === "optional-rules" ||
            (packs.nextElementSibling?.id === "languages" &&
              packs.nextElementSibling.nextElementSibling?.id === "optional-rules")),
        belowRace: packs instanceof HTMLElement && race instanceof HTMLElement && packs.offsetTop > race.offsetTop,
      };
    });
    expect(place.last).toBe(true);
    expect(place.belowRace).toBe(true);
    await page.locator("#content-packs summary").click();
    await expect(page.locator("#content-packs")).toHaveAttribute("open", "");
    await expect(page.locator("#content-packs")).toContainText("Turtles & Pirates");
    const summary = await page.locator("#content-packs summary").boundingBox();
    const header = await page.locator("header.top").boundingBox();
    if (!summary || !header) throw new Error("content packs or the header is missing");
    expect(summary.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  });

  test("the single file still builds a sheet with the network blocked", async ({ browser }) => {
    const file = path.resolve("dist/index.html");
    const html = readFileSync(file, "utf8");
    expect(html).toContain("woff2");
    expect(html).toContain("Build a D&D 5e inspired hero:");
    expect(html).toContain("github.com/ggggggggg/hero-sheets/blob/main/CUSTOM_CONTENT_GUIDE.md");
    expect(html).not.toContain("how to write a custom content file");
    expect(html).not.toMatch(/<(?:script|link)[^>]+(?:src|href)="https?:/);
    expect(html).not.toContain("docs/packs");
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript(() => {
      localStorage.clear();
      window.CHARSHEET_FIXED_START = true;
    });
    await page.route("**", (route) => {
      const url = route.request().url();
      if (url.startsWith("http://") || url.startsWith("https://")) return route.abort();
      return route.continue();
    });
    const context = page.context();
    await context.setOffline(true);
    await page.goto(`file://${file}`);
    await page.waitForSelector("#scaler .page.back");
    await expect(page.locator("#scaler .page")).toHaveCount(2);
    await field(page, "Class").getByRole("button", { name: "Wizard", exact: true }).click();
    await expect(page.locator("#scaler .back .bhead")).toContainText("Wizard");
    await page.close();
  });

  test("feats stay off until chosen, and unmet feats sit at the bottom", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    const rules = page.locator("#optional-rules");
    await rules.locator("summary").click();
    const feats = field(page, "Feats");
    await expect(rules.getByRole("checkbox", { name: "Use feats" })).toHaveCount(1);
    await expect(page.locator("#controls > .field[data-for='feat']")).toHaveCount(0);
    await expect(feats.getByRole("checkbox", { name: "Use feats" })).not.toBeChecked();
    await expect(feats).toContainText("Off. The usual ability boost is on.");
    await feats.getByRole("checkbox", { name: "Use feats" }).check();
    await feats.getByRole("button", { name: /take a feat/ }).click();
    const list = page.locator(".picker");
    const order = await list.innerHTML();
    expect(order.indexOf("For this hero")).toBeLessThan(order.indexOf("Off book"));
    expect(order.indexOf("Tough")).toBeLessThan(order.indexOf("Heavily Armored"));
    const heavy = list.locator(".popt", { hasText: "Heavily Armored" });
    await expect(heavy).toHaveClass(/unmet/);
    await expect(heavy).toHaveClass(/offbook/);
    await heavy.click();
    await expect(feats.locator("li.spell.offbook")).toContainText("Heavily Armored");
    await expect(page.locator("#scaler .cd[data-card='Heavily Armored']")).toContainText("off book");
  });

  test("hovering a stat shows where the score came from, and a click still edits it", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .ab");
    const charisma = page.locator("#scaler .ab", { hasText: "Charisma" });
    await hoverTip(page, charisma);
    await expect(page.locator("#tip")).toContainText("Standard array");
    await expect(page.locator("#tip")).toContainText("Ability boost");
    await expect(page.locator("#tip")).toContainText("level 4");
    await expect(page.locator("#tip")).not.toContainText("Warlock");
    await charisma.locator(".sc").click();
    await expect(page.locator('#controls [data-for="ability:CHA"]')).toHaveClass(/jump/);
    await expect(page.locator("body")).toHaveAttribute("data-view", "build");
    await page.locator("#scaler .ab", { hasText: "Charisma" }).locator(".sv").click();
    await expect(page.locator('#controls [data-for="save:CHA"]')).toHaveClass(/jump/);
  });

  test("hovering a skill shows what adds up, and a click still edits it", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .sk");
    const arcana = page.locator("#scaler .sk", { hasText: "Arcana" });
    await hoverTip(page, arcana);
    await expect(page.locator("#tip")).toContainText("Proficiency");
    await expect(page.locator("#tip")).toContainText("Warlock");
    await arcana.click();
    await expect(page.locator('#controls [data-for="skill:Arcana"]')).toHaveClass(/jump/);
    await expect(page.locator("body")).toHaveAttribute("data-view", "build");
  });

  test("clicking the sheet name jumps to the name field", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .front .nm");
    await page.locator("#scaler .front .nm").click();
    await expect(page.locator('#controls [data-for="name"]')).toHaveClass(/jump/);
    await expect(page.locator("body")).toHaveAttribute("data-view", "build");
  });

  test("on a phone, clicking the sheet switches to the build tab", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForSelector("html[data-booted='1']");
    await page.locator("#tab-sheet").click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "sheet");
    await page.locator("#scaler .front .nm").click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "build");
    await expect(page.locator('#controls [data-for="name"]')).toHaveClass(/jump/);
  });

  test("a level 7 wizard with Magic Initiate still fits on two pages", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await page.evaluate(() => {
      const set = window.__setHero;
      if (!set) throw new Error("missing __setHero");
      set("human", "wizard", null, 7);
    });
    const rules = page.locator("#optional-rules");
    await rules.locator("summary").click();
    const feats = field(page, "Feats");
    await feats.getByRole("checkbox", { name: "Use feats" }).check();
    await feats.getByRole("button", { name: /take a feat/ }).click();
    await page.locator(".popt", { hasText: "Magic Initiate" }).click();
    await expect(page.locator("#scaler .cd[data-card='Magic Initiate']")).toHaveCount(1);
    const got = await measureSheet(page);
    expect(got.shown, JSON.stringify(got)).toBe("");
    expect(got.pages, JSON.stringify(got)).toBe(2);
    expect(got.overflow, JSON.stringify(got)).toBe(false);
    expect(got.fs, JSON.stringify(got)).toBeGreaterThanOrEqual(FIT_PASS_PX);
  });

  test("multiclass is its own switch", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    const rules = page.locator("#optional-rules");
    await rules.locator("summary").click();
    await rules.getByRole("checkbox", { name: "Multiclassing" }).check();
    await field(page, "Second class").getByRole("button", { name: "Wizard", exact: true }).click();
    await expect(page.locator("#scaler .bhead").first()).toContainText("Warlock");
    await expect(page.locator("#scaler .bhead").first()).toContainText("Wizard");
    await expect(page.locator("#scaler .page")).toHaveCount(2);
    const dipped = await measureSheet(page);
    expect(dipped.overflow, JSON.stringify(dipped)).toBe(false);
    expect(dipped.fs, JSON.stringify(dipped)).toBeGreaterThanOrEqual(FIT_PASS_PX);
    await field(page, "Second class").getByRole("button", { name: "Fighter", exact: true }).click();
    const style = page.locator('#controls [data-for="choice:fighter:fighting_style"]');
    await expect(style.locator("ul.picked")).toContainText("Defense");
    await style.getByRole("button", { name: "Archery", exact: true }).click();
    await expect(style.locator("ul.picked")).toContainText("Archery");
    await hoverTip(page, style.getByRole("button", { name: "Archery", exact: true }));
    await expect(page.locator("#tip")).toContainText("ranged weapons");
    await expect(style.getByRole("button", { name: "Random Fighting Style" })).toBeVisible();
    await expect(rules.getByRole("checkbox", { name: "Use feats" })).not.toBeChecked();
    await rules.getByRole("checkbox", { name: "Multiclassing" }).uncheck();
    await expect(page.locator("#scaler .bhead")).not.toContainText("Wizard");
    await expect(page.locator("#scaler .page")).toHaveCount(2);
  });

  test("level popups work for a second class", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await field(page, "Class").getByRole("button", { name: "Bard", exact: true }).click();
    await field(page, "Level").getByRole("button", { name: "5", exact: true }).click();
    const rules = page.locator("#optional-rules");
    await rules.locator("summary").click();
    await rules.getByRole("checkbox", { name: "Multiclassing" }).check();
    await field(page, "Second class").getByRole("button", { name: "Barbarian", exact: true }).click();
    await field(page, "Barbarian level").getByRole("button", { name: "3", exact: true }).click();
    const bard = field(page, "Bard level");
    await expect(page.locator("#scaler .lv b")).toHaveText("5");
    await expect(bard.getByRole("button", { name: "2", exact: true })).toHaveAttribute("aria-pressed", "true");
    const tip = page.locator("#tip");
    await hoverTip(page, bard.getByRole("button", { name: "2", exact: true }));
    await expect(tip).toContainText("Bard level 2");
    await expect(tip).toContainText("HP");
    await expect(tip).toContainText("Berserker) 3");
    await hoverTip(page, bard.getByRole("button", { name: "4", exact: true }));
    await expect(tip).toContainText("Bard level 4");
    await expect(tip).toContainText("Berserker) 3");
    await hoverTip(page, field(page, "Barbarian level").getByRole("button", { name: "2", exact: true }));
    await expect(tip).toContainText("Barbarian level 2");
    await expect(tip).toContainText("HP");
    await expect(tip).toContainText("Lore) 3");
    await bard.getByRole("button", { name: "3", exact: true }).click();
    await expect(page.locator("#scaler .lv b")).toHaveText("6");
    await expect(bard.getByRole("button", { name: "3", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("a rogue level 5 chip does not invent a Charisma boost", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await field(page, "Class").getByRole("button", { name: "Rogue", exact: true }).click();
    await expect(page.locator("#scaler .bhead").first()).toContainText("Rogue");
    const tip = page.locator("#tip");
    await hoverTip(page, field(page, "Level").getByRole("button", { name: "4", exact: true }));
    await expect(tip).toContainText("Stat boost");
    await expect(tip).toContainText("Dexterity");
    await expect(tip).toContainText("level 4");
    await hoverTip(page, field(page, "Level").getByRole("button", { name: "5", exact: true }));
    await expect(tip).not.toContainText("Stat boost");
    const rules = page.locator("#optional-rules");
    await rules.locator("summary").click();
    await rules.getByRole("checkbox", { name: "Multiclassing" }).check();
    await field(page, "Second class").getByRole("button", { name: "Warlock", exact: true }).click();
    await field(page, "Warlock level").getByRole("button", { name: "4", exact: true }).click();
    await expect(page.locator("#scaler .bhead").first()).toContainText("Warlock");
    const rogue = field(page, "Rogue level");
    await expect(rogue).toContainText("ask your DM what level to start at");
    await expect(rogue.getByRole("button", { name: "1", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(rogue.getByRole("button", { name: "5", exact: true })).toHaveCount(0);
    await hoverTip(page, rogue.getByRole("button", { name: "1", exact: true }));
    await expect(tip).not.toContainText("Charisma");
    await hoverTip(page, field(page, "Warlock level").getByRole("button", { name: "4", exact: true }));
    await expect(tip).toContainText("Charisma");
    await expect(tip).toContainText("level 4 Warlock");
  });

  test("a second class names which class gave the ability boost", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await field(page, "Class").getByRole("button", { name: "Bard", exact: true }).click();
    await field(page, "Level").getByRole("button", { name: "6", exact: true }).click();
    const rules = page.locator("#optional-rules");
    await rules.locator("summary").click();
    await rules.getByRole("checkbox", { name: "Multiclassing" }).check();
    await field(page, "Second class").getByRole("button", { name: "Barbarian", exact: true }).click();
    await field(page, "Barbarian level").getByRole("button", { name: "2", exact: true }).click();
    await expect(page.locator("#scaler .bhead").first()).toContainText("Lore) 4");
    await hoverTip(page, page.locator("#scaler .ab", { hasText: "Charisma" }));
    await expect(page.locator("#tip")).toContainText("Ability boost");
    await expect(page.locator("#tip")).toContainText("level 4 Bard");
    await rules.getByRole("checkbox", { name: "Use feats" }).check();
    const feats = field(page, "Feats");
    await expect(feats).toContainText("Bard level 4");
    await expect(feats).toContainText("Barbarian level 4");
    await expect(feats.getByRole("button", { name: /Bard level 4/ })).toBeVisible();
    await expect(feats.getByRole("button", { name: /Barbarian level 4/ })).toBeVisible();
  });

  test("each ability boost can be its own feat", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await page.evaluate(() => {
      const set = window.__setHero;
      if (!set) throw new Error("missing __setHero");
      set("human", "fighter", "champion", 6);
    });
    const rules = page.locator("#optional-rules");
    await rules.locator("summary").click();
    const feats = field(page, "Feats");
    await feats.getByRole("checkbox", { name: "Use feats" }).check();
    const level4 = feats.getByRole("button", { name: /Fighter level 4/ });
    const level6 = feats.getByRole("button", { name: /Fighter level 6/ });
    await expect(level4).toBeVisible();
    await expect(level6).toBeVisible();
    await level4.click();
    await page.locator(".popt", { hasText: "Alert" }).click();
    await level6.click();
    await page.locator(".picker .popt", { hasText: "Tough" }).click();
    await expect(page.locator("#scaler .cd[data-card='Alert']")).toHaveCount(1);
    await expect(page.locator("#scaler .cd[data-card='Tough']")).toHaveCount(1);
    await hoverTip(page, page.locator("#scaler .ab", { hasText: "Strength" }));
    await expect(page.locator("#tip")).not.toContainText("Ability boost");
  });

  test("a multiclass spell line names the class spell", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await field(page, "Class").getByRole("button", { name: "Bard", exact: true }).click();
    await field(page, "Level").getByRole("button", { name: "4", exact: true }).click();
    const rules = page.locator("#optional-rules");
    await rules.locator("summary").click();
    await rules.getByRole("checkbox", { name: "Multiclassing" }).check();
    await field(page, "Second class").getByRole("button", { name: "Barbarian", exact: true }).click();
    await field(page, "Barbarian level").getByRole("button", { name: "2", exact: true }).click();
    const magic = page.locator("#scaler .magic");
    await expect(magic).toContainText("Bard spell");
    await expect(magic).not.toContainText("Bard attack");
    await expect(page.locator("#scaler .bhead").first()).toContainText("Bard 2");
    await expect(page.locator("#scaler .bhead").first()).toContainText("Barbarian 2");
  });

  test("a hero can carry more than one weapon", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .atk");
    await page.evaluate(() => {
      const set = window.__setHero;
      if (!set) throw new Error("missing __setHero");
      set("dwarf", "warlock", "fiend", 5);
    });
    await expect(page.locator("#scaler .atk")).toContainText("Dagger");
    await expect(page.locator("#scaler .atk")).toContainText("Eldritch Blast");
    await page.locator("#fine-tune summary").click();
    const weapons = field(page, "Weapons");
    await expect(weapons.getByRole("button", { name: /Dagger/ })).toHaveAttribute("aria-pressed", "true");
    await expect(weapons.getByRole("button", { name: /Quarterstaff/ })).toHaveAttribute("aria-pressed", "false");
    await weapons.getByRole("button", { name: /Quarterstaff/ }).click();
    await expect(weapons.getByRole("button", { name: /Dagger/ })).toHaveAttribute("aria-pressed", "true");
    await expect(weapons.getByRole("button", { name: /Quarterstaff/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#scaler .atk")).toContainText("Dagger");
    await expect(page.locator("#scaler .atk")).toContainText("Quarterstaff");
    await expect(page.locator("#scaler .atk")).toContainText("Eldritch Blast");
    await page.locator("#scaler tr[data-edit='weapon']", { hasText: "Quarterstaff" }).click();
    await expect(page.locator('#controls [data-for="weapon"]')).toHaveClass(/jump/);
  });

  test("optional rules open higher levels and magic pluses", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    const rules = page.locator("#optional-rules");
    await rules.locator("summary").click();
    await rules.getByRole("checkbox", { name: "Levels above 7" }).check();
    await expect(rules.getByRole("combobox", { name: "Highest level" })).toHaveValue("10");
    await rules.getByRole("combobox", { name: "Highest level" }).selectOption("11");
    await page.evaluate(() => {
      const set = window.__setHero;
      if (!set) throw new Error("missing __setHero");
      set("human", "fighter", "champion", 11);
    });
    await expect(page.locator("#scaler .cd[data-card='Indomitable']")).toHaveCount(1);
    const high = await measureSheet(page);
    expect(high.shown, JSON.stringify(high)).toBe("");
    expect(high.pages, JSON.stringify(high)).toBeGreaterThanOrEqual(2);
    expect(high.overflow, JSON.stringify(high)).toBe(false);
    expect(high.fs, JSON.stringify(high)).toBeGreaterThanOrEqual(FIT_PASS_PX);
    await rules.getByRole("checkbox", { name: "Magic weapons and armor" }).check();
    await expect(rules.getByRole("combobox", { name: "Biggest plus" })).toHaveValue("1");
    await page.locator("#fine-tune summary").click();
    await field(page, "Weapons").getByRole("button", { name: "+1", exact: true }).click();
    await expect(page.locator("#scaler .atk")).toContainText("Longsword +1");
    await rules.getByRole("button", { name: "Tier 2 · 10 · +2" }).click();
    await expect(rules.getByRole("combobox", { name: "Highest level" })).toHaveValue("10");
    await expect(field(page, "Level").getByRole("button", { name: "10", exact: true })).toBeVisible();
    await expect(rules.getByRole("checkbox", { name: "Magic weapons and armor" })).toBeChecked();
    await rules.getByRole("checkbox", { name: "Levels above 7" }).uncheck();
    await expect(field(page, "Level").getByRole("button", { name: "7", exact: true })).toBeVisible();
    await expect(field(page, "Level").getByRole("button", { name: "8", exact: true })).toHaveCount(0);
  });

  test("turn off optional rules shows at the top once one is on", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    const simple = page.locator("#simple");
    const rules = page.locator("#optional-rules");
    await expect(simple).toBeHidden();
    await rules.locator("summary").click();
    for (const name of ["Multiclassing", "Levels above 7", "Magic weapons and armor", "Use feats"]) {
      await rules.getByRole("checkbox", { name }).check();
      await expect(simple).toBeVisible();
      await expect(simple).toContainText("Turn off optional rules");
      await rules.getByRole("checkbox", { name }).uncheck();
      await expect(simple).toBeHidden();
    }
    await page.locator("#name").fill("ZZZSIMPLE");
    await rules.getByRole("checkbox", { name: "Multiclassing" }).check();
    await rules.getByRole("checkbox", { name: "Levels above 7" }).check();
    const place = await page.evaluate(() => {
      const button = document.getElementById("simple");
      const head = document.querySelector("header.top");
      const panel = document.getElementById("optional-rules");
      if (!(button instanceof HTMLElement) || !(head instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
        return null;
      }
      const buttonBox = button.getBoundingClientRect();
      const headBox = head.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      return {
        inHeader: head.contains(button),
        abovePanel: buttonBox.bottom <= panelBox.top,
        insideHeader: buttonBox.top >= headBox.top - 1 && buttonBox.bottom <= headBox.bottom + 1,
      };
    });
    expect(place).toEqual({ inHeader: true, abovePanel: true, insideHeader: true });
    const beside = await page.evaluate(() => {
      const button = document.getElementById("simple");
      const surprise = document.getElementById("surprise");
      const actions = document.querySelector(".actions");
      if (!(button instanceof HTMLElement) || !(surprise instanceof HTMLElement) || !(actions instanceof HTMLElement)) {
        return null;
      }
      const buttonBox = button.getBoundingClientRect();
      const surpriseBox = surprise.getBoundingClientRect();
      return {
        first: actions.firstElementChild === button,
        leftOf: buttonBox.right <= surpriseBox.left + 1,
        sameRow: Math.abs(buttonBox.top - surpriseBox.top) < 2,
        sameHeight: Math.abs(buttonBox.height - surpriseBox.height) < 2,
      };
    });
    expect(beside).toEqual({ first: true, leftOf: true, sameRow: true, sameHeight: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await rules.scrollIntoViewIfNeeded();
    await expect(simple).toBeInViewport();
    await simple.click();
    await expect(simple).toBeHidden();
    await expect(page.locator("#name")).not.toHaveValue("ZZZSIMPLE");
    await expect(field(page, "Level").getByRole("button", { name: "5", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(field(page, "Level").getByRole("button", { name: "8", exact: true })).toHaveCount(0);
    await expect(page.locator(".flabel", { hasText: /^Second class/ })).toHaveCount(0);
    await expect(rules).not.toHaveAttribute("open");
    await rules.locator("summary").click();
    await expect(rules.getByRole("checkbox", { name: "Multiclassing" })).not.toBeChecked();
    await expect(rules.getByRole("checkbox", { name: "Levels above 7" })).not.toBeChecked();
    await expect(rules.getByRole("checkbox", { name: "Magic weapons and armor" })).not.toBeChecked();
    await expect(rules.getByRole("checkbox", { name: "Use feats" })).not.toBeChecked();
  });

  test("max HP, speed, and spell attack explain themselves on hover", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("html[data-booted='1']");
    await page.evaluate(() => {
      const set = window.__setHero;
      if (!set) throw new Error("missing __setHero");
      set("dwarf", "warlock", "fiend", 5);
    });
    await expect(page.locator("#scaler")).toContainText("Spell attack");
    const tip = page.locator("#tip");
    await page.locator(".tile.hp").hover();
    await expect(tip).toContainText("Max HP");
    await expect(tip).toContainText("Hill Dwarf");
    await page.locator("[data-edit='speed']").hover();
    await expect(tip).toContainText("Speed");
    await expect(tip).toContainText("Hill Dwarf");
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    await page.locator(".magic .big").hover({ position: { x: 24, y: 6 } });
    await expect(tip).toContainText("spell attack");
    await expect(tip).toContainText("Save DC");
    await page.locator(".tile.hp").click();
    await expect(page.locator("#controls [data-for='hp']")).toHaveClass(/jump/);
    await page.evaluate(() => {
      const set = window.__setHero;
      if (!set) throw new Error("missing __setHero");
      set("human", "cleric", "life", 1);
    });
    const cure = page.locator("#scaler .cd[data-card='Cure Wounds']");
    await expect(cure).toContainText("extra");
    await page.keyboard.press("Escape");
    await cure.hover();
    await expect(tip).toContainText("1d8 is the spell's roll");
    await expect(tip).toContainText("Extra means Life Domain");
  });

  test("an extra language stays +1 more until you pick one", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await page.evaluate(() => {
      const set = window.__setHero;
      if (!set) throw new Error("missing __setHero");
      set("dwarf", "fighter", "champion", 5);
    });
    await expect(page.locator("#languages")).toHaveCount(0);
    await expect(page.locator("#scaler")).toContainText("Speaks: Common, Dwarvish");
    await page.evaluate(() => {
      const set = window.__setHero;
      if (!set) throw new Error("missing __setHero");
      set("human", "fighter", "champion", 5);
    });
    await expect(page.locator("#scaler")).toContainText("Speaks: Common + one more");
    const languages = page.locator("#languages");
    await expect(languages).toHaveCount(1);
    await expect(languages).not.toHaveAttribute("open");
    await expect(page.locator("#optional-rules")).toHaveAttribute("id", "optional-rules");
    const order = await page.evaluate(() => {
      const panel = document.getElementById("languages");
      const rules = document.getElementById("optional-rules");
      return (
        panel?.nextElementSibling?.id === "optional-rules" &&
        rules?.parentElement?.lastElementChild?.id === "optional-rules"
      );
    });
    expect(order).toBe(true);
    await languages.locator("summary").click();
    await languages.getByRole("button", { name: "Elvish", exact: true }).click();
    await expect(page.locator("#scaler")).toContainText("Speaks: Common, Elvish");
    await expect(page.locator("#scaler")).not.toContainText("+ one more");
    await languages.getByRole("button", { name: "leave as + one more", exact: true }).click();
    await expect(page.locator("#scaler")).toContainText("Speaks: Common + one more");
    await page.locator("#scaler span[data-edit='languages']").click();
    await expect(languages).toHaveClass(/jump/);
    await languages.getByRole("button", { name: "Giant", exact: true }).click();
    await languages.getByLabel("Type a language").fill("Crow-speech");
    await languages.getByLabel("Type a language").press("Enter");
    await expect(page.locator("#scaler")).toContainText("Speaks: Common, Crow-speech");
  });

  test("fine-tune, content packs, and optional rules share one summary", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("html[data-booted='1']");
    const rules = page.locator("#optional-rules summary");
    await expect(rules).toContainText("Optional rules");
    await expect(rules).toContainText("Multiclassing, levels above 7, magic weapons and armor, and feats.");
    const paint = await page.evaluate(() => {
      return ["fine-tune", "content-packs", "optional-rules"].map((id) => {
        const summary = document.querySelector(`#${id} summary`);
        if (!(summary instanceof HTMLElement)) return null;
        const style = getComputedStyle(summary);
        const arrow = getComputedStyle(summary, "::before");
        const hint = summary.querySelector(".hint");
        const hintStyle = hint instanceof HTMLElement ? getComputedStyle(hint) : null;
        return {
          bg: style.backgroundColor,
          color: style.color,
          border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
          radius: style.borderTopLeftRadius,
          font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
          arrow: arrow.color,
          hint: hintStyle ? `${hintStyle.color} ${hintStyle.fontWeight} ${hintStyle.fontSize}` : "",
        };
      });
    });
    expect(paint[0]).toEqual(paint[1]);
    expect(paint[1]).toEqual(paint[2]);
    expect(paint[0]?.bg).toBeTruthy();
  });

  test("reset turns optional rules off and rolls a new hero", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await page.locator("#name").fill("ZZZRESET");
    const rules = page.locator("#optional-rules");
    await rules.locator("summary").click();
    await rules.getByRole("checkbox", { name: "Multiclassing" }).check();
    await rules.getByRole("checkbox", { name: "Levels above 7" }).check();
    await rules.getByRole("checkbox", { name: "Magic weapons and armor" }).check();
    await rules.getByRole("checkbox", { name: "Use feats" }).check();
    await rules.getByRole("button", { name: "reset", exact: true }).click();
    await expect(page.locator("#name")).not.toHaveValue("ZZZRESET");
    await expect(field(page, "Level").getByRole("button", { name: "5", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(field(page, "Level").getByRole("button", { name: "8", exact: true })).toHaveCount(0);
    await expect(page.locator(".flabel", { hasText: /^Second class/ })).toHaveCount(0);
    await expect(rules).not.toHaveAttribute("open");
    await rules.locator("summary").click();
    await expect(rules.getByRole("checkbox", { name: "Multiclassing" })).not.toBeChecked();
    await expect(rules.getByRole("checkbox", { name: "Levels above 7" })).not.toBeChecked();
    await expect(rules.getByRole("checkbox", { name: "Magic weapons and armor" })).not.toBeChecked();
    await expect(rules.getByRole("checkbox", { name: "Use feats" })).not.toBeChecked();
    const got = await measureSheet(page);
    expect(got.pages, JSON.stringify(got)).toBe(2);
    expect(got.overflow, JSON.stringify(got)).toBe(false);
    expect(got.fs, JSON.stringify(got)).toBeGreaterThanOrEqual(FIT_PASS_PX);
  });

  test("a level 20 wizard prepares spells through 9th level", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await page.evaluate(() => {
      const set = window.__setHero;
      if (!set) throw new Error("missing __setHero");
      set("human", "wizard", "evocation", 20);
    });
    await expect(page.locator("#scaler .cd[data-card='Wish']")).toHaveCount(1);
    await expect(page.locator("#scaler h3", { hasText: "Level 8 Spells" })).toHaveCount(1);
    await expect(page.locator("#scaler h3", { hasText: "Level 9 Spells" })).toHaveCount(1);
    await expect(page.locator("#scaler .cd[data-card='Signature Spells']")).toHaveCount(1);
    const got = await measureSheet(page);
    expect(got.shown, JSON.stringify(got)).toBe("");
    expect(got.pages, JSON.stringify(got)).toBeGreaterThan(2);
    expect(got.overflow, JSON.stringify(got)).toBe(false);
    expect(got.fs, JSON.stringify(got)).toBeGreaterThanOrEqual(FIT_PASS_PX);
  });

  test("a level 20 bard and cleric run onto extra pages", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await page.evaluate(() => {
      const set = window.__setHero;
      if (!set) throw new Error("missing __setHero");
      set("human", "bard", "lore", 20);
    });
    const rules = page.locator("#optional-rules");
    await rules.locator("summary").click();
    await rules.getByRole("checkbox", { name: "Multiclassing" }).check();
    await field(page, "Second class").getByRole("button", { name: "Cleric", exact: true }).click();
    await field(page, "Cleric level").getByRole("button", { name: "10", exact: true }).click();
    await expect(page.locator("#scaler .cd[data-card='Magical Secrets']")).toHaveCount(2);
    await expect(page.locator("#scaler .cd[data-card='Divine Intervention']")).toHaveCount(1);
    const got = await measureSheet(page);
    expect(got.shown, JSON.stringify(got)).toBe("");
    expect(got.pages, JSON.stringify(got)).toBeGreaterThan(2);
    expect(got.overflow, JSON.stringify(got)).toBe(false);
    expect(got.fs, JSON.stringify(got)).toBeGreaterThanOrEqual(FIT_PASS_PX);
  });

  test("premades fit one whole sheet on the right and leave the builder hero alone", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    const name = await page.locator("#name").inputValue();
    await expect(page.locator("header.top")).not.toContainText("Hero gallery");
    await expect(page.locator("header.top")).not.toContainText("PAF");
    await expect(page.locator("#premades")).toHaveText("Hero gallery");
    await page.locator("#premades").scrollIntoViewIfNeeded();
    await page.locator("#premades").hover();
    await expect(page.locator("#tip")).toContainText("Hero gallery");
    await expect(page.locator("#tip")).toContainText("whole sheet");
    await page.locator("#premades").click();
    await expect(page.locator("#controls")).toHaveAttribute("aria-label", "Hero gallery");
    await expect(page.locator("#controls .flabel")).toHaveText("Hero gallery");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("#premades")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#premade-list button")).toHaveCount(16);
    await expect(page.locator("#premade-note")).toContainText("Wynn");
    await expect(page.locator("#premade-note")).toContainText("2 pages");
    await expect(page.locator("#scaler .page")).toHaveCount(2);
    const wide = await sheetFits(page);
    expect(wide.inside).toBe(true);
    expect(wide.sideBySide).toBe(true);
    await page.getByRole("button", { name: "Bard 10 / Cleric 10" }).click();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("#scaler .page")).toHaveCount(3);
    await expect(page.locator("#premade-note")).toContainText("3 pages");
    const three = await sheetFits(page);
    expect(three.inside).toBe(true);
    expect(three.sideBySide).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
        }),
    );
    const phone = await sheetFits(page);
    expect(phone.inside).toBe(true);
    expect(phone.sideBySide || phone.stacked).toBe(true);
    await page.locator("#premades").click();
    await expect(page.locator("#controls .lead")).toHaveText("Build a D&D 5e inspired hero:");
    await expect(page.locator("#name")).toHaveValue(name);
    await expect(page.locator("#premades")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#controls")).not.toContainText(/best/i);
  });

  test("the hero gallery can go back to the builder and download the pdf", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    const name = await page.locator("#name").inputValue();
    await page.locator("#premades").click();
    await expect(page.locator("#premade-back")).toHaveText("Back to builder");
    await expect(page.locator("#premade-pdf")).toHaveText("Download PDF");
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#premade-pdf").click()]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    await page.locator("#premade-back").click();
    await expect(page.locator("#name")).toHaveValue(name);
    await expect(page.locator("#controls .lead")).toHaveText("Build a D&D 5e inspired hero:");
  });

  test("proficiency, notice, speaks, skills, stats, and spells pop up", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await page.evaluate(() => {
      const set = window.__setHero;
      if (!set) throw new Error("missing __setHero");
      set("human", "wizard", "evocation", 1);
    });
    await expect(page.locator("#scaler .player")).toHaveCount(0);
    await hoverTip(page, page.locator("#scaler [data-edit='prof']"));
    await expect(page.locator("#tip")).toContainText("Added to the attacks");
    await hoverTip(page, page.locator("#scaler [data-edit='notice']"));
    await expect(page.locator("#tip")).toContainText("How easily you notice");
    await expect(page.locator("#tip")).toContainText("Perception");
    await hoverTip(page, page.locator("#scaler [data-edit='languages']"));
    await expect(page.locator("#tip")).toContainText("Speaks");
    await expect(page.locator("#tip")).toContainText("one more");
    await hoverTip(page, page.locator("#scaler .sk", { hasText: "Animal Handling" }));
    await expect(page.locator("#tip")).toContainText("Calm a scared animal");
    await hoverTip(page, page.locator("#scaler .ab", { hasText: "Strength" }));
    await expect(page.locator("#tip")).toContainText("Lifting, pushing");
    const missile = page.locator("#scaler .cd[data-card='Magic Missile']");
    await hoverTip(page, missile);
    await expect(page.locator("#tip")).toContainText("Casting time");
    await expect(missile.locator(".d")).not.toContainText("Casting time");
  });

  test("a level 7 wizard and cleric stay on two pages", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#scaler .page.back");
    await page.evaluate(() => {
      const set = window.__setHero;
      if (!set) throw new Error("missing __setHero");
      set("human", "wizard", "evocation", 7);
    });
    const rules = page.locator("#optional-rules");
    await rules.locator("summary").click();
    await rules.getByRole("checkbox", { name: "Multiclassing" }).check();
    await field(page, "Second class").getByRole("button", { name: "Cleric", exact: true }).click();
    await field(page, "Cleric level").getByRole("button", { name: "2", exact: true }).click();
    await expect(page.locator("#scaler .cd[data-card='Channel Divinity']")).toHaveCount(1);
    const got = await measureSheet(page);
    expect(got.shown, JSON.stringify(got)).toBe("");
    expect(got.pages, JSON.stringify(got)).toBe(2);
    expect(got.overflow, JSON.stringify(got)).toBe(false);
    expect(got.fs, JSON.stringify(got)).toBeGreaterThanOrEqual(FIT_PASS_PX);
  });
});
