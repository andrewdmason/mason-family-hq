const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * Plain text (quick-entry notes, Reminders notes) → minimal Tiptap-compatible
 * notes HTML: one <p> per non-empty line. Returns null for blank input so
 * callers can store NULL instead of an empty document.
 */
export function plainTextToNotesHtml(notes: string): string | null {
  const lines = notes.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return null;
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}
