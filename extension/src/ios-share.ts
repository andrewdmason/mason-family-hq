// The Reader iOS app's Share extension (ios/Reader/Share): the same extraction
// the Chrome extension does, as a Safari "JavaScript preprocessing" file. Safari
// runs it in the shared page and hands `ExtensionPreprocessingJS.run`'s result
// to the extension; for links shared from other apps, the extension loads the
// page itself and calls `__masonExtract()`.
//
// Built by build.mjs into ios/Reader/Share/GetArticle.js.
import { Readability } from "@mozilla/readability";
import DOMPurify from "dompurify";
import { extractArticle } from "./extract";

const w = window as unknown as Record<string, unknown>;
w.__MasonReadability = Readability;
w.__MasonDOMPurify = DOMPurify;
w.__masonExtract = () => extractArticle();
w.ExtensionPreprocessingJS = {
  run(args: { completionFunction: (result: unknown) => void }) {
    let article = null;
    try {
      article = extractArticle();
    } catch {
      // The extension falls back to the bare link.
    }
    args.completionFunction({ article, url: location.href, title: document.title });
  },
};
