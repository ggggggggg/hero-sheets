const PH = /\{([A-Z0-9_]+)\}/g;

export class CharError extends Error {
  readonly kind: "ValueError" | "KeyError";
  constructor(kind: "ValueError" | "KeyError", message: string) {
    super(message);
    this.kind = kind;
  }
}

const keyError = (message: string) => new CharError("KeyError", message);

const BANNED_FILE = new Set('\\/:*?"<>|'.split(""));

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function fileStem(value: string): string {
  return [...value]
    .filter((ch) => ch.charCodeAt(0) >= 32 && !BANNED_FILE.has(ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function expand(text: string, vars: Record<string, string | number>): string {
  let out = text || "";
  for (let i = 0; i < 4; i++) {
    const next = out.replace(PH, (_match, key: string) => {
      if (!(key in vars)) throw keyError(`no value for placeholder {${key}}`);
      return String(vars[key]);
    });
    if (next === out) break;
    out = next;
  }
  PH.lastIndex = 0;
  if (/\{([A-Z0-9_]+)\}/.test(out)) throw keyError(`unresolved placeholder in: ${out}`);
  return out;
}
