// Generates the Mason Family HQ app icons + favicon from a single vector mark.
//
// The mark is a warm cream house (with a heart window) on a terracotta
// gradient — drawn entirely with canvas primitives so it stays crisp at every
// size, from a 16px favicon to a 512px maskable PWA tile. The house sits inside
// the maskable safe zone (centre 80%), so the same full-bleed art works as an
// "any" icon and a "maskable" icon.
//
// Run: node scripts/generate-icons.mjs
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Warm analog palette, tuned to match the app's cream/terracotta theme.
const TERRA_TOP = "#a8623f";
const TERRA_BOTTOM = "#7f4327";
const CREAM = "#f7f1e5";

/**
 * Draw the house mark, full-bleed, on a square canvas of the given size.
 * All geometry is expressed as fractions of the size so it scales cleanly.
 */
function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const u = (n) => n * size;

  // Background: terracotta gradient, corner to corner.
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, TERRA_TOP);
  grad.addColorStop(1, TERRA_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Soft top highlight so the tile doesn't read flat.
  const glow = ctx.createRadialGradient(
    u(0.35), u(0.28), u(0.02),
    u(0.5), u(0.5), u(0.75)
  );
  glow.addColorStop(0, "rgba(255,255,255,0.16)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // House silhouette: a peaked roof over a body. One filled path in cream.
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

  // Heart window, punched out of the house in the background gradient. Drawing
  // the gradient again (not a flat colour) keeps the cut-out seamless.
  const hx = u(0.5), hy = u(0.58), hs = u(0.135);
  ctx.save();
  ctx.beginPath();
  heartPath(ctx, hx, hy, hs);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  return canvas;
}

// A heart centred at (cx, cy) with overall half-width ~s.
function heartPath(ctx, cx, cy, s) {
  const top = cy - s * 0.55;
  ctx.moveTo(cx, cy + s * 0.75);
  ctx.bezierCurveTo(cx + s * 1.1, cy - s * 0.1, cx + s * 0.5, top - s * 0.55, cx, top);
  ctx.bezierCurveTo(cx - s * 0.5, top - s * 0.55, cx - s * 1.1, cy - s * 0.1, cx, cy + s * 0.75);
}

function png(size) {
  return drawIcon(size).toBuffer("image/png");
}

// --- PNGs --------------------------------------------------------------------
const outputs = [
  ["public/icon-192.png", 192], // manifest icon
  ["public/icon-512.png", 512], // manifest icon (any + maskable)
  ["src/app/apple-icon.png", 180], // Next auto-links this as the apple-touch-icon
];
for (const [rel, size] of outputs) {
  writeFileSync(join(root, rel), png(size));
  console.log(`wrote ${rel} (${size}x${size})`);
}

// --- favicon.ico (16, 32, 48, packed as PNG entries) -------------------------
function buildIco(sizes) {
  const images = sizes.map((s) => ({ size: s, data: png(s) }));
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

// --- icon.svg (crisp vector favicon for modern browsers) ---------------------
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
