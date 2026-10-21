/** Campaign caps. The usual sheet is level 7 with no magic plus, and that sheet fits on two pages. */

export const BOOK_LEVEL = 7;
export const PLUS_CAP = 3;

export type TierId = "sheet" | "1" | "2" | "3" | "4";

export interface TierPreset {
  id: TierId;
  label: string;
  maxLevel: number;
  maxPlus: number;
}

/** 2014 tiers of play, with the DMG's +1 / +2 / +3 rarity steps. The usual sheet is the product cap, not a tier. */
export const TIERS: readonly TierPreset[] = [
  { id: "sheet", label: "Usual sheet · 7", maxLevel: 7, maxPlus: 0 },
  { id: "1", label: "Tier 1 · 4 · +1", maxLevel: 4, maxPlus: 1 },
  { id: "2", label: "Tier 2 · 10 · +2", maxLevel: 10, maxPlus: 2 },
  { id: "3", label: "Tier 3 · 16 · +3", maxLevel: 16, maxPlus: 3 },
  { id: "4", label: "Tier 4 · 20 · +3", maxLevel: 20, maxPlus: 3 },
];

export function matchTier(levelCap: number, plusCap: number): TierId | "custom" {
  const found = TIERS.find((tier) => tier.maxLevel === levelCap && tier.maxPlus === plusCap);
  return found ? found.id : "custom";
}

export function clampPlus(value: number, cap = PLUS_CAP): number {
  const n = value | 0;
  if (cap <= 0) return 0;
  return Math.min(Math.max(n, 0), cap);
}
