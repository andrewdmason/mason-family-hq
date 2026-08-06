/**
 * Cover shrinking for the one-time eBook import.
 *
 * Most covers come from Open Library as a plain URL, which costs the library
 * page nothing. The rest have to be inlined as `data:` URLs — that's the
 * existing contract for a cover with no hosted home — and those are read back
 * on every render of the shelf. A Calibre cover can be 2.5MB, and the shelf
 * loads every book's cover at once, so inlining them at full size would turn a
 * ~100-book library into a tens-of-megabytes page load.
 *
 * Shrinking to roughly the size they're displayed at fixes that: a few tens of
 * kilobytes each, indistinguishable on screen.
 */

import { readFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";

/** Tiles render ~150px wide in the grid, so 300px covers retina comfortably. */
const MAX_WIDTH = 300;
const JPEG_QUALITY = 78;

async function encode(bytes: Buffer): Promise<string> {
  const image = await loadImage(bytes);
  const scale = Math.min(1, MAX_WIDTH / image.width);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);

  const out = await canvas.encode("jpeg", JPEG_QUALITY);
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

/** Shrink a cover image file to an inline data URL. Null if it can't be read. */
export async function shrinkCoverFile(path: string): Promise<string | null> {
  try {
    return await encode(await readFile(path));
  } catch {
    return null;
  }
}

/** Shrink an already-inlined data URL (e.g. one pulled out of an EPUB). */
export async function shrinkCoverDataUrl(dataUrl: string): Promise<string | null> {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  try {
    return await encode(Buffer.from(dataUrl.slice(comma + 1), "base64"));
  } catch {
    return null;
  }
}
