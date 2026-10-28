import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { jpegsToPdf } from "../src/export";

const scratch = mkdtempSync(path.join(tmpdir(), "hero-pdf-"));
const tiny = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), w: 1, h: 1 };

function writeSheet(name: string, hero?: { state: object; packs: { title: string; text: string }[] }): string {
  const file = path.join(scratch, name);
  writeFileSync(file, jpegsToPdf([tiny], "Hero", hero));
  return file;
}

// The actual shipped output: clicking "Download PDF" makes a real, two-page, US-Letter PDF.
test("Download PDF makes a two-page US-Letter PDF", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    window.CHARSHEET_FIXED_START = true;
  });
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("/");
  await page.waitForSelector("#scaler .page.back");

  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#pdf").click()]);
  const file = await download.path();
  const pdf = await PDFDocument.load(readFileSync(file));

  expect(pdf.getPageCount()).toBe(2);
  const { width, height } = pdf.getPage(0).getSize();
  expect(Math.round(width)).toBe(612);
  expect(Math.round(height)).toBe(792);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
});

test("a downloaded PDF opens that hero and its content pack", async ({ page, browser }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    window.CHARSHEET_FIXED_START = true;
  });
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.waitForSelector("#scaler .page.back");
  await page.locator("#content-packs summary").click();
  await page.locator("li", { hasText: "Tobin aka Flame Master" }).getByRole("checkbox").check();
  await page.locator("#pack-heroes").click();
  await page.locator("#premade-list").getByRole("button", { name: "Tobin aka Flame Master", exact: true }).click();
  await page.getByRole("button", { name: "Use this hero" }).click();
  await expect(page.locator("#scaler .head .nm")).toHaveText("Tobin aka Flame Master");
  await expect(page.locator("#scaler")).toContainText("Dragon Strike");
  await page.locator("#fine-tune summary").click();
  const acrobatics = page.locator("#skill-numbers .numrow", { hasText: "Acrobatics" });
  await acrobatics.getByRole("button", { name: "Raise Acrobatics" }).click();
  await expect(acrobatics).toContainText("off book");
  await expect(page.locator(".field", { has: page.locator("#skill-numbers") })).toContainText("Check with your DM.");
  const bonus = (await acrobatics.locator("b").innerText()).trim();

  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#pdf").click()]);
  const file = await download.path();
  if (!file) throw new Error("download has no file");

  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.clear();
    window.CHARSHEET_FIXED_START = true;
  });
  const fresh = await context.newPage();
  fresh.on("pageerror", (error) => {
    throw error;
  });
  await fresh.setViewportSize({ width: 1400, height: 900 });
  await fresh.goto("/");
  await fresh.waitForSelector("html[data-booted='1']");
  await expect(fresh.locator("#scaler .head .nm")).toHaveText("Tobin");
  await fresh.locator("#open-pdf-file").setInputFiles(file);
  await expect(fresh.locator("#status")).toHaveText("Opened Tobin aka Flame Master.", { timeout: 15_000 });
  await expect(fresh.locator("#scaler .head .nm")).toHaveText("Tobin aka Flame Master");
  await expect(fresh.locator("#scaler .head .sub")).toContainText("Mountain Dwarf");
  await expect(fresh.locator("#scaler")).toContainText("Dragon Strike");
  await expect(fresh.getByRole("button", { name: "Warlock ✦" })).toHaveAttribute("aria-pressed", "true");
  await expect(fresh.locator("li", { hasText: "Tobin aka Flame Master" }).getByRole("checkbox")).toBeChecked();
  await expect(fresh.locator("li", { hasText: "Turtles & Pirates" }).getByRole("checkbox")).not.toBeChecked();
  await expect(fresh.locator("#use-builtin")).toBeChecked();
  await fresh.locator("#fine-tune summary").click();
  await expect(fresh.locator("#skill-numbers .numrow", { hasText: "Acrobatics" })).toContainText(bonus);
  await expect(fresh.locator("#skill-numbers .numrow", { hasText: "Acrobatics" })).toContainText("off book");
  await expect(fresh.locator("#scaler .sk", { hasText: "Acrobatics" })).toContainText(`${bonus}*`);
  await context.close();

  const again = await page.context().newPage();
  await again.addInitScript(() => {
    window.CHARSHEET_FIXED_START = true;
  });
  again.on("pageerror", (error) => {
    throw error;
  });
  await again.setViewportSize({ width: 1400, height: 900 });
  await again.goto("/");
  await again.waitForSelector("html[data-booted='1']");
  const packs = again.locator("#content-packs");
  if ((await packs.getAttribute("open")) === null) await packs.locator("summary").click();
  await again.locator("li", { hasText: "Turtles & Pirates" }).getByRole("checkbox").check();
  await expect(again.locator("li", { hasText: "Tobin aka Flame Master" }).getByRole("checkbox")).toBeChecked();
  await again.locator("#open-pdf-file").setInputFiles(file);
  await expect(again.locator("#status")).toHaveText("Opened Tobin aka Flame Master.", { timeout: 15_000 });
  await expect(again.locator("li", { hasText: "Tobin aka Flame Master" }).getByRole("checkbox")).toBeChecked();
  await expect(again.locator("li", { hasText: "Turtles & Pirates" }).getByRole("checkbox")).not.toBeChecked();
  await expect(again.locator("#use-builtin")).toBeChecked();
  await expect(again.getByRole("button", { name: "Turtle-folk", exact: true })).toHaveCount(0);
  await again.close();
});

test("a PDF turns off packs that hero does not use", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    window.CHARSHEET_FIXED_START = true;
  });
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.waitForSelector("#scaler .page.back");
  await page.locator("#content-packs summary").click();
  await page.locator("li", { hasText: "Mutants & Meltdowns" }).getByRole("checkbox").check();
  await page.locator("li", { hasText: "Turtles & Pirates" }).getByRole("checkbox").check();
  await page.locator("#pack-heroes").click();
  await page.locator("#premade-list").getByRole("button", { name: "Spanner", exact: true }).click();
  await page.getByRole("button", { name: "Use this hero" }).click();
  await expect(page.locator("#scaler .head .sub")).toContainText("Rustbucket");

  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#pdf").click()]);
  const file = await download.path();
  if (!file) throw new Error("download has no file");

  const again = await page.context().newPage();
  await again.addInitScript(() => {
    window.CHARSHEET_FIXED_START = true;
  });
  again.on("pageerror", (error) => {
    throw error;
  });
  await again.setViewportSize({ width: 1400, height: 900 });
  await again.goto("/");
  await again.waitForSelector("html[data-booted='1']");
  await again.locator("#open-pdf-file").setInputFiles(file);
  await expect(again.locator("#status")).toHaveText("Opened Spanner.");
  await expect(again.locator("#scaler .head .sub")).toContainText("Rustbucket");
  await expect(again.locator("#scaler .head .sub")).toContainText("Scavenger");
  await expect(again.locator("li", { hasText: "Mutants & Meltdowns" }).getByRole("checkbox")).toBeChecked();
  await expect(again.locator("li", { hasText: "Turtles & Pirates" }).getByRole("checkbox")).not.toBeChecked();
  await expect(again.locator("#use-builtin")).not.toBeChecked();
  await expect(again.getByRole("button", { name: "Human", exact: true })).toHaveCount(0);
  await expect(again.getByRole("button", { name: "Turtle-folk", exact: true })).toHaveCount(0);
  await again.close();
});

test("a PDF that is not a hero leaves the open builder alone", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    window.CHARSHEET_FIXED_START = true;
  });
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.waitForSelector("#scaler .page.back");
  await page.locator("#content-packs summary").click();
  await page.locator("li", { hasText: "Turtles & Pirates" }).getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: /Turtle-folk/ })).toHaveCount(1);

  const empty = writeSheet("empty.pdf");
  await page.locator("#open-pdf-file").setInputFiles(empty);
  await expect(page.locator("#status")).toHaveText("This PDF has no hero from Hero Sheet Builder.");
  await expect(page.locator("#scaler .head .nm")).toHaveText("Tobin");
  await expect(page.locator("li", { hasText: "Turtles & Pirates" }).getByRole("checkbox")).toBeChecked();
  await expect(page.locator("#use-builtin")).toBeChecked();
});

test("a PDF whose pack lacks that hero restores the packs", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    window.CHARSHEET_FIXED_START = true;
  });
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.waitForSelector("#scaler .page.back");
  await page.locator("#content-packs summary").click();
  await page.locator("li", { hasText: "Turtles & Pirates" }).getByRole("checkbox").check();

  const pack = JSON.stringify({
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
  const stranger = writeSheet("stranger.pdf", {
    state: { name: "Nope", race: "missingrace", cls: "missingclass" },
    packs: [{ title: "Solo World", text: pack }],
  });
  await page.locator("#open-pdf-file").setInputFiles(stranger);
  await expect(page.locator("#status")).toHaveText("This hero's race or class isn't in the pack from that PDF.");
  await expect(page.locator("#scaler .head .nm")).toHaveText("Tobin");
  await expect(page.locator("li", { hasText: "Turtles & Pirates" }).getByRole("checkbox")).toBeChecked();
  await expect(page.locator("li", { hasText: "Solo World" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Robot", exact: true })).toHaveCount(0);
  await expect(page.locator("#use-builtin")).toBeChecked();
});
