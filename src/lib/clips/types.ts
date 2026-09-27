// Baseball Clips — shared shapes for games, at-bats and pitch markers. Safe to
// import from client components (no server-only deps).

export const CLIPS_BUCKET = "baseball-clips";

export type AtBatStatus = "uploading" | "processing" | "ready" | "failed";

export type AtBatResult =
  | "K" | "KL" | "BB" | "HBP"
  | "1B" | "2B" | "3B" | "HR"
  | "GO" | "FO" | "LO" | "ROE";

// Scorebook order: strikeouts and free passes, then hits, then outs in play.
// `label` is what the badge shows (a backwards K reads as ꓘ); `name` is the
// spelled-out version for pickers and captions.
export const AT_BAT_RESULTS: { value: AtBatResult; label: string; name: string }[] = [
  { value: "K", label: "K", name: "Strikeout swinging" },
  { value: "KL", label: "ꓘ", name: "Strikeout looking" },
  { value: "BB", label: "BB", name: "Walk" },
  { value: "HBP", label: "HBP", name: "Hit by pitch" },
  { value: "1B", label: "1B", name: "Single" },
  { value: "2B", label: "2B", name: "Double" },
  { value: "3B", label: "3B", name: "Triple" },
  { value: "HR", label: "HR", name: "Home run" },
  { value: "GO", label: "GO", name: "Groundout" },
  { value: "FO", label: "FO", name: "Flyout" },
  { value: "LO", label: "LO", name: "Lineout" },
  { value: "ROE", label: "ROE", name: "Reached on error" },
];

export function resultLabel(result: AtBatResult | null | undefined): string | null {
  if (!result) return null;
  return AT_BAT_RESULTS.find((r) => r.value === result)?.label ?? result;
}

export type ClipKid = { id: string; slug: string; displayName: string };

export type ClipGame = {
  id: string;
  kidId: string;
  name: string;
  playedOn: string; // YYYY-MM-DD
};

// Pitch outcomes, as a scorebook (or GameChanger) records them. Swings are
// filled dots on the timeline and takes are hollow; the color says what
// happened.
export type PitchOutcome = "ball" | "called_strike" | "swinging_strike" | "foul" | "in_play";

export const PITCH_OUTCOMES: { value: PitchOutcome; label: string; short: string; key: string }[] = [
  { value: "ball", label: "Ball", short: "Ball", key: "b" },
  { value: "called_strike", label: "Called strike", short: "Strike", key: "c" },
  { value: "swinging_strike", label: "Swinging strike", short: "Swing", key: "s" },
  { value: "foul", label: "Foul", short: "Foul", key: "f" },
  { value: "in_play", label: "Ball in play", short: "In play", key: "i" },
];

export function outcomeLabel(outcome: PitchOutcome | null, form: "label" | "short" = "label"): string {
  const o = PITCH_OUTCOMES.find((x) => x.value === outcome);
  return o ? o[form] : "Pitch";
}

export type ClipPitch = {
  id: string;
  t: number;
  outcome: PitchOutcome | null;
  source: "manual" | "auto";
};

export function isSwing(p: Pick<ClipPitch, "outcome">): boolean {
  return p.outcome === "swinging_strike" || p.outcome === "foul" || p.outcome === "in_play";
}

export function isContact(p: Pick<ClipPitch, "outcome">): boolean {
  return p.outcome === "foul" || p.outcome === "in_play";
}

/**
 * The count before each pitch ("1-2"), scorebook rules: fouls add a strike
 * only until two. Stops counting once the at-bat would already be over.
 */
export function countsBefore(pitches: Pick<ClipPitch, "outcome">[]): string[] {
  let balls = 0;
  let strikes = 0;
  return pitches.map((p) => {
    const before = `${Math.min(balls, 3)}-${Math.min(strikes, 2)}`;
    if (p.outcome === "ball") balls++;
    else if (p.outcome === "called_strike" || p.outcome === "swinging_strike") strikes++;
    else if (p.outcome === "foul" && strikes < 2) strikes++;
    return before;
  });
}

/** A zoom box as fractions of the frame; it keeps the video's shape, so `s` sizes both sides. */
export type ClipZoom = { x: number; y: number; s: number };

export type ClipAtBat = {
  id: string;
  gameId: string;
  status: AtBatStatus;
  errorMessage: string | null;
  originalName: string | null;
  originalBytes: number | null;
  hasPlayback: boolean;
  hasPoster: boolean;
  durationS: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  recordedAt: string | null;
  /** When marking was finished; null while it still needs marking. */
  markedAt: string | null;
  zoom: ClipZoom | null;
  replayZoom: boolean;
  result: AtBatResult | null;
  createdAt: string;
  updatedAt: string;
  pitches: ClipPitch[];
};

/**
 * Still being uploaded or prepared — worth polling for. Gives up after half an
 * hour so a job that never reported back doesn't poll forever (the player
 * plays the original meanwhile and offers to retry the playback copy).
 */
export function isInFlight(ab: Pick<ClipAtBat, "status" | "updatedAt">): boolean {
  if (ab.status !== "uploading" && ab.status !== "processing") return false;
  return Date.now() - new Date(ab.updatedAt).getTime() < 30 * 60 * 1000;
}

/** The feed thumbnail's stable URL; the version busts caches when it changes. */
export function posterUrl(ab: Pick<ClipAtBat, "id" | "updatedAt">): string {
  return `/clips/poster/${ab.id}?v=${encodeURIComponent(ab.updatedAt)}`;
}

/** "5 pitches · 3 swings", or null when nothing's marked yet. */
export function pitchSummary(pitches: ClipPitch[]): string | null {
  if (pitches.length === 0) return null;
  const swings = pitches.filter(isSwing).length;
  const p = `${pitches.length} pitch${pitches.length === 1 ? "" : "es"}`;
  return swings > 0 ? `${p} · ${swings} swing${swings === 1 ? "" : "s"}` : p;
}

