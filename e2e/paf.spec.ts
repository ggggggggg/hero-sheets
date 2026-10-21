import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { jpegsToPdf } from "../src/export";
import { field, hoverTip } from "./helpers";

const scratch = mkdtempSync(path.join(tmpdir(), "paf-pdf-"));
const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), w: 1, h: 1 };

function writeSheet(name: string, state: object): string {
  const file = path.join(scratch, name);
  writeFileSync(file, jpegsToPdf([jpeg], "Hero", { state, packs: [] }));
  return file;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    window.CHARSHEET_FIXED_START = true;
  });
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("builds a level-3 hero with one once-a-fight power", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/paf.html");
  await page.waitForSelector("#scaler .page.back");
  await expect(page.locator("#scaler .page")).toHaveCount(2);
  await page.locator("#open-pdf").hover();
  await expect(page.locator("#tip")).toContainText("That hero comes back");
  await page.locator("#pdf").hover();
  await expect(page.locator("#tip")).toContainText("Saves this hero as a PDF");
  await hoverTip(page, page.locator("#name"));
  await expect(page.locator("#tip")).toContainText("name printed on the sheet");
  await hoverTip(page, page.getByRole("button", { name: "Random first origin" }));
  await expect(page.locator("#tip")).toContainText("Picks a different one at random");
  await expect(page.locator("#controls .lead")).toHaveText(
    "Build an even simpler hero for post-apocalyptic fantasy, with Gamma World inspired origins and simplified choices:",
  );
  await expect(page.locator(".sitefoot")).toContainText("original post-apocalyptic fantasy");
  await expect(page.locator(".sitefoot")).not.toContainText("SRD");
  await expect(page.locator(".sitefoot")).not.toContainText(/gamma/i);
  await expect(page.locator("header a.switch")).toHaveAttribute("href", "index.html");
  await expect(page.locator("#controls")).not.toContainText(/best/i);

  await field(page, "First origin").getByRole("button", { name: "Whisk", exact: true }).click();
  await field(page, "Second origin").getByRole("button", { name: "Spark", exact: true }).click();
  await field(page, "Level").getByRole("button", { name: "3", exact: true }).click();

  const sheet = page.locator("#scaler");
  await expect(sheet.locator(".cd[data-card='Vanish']")).toHaveCount(1);
  await expect(sheet.locator(".cd[data-card='Jolt']")).toHaveCount(0);
  await expect(sheet).not.toContainText(/proficiency/i);
  await expect(sheet).toContainText("Draw 1");
  await expect(sheet.locator(".head .sub")).toContainText("Whisk");
  await expect(sheet.locator(".head .sub")).toContainText("Spark");
  await expect(page.locator("#flux-relics")).toContainText("Extra arm");
  await page.locator("#flux-relics summary").click();
  await expect(page.locator("#flux-relics")).toContainText("One deck for every hero");
  const [deck] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#flux-relics").getByRole("button", { name: "Print the deck" }).click(),
  ]);
  expect(deck.suggestedFilename()).toBe("Flux and relic deck.pdf");
  expect(await deck.path()).toBeTruthy();
  await expect(sheet).not.toContainText("Extra arm");
});

test("matches the D&D dice, face maker, and content packs", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/paf.html");
  await page.waitForSelector("html[data-booted='1']");
  await expect(page.getByRole("button", { name: "Random first origin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Random second origin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Random level" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Random armor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Random scores" })).toBeVisible();
  await expect(page.locator("#controls")).not.toContainText("Re-roll scores");
  await expect(page.getByRole("button", { name: "Pixel" })).toBeVisible();
  await hoverTip(page, page.getByRole("button", { name: "Pixel" }));
  await expect(page.locator("#tip")).toContainText("blocky cartoon");
  await hoverTip(page, page.locator("#content-packs summary"));
  await expect(page.locator("#tip")).toContainText("Turn a pack on to use it");
  await expect(page.getByRole("button", { name: "Adventurer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Random face" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Boy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Girl" })).toBeVisible();
  await expect(page.locator("label[for='face-seed']")).toHaveText("Face code");
  await page.locator("#content-packs summary").click();
  await expect(page.locator("#content-packs")).toContainText("Lamp-saint");
  await expect(page.locator("#clear-saved")).toHaveText("Clear saved data");
  await page.locator("#content-packs").getByText("Lamp-saint", { exact: true }).click();
  const lamp = field(page, "First origin").getByRole("button", { name: "Lamp-saint 💡", exact: true });
  await expect(lamp).toBeVisible();
  await hoverTip(page, lamp);
  await expect(page.locator("#tip")).toContainText("From Lamp-saint");
  await hoverTip(page, field(page, "First origin").getByRole("button", { name: "Whisk", exact: true }));
  await expect(page.locator("#tip")).not.toContainText("From Lamp-saint");
});

test("the two pages point at each other", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("html[data-booted='1']");
  await expect(page.locator("header a.switch")).toHaveCount(0);
  await expect(page.locator("footer a.switch")).toHaveAttribute("href", "paf.html");
  await page.goto("/paf.html");
  await page.waitForSelector("html[data-booted='1']");
  await expect(page.locator("header a.switch")).toHaveAttribute("href", "index.html");
});

test("a fresh visit rolls a random hero", async ({ browser }) => {
  const seen = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    await page.goto("/paf.html");
    await page.waitForSelector("#scaler .page.back");
    await expect(page.getByRole("button", { name: "Pixel", exact: true })).toHaveClass(/on/);
    await expect(field(page, "Armor").locator("button[aria-pressed='true']")).toHaveCount(1);
    seen.add((await page.locator("#scaler .front").innerText()).slice(0, 80));
    await context.close();
  }
  expect(seen.size).toBeGreaterThan(1);
});

test("each page refuses the other page's PDF", async ({ page }) => {
  const pafPdf = writeSheet("paf.pdf", { kind: "paf", origin1: "whisk", origin2: "spark", name: "Pip", level: 3 });
  const dndPdf = writeSheet("dnd.pdf", { name: "Tobin", race: "human", cls: "fighter", level: 1 });

  await page.goto("/");
  await page.waitForSelector("#scaler .page.back");
  await page.locator("#open-pdf-file").setInputFiles(pafPdf);
  await expect(page.locator("#status")).toHaveText("This PDF is a post-apocalyptic hero. Open it on the PAF page.");

  await page.goto("/paf.html");
  await page.waitForSelector("#scaler .page.back");
  await page.locator("#open-pdf-file").setInputFiles(dndPdf);
  await expect(page.locator("#status")).toHaveText("This PDF is a D&D hero. Open it on the D&D heroes page.");
  await page.locator("#open-pdf-file").setInputFiles(pafPdf);
  await expect(page.locator("#scaler .head .nm")).toHaveText("Pip");
  await expect(page.locator("#status")).toHaveText("Opened Pip.");
});

test("the single file still builds a sheet with the network blocked", async ({ browser }) => {
  const file = path.resolve("dist/paf.html");
  const html = readFileSync(file, "utf8");
  expect(html).toContain("woff2");
  expect(html).not.toMatch(/<(?:script|link)[^>]+(?:src|href)="https?:/);
  expect(html).toContain("Gamma World inspired origins");
  expect(html).not.toMatch(/engineered human|famine in far-go/i);
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
  await page.context().setOffline(true);
  await page.goto(`file://${file}`);
  await page.waitForSelector("#scaler .page.back");
  await expect(page.locator("#scaler .page")).toHaveCount(2);
  await field(page, "First origin").getByRole("button", { name: "Howl", exact: true }).click();
  await expect(page.locator("#scaler .head .sub")).toContainText("Howl");
  await page.close();
});

test("every selection oval has a popup", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/paf.html");
  await page.waitForSelector("html[data-booted='1']");
  const tip = page.locator("#tip");
  const hover = async (locator: ReturnType<typeof field>) => {
    await locator.scrollIntoViewIfNeeded();
    await page.mouse.move(8, 8);
    await page.waitForTimeout(200);
    await locator.hover();
  };

  await hover(field(page, "First origin").getByRole("button", { name: "Whisk", exact: true }));
  await expect(tip).toContainText("Ears up, plans flexible.");
  await expect(tip).toContainText("Scratch");
  await expect(tip).toContainText("Hamstring");

  await hover(field(page, "Level").getByRole("button", { name: "2", exact: true }));
  await expect(tip).toContainText("Level 2");
  await expect(tip).toContainText("HP");

  await hover(field(page, "Bonus skill").getByRole("button", { name: "Acrobatics", exact: true }));
  await expect(tip).toContainText("Dexterity");

  await hover(field(page, "Armor").getByRole("button", { name: "Road plate", exact: true }));
  await expect(tip).toContainText("Heavy");

  await hover(field(page, "Weapon").getByRole("button", { name: "Knife", exact: true }));
  await expect(tip).toContainText("1d6");

  await field(page, "Level").getByRole("button", { name: "3", exact: true }).click();
  await hover(field(page, "Once a fight first").getByRole("button", { name: "Bramble", exact: true }));
  await expect(tip).toContainText("Root down");

  await field(page, "Level").getByRole("button", { name: "10", exact: true }).click();
  await hover(field(page, "Capstone").getByRole("button", { name: "Twice", exact: true }));
  await expect(tip).toContainText("always-on power");

  await hover(field(page, "Ready heroes").getByRole("button", { name: "Start as Pip", exact: true }));
  await expect(tip).toContainText("Whisk and Spark, level 3.");
});
