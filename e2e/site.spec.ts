import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { field } from "./helpers";

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
    await expect(page.locator("#controls > *").last()).toHaveAttribute("id", "content-packs");
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
    await expect(tip).toContainText("Armor training");
    await expect(tip).toContainText("light armor");
    await expect(tip).not.toContainText("medium");
    await page.locator("details.adv:not(.custom) summary").click();
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
    await field(page, "Class").getByRole("button", { name: "Cleric", exact: true }).click();
    await hoverChoice(field(page, "Path").getByRole("button", { name: "Life Domain", exact: true }));
    await expect(tip).toContainText("also heavy armor");
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
        last: packs?.parentElement?.lastElementChild === packs,
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
});
