import fontsCss from "../styles/fonts.css?inline";
import sheetCss from "../styles/sheet.css?inline";
import uiCss from "../styles/ui.css?inline";
import { type PafSitePack, startPaf } from "./app";
import content from "./content.json";
import { tablesFrom } from "./core";

function addStyle(id: string, css: string): void {
  const node = document.createElement("style");
  node.id = id;
  node.textContent = css;
  document.head.appendChild(node);
}

addStyle("sheet-css", `${fontsCss}\n${sheetCss}`);
addStyle("ui-css", uiCss);

const modules = import.meta.glob<Record<string, unknown>>("../../examples/paf/*.json", {
  eager: true,
  import: "default",
});

const sitePacks: PafSitePack[] = Object.entries(modules)
  .map(([path, data]) => {
    const file = path.split("/").pop() ?? path;
    const title = typeof data.title === "string" && data.title ? data.title : file.replace(/\.json$/, "");
    const about = typeof data.about === "string" ? data.about : "";
    return { file, title, about, text: JSON.stringify(data) };
  })
  .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

startPaf({ tables: tablesFrom(content), sitePacks });
