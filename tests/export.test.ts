import { describe, expect, it } from "vitest";
import { jpegsToPdf, readHeroSheet } from "../src/export";

const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), w: 1, h: 1 };

const hero = {
  state: {
    name: "Tobin aka Flame Master",
    race: "dwarf",
    cls: "flame_warlock",
    subrace: "mountain",
    level: 5,
    notes: "Dragons: Speak & Talk",
  },
  packs: [{ title: "Tobin aka Flame Master", text: '{"title":"Tobin aka Flame Master"}' }],
};

describe("hero pdf", () => {
  it("round-trips the hero and its packs", () => {
    const pdf = jpegsToPdf([jpeg, jpeg], "Tobin", hero);
    expect(readHeroSheet(pdf)).toEqual({ state: hero.state, packs: hero.packs });
  });

  it("returns null when the pdf has no hero", () => {
    expect(readHeroSheet(jpegsToPdf([jpeg], "Hero"))).toBeNull();
  });

  it("keeps scanning when an earlier marker is not a hero", () => {
    const pdf = jpegsToPdf([jpeg], "Tobin", hero);
    const junk = new TextEncoder().encode("HEROSHEET1 4\nnopeHEROSHEET1 2\n{}");
    const both = new Uint8Array(junk.length + pdf.length);
    both.set(junk);
    both.set(pdf, junk.length);
    expect(readHeroSheet(both)?.state).toEqual(hero.state);
  });

  it("returns null when the marker's length runs past the file", () => {
    expect(readHeroSheet(new TextEncoder().encode("HEROSHEET1 40\nshort"))).toBeNull();
  });

  it("keeps a hero and drops pack entries that are not a title and text", () => {
    const pdf = jpegsToPdf([jpeg], "Tobin", {
      state: hero.state,
      packs: [{ title: "Ok", text: "{}" }, { title: "No text" }, { text: "no title" }, { title: 4, text: "nope" }] as {
        title: string;
        text: string;
      }[],
    });
    expect(readHeroSheet(pdf)?.packs).toEqual([{ title: "Ok", text: "{}" }]);
  });
});
