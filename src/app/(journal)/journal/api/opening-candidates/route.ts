import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateCandidates } from "@/lib/journal/opening-candidates";
import { normalizeCandidates } from "@/lib/journal/candidates";
import { toErrorMessage } from "@/lib/journal/errors";
import type { JournalOpeningCandidate } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { entryId?: string; tz?: string };
  const entryId = body.entryId;
  if (!entryId) {
    return new Response("entryId required", { status: 400 });
  }

  const supabase = await createClient();

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .select("id, status, opening_candidates, candidates_reroll_count, reading_book_id, timeline_entry_id")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) {
    return new Response("entry not found", { status: 404 });
  }
  if (entry.status !== "open") {
    return new Response("entry is closed", { status: 409 });
  }

  // Idempotent: if candidates already exist, return them (handles reload and
  // React StrictMode double-mount).
  const existing = normalizeCandidates(entry.opening_candidates);
  if (existing.length > 0) {
    return Response.json({
      candidates: existing,
      rerollCount: entry.candidates_reroll_count,
    });
  }

  // The picker only runs before the conversation has started.
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

  let candidates: JournalOpeningCandidate[];
  try {
    // A book-reflection entry carries the book it's about; ground the questions
    // in it (status + rating folded into the prompt).
    candidates = await generateCandidates(
      entryId,
      [],
      undefined,
      body.tz,
      entry.reading_book_id as string | null,
      entry.timeline_entry_id as string | null
    );
  } catch (err) {
    console.error("[opening-candidates] generation failed:", err);
    return new Response(toErrorMessage(err), { status: 500 });
  }

  const { error: writeErr } = await supabase
    .from("journal_entries")
    .update({ opening_candidates: candidates })
    .eq("id", entryId);
  if (writeErr) {
    return new Response(writeErr.message, { status: 500 });
  }

  return Response.json({
    candidates,
    rerollCount: entry.candidates_reroll_count,
  });
}
