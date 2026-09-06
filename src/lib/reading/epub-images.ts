import "server-only";
import type JSZip from "jszip";

/**
 * Getting an EPUB's pictures into the reading experience.
 *
 * A book's plates, diagrams and ornaments are part of what it says, and until
 * now conversion threw all of them away — the sanitizer's allow-list had no
 * <img> in it, so a page that was a picture and a caption arrived as a caption
 * on its own.
 *
 * Pictures are inlined as `data:` URLs in the converted HTML rather than
 * uploaded as separate files, for the same reason covers already are. The
 * reader fetches the book as one document at one stable URL, caches it under
 * that URL, and reads it offline from that cache. Pictures living at their own
 * URLs would need their own auth, their own cache entries and their own
 * offline story; inlined, they simply are the book.
 *
 * The cost of that choice is size, so this module is mostly about staying
 * small: a picture bigger than the reader can use is scaled down, one that is
 * heavier than it needs to be is re-encoded, and a book with a great many of
 * them stops inlining once it has spent its budget. Everything is measured in
 * encoded bytes, in reading order, so the same file always converts to the same
 * bytes — which is what lets two copies of one book share a content hash and
 * therefore share their marks.
 */

/**
 * The longest edge we keep. The reader's measure is ~700 CSS px at its widest,
 * so this is comfortably retina for a full-width plate and there is nothing to
 * be gained from carrying more.
 */
const MAX_DIMENSION = 1600;

/**
 * When a picture is re-encoded rather than passed through. Below this we keep
 * the publisher's own bytes: re-encoding a small image can only lose quality,
 * and passing it through keeps line art and flat colour crisp.
 */
const PASSTHROUGH_MAX_BYTES = 300_000;

/**
 * What one picture may cost after re-encoding. A photographic plate lands
 * around 60–120KB at these dimensions, so this is the backstop for the
 * pathological case rather than a target.
 */
const PER_IMAGE_MAX_BYTES = 400_000;

/**
 * What all of a book's pictures may cost together. Past this the remaining
 * pictures are dropped — their captions stay, so the book still reads — because
 * the alternative is a reader that spends a minute downloading and can't be
 * kept offline.
 */
const BOOK_IMAGE_MAX_BYTES = 8_000_000;

/** JPEG qualities tried in turn when a picture has to come down in weight. */
const QUALITY_LADDER = [82, 68, 55];

export type PreparedImage = {
  /** Ready to drop straight into an <img src>. */
  dataUrl: string;
  /** Intrinsic size, emitted as width/height so the page reserves the space
   *  before the picture decodes — a paged layout measured without it would
   *  count its columns against a collapsed image. */
  width: number;
  height: number;
};

/** Image MIME from the file extension, for the pass-through case. */
function mimeFromPath(path: string): string | null {
  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return null;
  }
}

/**
 * Decode, and re-encode only when it buys something.
 *
 * Returns null for anything we can't read. That is a real case — EPUBs ship
 * SVG wrappers and the odd format Skia won't decode — and it is not worth
 * failing a book over: the picture is dropped and the rest of the book converts.
 */
async function encodeImage(
  bytes: Buffer,
  path: string
): Promise<PreparedImage | null> {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");

  let image;
  try {
    image = await loadImage(bytes);
  } catch {
    return null;
  }
  const srcWidth = image.naturalWidth || image.width;
  const srcHeight = image.naturalHeight || image.height;
  if (!srcWidth || !srcHeight) return null;

  const scale = Math.min(1, MAX_DIMENSION / Math.max(srcWidth, srcHeight));

  // Small enough already: the publisher's own bytes beat anything we'd produce.
  if (scale === 1 && bytes.length <= PASSTHROUGH_MAX_BYTES) {
    const mime = mimeFromPath(path);
    if (mime) {
      return {
        dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
        width: srcWidth,
        height: srcHeight,
      };
    }
  }

  // Re-encode, shrinking a step at a time until it fits. JPEG throughout, over
  // white: a book page is white, so flattening transparency against it is what
  // the picture looked like anyway, and JPEG is far and away the cheapest
  // format for the scanned plates that make up most of what books contain.
  let width = Math.max(1, Math.round(srcWidth * scale));
  let height = Math.max(1, Math.round(srcHeight * scale));
  for (const quality of QUALITY_LADDER) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const out = canvas.toBuffer("image/jpeg", quality);
    if (out.length <= PER_IMAGE_MAX_BYTES) {
      return {
        dataUrl: `data:image/jpeg;base64,${out.toString("base64")}`,
        width,
        height,
      };
    }
    width = Math.max(1, Math.round(width * 0.75));
    height = Math.max(1, Math.round(height * 0.75));
  }
  return null;
}

/**
 * Prepares an EPUB's pictures on demand, once each, against one shared budget.
 *
 * Callers ask for a picture by its path in the zip and get back either
 * something renderable or null; asking twice costs nothing. The budget is spent
 * in the order pictures are asked for, which the converter drives in reading
 * order, so a long illustrated book keeps its early pictures rather than an
 * arbitrary selection.
 */
export class EpubImageStore {
  private readonly cache = new Map<string, PreparedImage | null>();
  private spent = 0;
  /** Pictures inlined, for the conversion log. */
  public inlined = 0;
  /** Pictures dropped for want of budget, for the conversion log. */
  public droppedForBudget = 0;

  constructor(
    private readonly zip: JSZip,
    /** The cover art, which the shelf already shows and the book should not
     *  open with a second time. */
    private readonly excludePaths: ReadonlySet<string>
  ) {}

  async get(path: string): Promise<PreparedImage | null> {
    const cached = this.cache.get(path);
    if (cached !== undefined) return cached;

    const prepared = await this.load(path);
    this.cache.set(path, prepared);
    return prepared;
  }

  private async load(path: string): Promise<PreparedImage | null> {
    if (this.excludePaths.has(path)) return null;
    if (this.spent >= BOOK_IMAGE_MAX_BYTES) {
      this.droppedForBudget += 1;
      return null;
    }
    const file = this.zip.file(path);
    if (!file) return null;

    let prepared: PreparedImage | null = null;
    try {
      prepared = await encodeImage(Buffer.from(await file.async("uint8array")), path);
    } catch {
      prepared = null;
    }
    if (!prepared) return null;

    if (this.spent + prepared.dataUrl.length > BOOK_IMAGE_MAX_BYTES) {
      this.droppedForBudget += 1;
      return null;
    }
    this.spent += prepared.dataUrl.length;
    this.inlined += 1;
    return prepared;
  }
}
