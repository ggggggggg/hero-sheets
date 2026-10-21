import type { Locator, Page } from "@playwright/test";
import { cardsOverflow } from "../src/fit";

export function field(page: Page, label: string): Locator {
  return page.locator(".field").filter({ has: page.locator(".flabel", { hasText: new RegExp(`^${label}`) }) });
}

export async function hoverTip(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await page.mouse.move(8, 8);
  await page.waitForTimeout(200);
  await locator.hover();
}

export async function measureSheet(
  page: Page,
): Promise<{ pages: number; fs: number; overflow: boolean; shown: string }> {
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll("#scaler .page.back .cards")];
    return (
      cards.length > 0 &&
      cards.every((node) => node instanceof HTMLElement && getComputedStyle(node).getPropertyValue("--fs") !== "")
    );
  });
  const raw = await page.evaluate(() => {
    const pages = document.querySelectorAll("#scaler .page").length;
    const error = document.querySelector("#error");
    const shown = error instanceof HTMLElement && !error.hidden && error.textContent ? error.textContent : "";
    const backs = [...document.querySelectorAll("#scaler .page.back .cards")].filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    if (!backs.length) return { pages, fs: 0, shown, metrics: [] as const };
    const metrics = backs.map((cards) => {
      const box = cards.getBoundingClientRect();
      const children = [...cards.querySelectorAll(".cd, .sec h3")].map((node) => {
        const rect = node.getBoundingClientRect();
        return { right: rect.right, bottom: rect.bottom, width: rect.width };
      });
      return {
        scrollHeight: cards.scrollHeight,
        clientHeight: cards.clientHeight,
        scrollWidth: cards.scrollWidth,
        clientWidth: cards.clientWidth,
        box: { right: box.right, bottom: box.bottom, width: box.width },
        children,
      };
    });
    const fs = Math.min(...backs.map((cards) => Number.parseFloat(getComputedStyle(cards).getPropertyValue("--fs"))));
    return { pages, fs, shown, metrics };
  });
  return {
    pages: raw.pages,
    fs: raw.fs,
    shown: raw.shown,
    overflow: raw.metrics.length > 0 ? raw.metrics.some((metrics) => cardsOverflow(metrics)) : true,
  };
}
