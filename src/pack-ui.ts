// The content-pack panel, shared by both builders. The merge stays in each engine.

type Kid = Node | string | number | false | null | undefined;

interface Attrs {
  class?: string;
  id?: string;
  type?: string;
  for?: string;
  href?: string;
  target?: string;
  rel?: string;
  accept?: string;
  placeholder?: string;
  value?: string;
  rows?: number;
  autocomplete?: string;
  spellcheck?: string;
  checked?: boolean;
  onclick?: (ev: Event) => void;
  onchange?: (ev: Event) => void;
  ontoggle?: (ev: Event) => void;
}

export interface PackToggle {
  title: string;
  about: string;
  on: boolean;
  id?: string;
  toggle: (on: boolean) => void;
}

export interface PackLink {
  value: string;
  status: string;
  saved: boolean;
  onLoad: (url: string) => void;
  onForget: () => void;
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
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function toggleRow(row: PackToggle): HTMLElement {
  return el(
    "li",
    {},
    el(
      "label",
      {},
      el("input", {
        type: "checkbox",
        id: row.id,
        checked: row.on,
        onchange: (ev) => {
          const input = ev.target;
          if (input instanceof HTMLInputElement) row.toggle(input.checked);
        },
      }),
      " ",
      el("b", {}, row.title),
      row.about ? el("span", { class: "hint" }, ` — ${row.about}`) : null,
    ),
  );
}

export function contentPackPanel(opts: {
  open: boolean;
  onToggle: (open: boolean) => void;
  summaryHint: string;
  guideHref: string;
  builtin: PackToggle;
  rows: PackToggle[];
  problems: string[];
  onFileText: (text: string, name: string) => void;
  onPaste: (text: string) => void;
  link: PackLink;
  afterList?: Node | null;
  foot?: Kid | Kid[];
  onClear: () => void;
}): HTMLElement {
  const details = el(
    "details",
    {
      id: "content-packs",
      class: "adv custom packs",
      ontoggle: (ev) => {
        if (ev.target instanceof HTMLDetailsElement) opts.onToggle(ev.target.open);
      },
    },
    el("summary", {}, "Content packs", el("span", { class: "hint" }, opts.summaryHint)),
  );
  if (opts.open) details.open = true;
  const file = el("input", {
    id: "custom-file",
    type: "file",
    accept: ".json,application/json,text/plain",
    class: "visually-hidden",
    onchange: (ev) => {
      const input = ev.target;
      if (!(input instanceof HTMLInputElement)) return;
      const chosen = input.files?.[0];
      input.value = "";
      if (!chosen) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") opts.onFileText(reader.result, chosen.name);
      };
      reader.readAsText(chosen);
    },
  });
  const url = el("input", {
    id: "custom-url",
    type: "url",
    placeholder: "or paste a link to a custom content file",
    value: opts.link.value,
    autocomplete: "off",
    spellcheck: "false",
  });
  const go = el(
    "button",
    {
      type: "button",
      class: "ghost",
      onclick: () => {
        go.disabled = true;
        opts.link.onLoad(url.value);
      },
    },
    "Load link",
  );
  const paste = el("textarea", {
    id: "custom-paste",
    rows: 3,
    placeholder: "or paste a pack's JSON here",
    spellcheck: "false",
  });
  const lines = [opts.builtin, ...opts.rows].map(toggleRow);
  for (const problem of opts.problems) lines.push(el("li", { class: "bad" }, `⚠ ${problem}`));
  details.appendChild(
    el(
      "div",
      { class: "field" },
      el(
        "p",
        { class: "hint block" },
        el("a", { class: "link", href: opts.guideHref, target: "_blank", rel: "noopener" }, "Instructions"),
        " for writing a pack.",
      ),
      el("div", { class: "row" }, el("label", { for: "custom-file", class: "ghost filebtn" }, "Load a file"), file),
      el(
        "div",
        {},
        el("div", { class: "row" }, url, go),
        opts.link.saved
          ? el(
              "p",
              { class: "hint block" },
              "Checked for updates every time the builder opens. ",
              el("button", { type: "button", class: "link", onclick: () => opts.link.onForget() }, "forget link"),
            )
          : null,
        opts.link.status
          ? el("p", { class: `hint block${opts.link.status.startsWith("⚠") ? " bad" : ""}` }, opts.link.status)
          : null,
      ),
      el(
        "div",
        {},
        paste,
        el(
          "div",
          { class: "row" },
          el(
            "button",
            {
              type: "button",
              class: "ghost",
              onclick: () => {
                if (paste.value.trim()) opts.onPaste(paste.value);
              },
            },
            "Add pasted pack",
          ),
        ),
      ),
      el("ul", { class: "customlist" }, lines),
      opts.afterList ?? null,
      opts.foot ?? null,
      el(
        "p",
        { class: "hint block" },
        el(
          "button",
          {
            type: "button",
            class: "link",
            id: "clear-saved",
            onclick: () => opts.onClear(),
          },
          "Clear saved data",
        ),
        " forgets heroes and packs stored in this browser.",
      ),
    ),
  );
  return details;
}
