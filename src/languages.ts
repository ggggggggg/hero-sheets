// The extra language on a human, and the languages from a feat, stay unnamed until someone picks.

export const BOOK_LANGUAGES = [
  "Common",
  "Dwarvish",
  "Elvish",
  "Giant",
  "Gnomish",
  "Goblin",
  "Halfling",
  "Orc",
  "Abyssal",
  "Celestial",
  "Draconic",
  "Deep Speech",
  "Infernal",
  "Primordial",
  "Sylvan",
  "Undercommon",
  "Aquan",
  "Auran",
  "Ignan",
  "Terran",
] as const;

const MORE = /^(.*?)\s+\+\s+(one|a|an|\d+)\s+more(?:\s+languages?)?$/i;

export function languageParts(line: string): { fixed: string[]; extra: number } {
  const trimmed = line.trim();
  const match = MORE.exec(trimmed);
  const body = (match?.[1] ?? trimmed).trim();
  const word = match?.[2]?.toLowerCase() ?? "";
  const extra = !match ? 0 : word === "one" || word === "a" || word === "an" ? 1 : Number(word);
  const fixed = body
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return { fixed, extra: Number.isFinite(extra) ? extra : 0 };
}

export function languageSlots(raceLine: string, featLanguages: number): number {
  return languageParts(raceLine).extra + Math.max(0, featLanguages | 0);
}

export function chosenLanguages(
  raceLine: string,
  featLanguages: number,
  picked: readonly string[] | null | undefined,
): string[] {
  const slots = languageSlots(raceLine, featLanguages);
  if (slots < 1 || !picked?.length) return [];
  const known = new Set(languageParts(raceLine).fixed.map((name) => name.toLowerCase()));
  const chosen: string[] = [];
  for (const name of picked) {
    const clean = name.trim();
    const key = clean.toLowerCase();
    if (!clean || known.has(key) || chosen.some((item) => item.toLowerCase() === key)) continue;
    chosen.push(clean);
    if (chosen.length >= slots) break;
  }
  return chosen;
}

export function languageNotes(
  raceLine: string,
  from: string,
  featLanguages: number,
  featFrom: string,
  picked: readonly string[] | null | undefined,
): { name: string; from: string }[] {
  const parts = languageParts(raceLine);
  const chosen = chosenLanguages(raceLine, featLanguages, picked);
  const notes: { name: string; from: string }[] = parts.fixed.map((name) => ({ name, from }));
  const racePicked = chosen.slice(0, parts.extra);
  const featPicked = chosen.slice(parts.extra);
  for (const name of racePicked) notes.push({ name, from: "You picked it" });
  for (const name of featPicked) notes.push({ name, from: featFrom || "You picked it" });
  const unnamed = (count: number, source: string) => {
    if (count <= 0) return;
    notes.push({
      name: count === 1 ? "one more, not named yet" : `${count} more, not named yet`,
      from: source,
    });
  };
  unnamed(parts.extra - racePicked.length, from);
  unnamed(Math.max(0, featLanguages | 0) - featPicked.length, featFrom || "A feat");
  return notes;
}

export function spokenLine(
  raceLine: string,
  featLanguages: number,
  picked: readonly string[] | null | undefined,
): string {
  const chosen = chosenLanguages(raceLine, featLanguages, picked);
  const feat = Math.max(0, featLanguages | 0);
  if (!chosen.length) return feat > 0 ? `${raceLine} + ${feat} more` : raceLine;
  const slots = languageSlots(raceLine, featLanguages);
  const left = slots - chosen.length;
  const names = [...languageParts(raceLine).fixed, ...chosen].join(", ");
  return left > 0 ? `${names} + ${left} more` : names;
}

export function languageChoices(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: string) => {
    const clean = name.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };
  for (const name of BOOK_LANGUAGES) add(name);
  for (const line of lines) for (const name of languageParts(line).fixed) add(name);
  return out;
}
