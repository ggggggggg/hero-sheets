import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

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
    await page.locator("details.custom summary").click();
    await page.locator("li", { hasText: "Turtles & Pirates" }).getByRole("button", { name: "add" }).click();
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

  test("the single file still builds a sheet with the network blocked", async ({ browser }) => {
    const file = path.resolve("dist/index.html");
    const html = readFileSync(file, "utf8");
    expect(html).toContain("woff2");
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

function field(page: import("@playwright/test").Page, label: string) {
  return page.locator(".field").filter({ has: page.locator(".flabel", { hasText: new RegExp(`^${label}`) }) });
}
