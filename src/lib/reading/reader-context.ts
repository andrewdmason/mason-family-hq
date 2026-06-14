import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/** Hard cap on the context string fed to essay generation, to keep prompts lean. */
const MAX_CONTEXT_CHARS = 1200;

/**
 * A short "about this reader" snippet for essay generation — the shared family doc
 * plus the reader's own Present profile, if they've written one. Used ONLY to let
 * the broader-theme half of an essay feel relevant when it fits; the generator is
 * told to use it sparingly (see quiz-generate's guardrail). Reads through the
 * caller-supplied scope client and userId so it's correct whether the kid is
 * signed in or the owner is generating on their behalf. Empty string when nothing
 * useful is on file — generation then leans entirely on the book.
 */
export async function loadReaderContext(
  client: SupabaseClient,
  userId: string
): Promise<string> {
  const [family, present] = await Promise.all([
    client.from("journal_family").select("content").maybeSingle(),
    client
      .from("journal_agent_files")
      .select("content")
      .eq("user_id", userId)
      .eq("name", "Present")
      .maybeSingle(),
  ]);

  const parts: string[] = [];
  const familyDoc = (family.data?.content as string | null)?.trim();
  if (familyDoc) parts.push(familyDoc);
  const presentDoc = (present.data?.content as string | null)?.trim();
  if (presentDoc) parts.push(presentDoc);

  return parts.join("\n\n").slice(0, MAX_CONTEXT_CHARS).trim();
}

/**
 * The soft minimum word count for a reader's essays: the owner-set per-member
 * value (reading_settings.essay_min_words), falling back to an age heuristic, then
 * to 150. Read via the service role (like readerAge) so it works in either scope.
 */
export async function essayMinWords(
  email: string | null,
  readerAge: number | null
): Promise<number> {
  if (email) {
    const { data } = await createAdminClient()
      .from("reading_settings")
      .select("essay_min_words")
      .eq("member_email", email)
      .maybeSingle();
    const set = data?.essay_min_words as number | null | undefined;
    if (typeof set === "number" && set > 0) return set;
  }
  return readerAge != null && readerAge <= 10 ? 100 : 150;
}
