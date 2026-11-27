import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DASHBOARD_DAYS, dashboardDays, dashboardHouse, dashboardMath, dashboardWeeks, practiceWords, vocabStreak } from "@/lib/tuttles/dashboard";
import { loadHouses } from "@/lib/tuttles/house-db";
import { loadAnswers, loadRuns } from "@/lib/tuttles/math-db";
import { firstName, summarize } from "@/lib/tuttles/math";
import { NO_STORE, vocabCaller } from "@/lib/tuttles/vocab";
import { allParts, wordsFor } from "@/lib/words/content";
import { WORDS_TZ, wordsToday } from "@/lib/words/day";
import { loadProgress, loadStudents } from "@/lib/words/session";
import { TEST_DATE, daysBetween } from "@/lib/words/schedule";

export const runtime = "nodejs";

/**
 * The Parent Dashboard in the Tuttles app (src/lib/tuttles/dashboard.ts): for
 * each kid, the last four weeks of Vocab and Math by day and by week, the
 * words worth practicing with them at home today, their streaks, where Math
 * is going wrong, and what's in their purse. It's all the parents see of the
 * kids' Vocab, Math and houses short of the houses themselves.
 *
 *   GET   Authorization: Bearer …
 *   → { today, daysLeft, kids: [{ id, name, level, totalWords, mastered, days, weeks, practice, vocabStreak, math, house }] }
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
  const students = await loadStudents();
  const houses = await loadHouses(
    admin,
    students.map((s) => s.userId),
  );
  const kids = await Promise.all(
    students.map(async (s) => {
      const level = s.profile.level;
      const [progress, sessions, answers, runs] = await Promise.all([
        loadProgress(s.userId, level, admin),
        // The newest first, as far back as the streak needs: a thousand is months of them.
        admin
          .from("words_sessions")
          .select("day, answered, correct, elapsed_ms, finished_at")
          .eq("user_id", s.userId)
          .eq("level", level)
          .order("day", { ascending: false })
          .limit(1000)
          .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            return data ?? [];
          }),
        loadAnswers(admin, s.userId),
        loadRuns(admin, s.userId),
      ]);
      const words = wordsFor(level);
      // One day more than shown: the words mastered before the first week, so it says what that week gained.
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
        vocabStreak: vocabStreak(sessions, today),
        math: dashboardMath(summarize({ kid: s.userId, name: s.name, level, today, tz: WORDS_TZ, answers, runs })),
        house: dashboardHouse(houses.get(s.userId)?.json),
      };
    }),
  );
  return NextResponse.json({ today, daysLeft: daysBetween(today, TEST_DATE), kids }, NO_STORE);
}
