// Cartoon faces for both builders. The pictures come from DiceBear.

export type Look = "boy" | "girl";

export interface FacePick {
  style: string;
  seed: string;
  look: Look;
}

export interface FaceState {
  name: string;
  portrait: string | null;
  portrait_credit: string | null;
  avatar: FacePick | null;
  look: Look | null;
}

interface FaceHooks {
  read: () => FaceState;
  write: (patch: Partial<FaceState>) => void;
  refresh: () => void;
}

interface AvatarOptions {
  seed: string;
  size: number;
  hair?: string[];
  earringsProbability?: number;
  features?: string[];
  beardProbability?: number;
  accessories?: string[];
  top?: string[];
  mustacheProbability?: number;
}

interface AvatarCore {
  createAvatar: (style: object, options: AvatarOptions) => { toString(): string };
}

type Kid = Node | string | number | false | null | undefined;

interface Attrs {
  class?: string;
  id?: string;
  type?: string;
  for?: string;
  accept?: string;
  value?: string;
  maxlength?: number;
  autocomplete?: string;
  spellcheck?: string;
  title?: string;
  "aria-label"?: string;
  "aria-pressed"?: string;
  onclick?: (ev: Event) => void;
  oninput?: (ev: Event) => void;
  onchange?: (ev: Event) => void;
}

const STYLES = [
  { id: "pixel", label: "Pixel", pkg: "pixel-art", credit: "Art: “Pixel Art” by DiceBear, CC0" },
  {
    id: "adventurer",
    label: "Adventurer",
    pkg: "adventurer",
    credit: "Art: “Adventurer” by Lisa Wischofsky, CC BY 4.0, via DiceBear",
  },
  {
    id: "smile",
    label: "Big smile",
    pkg: "big-smile",
    credit: "Art: “Big Smile” by Ashley Seo, CC BY 4.0, via DiceBear",
  },
  {
    id: "doodle",
    label: "Doodle",
    pkg: "croodles",
    credit: "Art: “Croodles” by Vijay Verma, CC BY 4.0, via DiceBear",
  },
];

const DICEBEAR = "https://cdn.jsdelivr.net/npm/@dicebear/";
const DICEBEAR_V = "9.2.2";
const avatarMods = new Map<string, Promise<unknown>>();

const SEED_A = [
  "brave",
  "sneaky",
  "sleepy",
  "fizzy",
  "lucky",
  "grumpy",
  "jolly",
  "tiny",
  "mighty",
  "silly",
  "quiet",
  "wild",
];
const SEED_B = [
  "otter",
  "dragon",
  "badger",
  "pickle",
  "comet",
  "goblin",
  "pebble",
  "wizard",
  "turnip",
  "falcon",
  "muffin",
  "troll",
];

const pad2 = (n: number) => String(n).padStart(2, "0");
const range = (pre: string, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => pre + pad2(a + i));
const LOOKS: Record<string, Partial<Record<Look, Omit<AvatarOptions, "seed" | "size">>>> = {
  adventurer: {
    boy: { hair: range("short", 1, 19), earringsProbability: 0 },
    girl: { hair: range("long", 1, 26), earringsProbability: 30, features: ["blush", "birthmark", "freckles"] },
  },
  pixel: { boy: { hair: range("short", 1, 24) }, girl: { hair: range("long", 1, 21), beardProbability: 0 } },
  smile: {
    boy: { hair: ["shortHair", "mohawk", "bowlCutHair", "shavedHead", "halfShavedHead", "curlyShortHair"] },
    girl: {
      hair: ["wavyBob", "curlyBob", "straightHair", "braids", "bunHair", "froBun", "bangs"],
      accessories: ["catEars", "glasses", "sailormoonCrown", "clownNose", "sleepMask", "sunglasses", "faceMask"],
    },
  },
  doodle: {
    boy: {
      top: [
        "variant01",
        "variant02",
        "variant03",
        "variant04",
        "variant06",
        "variant07",
        "variant08",
        "variant09",
        "variant19",
        "variant21",
        "variant22",
        "variant24",
        "variant25",
        "variant26",
        "variant27",
        "variant29",
      ],
    },
    girl: {
      top: [...range("variant", 10, 18), "variant05", "variant21", "variant25"],
      beardProbability: 0,
      mustacheProbability: 0,
    },
  },
};

const BOY_NAMES = new Set(
  "tobin rook fennick grimble brick dex bolt aaron adam aiden alex alexander andrew anthony arthur austin ben benjamin bob brandon brian bruce caleb carl carlos charles charlie chris christopher cole colin connor daniel david dean derek dominic dylan edward eli elijah eric ethan evan felix finn frank fred gabe gabriel galen gavin george graham greg harry henry hugo ian isaac jack jacob jake james jason jeff jeremy jesse joe joel john jonah jonathan jordan jose joseph josh joshua juan julian justin kevin kyle leo leon liam logan lucas luke marcus mark martin mason matt matthew max michael miles nate nathan nick nicholas noah oliver oscar owen patrick paul peter phil ralph ray ryan sam samuel scott sean seth simon steve steven theo thomas tim timothy tom tony travis trevor tyler victor vincent walter wesley will william wyatt zach zachary gandalf aragorn bilbo frodo thor conan merlin drizzt gimli legolas boromir sam".split(
    " ",
  ),
);
const GIRL_NAMES = new Set(
  "mira juniper nova tulip moxie luna odette saffron wren abby abigail ada addison alice alicia allison amanda amber amelia amy anna annie aria ariana audrey ava bella brooke caroline charlotte chloe claire clara daisy ella ellie emily emma eva evelyn faith fiona freya grace hailey hannah harper hazel holly isabel isabella ivy jade jane jasmine jenna jennifer jessica josie julia kate katie kayla kim laura layla leah lily lila lucy lydia maddie madison maya megan mia molly naomi natalie nora olivia penny piper poppy quinn rachel rose ruby sadie sara sarah scarlett sofia sophia sophie stella susan tessa violet willow zoe zoey hermione arwen galadriel elsa anna leia rey".split(
    " ",
  ),
);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...kids: (Kid | Kid[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === "class" && typeof value === "string") node.className = value;
    else if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2), value as EventListener);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error("nothing to pick");
  return item;
}

function nameLook(name: string): Look | null {
  const word =
    String(name || "")
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, "") ?? "";
  return BOY_NAMES.has(word) ? "boy" : GIRL_NAMES.has(word) ? "girl" : null;
}

function coin(seed: string): Look {
  let hash = 7;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) % 2147483647;
  return hash % 2 ? "girl" : "boy";
}

async function importModule(url: string): Promise<unknown> {
  return await import(/* @vite-ignore */ url);
}

function asAvatarCore(mod: unknown): AvatarCore {
  if (typeof mod !== "object" || mod === null || !("createAvatar" in mod) || typeof mod.createAvatar !== "function") {
    throw new Error("cartoon face library didn't load");
  }
  const createAvatar = mod.createAvatar.bind(mod) as AvatarCore["createAvatar"];
  return { createAvatar };
}

async function avatarLib(pkg: string): Promise<[AvatarCore, object]> {
  const coreUrl = `${DICEBEAR}core@${DICEBEAR_V}/+esm`;
  const styleUrl = `${DICEBEAR}${pkg}@${DICEBEAR_V}/+esm`;
  let core = avatarMods.get("core");
  if (!core) {
    core = importModule(coreUrl);
    avatarMods.set("core", core);
  }
  let style = avatarMods.get(pkg);
  if (!style) {
    style = importModule(styleUrl);
    avatarMods.set(pkg, style);
  }
  const [coreMod, styleMod] = await Promise.all([core, style]);
  if (typeof styleMod !== "object" || styleMod === null) throw new Error("cartoon face library didn't load");
  return [asAvatarCore(coreMod), styleMod];
}

function focusId(id: string): void {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLInputElement)) return;
  node.focus();
  node.setSelectionRange(node.value.length, node.value.length);
}

export function createFaceKit(hooks: FaceHooks): {
  controls: () => HTMLElement;
  noteName: () => void;
  draw: (styleId: string, seed: string | null) => Promise<void>;
  randomFace: () => Promise<void>;
} {
  let lookTimer = 0;
  let seedTimer = 0;

  function lookFor(seed: string): { look: Look; why: string } {
    const state = hooks.read();
    if (state.look) return { look: state.look, why: "" };
    const named = nameLook(state.name);
    return named
      ? { look: named, why: "matches the name" }
      : { look: coin(seed), why: "coin flip (name could be either)" };
  }

  function redraw(): void {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.id : "";
    hooks.refresh();
    if (focused === "face-seed" || focused === "name") focusId(focused);
  }

  async function draw(styleId: string, seed: string | null): Promise<void> {
    if (seed === null) {
      hooks.write({ avatar: null, portrait: null, portrait_credit: null });
      redraw();
      return;
    }
    const style = STYLES.find((item) => item.id === styleId);
    const msg = document.getElementById("avatar-msg");
    if (!style) {
      if (msg)
        msg.textContent = "Couldn't load the cartoon faces (they come from the internet). Upload a picture instead.";
      return;
    }
    if (msg) msg.textContent = "Drawing a face…";
    try {
      const [core, styleMod] = await avatarLib(style.pkg);
      const look = lookFor(seed).look;
      const svg = core.createAvatar(styleMod, { seed, size: 256, ...(LOOKS[styleId]?.[look] ?? {}) }).toString();
      hooks.write({
        portrait: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`,
        portrait_credit: style.credit,
        avatar: { style: styleId, seed, look },
      });
      redraw();
    } catch {
      avatarMods.delete("core");
      avatarMods.delete(style.pkg);
      const again = document.getElementById("avatar-msg");
      if (again)
        again.textContent = "Couldn't load the cartoon faces (they come from the internet). Upload a picture instead.";
    }
  }

  function loadPortrait(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 600 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        hooks.write({ portrait: canvas.toDataURL("image/jpeg", 0.85), portrait_credit: null, avatar: null });
        redraw();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function noteName(): void {
    clearTimeout(lookTimer);
    lookTimer = window.setTimeout(() => {
      const state = hooks.read();
      if (!state.avatar || state.look) return;
      const had = document.activeElement instanceof HTMLElement && document.activeElement.id === "name";
      if (lookFor(state.avatar.seed).look !== state.avatar.look) {
        void draw(state.avatar.style, state.avatar.seed).then(() => {
          if (had) focusId("name");
        });
      } else {
        hooks.refresh();
        if (had) focusId("name");
      }
    }, 400);
  }

  const randomSeed = () => `${pick(SEED_A)}-${pick(SEED_B)}-${1 + Math.floor(Math.random() * 99)}`;

  function controls(): HTMLElement {
    const state = hooks.read();
    const avatar = state.avatar;
    return el(
      "div",
      { class: "pic" },
      el(
        "div",
        { class: "chips" },
        STYLES.map((style) =>
          el(
            "button",
            {
              type: "button",
              class: `chip-btn${avatar?.style === style.id ? " on" : ""}`,
              onclick: () => {
                void draw(style.id, avatar?.style === style.id ? null : avatar?.seed || state.name || "Hero");
              },
            },
            style.label,
          ),
        ),
        avatar
          ? el(
              "button",
              {
                type: "button",
                class: "dice",
                title: "Random face",
                "aria-label": "Random face",
                onclick: () => {
                  void draw(avatar.style, randomSeed());
                },
              },
              "🎲",
            )
          : null,
      ),
      avatar
        ? el(
            "div",
            { class: "row" },
            el("label", { for: "face-seed", class: "hint" }, "Face code"),
            el("input", {
              id: "face-seed",
              type: "text",
              value: avatar.seed || "",
              maxlength: 60,
              autocomplete: "off",
              spellcheck: "false",
              oninput: (ev) => {
                const input = ev.target;
                if (!(input instanceof HTMLInputElement)) return;
                const value = input.value;
                clearTimeout(seedTimer);
                seedTimer = window.setTimeout(() => {
                  const current = hooks.read().avatar;
                  if (current) void draw(current.style, value || " ");
                }, 250);
              },
            }),
          )
        : null,
      avatar
        ? (() => {
            const lf = lookFor(avatar.seed);
            const pickLook = (value: Look | null) => {
              hooks.write({ look: value });
              const current = hooks.read().avatar;
              if (current) void draw(current.style, current.seed);
            };
            return el(
              "div",
              { class: "row" },
              el("span", { class: "hint" }, "Look"),
              el(
                "div",
                { class: "chips" },
                (
                  [
                    ["boy", "Boy"],
                    ["girl", "Girl"],
                  ] as const
                ).map(([value, label]) =>
                  el(
                    "button",
                    {
                      type: "button",
                      class: `chip-btn${lf.look === value ? " on" : ""}`,
                      "aria-pressed": lf.look === value ? "true" : "false",
                      onclick: () => pickLook(value),
                    },
                    label,
                  ),
                ),
              ),
              state.look
                ? el("button", { type: "button", class: "link", onclick: () => pickLook(null) }, "match name")
                : el("span", { class: "hint" }, lf.why),
            );
          })()
        : null,
      el(
        "div",
        { class: "row" },
        el("label", { for: "portrait", class: "ghost filebtn" }, "Upload a picture"),
        el("input", {
          id: "portrait",
          type: "file",
          accept: "image/*",
          class: "visually-hidden",
          onchange: (ev) => {
            const input = ev.target;
            if (!(input instanceof HTMLInputElement)) return;
            const chosen = input.files?.[0];
            input.value = "";
            if (chosen) loadPortrait(chosen);
          },
        }),
        state.portrait
          ? el(
              "button",
              {
                type: "button",
                class: "ghost",
                onclick: () => {
                  hooks.write({ portrait: null, portrait_credit: null, avatar: null });
                  redraw();
                },
              },
              "Remove",
            )
          : null,
      ),
      el(
        "p",
        { class: "hint block", id: "avatar-msg" },
        avatar ? "Same code + same style = same face. Share a code to share a face. Credit prints in the corner." : "",
      ),
    );
  }

  return { controls, noteName, draw, randomFace: () => draw("pixel", randomSeed()) };
}
