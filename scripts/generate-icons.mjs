// Generates the Mason Family HQ app icons + favicon, plus a distinct icon for
// each "app" (route group) so a PWA installed from /workouts gets a dumbbell
// tile, /reader a book, and so on.
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
import { writeFileSync } from "node:fs";
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
function drawHouse(ctx, size, top, bottom) {
  const u = (n) => n * size;
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

function strokeRoundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.stroke();
}

/** Draw a Lucide glyph centred in the maskable safe zone, in cream. */
function drawGlyph(ctx, size, IconComponent) {
  const glyphSize = size * 0.46; // sits well inside the 80% maskable safe zone
  const scale = glyphSize / 24; // Lucide's viewBox is 24×24
  ctx.save();
  ctx.translate(size / 2 - glyphSize / 2, size / 2 - glyphSize / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = CREAM;
  ctx.fillStyle = "transparent";
  ctx.lineWidth = 2; // Lucide's native stroke width, scaled with the glyph
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const el of lucideElements(IconComponent)) strokeSvgElement(ctx, el);
  ctx.restore();
}

// --- Compose -----------------------------------------------------------------
function appCanvas(size, app) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, size, app.top, app.bottom);
  if (app.glyph) drawGlyph(ctx, size, app.glyph);
  else drawHouse(ctx, size, app.top, app.bottom);
  return canvas;
}

const appPng = (size, app) => appCanvas(size, app).toBuffer("image/png");

// --- Per-app outputs ---------------------------------------------------------
// Manifest icons (any + maskable) for every app; apple-touch-icons for each
// route group except home, which inherits the root house apple-icon.
for (const app of APPS) {
  writeFileSync(join(root, `public/app-icons/${app.key}-192.png`), appPng(192, app));
  writeFileSync(join(root, `public/app-icons/${app.key}-512.png`), appPng(512, app));
  console.log(`wrote public/app-icons/${app.key}-{192,512}.png`);
  if (app.key !== "home") {
    writeFileSync(join(root, `src/app/${app.group}/apple-icon.png`), appPng(180, app));
    console.log(`wrote src/app/${app.group}/apple-icon.png (180x180)`);
  }
}

// --- Master house assets (favicon + default apple-touch-icon) ----------------
const house = APPS[0];
const housePng = (size) => appPng(size, house);

writeFileSync(join(root, "src/app/apple-icon.png"), housePng(180));
console.log("wrote src/app/apple-icon.png (180x180)");

// favicon.ico (16, 32, 48, packed as PNG entries).
function buildIco(sizes) {
  const images = sizes.map((s) => ({ size: s, data: housePng(s) }));
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
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${TERRA_TOP}"/>
      <stop offset="1" stop-color="${TERRA_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <path d="M256 102 L430 235 L82 235 Z" fill="${CREAM}" stroke="${CREAM}" stroke-width="28" stroke-linejoin="round"/>
  <rect x="131" y="235" width="250" height="185" rx="15" fill="${CREAM}"/>
  <path d="M256 349
           C 331 290, 290 221, 256 259
           C 222 221, 181 290, 256 349 Z" fill="url(#bg)"/>
</svg>
`;
writeFileSync(join(root, "src/app/icon.svg"), svg);
console.log("wrote src/app/icon.svg");
