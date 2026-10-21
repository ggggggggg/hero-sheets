import { describe, expect, it } from "vitest";
import {
  type CardMetrics,
  cardsOverflow,
  FIT_FLOOR_PX,
  FIT_PASS_PX,
  FIT_START_PX,
  type FontBox,
  fitCardFont,
  PAGE_H,
  PAGE_W,
  premadeLayout,
  previewLayout,
} from "../src/fit";

function metrics(over: Partial<CardMetrics> = {}): CardMetrics {
  return {
    scrollHeight: 100,
    clientHeight: 100,
    scrollWidth: 80,
    clientWidth: 100,
    box: { right: 100, bottom: 200, width: 400 },
    children: [{ right: 100, bottom: 200, width: 40 }],
    ...over,
  };
}

function fontBox(overflowAbove: number): FontBox {
  let fs = 0;
  return {
    get scrollHeight() {
      return fs > overflowAbove ? 300 : 100;
    },
    clientHeight: 100,
    scrollWidth: 40,
    clientWidth: 100,
    style: {
      setProperty(_name: string, value: string) {
        fs = Number.parseFloat(value);
      },
    },
    getBoundingClientRect: () => ({ right: 100, bottom: 100, width: 100 }),
    querySelectorAll: () => [],
  };
}

describe("card fit", () => {
  it("accepts content inside the box, including the one-pixel slop", () => {
    expect(cardsOverflow(metrics())).toBe(false);
    expect(cardsOverflow(metrics({ scrollHeight: 101 }))).toBe(false);
    expect(cardsOverflow(metrics({ scrollHeight: 102 }))).toBe(true);
    expect(cardsOverflow(metrics({ scrollWidth: 102 }))).toBe(true);
  });

  it("uses a tolerance that grows with the card width", () => {
    const tol = 1 + 400 / 400;
    expect(cardsOverflow(metrics({ children: [{ right: 100 + tol, bottom: 200, width: 10 }] }))).toBe(false);
    expect(cardsOverflow(metrics({ children: [{ right: 100 + tol + 0.01, bottom: 200, width: 10 }] }))).toBe(true);
    expect(cardsOverflow(metrics({ children: [{ right: 100, bottom: 200 + tol + 0.01, width: 10 }] }))).toBe(true);
  });

  it("shrinks the card font until the back fits, and stops at the floor", () => {
    expect(fitCardFont(fontBox(FIT_START_PX))).toBe(FIT_START_PX);
    expect(fitCardFont(fontBox(10))).toBe(10);
    expect(fitCardFont(fontBox(0))).toBe(FIT_FLOOR_PX);
    expect(FIT_PASS_PX).toBeGreaterThan(FIT_FLOOR_PX);
  });

  it("puts the two pages side by side only when the preview is wide enough", () => {
    expect(previewLayout(0)).toBeNull();
    const narrow = previewLayout(400);
    const wide = previewLayout(1400);
    if (!narrow || !wide) throw new Error("missing layout");
    expect(narrow.side).toBe(false);
    expect(narrow.scale).toBeCloseTo(400 / 816);
    expect(narrow.height).toBeCloseTo((1056 * 2 + 24) * (400 / 816));
    expect(wide.side).toBe(true);
    expect(wide.scale).toBeCloseTo(1400 / (816 * 2 + 24));
    expect(wide.height).toBeCloseTo(1056 * (1400 / (816 * 2 + 24)));
  });

  it("fits every premade page inside the pane, in a row when that is larger", () => {
    const gap = 24;
    const expectLayout = (width: number, height: number, pages: number, side: boolean) => {
      const got = premadeLayout(width, height, pages);
      const row = Math.min(width / (pages * PAGE_W + (pages - 1) * gap), height / PAGE_H);
      const col = Math.min(width / PAGE_W, height / (pages * PAGE_H + (pages - 1) * gap));
      expect(got.side).toBe(side);
      expect(got.scale).toBeCloseTo(Math.min(1, side ? row : col));
    };
    expect(premadeLayout(0, 800, 2)).toEqual({ side: false, scale: 1 });
    expect(premadeLayout(800, 0, 2)).toEqual({ side: false, scale: 1 });
    expectLayout(5000, 5000, 1, false);
    expect(premadeLayout(5000, 5000, 1).scale).toBe(1);
    expectLayout(992, 821, 2, true);
    expectLayout(400, 1600, 2, false);
    expectLayout(992, 821, 3, true);
    expect(premadeLayout(992, 821, 3).scale).toBeLessThan(premadeLayout(992, 821, 2).scale);
  });
});
