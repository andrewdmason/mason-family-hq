/**
 * Where "inside this paragraph" is when the paragraph on screen isn't the one
 * the position is measured in.
 *
 * Every position primitive — the character at the top of a page, a saved
 * resume point, an anchor's in-block offset — is measured off the DOM and
 * expressed in the ORIGINAL conversion char space. When the page shows the
 * plain face, the DOM holds different text of a different length, so a
 * measured in-block offset has to be carried across before it enters that
 * space, and carried back when a stored offset is being located on the page.
 *
 * Mapping is proportional, per paragraph. There is no word-level alignment
 * between faces and none is wanted: the error is a sentence at worst inside one
 * paragraph, well under the 400-character thresholds that decide whether two
 * devices are "elsewhere" from each other (position-sync.ts). Snapping to the
 * block start was the simpler alternative and was rejected because a paragraph
 * that runs across several pages would jump to its first page on every switch.
 *
 * Pure. Verified by scripts/verify-face-map.mts.
 */

/** Carry an offset measured in a paragraph of `fromLength` into one of `toLength`. */
export function mapOffset(offset: number, fromLength: number, toLength: number): number {
  if (fromLength <= 0 || toLength <= 0) return 0;
  const clamped = Math.max(0, Math.min(offset, fromLength));
  if (clamped === 0) return 0;
  if (clamped >= fromLength) return toLength;
  return Math.min(toLength, Math.round((clamped * toLength) / fromLength));
}

/** An in-block offset measured on the plain face, in the original's space. */
export function toOriginalOffset(
  plainOffset: number,
  originalLength: number,
  plainLength: number
): number {
  return mapOffset(plainOffset, plainLength, originalLength);
}

/** An in-block offset stored in the original's space, located on the plain face. */
export function toPlainOffset(
  originalOffset: number,
  originalLength: number,
  plainLength: number
): number {
  return mapOffset(originalOffset, originalLength, plainLength);
}

/**
 * What the DOM currently shows for a block: the plain text when the plain face
 * is applied to that paragraph, null when the original is on screen.
 *
 * Passed into the measurement code rather than the whole translation, so the
 * position module never learns what a translation is — only that a paragraph's
 * on-screen text can differ from its text in the char space.
 */
export type FaceTextOf = (blockIndex: number) => string | null;

/** The length of the text the DOM shows for a block. */
export function shownLength(
  faceTextOf: FaceTextOf | undefined,
  blockIndex: number,
  originalLength: number
): number {
  const shown = faceTextOf?.(blockIndex);
  return shown == null ? originalLength : shown.length;
}
