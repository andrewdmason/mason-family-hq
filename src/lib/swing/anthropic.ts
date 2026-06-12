// The Swing app reuses the shared Anthropic client. Coaching quality is the
// product (the eye test is the quality gate), so this app defaults to the
// most capable current model rather than the journal's default; SWING_MODEL
// still overrides without a deploy.
import { anthropic } from "@/lib/journal/anthropic";

export { anthropic };

export const SWING_MODEL = process.env.SWING_MODEL ?? "claude-fable-5";
