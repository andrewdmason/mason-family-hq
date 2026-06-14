// Bundled libraries exposed on the page's window so the injected extractor
// (background.ts -> extractArticle) can use them. Loaded into the active tab via
// chrome.scripting.executeScript({ files: ["vendor.js"] }) before extraction.
import { Readability } from "@mozilla/readability";
import DOMPurify from "dompurify";

declare global {
  interface Window {
    __MasonReadability?: typeof Readability;
    __MasonDOMPurify?: typeof DOMPurify;
  }
}

window.__MasonReadability = Readability;
window.__MasonDOMPurify = DOMPurify;
