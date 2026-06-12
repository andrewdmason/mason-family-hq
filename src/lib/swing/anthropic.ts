// The Swing app reuses the shared Anthropic client. SWING_MODEL overrides the
// model independently (e.g. point it at claude-opus-4-8 for assessment
// quality without a deploy); defaults to the journal's model.
import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";

export { anthropic };

export const SWING_MODEL = process.env.SWING_MODEL ?? JOURNAL_MODEL;
