import { describe, expect, it } from "vitest";
import { buildCharacter } from "../src/core";
import { chosenLanguages, languageChoices, languageParts, spokenLine } from "../src/languages";
import { freshTables, req } from "./helpers";

describe("extra languages", () => {
  it("reads a + more clause and leaves the rest as named languages", () => {
    expect(languageParts("Common + one more")).toEqual({ fixed: ["Common"], extra: 1 });
    expect(languageParts("Common, Elvish + 2 more")).toEqual({ fixed: ["Common", "Elvish"], extra: 2 });
    expect(languageParts("Common, Dwarvish")).toEqual({ fixed: ["Common", "Dwarvish"], extra: 0 });
    expect(languageParts("Common + 1 more language")).toEqual({ fixed: ["Common"], extra: 1 });
  });

  it("keeps + more until a language is picked, then names the ones that were picked", () => {
    expect(spokenLine("Common + one more", 0, null)).toBe("Common + one more");
    expect(spokenLine("Common + one more", 0, [])).toBe("Common + one more");
    expect(spokenLine("Common + one more", 0, ["Elvish"])).toBe("Common, Elvish");
    expect(spokenLine("Common + one more", 0, ["Common"])).toBe("Common + one more");
    expect(spokenLine("Common + one more", 0, ["Elvish", "Giant"])).toBe("Common, Elvish");
    expect(spokenLine("Common, Dwarvish", 0, ["Elvish"])).toBe("Common, Dwarvish");
    expect(spokenLine("Common, Dwarvish", 3, null)).toBe("Common, Dwarvish + 3 more");
    expect(spokenLine("Common, Dwarvish", 3, ["Giant", "Goblin"])).toBe("Common, Dwarvish, Giant, Goblin + 1 more");
    expect(spokenLine("Common, Dwarvish", 3, ["Giant", "Goblin", "Sylvan"])).toBe(
      "Common, Dwarvish, Giant, Goblin, Sylvan",
    );
    expect(spokenLine("Common + one more", 3, null)).toBe("Common + one more + 3 more");
    expect(spokenLine("Common + one more", 3, ["Elvish"])).toBe("Common, Elvish + 3 more");
    expect(chosenLanguages("Common + one more", 0, [" elvish ", "Elvish"])).toEqual(["elvish"]);
  });

  it("offers the usual languages plus any a race already names", () => {
    const names = languageChoices(["Common + one more", "Trade-talk, Growls"]);
    expect(names).toContain("Common");
    expect(names).toContain("Elvish");
    expect(names).toContain("Trade-talk");
    expect(names).toContain("Growls");
    expect(names.indexOf("Trade-talk")).toBeGreaterThan(names.indexOf("Undercommon"));
  });

  it("prints + one more on a human until the extra language is set", () => {
    const tables = freshTables();
    const human = buildCharacter(tables, req({ race: "human" }));
    expect(human.identity.languages).toBe("Common + one more");
    expect(human.identity.language_slots).toBe(1);
    expect(buildCharacter(tables, req({ race: "human", extra_languages: ["Elvish"] })).identity.languages).toBe(
      "Common, Elvish",
    );
    const dwarf = buildCharacter(tables, req({ race: "dwarf", extra_languages: ["Elvish"] }));
    expect(dwarf.identity.languages).toBe("Common, Dwarvish");
    expect(dwarf.identity.language_slots).toBe(0);
    const early = buildCharacter(tables, req({ race: "dwarf", level: 1, use_feats: true, feat: "linguist" }));
    expect(early.identity.language_slots).toBe(0);
    const linguist = buildCharacter(
      tables,
      req({ race: "dwarf", level: 4, use_feats: true, feat: "linguist", extra_languages: ["Giant"] }),
    );
    expect(linguist.identity.language_slots).toBe(3);
    expect(linguist.identity.languages).toBe("Common, Dwarvish, Giant + 2 more");
  });
});
