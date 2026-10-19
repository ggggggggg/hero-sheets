/* Turn the sheet into files: a 2-page PDF (made right in the browser, no libraries)
 * and a print-ready 2-page HTML. Needs window.CHARSHEET_PRINT_CSS (fonts + sheet CSS).
 *
 * PDF: each page is drawn by the browser itself (SVG <foreignObject>), so it looks exactly
 * like the preview, then turned into a JPEG and wrapped in a tiny hand-written PDF.
 */
(function (root) {
  "use strict";
  const PAGE_W = 816, PAGE_H = 1056;          // CSS px of one letter page (8.5in x 11in @ 96dpi)
  const PT_W = 612, PT_H = 792;               // PDF points
  const SCALE = 3;                            // 288 dpi

  function sheetCss() {
    if (root.CHARSHEET_PRINT_CSS) return root.CHARSHEET_PRINT_CSS;
    const n = document.getElementById("sheet-css");
    return n ? n.textContent : "";
  }

  function fitCards(page) {
    const c = page.querySelector(".cards");
    if (!c) return;
    const fits = () => { if (c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1) return false; const box = c.getBoundingClientRect(); const tol = 1 + box.width / 400; for (const k of c.querySelectorAll('.cd, .sec h3')) { const r = k.getBoundingClientRect(); if (r.right > box.right + tol || r.bottom > box.bottom + tol) return false; } return true; };
    let fs = 16;
    c.style.setProperty("--fs", fs + "px");
    while (!fits() && fs > 8) { fs -= 0.25; c.style.setProperty("--fs", fs + "px"); }
  }

  /** Lay the sheet out off-screen at true size; returns {host, sheet, pages}. */
  function layOut(sheetHtml) {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-20000px;top:0;width:" + PAGE_W + "px;pointer-events:none;";
    host.innerHTML = sheetHtml;
    document.body.appendChild(host);
    const sheet = host.querySelector(".sheet");
    const pages = Array.from(host.querySelectorAll(".page"));
    pages.forEach(fitCards);
    return { host, sheet, pages };
  }

  function pageSvg(sheet, page, css) {
    const wrap = document.createElement("div");
    wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const style = document.createElement("style");
    style.textContent = css + "\n.page{box-shadow:none!important;border-radius:0!important;margin:0!important}";
    const sh = document.createElement("div");
    sh.className = "sheet";
    sh.setAttribute("style", sheet.getAttribute("style") || "");
    sh.appendChild(page.cloneNode(true));
    wrap.appendChild(style);
    wrap.appendChild(sh);
    wrap.setAttribute("style", "width:" + PAGE_W + "px;height:" + PAGE_H + "px;transform:scale(" + SCALE + ");transform-origin:0 0;");
    const xhtml = new XMLSerializer().serializeToString(wrap);
    // No viewBox: WebKit ignores viewBox scaling for foreignObject, so we scale the HTML itself.
    const W = PAGE_W * SCALE, H = PAGE_H * SCALE;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><foreignObject x="0" y="0" width="' + W +
      '" height="' + H + '">' + xhtml + "</foreignObject></svg>";
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("The browser couldn't draw the sheet."));
      img.src = src;
    });
  }

  async function pageJpeg(svg) {
    const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
    if (img.decode) { try { await img.decode(); } catch (e) { /* drawn below anyway */ } }
    const cv = document.createElement("canvas");
    cv.width = PAGE_W * SCALE; cv.height = PAGE_H * SCALE;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    // draw twice: the first pass lets fonts inside the picture settle
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    await new Promise((r) => setTimeout(r, 60));
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    let blob;
    try {
      blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("empty"))), "image/jpeg", 0.9));
    } catch (e) {
      const err = new Error("This browser won't let the page turn the sheet into a picture. Use “Save print-ready HTML” instead.");
      err.code = "tainted";
      throw err;
    }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w: cv.width, h: cv.height };
  }

  /** Minimal PDF: one full-page JPEG per page. Pure. */
  function jpegsToPdf(images, title) {
    const enc = new TextEncoder();
    const chunks = [];
    let len = 0;
    const offsets = [];
    const push = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; chunks.push(b); len += b.length; };
    const obj = (n, body) => { offsets[n] = len; push(n + " 0 obj\n"); body(); push("\nendobj\n"); };
    const n = images.length;
    // objects: 1 catalog, 2 pages, 3 info, then per page: page, content, image
    push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
    const kids = images.map((_, i) => (4 + i * 3) + " 0 R").join(" ");
    obj(2, () => push("<< /Type /Pages /Count " + n + " /Kids [" + kids + "] >>"));
    const safe = String(title || "Hero").replace(/[\\()]/g, "").replace(/[^\x20-\x7e]/g, "");
    obj(3, () => push("<< /Title (" + safe + ") /Producer (Hero Sheet Builder) >>"));
    images.forEach((im, i) => {
      const p = 4 + i * 3, c = p + 1, x = p + 2;
      obj(p, () => push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PT_W + " " + PT_H + "] /Resources << /XObject << /Im0 " + x +
        " 0 R >> >> /Contents " + c + " 0 R >>"));
      const content = "q " + PT_W + " 0 0 " + PT_H + " 0 0 cm /Im0 Do Q";
      obj(c, () => push("<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream"));
      obj(x, () => {
        push("<< /Type /XObject /Subtype /Image /Width " + im.w + " /Height " + im.h +
          " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + im.bytes.length + " >>\nstream\n");
        push(im.bytes);
        push("\nendstream");
      });
    });
    const total = 3 + n * 3;
    const xref = len;
    let x = "xref\n0 " + (total + 1) + "\n0000000000 65535 f \n";
    for (let i = 1; i <= total; i++) x += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    push(x + "trailer\n<< /Size " + (total + 1) + " /Root 1 0 R /Info 3 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    const out = new Uint8Array(len);
    let o = 0;
    for (const b of chunks) { out.set(b, o); o += b.length; }
    return out;
  }

  async function makePdf(sheetHtml, title) {
    const css = sheetCss();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const { host, sheet, pages } = layOut(sheetHtml);
    try {
      const imgs = [];
      for (const p of pages) imgs.push(await pageJpeg(pageSvg(sheet, p, css)));
      return new Blob([jpegsToPdf(imgs, title)], { type: "application/pdf" });
    } finally {
      host.remove();
    }
  }

  function makeHtml(sheetHtml, title) {
    const css = sheetCss();
    const { host } = layOut(sheetHtml);
    const fitted = host.innerHTML;
    host.remove();
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>" + esc(title) + "</title><style>" + css +
      "\n@page{size:letter;margin:0}html,body{margin:0;background:#fff}" +
      "@media screen{body{background:#888}.sheet{display:flex;flex-direction:column;align-items:center;gap:24px;padding:24px 0}" +
      ".page{box-shadow:0 2px 14px rgba(0,0,0,.3)}}</style></head><body>" + fitted + "</body></html>";
  }

  const api = { makePdf, makeHtml, jpegsToPdf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CharsheetExport = api;
})(typeof window !== "undefined" ? window : globalThis);
