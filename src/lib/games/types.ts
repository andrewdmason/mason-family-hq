/** Shared types for the Games · Trivia subsystem. */

/**
 * A question's difficulty band. Relative (younger/older kid map to the two boys
 * by birthdate, stable across school years; the concrete grade only flavors
 * generation). `all` is general/any-age. `adult` targets the parents.
 */
export type TriviaLevel = "younger_kid" | "older_kid" | "adult" | "all";

/** The three v1 question shapes. */
export type TriviaType = "mc" | "list" | "closest";

/** Multiple choice: pick the one right option. */
export type McPayload = { options: string[]; correctIndex: number };
/** List it: name as many of `items` as you can; `target` is the bonus threshold. */
export type ListPayload = { items: string[]; target: number };
/** Closest wins: the numeric answer (closest guess wins); `unit` labels it. */
export type ClosestPayload = { answer: number; unit: string | null };

export type TriviaPayload = McPayload | ListPayload | ClosestPayload;

/** A freshly generated question, before it's verified and persisted. */
export type GeneratedQuestion = {
  type: TriviaType;
  prompt: string;
  payload: TriviaPayload;
  /** Sports/pop-culture facts that go stale; tagged so they can be expired later. */
  perishable: boolean;
};

export type GenerateResult = { ok: boolean; questions: GeneratedQuestion[] };

export type VerifyVerdict = "ready" | "quarantine";
/** The verifier's call on one question, plus a short rationale for the audit trail. */
export type VerifyResult = { verdict: VerifyVerdict; notes: string | null };
