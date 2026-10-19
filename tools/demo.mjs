// Records demo/builder.gif from the booted page.
// Frames are taken only after styles and the sheet are on screen.
import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static");
if (typeof ffmpeg !== "string") throw new Error("ffmpeg-static did not provide a binary");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 4174;
const base = `http://localhost:${port}`;
const demoDir = path.join(root, "demo");
const tmp = path.join(demoDir, ".tmp");
const fps = 10;

function field(page, label) {
  return page.locator(".field").filter({
    has: page.locator(".flabel", { hasText: new RegExp(`^${label}`) }),
  });
}

async function waitForPreview() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // preview is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("vite preview did not start");
}

async function ready(page) {
  await page.waitForSelector("html[data-booted='1']");
  await page.waitForSelector("#scaler .page.front .head .sub");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function assertFrame(page, subtitle) {
  const info = await page.evaluate(() => {
    const brand = document.querySelector(".brand")?.getBoundingClientRect();
    const sub = document.querySelector(".page.front .head .sub");
    const box = sub?.getBoundingClientRect();
    const small = document.querySelector(".sm");
    return {
      styled: small instanceof Element && getComputedStyle(small).display === "none",
      booted: document.documentElement.dataset.booted ?? "",
      brandTop: brand?.top ?? -1,
      brandH: brand?.height ?? 0,
      subTop: box?.top ?? -1,
      subText: sub?.textContent ?? "",
    };
  });
  if (!info.styled || info.booted !== "1") throw new Error(`unstyled frame ${JSON.stringify(info)}`);
  if (info.brandTop < 0 || info.brandTop > 30 || info.brandH < 16) {
    throw new Error(`header is off screen ${JSON.stringify(info)}`);
  }
  if (info.subTop < 50 || info.subTop > 420) throw new Error(`sheet banner is off screen ${JSON.stringify(info)}`);
  if (subtitle && !info.subText.includes(subtitle)) throw new Error(`sheet says ${info.subText}`);
}

const built = path.join(root, "dist", "index.html");
await stat(built);
await mkdir(tmp, { recursive: true });
const preview = spawn(
  process.execPath,
  [path.join(root, "node_modules/vite/bin/vite.js"), "preview", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: "inherit" },
);

try {
  await waitForPreview();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  await page.addInitScript(() => {
    localStorage.clear();
    window.CHARSHEET_FIXED_START = true;
  });
  await page.goto(base);
  await ready(page);
  await page.addStyleTag({
    content:
      "#demo-cursor{position:fixed;z-index:100000;width:16px;height:16px;margin:2px 0 0 2px;border-radius:50%;background:#6a1b9a;border:3px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45);pointer-events:none}",
  });
  await page.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    document.body.appendChild(cursor);
  });

  const shots = [];
  const marks = {};
  const snap = async () => {
    const file = path.join(tmp, `${String(shots.length).padStart(4, "0")}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
  };
  const hold = async (seconds) => {
    for (let i = 0; i < Math.round(seconds * fps); i++) await snap();
  };
  const place = async (x, y) => {
    await page.mouse.move(x, y);
    await page.evaluate(
      ({ x, y }) => {
        const cursor = document.getElementById("demo-cursor");
        if (!cursor) throw new Error("cursor missing");
        cursor.style.left = `${x}px`;
        cursor.style.top = `${y}px`;
      },
      { x, y },
    );
  };
  const center = async (locator) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error("control is off screen");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (x < 0 || y < 4 || x > 1270 || y > 790) throw new Error(`control is off screen at ${Math.round(x)},${Math.round(y)}`);
    return { x, y };
  };
  const glide = async (x, y) => {
    const start = await page.evaluate(() => {
      const cursor = document.getElementById("demo-cursor");
      return {
        x: Number.parseFloat(cursor?.style.left || "80"),
        y: Number.parseFloat(cursor?.style.top || "160"),
      };
    });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await place(start.x + (x - start.x) * t, start.y + (y - start.y) * t);
      await snap();
    }
  };
  const show = async (locator) => {
    await locator.evaluate((el) => {
      const controls = document.getElementById("controls");
      if (!(controls instanceof HTMLElement) || !controls.contains(el)) return;
      const elBox = el.getBoundingClientRect();
      const box = controls.getBoundingClientRect();
      if (elBox.top >= box.top + 8 && elBox.bottom <= box.bottom - 8) return;
      const top = elBox.top - box.top + controls.scrollTop;
      controls.scrollTop = Math.max(0, top - 72);
    });
  };
  const press = async (locator) => {
    await show(locator);
    const point = await center(locator);
    await glide(point.x, point.y);
    await page.evaluate(() => {
      const tip = document.getElementById("tip");
      if (tip) tip.hidden = true;
    });
    await show(locator);
    const landed = await center(locator);
    await place(landed.x, landed.y);
    await page.mouse.click(landed.x, landed.y);
  };
  const pin = async () => {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      const controls = document.getElementById("controls");
      if (controls) controls.scrollTop = 0;
    });
  };
  const scrollToEl = async (locator, pad = 36, markName) => {
    const plan = await locator.evaluate((el, padding) => {
      const controls = document.getElementById("controls");
      if (!(controls instanceof HTMLElement) || !controls.contains(el)) return null;
      const top = el.getBoundingClientRect().top - controls.getBoundingClientRect().top + controls.scrollTop;
      const max = Math.max(0, controls.scrollHeight - controls.clientHeight);
      return { from: controls.scrollTop, to: Math.max(0, Math.min(top - padding, max)) };
    }, pad);
    if (!plan) return;
    const delta = plan.to - plan.from;
    if (Math.abs(delta) < 8) return;
    await page.evaluate(() => {
      const tip = document.getElementById("tip");
      if (tip) tip.hidden = true;
    });
    const steps = Math.min(24, Math.max(12, Math.round(Math.abs(delta) / 80)));
    const mid = Math.round(steps / 2);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const eased = 1 - (1 - t) ** 3;
      await page.evaluate((scroll) => {
        const controls = document.getElementById("controls");
        if (controls) controls.scrollTop = scroll;
      }, plan.from + delta * eased);
      if (markName && i === mid) marks[markName] = shots.length;
      await snap();
    }
  };

  const sub = page.locator(".page.front .head .sub");
  const level = page.locator(".page.front .lv b");
  const levelBtn = field(page, "Level").getByRole("button", { name: "1", exact: true });
  await levelBtn.click();
  await level.filter({ hasText: /^1$/ }).waitFor();
  await pin();
  await assertFrame(page, "Hill Dwarf");

  const surpriseBtn = page.locator("#surprise");
  const surpriseAt = await center(surpriseBtn);
  await place(surpriseAt.x, surpriseAt.y);
  marks.start = shots.length;
  await hold(0.8);
  const beforeName = await page.locator(".page.front .head .nm").innerText();
  const beforeSub = await sub.innerText();
  await press(surpriseBtn);
  await page.waitForFunction(
    ({ name, subtitle }) => {
      const nextName = document.querySelector(".page.front .head .nm")?.textContent ?? "";
      const nextSub = document.querySelector(".page.front .head .sub")?.textContent ?? "";
      return nextName !== name || nextSub !== subtitle;
    },
    { name: beforeName, subtitle: beforeSub },
  );
  await level.filter({ hasText: /^5$/ }).waitFor();
  await page.waitForFunction(() => (document.querySelector("#avatar-msg")?.textContent ?? "") !== "Drawing a face…");
  await pin();
  await assertFrame(page);
  marks.surprise = shots.length;
  await hold(0.7);

  await press(levelBtn);
  await level.filter({ hasText: /^1$/ }).waitFor();
  await pin();
  await assertFrame(page);
  marks.low = shots.length;
  await hold(1.2);

  await press(field(page, "Race").getByRole("button", { name: "Elf", exact: true }));
  await sub.filter({ hasText: "Elf" }).waitFor();
  await level.filter({ hasText: /^1$/ }).waitFor();
  await pin();
  await assertFrame(page, "Elf");
  marks.elf = shots.length;
  await hold(1.1);

  await press(field(page, "Class").getByRole("button", { name: "Rogue", exact: true }));
  await sub.filter({ hasText: "Rogue" }).waitFor();
  await level.filter({ hasText: /^1$/ }).waitFor();
  await pin();
  await assertFrame(page, "Rogue");
  marks.fighter = shots.length;
  await hold(1.1);

  const packsSummary = page.locator("#content-packs summary");
  await scrollToEl(packsSummary, 24, "down");
  await press(packsSummary);
  await page.waitForSelector("#content-packs[open]");
  const add = page.locator("#content-packs li", { hasText: "Turtles & Pirates" }).getByRole("checkbox");
  await scrollToEl(add, 80);
  await center(add);
  await assertFrame(page, "Rogue");
  marks.packs = shots.length;
  await hold(1.2);

  await press(add);
  const turtle = field(page, "Race").getByRole("button", { name: /Turtle-folk/ });
  await turtle.waitFor();
  await scrollToEl(turtle, 80, "back");
  await press(turtle);
  await sub.filter({ hasText: "Turtle-folk" }).waitFor();
  await level.filter({ hasText: /^1$/ }).waitFor();
  await pin();
  await assertFrame(page, "Turtle-folk");
  marks.end = shots.length;
  await hold(1.6);

  await browser.close();
  const first = shots[0];
  if (!first) throw new Error("no frames");
  const firstSize = await stat(first);
  if (firstSize.size < 100_000) throw new Error(`first frame is only ${firstSize.size} bytes`);

  const gif = path.join(demoDir, "builder.gif");
  await execFileAsync(ffmpeg, [
    "-y",
    "-framerate",
    String(fps),
    "-i",
    path.join(tmp, "%04d.png"),
    "-vf",
    "fps=10,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=none",
    "-loop",
    "0",
    gif,
  ]);
  const review = "/tmp/hero-demo-frames";
  await mkdir(review, { recursive: true });
  for (const [name, index] of Object.entries(marks)) {
    const frame = shots[index];
    if (frame) await copyFile(frame, path.join(review, `${name}.png`));
  }
  console.log(JSON.stringify({ fps, frames: shots.length, marks, gif }));
} finally {
  preview.kill("SIGTERM");
  await rm(tmp, { recursive: true, force: true });
}
