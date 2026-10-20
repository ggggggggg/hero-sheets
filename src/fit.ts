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

export function previewLayout(wrapWidth: number): { side: boolean; scale: number; height: number } | null {
  if (!wrapWidth) return null;
  const side = wrapWidth >= 2 * PAGE_W * 0.55 + PREVIEW_GAP;
  const natW = side ? PAGE_W * 2 + PREVIEW_GAP : PAGE_W;
  const natH = side ? PAGE_H : PAGE_H * 2 + PREVIEW_GAP;
  const scale = Math.min(1, wrapWidth / natW);
  return { side, scale, height: natH * scale };
}
