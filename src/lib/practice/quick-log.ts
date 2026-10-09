import { daysBetween } from "@/lib/date-utils";
import type { Piece, PracticeTask } from "@/lib/types";

/** Today's log as the full list, or as the quick logger's tap-to-time cards. */
export type LogMode = "list" | "quick";

/** Per-device cookie remembering the mode, so the right one paints first. */
export const LOG_MODE_COOKIE = "practice-log-mode";

export function parseLogMode(value: string | undefined): LogMode {
  return value === "quick" ? "quick" : "list";
}

/**
 * One card in the quick logger. A work with several active pieces (a trio's
 * movements) is one card split into a segment per piece; anything else is a
 * card of one.
 */
export type QuickCard = {
  key: string;
  title: string;
  /** In display order. Length > 1 means a segmented card. */
  pieces: Piece[];
};

const KIND_ORDER: Record<Piece["kind"], number> = {
  technique: 0,
  sight_reading: 1,
  piece: 2,
};

/**
 * The quick logger's cards, split into what's being learned and the
 * keep-it-warm rotation. The order is fixed — by kind, then name — so a card
 * never moves out from under the pointer as practice goes in.
 */
export function buildQuickCards(
  activePieces: Piece[],
  worksById: Record<string, string>
): { current: QuickCard[]; maintenance: QuickCard[] } {
  const byWork = new Map<string, Piece[]>();
  for (const piece of activePieces) {
    if (!piece.work_id) continue;
    byWork.set(piece.work_id, [...(byWork.get(piece.work_id) ?? []), piece]);
  }

  const cards: QuickCard[] = [];
  const seenWorks = new Set<string>();
  for (const piece of activePieces) {
    const siblings = piece.work_id ? byWork.get(piece.work_id) : undefined;
    if (piece.work_id && siblings && siblings.length > 1) {
      if (seenWorks.has(piece.work_id)) continue;
      seenWorks.add(piece.work_id);
      cards.push({
        key: `work:${piece.work_id}`,
        title: worksById[piece.work_id] ?? piece.name,
        pieces: [...siblings].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true })
        ),
      });
    } else {
      cards.push({ key: piece.id, title: piece.name, pieces: [piece] });
    }
  }

  const rank = (card: QuickCard) =>
    Math.min(...card.pieces.map((p) => KIND_ORDER[p.kind] ?? 2));
  cards.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.title.localeCompare(b.title, undefined, { numeric: true })
  );

  // A card belongs to the rotation only when every piece on it does.
  const isMaintenance = (card: QuickCard) =>
    card.pieces.every((p) => p.maintenance);
  return {
    current: cards.filter((c) => !isMaintenance(c)),
    maintenance: cards.filter(isMaintenance),
  };
}

/** Seconds of practice a task holds, never negative. */
export function taskElapsedSeconds(
  task: Pick<PracticeTask, "timer_seconds" | "timer_remaining_seconds">
): number {
  return Math.max(0, task.timer_seconds - task.timer_remaining_seconds);
}

/**
 * Which of a piece's tasks today a tap should time: the first one still open,
 * in the day's order; failing that, the one most recently worked on. Null
 * when the piece has nothing today and a tap should create an entry.
 */
export function pickQuickLogTask<
  T extends Pick<
    PracticeTask,
    "completed" | "started_at" | "ended_at" | "created_at"
  >,
>(tasks: T[]): T | null {
  const open = tasks.find((t) => !t.completed);
  if (open) return open;
  let best: T | null = null;
  let bestAt = "";
  for (const t of tasks) {
    const at = [t.ended_at, t.started_at, t.created_at]
      .filter((v): v is string => !!v)
      .sort()
      .at(-1) ?? "";
    if (best === null || at >= bestAt) {
      best = t;
      bestAt = at;
    }
  }
  return best;
}

/** "45m", "1h 16m" — the quiet total under a stopped card. */
export function formatQuickTotal(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "4:07", "1:16:05" — the live clock on a running card. */
export function formatQuickClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "Yesterday", "12 days ago", "Never played" — for a card not played today. */
export function daysSinceText(
  lastPracticed: string | undefined,
  today: string
): string {
  if (!lastPracticed) return "Never played";
  const days = daysBetween(lastPracticed, today);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}
