import content from "../src/content.json";
import type { Character, HeroRequest, SheetCard, Tables } from "../src/types";

export function freshTables(): Tables {
  return structuredClone(content) as unknown as Tables;
}

export function req(over: Partial<HeroRequest> = {}): HeroRequest {
  return {
    name: "Hero",
    race: "human",
    cls: "fighter",
    subclass: null,
    subrace: null,
    level: 1,
    choices: [],
    cantrips: null,
    spells: null,
    path_spells: null,
    items: null,
    item_seed: null,
    armor: null,
    shield: null,
    weapon: null,
    base_scores: null,
    race_asi: null,
    inventory: null,
    notes: "",
    portrait: null,
    portrait_credit: null,
    ...over,
  };
}

export function picks(map: Record<string, string[]>): HeroRequest["choices"] {
  return Object.entries(map).map(([group, picked]) => ({ group, picks: picked }));
}

export function cards(ch: Character): Map<string, SheetCard> {
  return new Map(ch.cards.map((card) => [card.name, card]));
}

export function allText(value: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) for (const item of node) walk(item);
    else if (node && typeof node === "object") for (const item of Object.values(node)) walk(item);
  };
  walk(value);
  return out;
}
