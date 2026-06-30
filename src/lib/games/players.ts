import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TriviaLevel } from "@/lib/games/types";

/**
 * Family-member identity for trivia, with each person resolved to a difficulty
 * band. We don't store a grade column (family_members only has birthdate), so the
 * band is derived: the two kids are ordered by birthdate — oldest → older_kid,
 * youngest → younger_kid — which is stable across school years. Adults → adult.
 *
 * The concrete age/grade only flavors generation (audienceForLevel); the stored
 * question tag is the stable band.
 */
export type TriviaPlayer = {
  userId: string;
  email: string;
  name: string;
  role: "owner" | "parent" | "kid";
  band: TriviaLevel;
  birthdate: string | null;
};

type Row = {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  birthdate: string | null;
};

/** Age (whole years) as of the given reference date. */
function ageOn(birthdate: string, ref: Date): number {
  const b = new Date(birthdate);
  let age = ref.getFullYear() - b.getFullYear();
  const beforeBirthday =
    ref.getMonth() < b.getMonth() ||
    (ref.getMonth() === b.getMonth() && ref.getDate() < b.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** The upcoming/current school year's Sept 1 — the reference for grade. */
function schoolYearStart(now = new Date()): Date {
  // Before September, the relevant school year still starts this calendar year.
  return new Date(now.getFullYear(), 8, 1);
}

/** Approximate US grade a kid is entering (5yo → K(0) … 10yo → 5th). */
export function approxGrade(birthdate: string, now = new Date()): number {
  return Math.max(0, ageOn(birthdate, schoolYearStart(now)) - 5);
}

/** Load the family as trivia players with bands. Service role (reads across members). */
export async function loadTriviaPlayers(): Promise<TriviaPlayer[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("family_members")
    .select("user_id, email, name, role, birthdate")
    .in("role", ["owner", "parent", "kid"])
    .not("user_id", "is", null);

  const rows = (data ?? []) as Row[];
  const kids = rows
    .filter((r) => r.role === "kid")
    .sort((a, b) => (a.birthdate ?? "").localeCompare(b.birthdate ?? "")); // oldest first

  const bandFor = (r: Row): TriviaLevel => {
    if (r.role !== "kid") return "adult";
    if (kids.length <= 1) return "younger_kid";
    if (r.user_id === kids[0].user_id) return "older_kid"; // earliest birthdate
    if (r.user_id === kids[kids.length - 1].user_id) return "younger_kid";
    return "older_kid";
  };

  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.name?.trim() || r.email,
    role: r.role as TriviaPlayer["role"],
    band: bandFor(r),
    birthdate: r.birthdate,
  }));
}

/** A human audience description for the generator prompt, given a target band. */
export function audienceForLevel(
  level: TriviaLevel,
  players: TriviaPlayer[],
  now = new Date()
): string {
  if (level === "adult") return "well-read adults";
  if (level === "all") return "a mixed family audience of kids and adults";

  const kid = players.find((p) => p.band === level);
  if (!kid?.birthdate) {
    return level === "older_kid" ? "a middle-school kid" : "an elementary-school kid";
  }
  const age = ageOn(kid.birthdate, now);
  const grade = approxGrade(kid.birthdate, now);
  const gradeLabel = grade === 0 ? "kindergarten" : `grade ${grade}`;
  return `a ${age}-year-old kid entering about ${gradeLabel}`;
}
