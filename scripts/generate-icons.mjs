// Generates the Mason Family HQ app icons + favicons, plus a distinct icon for
// each "app" (route group) so a PWA installed from /workouts gets a dumbbell
// tile, /reader a book, and so on — and the browser tab favicon matches too
// (each route group gets its own icon0.svg/icon1.png pair). Favicons draw the
// same art enlarged (FAVICON_* constants): browser tabs don't mask the icon,
// and at 16px the safe-zone-sized glyph is too small to read.
//
// The master mark is a warm cream house (with a heart window) on a terracotta
// gradient — drawn entirely with canvas primitives so it stays crisp at every
// size, from a 16px favicon to a 512px maskable PWA tile. The house sits inside
// the maskable safe zone (centre ~80%), so the same full-bleed art works as an
// "any" icon and a "maskable" icon.
//
// Per-app tiles reuse that full-bleed gradient (in a per-app hue) with the same
// Lucide glyph the in-app app switcher shows for that section, in cream. The
// app list mirrors src/lib/pwa/apps.ts and the switcher's APPS — keep the keys
// in sync.
//
// Run: node scripts/generate-icons.mjs
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DOMParser } from "@xmldom/xmldom";
import {
  Users,
  BookOpen,
  NotebookPen,
  CalendarDays,
  CalendarRange,
  GraduationCap,
  Dumbbell,
  Music,
} from "lucide-react";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Warm analog palette, tuned to match the app's cream/terracotta theme.
const TERRA_TOP = "#a8623f";
const TERRA_BOTTOM = "#7f4327";
const CREAM = "#f7f1e5";

// Favicon-only enlargements. Browser tabs don't mask the icon, so favicon art
// can run much bigger than the PWA maskable safe zone (which keeps the tile
// glyphs at 46%). Glyphs get ~74% of the tile with a slightly thicker stroke
// so the line doesn't read thin once enlarged; the house mark scales a bit
// less so its roof keeps clear of the rounded corners.
const FAVICON_GLYPH_SCALE = 0.74;
const FAVICON_GLYPH_STROKE = 2.5;
const FAVICON_HOUSE_SCALE = 1.22;
const TILE_GLYPH_SCALE = 0.46;
const TILE_GLYPH_STROKE = 2;

// Each app's tile: a per-hue gradient (kept warm/muted so the set reads as one
// family) plus its switcher glyph. `group` is the route-group folder that gets
// the apple-touch-icon; `glyph: null` means the master house mark (home).
const APPS = [
  { key: "home", group: "(home)", glyph: null, top: TERRA_TOP, bottom: TERRA_BOTTOM },
  { key: "family", group: "(family)", glyph: Users, top: "#b5746e", bottom: "#8a4a42" },
  { key: "reader", group: "(reading)", glyph: BookOpen, top: "#bd924a", bottom: "#8a6526" },
  { key: "journal", group: "(journal)", glyph: NotebookPen, top: "#a07258", bottom: "#70492f" },
  { key: "timeline", group: "(timeline)", glyph: CalendarDays, top: "#a8718f", bottom: "#774a63" },
  { key: "calendar", group: "(calendar)", glyph: CalendarRange, top: "#7c8a55", bottom: "#515c33" },
  { key: "assignments", group: "(assignments)", glyph: GraduationCap, top: "#6f8a96", bottom: "#415c68" },
  { key: "workouts", group: "(workouts)", glyph: Dumbbell, top: "#b85c40", bottom: "#883a26" },
  { key: "practice", group: "practice", glyph: Music, top: "#8475a6", bottom: "#524673" },
];

// --- Background --------------------------------------------------------------
/** Fill a square canvas with the corner-to-corner gradient + soft top glow. */
function drawBackground(ctx, size, top, bottom) {
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const glow = ctx.createRadialGradient(
    size * 0.35, size * 0.28, size * 0.02,
    size * 0.5, size * 0.5, size * 0.75
  );
  glow.addColorStop(0, "rgba(255,255,255,0.16)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  return grad;
}

// --- House mark (home + favicon) ---------------------------------------------
/** Draw the cream house with a heart-window cut-out, full-bleed. */
function drawHouse(ctx, size, top, bottom, houseScale = 1) {
  const u = (n) => n * size;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(houseScale, houseScale);
  ctx.translate(-size / 2, -size / 2);
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);

  ctx.fillStyle = CREAM;
  ctx.lineJoin = "round";

  const apexX = u(0.5), apexY = u(0.2);
  const eaveL = u(0.16), eaveR = u(0.84), eaveY = u(0.46);
  const bodyL = u(0.255), bodyR = u(0.745), bodyB = u(0.82);

  // Roof (slightly wider than the body, with rounded eaves).
  ctx.beginPath();
  ctx.moveTo(apexX, apexY);
  ctx.lineTo(eaveR, eaveY);
  ctx.lineTo(eaveL, eaveY);
  ctx.closePath();
  ctx.lineWidth = u(0.055);
  ctx.strokeStyle = CREAM;
  ctx.stroke();
  ctx.fill();

  // Body.
  const r = u(0.03);
  ctx.beginPath();
  ctx.moveTo(bodyL, eaveY);
  ctx.lineTo(bodyR, eaveY);
  ctx.lineTo(bodyR, bodyB - r);
  ctx.arcTo(bodyR, bodyB, bodyR - r, bodyB, r);
  ctx.lineTo(bodyL + r, bodyB);
  ctx.arcTo(bodyL, bodyB, bodyL, bodyB - r, r);
  ctx.closePath();
  ctx.fill();

  // Heart window, punched out of the house in the background gradient.
  const hx = u(0.5), hy = u(0.58), hs = u(0.135);
  ctx.save();
  ctx.beginPath();
  heartPath(ctx, hx, hy, hs);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
  ctx.restore();
}

// A heart centred at (cx, cy) with overall half-width ~s.
function heartPath(ctx, cx, cy, s) {
  const top = cy - s * 0.55;
  ctx.moveTo(cx, cy + s * 0.75);
  ctx.bezierCurveTo(cx + s * 1.1, cy - s * 0.1, cx + s * 0.5, top - s * 0.55, cx, top);
  ctx.bezierCurveTo(cx - s * 0.5, top - s * 0.55, cx - s * 1.1, cy - s * 0.1, cx, cy + s * 0.75);
}

// --- Lucide glyphs -----------------------------------------------------------
// Render a Lucide React icon to its raw SVG elements (24×24 viewBox, stroked),
// then re-draw them on canvas in cream. We render the component rather than
// reach for private icon data, so this tracks whatever lucide-react ships.
function lucideElements(IconComponent) {
  const markup = renderToStaticMarkup(createElement(IconComponent));
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const els = [];
  const nodes = doc.documentElement.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].nodeType === 1) els.push(nodes[i]);
  }
  return els;
}

const attr = (el, name, def = 0) => {
  const v = el.getAttribute(name);
  return v == null || v === "" ? def : parseFloat(v);
};

function strokeSvgElement(ctx, el) {
  switch (el.tagName) {
    case "path":
      ctx.stroke(new Path2D(el.getAttribute("d")));
      break;
    case "circle":
      ctx.beginPath();
      ctx.arc(attr(el, "cx"), attr(el, "cy"), attr(el, "r"), 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(attr(el, "cx"), attr(el, "cy"), attr(el, "rx"), attr(el, "ry"), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "line":
      ctx.beginPath();
      ctx.moveTo(attr(el, "x1"), attr(el, "y1"));
      ctx.lineTo(attr(el, "x2"), attr(el, "y2"));
      ctx.stroke();
      break;
    case "rect":
      strokeRoundRect(ctx, attr(el, "x"), attr(el, "y"), attr(el, "width"), attr(el, "height"), attr(el, "rx"));
      break;
    case "polyline":
    case "polygon": {
      const pts = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
      ctx.beginPath();
      for (let i = 0; i + 1 < pts.length; i += 2) {
        if (i === 0) ctx.moveTo(pts[i], pts[i + 1]);
        else ctx.lineTo(pts[i], pts[i + 1]);
      }
      if (el.tagName === "polygon") ctx.closePath();
      ctx.stroke();
      break;
    }
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function strokeRoundRect(ctx, x, y, w, h, r) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.stroke();
}

/** Draw a Lucide glyph centred, in cream. Tiles keep the glyph inside the 80%
 * maskable safe zone (46%); favicons blow it up for tab legibility. */
function drawGlyph(ctx, size, IconComponent, glyphScale = TILE_GLYPH_SCALE, stroke = TILE_GLYPH_STROKE) {
  const glyphSize = size * glyphScale;
  const scale = glyphSize / 24; // Lucide's viewBox is 24×24
  ctx.save();
  ctx.translate(size / 2 - glyphSize / 2, size / 2 - glyphSize / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = CREAM;
  ctx.fillStyle = "transparent";
  ctx.lineWidth = stroke; // Lucide-native is 2, scaled with the glyph
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const el of lucideElements(IconComponent)) strokeSvgElement(ctx, el);
  ctx.restore();
}

// --- Compose -----------------------------------------------------------------
// Favicons aren't masked by the platform (unlike maskable PWA tiles), so they
// get their corners rounded here, at the icon.svg's 112/512 radius.
const CORNER = 112 / 512;

function appCanvas(size, app, { rounded = false, favicon = false } = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (rounded) {
    roundRectPath(ctx, 0, 0, size, size, size * CORNER);
    ctx.clip();
  }
  drawBackground(ctx, size, app.top, app.bottom);
  if (app.glyph)
    drawGlyph(
      ctx, size, app.glyph,
      favicon ? FAVICON_GLYPH_SCALE : TILE_GLYPH_SCALE,
      favicon ? FAVICON_GLYPH_STROKE : TILE_GLYPH_STROKE
    );
  else drawHouse(ctx, size, app.top, app.bottom, favicon ? FAVICON_HOUSE_SCALE : 1);
  return canvas;
}

function appPng(size, app, opts = {}) {
  // Tiny favicons get rendered 8× and downscaled — stroking directly at
  // 16–48px aliases badly.
  if (size < 64) {
    const big = appCanvas(size * 8, app, opts);
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(big, 0, 0, size, size);
    return canvas.toBuffer("image/png");
  }
  return appCanvas(size, app, opts).toBuffer("image/png");
}

// --- Favicons (SVG) ------------------------------------------------------------
// A crisp vector favicon: the app's tile art with rounded corners. Modern
// browsers (Chrome, Firefox) prefer this over the .ico/.png fallbacks.
function appSvg(app) {
  // Favicon geometry (bigger than the PWA tiles): a 24×24 Lucide viewBox
  // scaled to FAVICON_GLYPH_SCALE of the tile, centred. We inline the icon's
  // rendered child elements (bare paths that inherit stroke styling from the
  // wrapping <g>). The house mark scales up around the tile centre instead.
  const glyphSide = 512 * FAVICON_GLYPH_SCALE;
  const art = app.glyph
    ? `<g transform="translate(${(512 - glyphSide) / 2} ${(512 - glyphSide) / 2}) scale(${glyphSide / 24})" fill="none" stroke="${CREAM}" stroke-width="${FAVICON_GLYPH_STROKE}" stroke-linecap="round" stroke-linejoin="round">${renderToStaticMarkup(createElement(app.glyph))
        .replace(/^<svg[^>]*>/, "")
        .replace(/<\/svg>$/, "")}</g>`
    : `<g transform="translate(256 256) scale(${FAVICON_HOUSE_SCALE}) translate(-256 -256)">
  <path d="M256 102 L430 235 L82 235 Z" fill="${CREAM}" stroke="${CREAM}" stroke-width="28" stroke-linejoin="round"/>
  <rect x="131" y="235" width="250" height="185" rx="15" fill="${CREAM}"/>
  <path d="M256 349
           C 331 290, 290 221, 256 259
           C 222 221, 181 290, 256 349 Z" fill="url(#bg)"/>
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${app.top}"/>
      <stop offset="1" stop-color="${app.bottom}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${512 * CORNER}" fill="url(#bg)"/>
  ${art}
</svg>
`;
}

// --- Per-app outputs ---------------------------------------------------------
// Manifest icons (any + maskable) for every app; apple-touch-icons and favicons
// (icon0.svg + icon1.png — Safari doesn't load SVG favicons) for each route
// group except home, which inherits the root house assets. Next serves the
// most-leaf segment's icon files, so each section's browser tab gets its own.
for (const app of APPS) {
  writeFileSync(join(root, `public/app-icons/${app.key}-192.png`), appPng(192, app));
  writeFileSync(join(root, `public/app-icons/${app.key}-512.png`), appPng(512, app));
  console.log(`wrote public/app-icons/${app.key}-{192,512}.png`);
  if (app.key !== "home") {
    writeFileSync(join(root, `src/app/${app.group}/apple-icon.png`), appPng(180, app));
    writeFileSync(join(root, `src/app/${app.group}/icon0.svg`), appSvg(app));
    writeFileSync(join(root, `src/app/${app.group}/icon1.png`), appPng(32, app, { rounded: true, favicon: true }));
    console.log(`wrote src/app/${app.group}/{apple-icon.png,icon0.svg,icon1.png}`);
  }
}

// --- iOS launch screens --------------------------------------------------------
// iOS shows plain white on a standalone launch unless an apple-touch-startup-
// image exactly matching the device's pixel size is linked, so we draw one per
// app per device: the app's rounded home-screen tile centred on the app's cream
// background. Mirrors SPLASH_SIZES in src/lib/pwa/apps.ts — keep in sync.
const SPLASH_BG = "#faf7f0"; // matches --background and the manifest background_color
const SPLASH_SIZES = [
  // iPhones (CSS points + device pixel ratio, portrait)
  { w: 440, h: 956, r: 3 },
  { w: 430, h: 932, r: 3 },
  { w: 428, h: 926, r: 3 },
  { w: 414, h: 896, r: 3 },
  { w: 414, h: 896, r: 2 },
  { w: 402, h: 874, r: 3 },
  { w: 393, h: 852, r: 3 },
  { w: 390, h: 844, r: 3 },
  { w: 375, h: 812, r: 3 },
  { w: 375, h: 667, r: 2 },
  // iPads
  { w: 1024, h: 1366, r: 2 },
  { w: 834, h: 1194, r: 2 },
  { w: 820, h: 1180, r: 2 },
  { w: 810, h: 1080, r: 2 },
  { w: 768, h: 1024, r: 2 },
  { w: 744, h: 1133, r: 2 },
];

function splashPng(app, pw, ph) {
  const canvas = createCanvas(pw, ph);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = SPLASH_BG;
  ctx.fillRect(0, 0, pw, ph);
  // The home-screen tile, dead centre — sized like a native app's launch icon.
  const tile = Math.round(Math.min(pw, ph) * 0.3);
  const icon = appCanvas(tile, app, { rounded: true });
  ctx.drawImage(icon, Math.round((pw - tile) / 2), Math.round((ph - tile) / 2));
  return canvas.toBuffer("image/png");
}

mkdirSync(join(root, "public/app-splash"), { recursive: true });
for (const app of APPS) {
  for (const { w, h, r } of SPLASH_SIZES) {
    writeFileSync(
      join(root, `public/app-splash/${app.key}-${w * r}x${h * r}.png`),
      splashPng(app, w * r, h * r)
    );
  }
  console.log(`wrote public/app-splash/${app.key}-* (${SPLASH_SIZES.length} sizes)`);
}

// --- Master house assets (favicon + default apple-touch-icon) ----------------
const house = APPS[0];
const housePng = (size) => appPng(size, house);

writeFileSync(join(root, "src/app/apple-icon.png"), housePng(180));
console.log("wrote src/app/apple-icon.png (180x180)");

// favicon.ico (16, 32, 48, packed as PNG entries).
function buildIco(sizes) {
  const images = sizes.map((s) => ({ size: s, data: appPng(s, house, { favicon: true }) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const e = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0); // width
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1); // height
    dir.writeUInt8(0, e + 2); // palette
    dir.writeUInt8(0, e + 3); // reserved
    dir.writeUInt16LE(1, e + 4); // colour planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(img.data.length, e + 8); // size of data
    dir.writeUInt32LE(offset, e + 12); // offset of data
    offset += img.data.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}
writeFileSync(join(root, "src/app/favicon.ico"), buildIco([16, 32, 48]));
console.log("wrote src/app/favicon.ico (16,32,48)");

// icon.svg (crisp vector favicon for modern browsers).
writeFileSync(join(root, "src/app/icon.svg"), appSvg(house));
console.log("wrote src/app/icon.svg");
