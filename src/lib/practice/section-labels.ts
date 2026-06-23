/**
 * Auto-label helpers for piece sections, shared between the SectionEditor table
 * and the Measure view so the two surfaces label new sections identically.
 *
 * Top-level sections get sequential letters (A, B, C…); subsections append a
 * 1-based index to the parent label (A1, A2…). Both assume the input is already
 * ordered by sort_order — they derive the next label from the last sibling.
 */

/** Next top-level label: the letter after the last parent's, or "A" if none. */
export function nextSectionLetter(parents: { label: string }[]): string {
  if (parents.length === 0) return "A";
  const last = parents[parents.length - 1].label;
  return String.fromCharCode(last.charCodeAt(0) + 1);
}

/** Next subsection label for a parent given how many children it already has. */
export function nextSubsectionLabel(
  parentLabel: string,
  childCount: number
): string {
  return `${parentLabel}${childCount + 1}`;
}
