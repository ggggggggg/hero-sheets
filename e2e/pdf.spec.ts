import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

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
