import { CharError } from "../text";
import { type PafTables, tablesFrom } from "./core";

const LISTS = ["origins", "skills", "armor", "weapons", "flux", "relics", "capstones", "heroes"] as const;
type ListName = (typeof LISTS)[number];
const META = new Set(["kind", "title", "about", "emoji"]);

function isObj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parsePafPack(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CharError("ValueError", "That file is not JSON.");
  }
  if (!isObj(value)) throw new CharError("ValueError", "A PAF pack should be a JSON object.");
  if (value.kind !== "paf") {
    throw new CharError("ValueError", 'This file is not a PAF pack. It needs "kind": "paf".');
  }
  for (const key of Object.keys(value)) {
    if (!META.has(key) && !LISTS.some((name) => name === key)) {
      throw new CharError("ValueError", `Unknown field ${key}.`);
    }
  }
  return value;
}

function rowKey(table: ListName, row: Record<string, unknown>): string {
  const key = table === "origins" || table === "capstones" ? row.id : row.name;
  return typeof key === "string" ? key : "";
}

export function mergePaf(base: PafTables, pack: Record<string, unknown>): PafTables {
  const next: Record<string, unknown> = {
    max_level: base.max_level,
    origins: base.origins,
    skills: base.skills,
    armor: base.armor,
    weapons: base.weapons,
    flux: base.flux,
    relics: base.relics,
    capstones: base.capstones,
    heroes: base.heroes,
  };
  for (const table of LISTS) {
    const rows = pack[table];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new CharError("ValueError", `${table} should be a list.`);
    const list = [...(next[table] as Record<string, unknown>[])];
    for (const row of rows) {
      if (!isObj(row)) throw new CharError("ValueError", `${table} entries should be objects.`);
      const key = rowKey(table, row);
      const at = key ? list.findIndex((item) => rowKey(table, item) === key) : -1;
      if (at >= 0) list[at] = row;
      else list.push(row);
    }
    next[table] = list;
  }
  return tablesFrom(next);
}

export function packTitle(pack: Record<string, unknown>, fallback: string): string {
  return typeof pack.title === "string" && pack.title ? pack.title : fallback;
}
