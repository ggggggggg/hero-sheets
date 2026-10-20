import fontsCss from "../styles/fonts.css?inline";
import sheetCss from "../styles/sheet.css?inline";
import uiCss from "../styles/ui.css?inline";
import { startPaf } from "./app";
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

startPaf(tablesFrom(content));
