import { copyFileSync, mkdirSync } from "node:fs";
import * as esbuild from "esbuild";

mkdirSync("dist", { recursive: true });

await esbuild.build({
  entryPoints: {
    background: "src/background.ts",
    vendor: "src/vendor.ts",
    options: "src/options.ts",
  },
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome110",
  legalComments: "none",
  logLevel: "info",
});

// The Reader iOS app's Share extension carries the same extractor.
await esbuild.build({
  entryPoints: ["src/ios-share.ts"],
  bundle: true,
  outfile: "../ios/Reader/Share/GetArticle.js",
  format: "iife",
  target: "safari17",
  legalComments: "none",
  logLevel: "info",
});

copyFileSync("manifest.json", "dist/manifest.json");
copyFileSync("options.html", "dist/options.html");

console.log("Built extension -> dist/ (load unpacked from there)");
