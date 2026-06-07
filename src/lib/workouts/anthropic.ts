// The Workouts app reuses the shared Anthropic client. It can override the model
// independently of the journal via WORKOUTS_MODEL, but defaults to the same one.
import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";

export { anthropic };

export const WORKOUTS_MODEL = process.env.WORKOUTS_MODEL ?? JOURNAL_MODEL;
