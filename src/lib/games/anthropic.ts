// Games reuses the shared Anthropic client (singleton, maxRetries: 5). It can
// override the model independently via GAMES_MODEL but defaults to the same one
// the rest of the app uses. Mirrors src/lib/workouts/anthropic.ts.
import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";

export { anthropic };

export const GAMES_MODEL = process.env.GAMES_MODEL ?? JOURNAL_MODEL;
