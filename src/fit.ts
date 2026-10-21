export const PAGE_W = 816;
export const PAGE_H = 1056;
export const FIT_START_PX = 16;
export const FIT_STEP_PX = 0.25;
export const FIT_FLOOR_PX = 8;
export const FIT_PASS_PX = 9.5;

const PREVIEW_GAP = 24;

export interface CardBox {
  right: number;
  bottom: number;
  width: number;
}

export interface CardMetrics {
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
  box: CardBox;
  children: CardBox[];
}

export interface FontBox {
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
  style: { setProperty(name: string, value: string): void };
  getBoundingClientRect(): CardBox;
  querySelectorAll(selector: string): Iterable<{ getBoundingClientRect(): CardBox }>;
}

export function cardsOverflow(metrics: CardMetrics): boolean {
  if (metrics.scrollHeight > metrics.clientHeight + 1 || metrics.scrollWidth > metrics.clientWidth + 1) return true;
  const tol = 1 + metrics.box.width / 400;
  for (const child of metrics.children) {
    if (child.right > metrics.box.right + tol || child.bottom > metrics.box.bottom + tol) return true;
  }
  return false;
}

function metricsOf(cards: FontBox): CardMetrics {
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
}

export function fitCardFont(cards: FontBox): number {
  let fs = FIT_START_PX;
  const apply = () => cards.style.setProperty("--fs", `${fs}px`);
  apply();
  while (cardsOverflow(metricsOf(cards)) && fs > FIT_FLOOR_PX) {
    fs -= FIT_STEP_PX;
    apply();
  }
  return fs;
}

/** Shrink a D&D back page down to FIT_PASS_PX, then move trailing cards onto more back pages. */
export function spillBack(page: HTMLElement): void {
  const cards = page.querySelector(":scope > .cards");
  if (!(cards instanceof HTMLElement) || !cards.clientHeight) return;
  let step = 0;
  const size = () => FIT_START_PX - step * FIT_STEP_PX;
  const apply = () => cards.style.setProperty("--fs", `${size()}px`);
  apply();
  while (cardsOverflow(metricsOf(cards)) && size() - FIT_STEP_PX >= FIT_PASS_PX - 1e-9) {
    step += 1;
    apply();
  }
  if (!cardsOverflow(metricsOf(cards))) return;
  const doc = page.ownerDocument;
  const next = doc.createElement("section");
  next.className = "page back";
  const head = page.querySelector(":scope > .bhead");
  if (head) next.append(head.cloneNode(true));
  const box = doc.createElement("div");
  box.className = "cards";
  next.append(box);
  const foot = page.querySelector(":scope > .foot");
  if (foot) next.append(foot.cloneNode(true));
  page.after(next);
  while (cardsOverflow(metricsOf(cards))) {
    const cds = [...cards.querySelectorAll(".cd")];
    const last = cds[cds.length - 1];
    if (!(last instanceof HTMLElement) || cds.length <= 1) break;
    const sec = last.closest(".sec");
    const title = sec?.querySelector("h3")?.textContent ?? "";
    last.remove();
    if (sec && !sec.querySelector(".cd")) sec.remove();
    let dest = [...box.querySelectorAll(":scope > .sec")].find(
      (node) => node.querySelector("h3")?.textContent === title,
    );
    if (!dest) {
      dest = doc.createElement("div");
      dest.className = "sec";
      const h3 = doc.createElement("h3");
      h3.textContent = title;
      dest.append(h3);
      box.prepend(dest);
    }
    const heading = dest.querySelector("h3");
    if (heading) heading.after(last);
    else dest.append(last);
  }
  spillBack(next);
}

export function previewLayout(wrapWidth: number): { side: boolean; scale: number; height: number } | null {
  if (!wrapWidth) return null;
  const side = wrapWidth >= 2 * PAGE_W * 0.55 + PREVIEW_GAP;
  const natW = side ? PAGE_W * 2 + PREVIEW_GAP : PAGE_W;
  const natH = side ? PAGE_H : PAGE_H * 2 + PREVIEW_GAP;
  const scale = Math.min(1, wrapWidth / natW);
  return { side, scale, height: natH * scale };
}

/** Scale every page of a premade sheet so the whole sheet fits the preview. */
export function premadeLayout(width: number, height: number, pages: number): { side: boolean; scale: number } {
  const count = Math.max(1, pages | 0);
  if (!width || !height) return { side: false, scale: 1 };
  const rowScale = Math.min(width / (count * PAGE_W + (count - 1) * PREVIEW_GAP), height / PAGE_H);
  const colScale = Math.min(width / PAGE_W, height / (count * PAGE_H + (count - 1) * PREVIEW_GAP));
  const side = count > 1 && rowScale >= colScale;
  return { side, scale: Math.min(1, side ? rowScale : colScale) };
}
