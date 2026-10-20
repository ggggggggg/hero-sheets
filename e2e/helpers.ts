import type { Locator, Page } from "@playwright/test";
import { cardsOverflow } from "../src/fit";

export function field(page: Page, label: string): Locator {
  return page.locator(".field").filter({ has: page.locator(".flabel", { hasText: new RegExp(`^${label}`) }) });
}

export async function measureSheet(
  page: Page,
): Promise<{ pages: number; fs: number; overflow: boolean; shown: string }> {
  await page.waitForFunction(() => {
    const cards = document.querySelector("#scaler .page.back .cards");
    return cards instanceof HTMLElement && getComputedStyle(cards).getPropertyValue("--fs") !== "";
  });
  const raw = await page.evaluate(() => {
    const pages = document.querySelectorAll("#scaler .page").length;
    const error = document.querySelector("#error");
    const shown = error instanceof HTMLElement && !error.hidden && error.textContent ? error.textContent : "";
    const cards = document.querySelector("#scaler .page.back .cards");
    if (!(cards instanceof HTMLElement)) return { pages, fs: 0, shown, metrics: null };
    const box = cards.getBoundingClientRect();
    const children = [...cards.querySelectorAll(".cd, .sec h3")].map((node) => {
      const rect = node.getBoundingClientRect();
      return { right: rect.right, bottom: rect.bottom, width: rect.width };
    });
    return {
      pages,
      fs: Number.parseFloat(getComputedStyle(cards).getPropertyValue("--fs")),
      shown,
      metrics: {
        scrollHeight: cards.scrollHeight,
        clientHeight: cards.clientHeight,
        scrollWidth: cards.scrollWidth,
        clientWidth: cards.clientWidth,
        box: { right: box.right, bottom: box.bottom, width: box.width },
        children,
      },
    };
  });
  return { pages: raw.pages, fs: raw.fs, shown: raw.shown, overflow: raw.metrics ? cardsOverflow(raw.metrics) : true };
}
