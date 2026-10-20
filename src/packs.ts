export interface SavedPack {
  title: string;
  text: string;
}

export interface BundledPack {
  title: string;
  text: string;
}

// A checked built-in pack used to stay as the copy from the day it was turned on.
export function refreshBundledPacks(
  saved: readonly SavedPack[],
  bundled: readonly BundledPack[],
): { packs: SavedPack[]; changed: boolean } {
  let changed = false;
  const packs = saved.map((pack) => {
    const site = bundled.find((item) => item.title === pack.title);
    if (!site || site.text === pack.text) return pack;
    changed = true;
    return { title: pack.title, text: site.text };
  });
  return { packs, changed };
}

export const DND_SAVE_KEYS = [
  "charsheet-custom-v1",
  "charsheet-custom-url-v1",
  "charsheet-custom-url-v1-text",
  "charsheet-ui-v1",
  "charsheet-heroes-v1",
  "charsheet-hero-v1",
];

export const PAF_SAVE_KEYS = ["paf-heroes-v1", "paf-packs-v1", "paf-ui-v1", "paf-pack-url-v1"];

export function clearSavedKeys(keys: readonly string[]): void {
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // private mode
    }
  }
}
