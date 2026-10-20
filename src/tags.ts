import { escapeHtml } from "./text";
import type { Ability } from "./types";

export const ABILITY_NAME: Record<Ability, string> = {
  STR: "Strength",
  DEX: "Dexterity",
  CON: "Constitution",
  INT: "Intelligence",
  WIS: "Wisdom",
  CHA: "Charisma",
};

const ICONS: Record<string, string> = {
  A: '<svg viewBox="0 0 24 24"><path d="M14.5 3H21v6.5L10 20.5l-2-2-3 3-2.5-2.5 3-3-2-2z" fill="currentColor"/></svg>',
  B: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor"/></svg>',
  R: '<svg viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5z" fill="currentColor"/></svg>',
  ON: '<svg viewBox="0 0 24 24"><path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill="currentColor"/></svg>',
  F: '<svg viewBox="0 0 24 24"><path d="M12 1c.6 5 2 9.4 11 11-9 1.6-10.4 6-11 11-.6-5-2-9.4-11-11 9-1.6 10.4-6 11-11z" fill="currentColor"/></svg>',
};

export const TAGS: [string, string, string][] = [
  ["A", "ACTION", "#222"],
  ["B", "BONUS", "#e08a00"],
  ["R", "REACTION", "#2878c8"],
  ["ON", "ALWAYS ON", "#7a7a7a"],
  ["F", "FREE", "#2a9d5c"],
];

export const PAF_TAGS = TAGS.filter((row) => row[0] !== "F");

const TAGMAP = Object.fromEntries(TAGS.map(([key, label, color]) => [key, [label, color] as [string, string]]));

export function accentTint(hex: string): string {
  return hex.length === 7 ? `${hex}1a` : "#f2f2f2";
}

export function tagChip(tag: string, hideUnknown = false): string {
  if (!tag) return "";
  const known = TAGMAP[tag];
  if (!known) {
    if (hideUnknown) return "";
    return `<span class="chip" style="background:#555">${escapeHtml(tag)}</span>`;
  }
  return `<span class="chip" style="background:${known[1]}">${ICONS[tag] ?? ""}${escapeHtml(known[0])}</span>`;
}

export function tagLegend(rows: readonly (readonly [string, string, string])[] = TAGS): string {
  return rows
    .map(
      ([key, label, color]) =>
        `<span class="chip" style="background:${color};margin:0">${ICONS[key] ?? ""}${label}</span>`,
    )
    .join("");
}
