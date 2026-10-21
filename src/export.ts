import { fitCardFont, PAGE_H, PAGE_W, spillBack } from "./fit";

const PT_W = 612;
const PT_H = 792;
const SCALE = 3;

export interface JpegPage {
  bytes: Uint8Array;
  w: number;
  h: number;
}

export interface HeroFile {
  state: object;
  packs: { title: string; text: string }[];
}

export interface HeroSheetFile {
  state: Record<string, unknown>;
  packs: { title: string; text: string }[];
}

const HERO_MARK = "HEROSHEET1 ";

function heroBytes(hero: HeroFile): Uint8Array {
  const json = JSON.stringify({ v: 1, state: hero.state, packs: hero.packs });
  const body = new TextEncoder().encode(json);
  const head = new TextEncoder().encode(`${HERO_MARK}${body.length}\n`);
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}

function findBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  for (let i = from; i + needle.length <= haystack.length; i++) {
    let same = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        same = false;
        break;
      }
    }
    if (same) return i;
  }
  return -1;
}

function packCopies(value: unknown): { title: string; text: string }[] {
  if (!Array.isArray(value)) return [];
  const packs: { title: string; text: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.title === "string" && typeof row.text === "string") packs.push({ title: row.title, text: row.text });
  }
  return packs;
}

export function readHeroSheet(bytes: Uint8Array): HeroSheetFile | null {
  const mark = new TextEncoder().encode(HERO_MARK);
  let from = 0;
  while (from < bytes.length) {
    const at = findBytes(bytes, mark, from);
    if (at < 0) return null;
    let cursor = at + mark.length;
    let length = 0;
    let digits = 0;
    while (
      cursor < bytes.length &&
      bytes[cursor] !== undefined &&
      bytes[cursor] >= 48 &&
      bytes[cursor] <= 57 &&
      digits < 9
    ) {
      length = length * 10 + ((bytes[cursor] ?? 0) - 48);
      cursor++;
      digits++;
    }
    if (!digits || bytes[cursor] !== 10) {
      from = at + mark.length;
      continue;
    }
    cursor++;
    if (cursor + length > bytes.length) return null;
    const text = new TextDecoder().decode(bytes.subarray(cursor, cursor + length));
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        const row = parsed as Record<string, unknown>;
        if (row.state && typeof row.state === "object") {
          const state = row.state as Record<string, unknown>;
          const dnd = typeof state.race === "string" && typeof state.cls === "string";
          const paf = state.kind === "paf" && typeof state.origin1 === "string" && typeof state.origin2 === "string";
          if (dnd || paf) return { state, packs: packCopies(row.packs) };
        }
      }
    } catch {
      // a picture in the PDF can contain the marker bytes
    }
    from = cursor + length;
  }
  return null;
}

export class ExportError extends Error {
  readonly code: "tainted";
  constructor(message: string) {
    super(message);
    this.code = "tainted";
  }
}

function sheetCss(): string {
  const node = document.getElementById("sheet-css");
  return node?.textContent ?? "";
}

function fitCards(page: Element): void {
  const cards = page.querySelector(".cards");
  if (!(cards instanceof HTMLElement)) return;
  fitCardFont(cards);
}

function layOut(html: string, spill = false): { host: HTMLDivElement; sheet: HTMLElement; pages: HTMLElement[] } {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${PAGE_W}px;pointer-events:none;`;
  host.innerHTML = html;
  document.body.appendChild(host);
  const sheet = host.querySelector(".sheet");
  if (!(sheet instanceof HTMLElement)) {
    host.remove();
    throw new Error("sheet markup has no .sheet");
  }
  if (spill) {
    const back = host.querySelector(".page.back");
    if (back instanceof HTMLElement) spillBack(back);
  }
  const pages = [...host.querySelectorAll(".page")].filter((page): page is HTMLElement => page instanceof HTMLElement);
  if (!spill) for (const page of pages) fitCards(page);
  return { host, sheet, pages };
}

function pageSvg(sheet: HTMLElement, page: HTMLElement, css: string): string {
  const wrap = document.createElement("div");
  wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const style = document.createElement("style");
  style.textContent = `${css}\n.page{box-shadow:none!important;border-radius:0!important;margin:0!important}`;
  const copy = document.createElement("div");
  copy.className = "sheet";
  copy.setAttribute("style", sheet.getAttribute("style") ?? "");
  copy.appendChild(page.cloneNode(true));
  wrap.appendChild(style);
  wrap.appendChild(copy);
  wrap.setAttribute("style", `width:${PAGE_W}px;height:${PAGE_H}px;transform:scale(${SCALE});transform-origin:0 0;`);
  const xhtml = new XMLSerializer().serializeToString(wrap);
  const w = PAGE_W * SCALE;
  const h = PAGE_H * SCALE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The browser couldn't draw the sheet."));
    img.src = src;
  });
}

async function pageJpeg(svg: string): Promise<JpegPage> {
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  if (img.decode) {
    try {
      await img.decode();
    } catch {
      // a failed decode still leaves a drawable image
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W * SCALE;
  canvas.height = PAGE_H * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The browser couldn't draw the sheet.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  await new Promise((resolve) => setTimeout(resolve, 60));
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let blob: Blob;
  try {
    blob = await new Promise((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("empty"))), "image/jpeg", 0.9);
    });
  } catch {
    throw new ExportError(
      "This browser won't let the page turn the sheet into a picture. Use “Save print-ready HTML” instead.",
    );
  }
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height };
}

export function jpegsToPdf(images: JpegPage[], title: string, hero?: HeroFile): Uint8Array {
  const embedded = hero ? heroBytes(hero) : null;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let len = 0;
  const offsets: number[] = [];
  const push = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? enc.encode(value) : value;
    chunks.push(bytes);
    len += bytes.length;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = len;
    push(`${n} 0 obj\n`);
    body();
    push("\nendobj\n");
  };
  const n = images.length;
  const extra = embedded ? 2 : 0;
  const firstPage = 4 + extra;
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  obj(1, () =>
    push(
      embedded
        ? "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(hero.json) 4 0 R] >> >> >>"
        : "<< /Type /Catalog /Pages 2 0 R >>",
    ),
  );
  const kids = images.map((_, i) => `${firstPage + i * 3} 0 R`).join(" ");
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${kids}] >>`));
  const safe = String(title || "Hero")
    .replace(/[\\()]/g, "")
    .replace(/[^\x20-\x7e]/g, "");
  obj(3, () => push(`<< /Title (${safe}) /Producer (Hero Sheet Builder) >>`));
  if (embedded) {
    obj(4, () => push("<< /Type /Filespec /F (hero.json) /EF << /F 5 0 R >> /Desc (Hero Sheet Builder hero) >>"));
    obj(5, () => {
      push(`<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length ${embedded.length} >>\nstream\n`);
      push(embedded);
      push("\nendstream");
    });
  }
  images.forEach((image, i) => {
    const page = firstPage + i * 3;
    const contentId = page + 1;
    const imageId = page + 2;
    obj(page, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PT_W} ${PT_H}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
    const content = `q ${PT_W} 0 0 ${PT_H} 0 0 cm /Im0 Do Q`;
    obj(contentId, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(imageId, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      );
      push(image.bytes);
      push("\nendstream");
    });
  });
  const total = 3 + extra + n * 3;
  const xref = len;
  let xrefBody = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i++) xrefBody += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
  push(`${xrefBody}trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function makePdf(html: string, title: string, hero?: HeroFile, spill = false): Promise<Blob> {
  const css = sheetCss();
  if (document.fonts) await document.fonts.ready;
  const { host, sheet, pages } = layOut(html, spill);
  try {
    const images: JpegPage[] = [];
    for (const page of pages) images.push(await pageJpeg(pageSvg(sheet, page, css)));
    const bytes = jpegsToPdf(images, title, hero);
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return new Blob([copy], { type: "application/pdf" });
  } finally {
    host.remove();
  }
}

export function makeHtml(html: string, title: string, spill = false): string {
  const css = sheetCss();
  const { host } = layOut(html, spill);
  const fitted = host.innerHTML;
  host.remove();
  const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}\n@page{size:letter;margin:0}html,body{margin:0;background:#fff}@media screen{body{background:#888}.sheet{display:flex;flex-direction:column;align-items:center;gap:24px;padding:24px 0}.page{box-shadow:0 2px 14px rgba(0,0,0,.3)}}</style></head><body>${fitted}</body></html>`;
}
