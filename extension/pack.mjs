import { mkdirSync, readFileSync } from "node:fs";
import crx3 from "crx3";

// Sign dist/ into a CRX3 and emit the Omaha update manifest that Chrome's
// force-install policy points at. Run AFTER `npm run build` (needs dist/).
//
// crx3 does NOT read the zip to discover the version, so we pass appVersion
// explicitly from the built manifest — otherwise updates.xml ships a literal
// "${APP_VERSION}" and Chrome silently never updates. Keeping the version in
// manifest.json the single source of truth means it can't drift.

const APP_DOMAIN = "https://family.mason.io";
const CRX_URL = `${APP_DOMAIN}/extension/mason-reader.crx`;
const OUT_DIR = "../public/extension";

const { version } = JSON.parse(readFileSync("dist/manifest.json", "utf8"));

mkdirSync(OUT_DIR, { recursive: true });

await crx3(["dist/manifest.json"], {
  keyPath: "key.pem",
  crxPath: `${OUT_DIR}/mason-reader.crx`,
  xmlPath: `${OUT_DIR}/updates.xml`,
  crxURL: CRX_URL,
  appVersion: version,
});

console.log(`Packed v${version} -> ${OUT_DIR}/{mason-reader.crx,updates.xml} (codebase ${CRX_URL})`);
