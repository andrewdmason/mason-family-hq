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

/** Game length: quick (~8q), standard (~20q), or play to a target score. */
export type GameMode = "quick" | "standard" | "target";

/** A team as the setup UI submits it. */
export type TeamInput = { key: string; name: string; memberUserIds: string[] };

/** A team with its kid resolved (the payout pays the kid). */
export type ResolvedTeam = {
  key: string;
  name: string;
  memberUserIds: string[];
  /** The kid on this team, or null for an all-adult team (no Bucks). */
  kidUserId: string | null;
};

/** One served question, as the client runner plays it (includes the answer payload). */
export type DeckQuestion = {
  id: string;
  type: TriviaType;
  prompt: string;
  payload: TriviaPayload;
  spotlightUserId: string;
  ordinal: number;
};

/** Result of assembling a deck: a playable deck, or a typed insufficiency. */
export type DeckResult =
  | { ok: true; deck: DeckQuestion[] }
  | {
      ok: false;
      reason: "insufficient";
      shortfall: { band: TriviaLevel; needed: number; available: number }[];
    };
