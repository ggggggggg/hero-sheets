// Hover and press-and-hold cards for selection ovals. Both builders use this.

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

  return {
    tipped(node, fn) {
      tips.set(node, fn);
      node.classList.add("has-tip");
      return node;
    },
    show,
    hide,
  };
}
