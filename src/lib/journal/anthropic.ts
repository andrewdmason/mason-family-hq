import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  // Bump retries above the SDK default of 2: the API returns transient 429s and
  // 529s (overloaded) under load, and the SDK retries those with exponential
  // backoff. A few extra attempts ride out a brief overload instead of bubbling
  // a raw error up to the user.
  cached = new Anthropic({ apiKey, maxRetries: 5 });
  return cached;
}

export const JOURNAL_MODEL = process.env.JOURNAL_MODEL ?? "claude-sonnet-4-6";

/**
 * Thinking switched off, on Claude Sonnet 5.5 — the only model that accepts it.
 * `{ type: "disabled" }` is a 400 there. Cast because the installed SDK's types
 * predate this mode.
 */
export const SONNET_5_5_THINKING_OFF = {
  type: "between_tools",
} as unknown as Anthropic.ThinkingConfigParam;

/**
 * The JSON a structured-output reply (`output_config.format`) carries, or null
 * when there isn't any — a refusal, or a reply cut off before the JSON closed.
 */
export function structuredReply(message: Anthropic.Message): unknown {
  if (message.stop_reason !== "end_turn") return null;
  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return null;
  try {
    return JSON.parse(block.text);
  } catch {
    return null;
  }
}
