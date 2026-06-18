import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, PRACTICE_MODEL } from "./anthropic";

export type PieceSummary = {
  pieceName: string;
  totalSeconds: number;
  regions: string[]; // region labels visited, e.g. ["the coda"]
  handsSeparate: boolean;
};

/**
 * A short, teacher-legible note describing how a piece was practiced this
 * session (plan U8, R9). Built only from facts the alignment worker is confident
 * about — region, time, hands-separate. Deliberately does NOT mention measure
 * numbers, specific notes, or mistakes (the worker can't see those reliably).
 *
 * Resilient: any LLM failure falls back to a templated sentence so a task is
 * still written (never blocks the log).
 */
export async function generatePieceNarrative(s: PieceSummary): Promise<string> {
  const minutes = Math.max(1, Math.round(s.totalSeconds / 60));
  try {
    const msg = await anthropic().messages.create({
      model: PRACTICE_MODEL,
      max_tokens: 200,
      system:
        "You are a piano practice coach writing a one- or two-sentence note for " +
        "the student's teacher about how a practice session was spent. Be plain, " +
        "specific, and warm. Write in a neutral voice (e.g. \"Worked on...\", " +
        "\"Practiced...\") — do NOT invent or use any person's name, and do not " +
        "use 'I'. Use only the facts provided. NEVER invent measure numbers, " +
        "specific notes, mistakes, or tempos that aren't given. Only mention " +
        "hands-separate practice if the facts include it — never describe playing " +
        "as 'hands together', which is the normal default and adds nothing. Output " +
        "only the note, no preamble.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            piece: s.pieceName,
            minutes,
            sectionsWorked: s.regions,
            // Only surface hands-separate when it actually happened — otherwise the
            // model narrates "hands together" on every entry.
            ...(s.handsSeparate ? { handsSeparate: true } : {}),
          }),
        },
      ],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (text) return text;
  } catch {
    // fall through to template
  }
  const where = s.regions.length ? ` around ${joinList(s.regions)}` : "";
  const hands = s.handsSeparate ? ", including hands-separate work" : "";
  return `Practiced ${s.pieceName} for about ${minutes} min${where}${hands}.`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
