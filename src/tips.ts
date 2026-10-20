// Hover and press-and-hold cards. Both builders use this, including the shared wording.

import { CharError } from "./text";

export interface TipPick {
  label: string;
  on: boolean;
  choose: () => void;
}

export interface Tip {
  title: string;
  lines: [string | null, string][];
  picks?: TipPick[];
}

type TipFn = () => Tip | null;
type Tipper = <T extends HTMLElement>(node: T, fn: TipFn) => T;

let tipper: Tipper | null = null;

export function help(title: string, text: string): () => Tip {
  return () => ({ title, lines: [[null, text]] });
}

export function tipNode<T extends HTMLElement>(node: T, fn: TipFn): T {
  return tipper ? tipper(node, fn) : node;
}

export function tipChrome(): void {
  const buttons: [string, () => Tip][] = [
    ["#surprise", HELP.surprise],
    ["#heroes-btn", HELP.heroes],
    ["#open-pdf", HELP.openPdf],
    ["#pdf", HELP.downloadPdf],
    ["#tab-build", HELP.build],
    ["#tab-sheet", HELP.sheet],
  ];
  for (const [sel, fn] of buttons) {
    const node = document.querySelector(sel);
    if (node instanceof HTMLElement) tipNode(node, fn);
  }
  const link = document.querySelector("header a.switch");
  if (link instanceof HTMLElement) tipNode(link, link.getAttribute("href")?.includes("paf") ? HELP.toPaf : HELP.toDnd);
}

export const HELP = {
  surprise: help("Surprise me", "Makes a new hero with random choices and draws a face."),
  heroes: help("My heroes", "Heroes saved in this browser. Pick one to bring it back."),
  savedHero: help("Saved hero", "Brings this hero back."),
  deleteHero: help("Delete", "Asks once, then forgets this hero. It is only stored in this browser."),
  newHero: help("New random hero", "Starts another hero and keeps this one in the list."),
  blankHero: help("New hero", "Starts a level 1 hero and keeps this one in the list."),
  openPdf: help(
    "Open PDF",
    "Open a hero PDF made here. That hero comes back, including content packs saved in the file.",
  ),
  downloadPdf: help(
    "Download PDF",
    "Saves this hero as a PDF. Open that file later on this page to get the same hero back.",
  ),
  build: help("Build", "The choices. The sheet updates as you pick."),
  sheet: help("See the sheet", "The printed pages, big enough to read before you download."),
  toPaf: help("PAF", "The other builder. A simpler hero for post-apocalyptic fantasy."),
  toDnd: help("D&D heroes", "The other builder. A D&D 5e hero."),
  name: help("Name", "The name printed on the sheet. Many names also pick Boy or Girl for the picture."),
  dice: (label: string) => help(`Random ${label}`, "Picks a different one at random."),
  inventory: help("Inventory", "One thing per line. It prints on the sheet."),
  notes: help("Notes", "Anything you want to remember. It prints on the sheet."),
  pixel: help("Pixel", "A blocky cartoon. The same face code always draws the same face."),
  adventurer: help("Adventurer", "A painted cartoon. The same face code always draws the same face."),
  smile: help("Big smile", "A round cartoon. The same face code always draws the same face."),
  doodle: help("Doodle", "A scribbled cartoon. The same face code always draws the same face."),
  randomFace: help("Random face", "Draws a new face in this style."),
  faceCode: help("Face code", "Same code and same style make the same face. Share a code to share a face."),
  boy: help("Boy", "Draws this face with a boy look."),
  girl: help("Girl", "Draws this face with a girl look."),
  matchName: help("Match name", "Lets the name pick Boy or Girl again."),
  upload: help("Upload a picture", "Uses a picture from this computer instead of a cartoon."),
  removePicture: help("Remove", "Clears the picture."),
  packs: help("Content packs", "Extra choices from a file. Turn a pack on to use it."),
  instructions: help("Instructions", "How to write a content pack. Opens in a new tab."),
  loadFile: help("Load a file", "Picks a content pack file from this computer."),
  packLink: help("Pack link", "A web address for a content pack file."),
  loadLink: help("Load link", "Loads the content pack at that address."),
  forgetLink: help("Forget link", "Stops checking that address for a newer pack."),
  paste: help("Pasted pack", "Paste the pack's JSON here."),
  addPaste: help("Add pasted pack", "Adds the pack in the box."),
  clearSaved: help("Clear saved data", "Forgets the heroes and content packs stored in this browser."),
  builtin: help("Built-in choices", "The choices that come with this page. Turn this off to use only your packs."),
  packRow: (title: string, about: string) => help(title, about || "Turn this pack on to add its choices."),
  step: (label: string) => help(label, "Changes the number on the sheet. Off book means it isn't the usual one."),
  resetNumbers: help("Reset", "Puts the usual numbers back."),
  addSpell: (what: string) => help(`Add a ${what}`, "Opens the list for this class."),
  score: (ability: string) =>
    help(ability, "From 1 to 20. An origin locks this when it is that origin's main ability."),
  scoreLocked: (ability: string) => help(ability, "This origin sets this score."),
  flux: help("Flux and relics", "Drawn at the table. Write the names in Notes. They are not picked here."),
};

type Kid = Node | string | null | undefined;

interface Attrs {
  class?: string;
  id?: string;
  type?: string;
  role?: string;
  hidden?: boolean;
  "aria-pressed"?: string;
  onclick?: (ev: Event) => void;
}

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
    if (kid == null) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export function createTips(): {
  tipped: <T extends HTMLElement>(node: T, fn: () => Tip | null) => T;
  show: (node: Node) => void;
  hide: () => void;
} {
  const tips = new WeakMap<Node, () => Tip | null>();
  let box: HTMLElement | null = null;
  let tipFor: Node | null = null;
  let tipTimer = 0;
  let holdFired = false;

  const tipBox = (): HTMLElement => {
    if (!box) box = document.body.appendChild(el("div", { id: "tip", role: "tooltip", hidden: true }));
    return box;
  };

  function show(node: Node): void {
    const fn = tips.get(node);
    let tip: Tip | null = null;
    try {
      tip = fn ? fn() : null;
    } catch (error) {
      if (!(error instanceof CharError)) throw error;
      tip = null;
    }
    if (!tip) return;
    const card = tipBox();
    const picks = tip.picks?.length
      ? el(
          "div",
          { class: "tpicks" },
          tip.picks.map((pick) =>
            el(
              "button",
              {
                type: "button",
                class: `tpick${pick.on ? " on" : ""}`,
                "aria-pressed": pick.on ? "true" : "false",
                onclick: () => pick.choose(),
              },
              pick.label,
            ),
          ),
        )
      : null;
    card.replaceChildren(
      el("b", { class: "tt" }, tip.title),
      ...(picks ? [picks] : []),
      ...tip.lines
        .filter((line) => line[1])
        .map(([label, text]) => el("p", {}, label ? el("b", {}, `${label}: `) : null, text)),
    );
    card.hidden = false;
    tipFor = node;
    if (!(node instanceof Element)) return;
    const rect = node.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 32);
    card.style.width = `${width}px`;
    const left = Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 16));
    const height = card.offsetHeight;
    const below = rect.bottom + 8 + height < window.innerHeight || rect.top - 8 - height < 0;
    card.style.left = `${left}px`;
    card.style.top = `${below ? rect.bottom - 2 : rect.top + 2 - height}px`;
  }

  function hide(): void {
    clearTimeout(tipTimer);
    if (!tipFor) return;
    tipBox().hidden = true;
    tipFor = null;
  }

  function tipTarget(ev: Event): HTMLElement | null {
    if (!(ev.target instanceof Element)) return null;
    const node = ev.target.closest(".has-tip");
    return node instanceof HTMLElement && tips.has(node) ? node : null;
  }

  document.addEventListener("pointerover", (ev) => {
    if (ev.pointerType === "touch") return;
    if (ev.target instanceof Node && tipBox().contains(ev.target)) {
      clearTimeout(tipTimer);
      return;
    }
    const node = tipTarget(ev);
    if (node === tipFor) return;
    clearTimeout(tipTimer);
    if (!node) {
      tipTimer = window.setTimeout(hide, 120);
      return;
    }
    tipTimer = window.setTimeout(() => show(node), tipFor ? 0 : 350);
  });
  document.addEventListener("pointerdown", (ev) => {
    if (ev.target instanceof Node && tipBox().contains(ev.target)) {
      holdFired = false;
      return;
    }
    holdFired = false;
    if (ev.pointerType !== "touch" && ev.pointerType !== "pen") {
      hide();
      return;
    }
    const node = tipTarget(ev);
    hide();
    if (node)
      tipTimer = window.setTimeout(() => {
        holdFired = true;
        show(node);
      }, 450);
  });
  for (const name of ["pointerup", "pointercancel"]) {
    document.addEventListener(name, () => {
      if (!holdFired) clearTimeout(tipTimer);
    });
  }
  document.addEventListener(
    "pointermove",
    (ev) => {
      if (ev.pointerType === "touch" && !holdFired) clearTimeout(tipTimer);
    },
    { passive: true },
  );
  document.addEventListener(
    "click",
    (ev) => {
      if (!holdFired) return;
      holdFired = false;
      ev.preventDefault();
      ev.stopPropagation();
    },
    true,
  );
  document.addEventListener("contextmenu", (ev) => {
    if (tipTarget(ev)) ev.preventDefault();
  });
  document.addEventListener("focusin", (ev) => {
    if (ev.target instanceof Node && tipBox().contains(ev.target)) return;
    const node = tipTarget(ev);
    if (node?.matches(":focus-visible")) show(node);
    else if (!node) hide();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hide();
  });
  window.addEventListener(
    "scroll",
    (ev) => {
      const card = tipBox();
      if (ev.target instanceof Node && card.contains(ev.target)) return;
      if (document.activeElement && card.contains(document.activeElement)) return;
      hide();
    },
    true,
  );

  const tipped: Tipper = (node, fn) => {
    tips.set(node, fn);
    node.classList.add("has-tip");
    return node;
  };
  tipper = tipped;
  return { tipped, show, hide };
}
