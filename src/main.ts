import { type SitePack, startApp } from "./app";
import content from "./content.json";
import type { PackRow } from "./custom";
import fontsCss from "./styles/fonts.css?inline";
import sheetCss from "./styles/sheet.css?inline";
import uiCss from "./styles/ui.css?inline";
import type { Tables } from "./types";

function addStyle(id: string, css: string): void {
  const node = document.createElement("style");
  node.id = id;
  node.textContent = css;
  document.head.appendChild(node);
}

addStyle("sheet-css", `${fontsCss}\n${sheetCss}`);
addStyle("ui-css", uiCss);

const modules = import.meta.glob<PackRow>("../examples/*.json", { eager: true, import: "default" });

const sitePacks: SitePack[] = Object.entries(modules)
  .map(([path, data]) => {
    const file = path.split("/").pop() ?? path;
    const title = typeof data.title === "string" && data.title ? data.title : file.replace(/\.json$/, "");
    const about = typeof data.about === "string" ? data.about : "";
    return { file, title, about, data };
  })
  .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

function isTables(value: object): value is Tables {
  return "rules" in value && "races" in value && "classes" in value && "spells" in value;
}

if (!isTables(content)) throw new Error("content.json is not a ruleset");

startApp({ tables: content, sitePacks });
