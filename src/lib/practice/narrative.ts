import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, PRACTICE_MODEL } from "./anthropic";

export type PieceSummary = {
  // Per-section time spent, e.g. [{ name: "the opening", minutes: 3 }]. The piece
  // name and total time are deliberately omitted — they're already on the task
  // (its row header and duration field), so the note only adds what's new.
  sections: Array<{ name: string; minutes: number }>;
  handsSeparate: boolean;
};

/**
 * A short, teacher-legible note describing WHAT was practiced in one piece — which
 * sections and roughly how long on each (plan U8, R9). Does NOT name the piece or
 * state the overall time (both are structured on the task), and does NOT invent
 * measure numbers / notes / mistakes (the worker can't see those reliably).
 *
 * Resilient: any LLM failure falls back to a templated sentence.
 */
export async function generatePieceNarrative(s: PieceSummary): Promise<string> {
  try {
    const msg = await anthropic().messages.create({
      model: PRACTICE_MODEL,
      max_tokens: 200,
      system:
        "You are a piano practice coach writing a one- or two-sentence note for " +
        "the student's teacher about WHAT was practiced in a single piece during " +
        "this session. Do NOT name the piece and do NOT state the total time — " +
        "both are already shown elsewhere on the entry; naming them adds nothing. " +
        "Focus on which sections were worked and roughly how long on each. Write " +
        "in a neutral voice (e.g. \"Worked on...\"), no person's name, no 'I'. Use " +
        "only the facts provided. NEVER invent measure numbers, specific notes, " +
        "mistakes, or tempos. Only mention hands-separate practice if the facts " +
        "include it — never describe playing as 'hands together'. Output only the " +
        "note, no preamble.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            sectionsWorked: s.sections,
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
  const parts = s.sections.map((x) => `${x.name} (~${x.minutes} min)`);
  const where = parts.length ? `Worked on ${joinList(parts)}` : "Practiced this piece";
  const hands = s.handsSeparate ? ", hands separately" : "";
  return `${where}${hands}.`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
