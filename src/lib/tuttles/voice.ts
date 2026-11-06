import { tutorInstructions, VISUALS } from "@/lib/tuttles/prompt";

/**
 * Tuttles' live voice mode: a spoken conversation with the tutor inside a
 * chat. The phone talks to OpenAI's realtime model directly, with a
 * short-lived key the website mints (/tuttles/api/voice/session), so the real
 * key never leaves the server. The tutor gets the same rules, memory and
 * classes as typed chat, plus the chat so far, and can put diagrams on the
 * screen with the show_visual tool. When the call ends, the phone sends the
 * transcript back (/tuttles/api/voice/save) and it becomes part of the chat.
 */

export const VOICE_MODEL = "gpt-realtime-2.1";
export const VOICE = "marin";
/** Writes out what the student says, for the captions and the saved chat. */
export const VOICE_TRANSCRIBE_MODEL = "gpt-4o-transcribe";
/**
 * Left to guess, the transcriber heard "two, three" as Maori ("rua tūī").
 * Saying it's English (with some Spanish) and that math is spoken keeps short
 * fragments from being taken for another language. Only the captions and the
 * saved chat use this; the tutor hears the audio itself.
 */
export const TRANSCRIBE_LANGUAGE = "en";
export const TRANSCRIBE_PROMPT =
  "A middle schooler talking with a homework tutor in English, sometimes using Spanish words from Spanish class. Math is spoken aloud: \"two, three\", \"x squared\".";

const SPEAKING = (name: string) => `You're talking out loud with ${name} in a live voice call, not typing.
- Keep each turn short: about 40 words at most, one point per turn, then stop and let ${name} talk. A long explanation is several turns with ${name} answering in between. Ask one question at a time.
- Say math in words ("x squared minus three", "two thirds"), never symbols or LaTeX.
- When seeing it would help (a diagram, a graph, an equation written out, a list of steps), call show_visual, then talk about what's on the screen. Don't read the whole thing aloud.
- A photo ${name} sends is what they're looking at right now; talk about it directly.
- Open with a greeting of one to three words, like a friend picking up the phone ("Hey!", "Hey, what's up?"), then wait for them to talk. Never read back or repeat anything from earlier in the chat.`;

/** The tool the tutor uses to put a picture on the student's screen. */
export const SHOW_VISUAL_TOOL = {
  type: "function" as const,
  name: "show_visual",
  description: `Show a picture on the student's screen while you talk about it. Pass one JSON object in "visual", in one of these formats, or {"type":"math","latex":"..."} for an equation or expression written out.\n\n${VISUALS}`,
  parameters: {
    type: "object",
    properties: { visual: { type: "string", description: "The visual, as a JSON object in one of the formats described." } },
    required: ["visual"],
    additionalProperties: false,
  },
};

export function voiceInstructions(
  student: { name: string; birthdate: string | null },
  sections: string[],
  chatSoFar: { role: "student" | "tutor"; content: string }[],
): string {
  const history = chatSoFar.length
    ? `## Earlier in this chat (typed; background only, never read it aloud or repeat it)\n${chatSoFar
        .slice(-30)
        .map((m) => `${m.role === "student" ? student.name : "You"}: ${m.content.slice(0, 1500)}`)
        .join("\n\n")}`
    : null;
  return [tutorInstructions(student), SPEAKING(student.name), ...sections, history].filter(Boolean).join("\n\n");
}

/** Reads photos for the voice tutor (the voice model's own reading of a worksheet is shakier). */
export const PHOTO_READER_MODEL = "gpt-5.6-sol";

export const PHOTO_READER_INSTRUCTIONS = `Write out exactly what's on this photo of a student's homework, for a tutor who will talk it through with them. Include the printed instructions and problems word for word (math in plain text, like "x^2 - 3"), any graphs or diagrams described precisely (axes, labeled points, segments and their endpoints), and the student's own handwritten work and answers, marked as theirs. Say "unclear" for marks you can't read, and note stray marks as stray rather than guessing. Don't solve, grade or comment on anything.`;
