import type {
  DeckQuestion,
  McPayload,
  ListPayload,
  ClosestPayload,
} from "@/lib/games/types";

/**
 * Phone Grandma — the fake friend lifeline. Client-side, no AI at call time: she
 * returns a confident guess that's correct ~75% of the time, else a plausible
 * wrong one, always with a little personality. Single-device host mode, so it's
 * fine that this reads the answer client-side.
 *
 * `visibleOptions` (MC only) lets her pick from the currently-shown options, so a
 * guess after 50/50 never names a removed choice.
 */

export const GRANDMA_ACCURACY = 0.75;

const RIGHT_PHRASES = [
  "Oh sweetie, it's obviously",
  "Easy one, dear —",
  "Back in my day we knew this:",
  "I'd bet my bingo money on",
];
const WRONG_PHRASES = [
  "Hmm, I'm pretty sure it's",
  "Oh, this takes me back… it's",
  "Don't quote me, but —",
  "My hearing aid's acting up, but I'd say",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export type GrandmaGuess = { phrase: string; text: string; confident: boolean };

export function askGrandma(
  q: DeckQuestion,
  visibleOptions?: number[]
): GrandmaGuess {
  const confident = Math.random() < GRANDMA_ACCURACY;
  let text = "";

  if (q.type === "mc") {
    const p = q.payload as McPayload;
    const indices =
      visibleOptions && visibleOptions.length > 0
        ? visibleOptions
        : p.options.map((_, i) => i);
    if (confident && indices.includes(p.correctIndex)) {
      text = p.options[p.correctIndex];
    } else {
      const wrong = indices.filter((i) => i !== p.correctIndex);
      text = p.options[wrong.length ? pick(wrong) : p.correctIndex];
    }
  } else if (q.type === "list") {
    const p = q.payload as ListPayload;
    const n = Math.max(2, Math.min(p.target, p.items.length));
    const some = [...p.items].slice(0, n);
    text = confident
      ? some.join(", ")
      : [...some.slice(0, n - 1), "um… a goldfish?"].join(", ");
  } else {
    const p = q.payload as ClosestPayload;
    const factor = confident
      ? 1 + (Math.random() * 0.2 - 0.1) // within ±10%
      : 1 + (Math.random() * 0.8 + 0.4) * (Math.random() < 0.5 ? -1 : 1); // 40–120% off
    const guess = Math.round(p.answer * factor);
    text = p.unit ? `${guess} ${p.unit}` : String(guess);
  }

  return { phrase: pick(confident ? RIGHT_PHRASES : WRONG_PHRASES), text, confident };
}
