import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Retire any OTHER open quiz for a book when one is published, so a book never has
 * two live quizzes at once. "Open" = published and not yet passed; passed quizzes
 * are left as completed history, drafts are left in review. Scoped by userId; pass
 * the just-published quiz's id as keepId so it survives. Safe to call repeatedly.
 */
export async function archiveOtherOpenQuizzes(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  keepId: string
): Promise<void> {
  const { data: others } = await client
    .from("reading_quizzes")
    .select("id")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .eq("status", "published")
    .neq("id", keepId);
  if (!others || others.length === 0) return;

  const otherIds = others.map((q) => q.id as string);
  // Leave already-passed quizzes alone — they're the record of a finished stretch.
  const { data: subs } = await client
    .from("reading_quiz_submissions")
    .select("quiz_id, score_correct, score_total")
    .in("quiz_id", otherIds);
  const passed = new Set(
    (subs ?? [])
      .filter(
        (s) =>
          (s.score_total ?? 0) > 0 &&
          (s.score_correct ?? 0) === (s.score_total ?? 0)
      )
      .map((s) => s.quiz_id as string)
  );

  const toArchive = otherIds.filter((id) => !passed.has(id));
  if (toArchive.length === 0) return;

  await client
    .from("reading_quizzes")
    .update({ status: "archived" })
    .in("id", toArchive)
    .eq("user_id", userId);
}
