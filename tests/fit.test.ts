import { describe, expect, it } from "vitest";
import {
  type CardMetrics,
  cardsOverflow,
  FIT_FLOOR_PX,
  FIT_PASS_PX,
  FIT_START_PX,
  type FontBox,
  fitCardFont,
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
});
