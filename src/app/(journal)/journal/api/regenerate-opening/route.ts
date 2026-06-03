import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import { generateCandidates } from "@/lib/journal/opening-candidates";
import { candidateTexts } from "@/lib/journal/candidates";
import { localDate, resolveTimezone } from "@/lib/date-utils";
import type { JournalOpeningCandidate } from "@/lib/types";

export const runtime = "nodejs";

// Reroll the picker: regenerate a fresh set, avoiding the questions the user
// just rejected. An optional `categoryName` forces the whole new set into a
// single question type (the user asked for a specific kind). The reroll count
// is still tracked (it keys the picker's re-animation) but isn't capped.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    entryId?: string;
    categoryName?: string;
    tz?: string;
  };
  const entryId = body.entryId;
  const categoryName = body.categoryName?.trim() || undefined;
  if (!entryId) {
    return new Response("entryId required", { status: 400 });
  }

  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .select("id, status, opening_candidates, candidates_reroll_count, reading_book_id")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) {
    return new Response("entry not found", { status: 404 });
  }
  if (entry.status !== "open") {
    return new Response("entry is closed", { status: 409 });
  }

  // Can't reroll once the conversation has started.
  const { count, error: countErr } = await supabase
    .from("journal_messages")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", entryId);
  if (countErr) {
    return new Response(countErr.message, { status: 500 });
  }
  if ((count ?? 0) > 0) {
    return new Response("entry already started", { status: 409 });
  }

  const rejected = candidateTexts(entry.opening_candidates);

  // Persist the rejected set so future days don't resurface the same prompts.
  if (rejected.length > 0) {
    const tz = await resolveTimezone(body.tz);
    const today = localDate(new Date(), tz);
    await supabase.from("journal_skipped_questions").insert(
      rejected.map((q) => ({ question: q, entry_id: entryId, skipped_on: today, user_id: userId }))
    );
  }

  let candidates: JournalOpeningCandidate[];
  try {
    // Keep a book-reflection entry grounded in its book across rerolls (unless
    // the user explicitly forced a different category).
    candidates = await generateCandidates(
      entryId,
      rejected,
      categoryName,
      body.tz,
      entry.reading_book_id as string | null
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(msg, { status: 500 });
  }

  const rerollCount = entry.candidates_reroll_count + 1;
  const { error: writeErr } = await supabase
    .from("journal_entries")
    .update({
      opening_candidates: candidates,
      candidates_reroll_count: rerollCount,
    })
    .eq("id", entryId);
  if (writeErr) {
    return new Response(writeErr.message, { status: 500 });
  }

  return Response.json({ candidates, rerollCount });
}
