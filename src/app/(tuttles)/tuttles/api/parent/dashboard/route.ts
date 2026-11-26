import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DASHBOARD_DAYS, dashboardDays, dashboardWeeks, practiceWords } from "@/lib/tuttles/dashboard";
import { loadAnswers } from "@/lib/tuttles/math-db";
import { firstName } from "@/lib/tuttles/math";
import { NO_STORE, vocabCaller } from "@/lib/tuttles/vocab";
import { allParts, wordsFor } from "@/lib/words/content";
import { WORDS_TZ, wordsToday } from "@/lib/words/day";
import { loadProgress, loadStudents } from "@/lib/words/session";
import { addDays } from "@/lib/words/schedule";

export const runtime = "nodejs";

/**
 * The Parent Dashboard in the Tuttles app (src/lib/tuttles/dashboard.ts): for
 * each kid, the last four weeks of Vocab and Math by day and by week, and the
 * words worth practicing with them at home today.
 *
 *   GET   Authorization: Bearer …
 *   → { today, kids: [{ id, name, level, totalWords, mastered, days, weeks, practice }] }
 *
 * Parents only, in the parents' own view (no X-Tuttles-Kid), as with Vocab's
 * and Math's summaries. A parent's own practice, played as themselves, isn't
 * in it: only the kids are.
 */
export async function GET(request: Request) {
  const caller = await vocabCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  if (!caller.parentView) return NextResponse.json({ error: "parents only" }, { status: 403 });

  const admin = createAdminClient();
  const today = wordsToday();
  // One day more than shown: the words mastered before the first week, so it says what that week gained.
  const from = addDays(today, -DASHBOARD_DAYS);
  const students = await loadStudents();
  const kids = await Promise.all(
    students.map(async (s) => {
      const level = s.profile.level;
      const [progress, sessions, answers] = await Promise.all([
        loadProgress(s.userId, level, admin),
        admin
          .from("words_sessions")
          .select("day, answered, correct, elapsed_ms, finished_at")
          .eq("user_id", s.userId)
          .eq("level", level)
          .gte("day", from)
          .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            return data ?? [];
          }),
        loadAnswers(admin, s.userId),
      ]);
      const words = wordsFor(level);
      const all = dashboardDays({ today, tz: WORDS_TZ, sessions, answers, progress: [...progress.values()], n: DASHBOARD_DAYS + 1 });
      const days = all.slice(1);
      return {
        id: s.userId,
        name: firstName(s.name),
        level,
        totalWords: words.length,
        mastered: days[days.length - 1]?.mastered ?? 0,
        days,
        weeks: dashboardWeeks(days, all[0]?.mastered ?? 0),
        practice: practiceWords([...words, ...allParts()], progress, today),
      };
    }),
  );
  return NextResponse.json({ today, kids }, NO_STORE);
}
