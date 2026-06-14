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

copyFileSync("manifest.json", "dist/manifest.json");
copyFileSync("options.html", "dist/options.html");

console.log("Built extension -> dist/ (load unpacked from there)");
