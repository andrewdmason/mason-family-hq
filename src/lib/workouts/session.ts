import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { WORKOUTS_MODEL } from "@/lib/workouts/anthropic";
import { parseWorkoutDescription } from "@/lib/workouts/parse";
import { loadMovementVocabulary } from "@/lib/workouts/canonicalize";
import { materializeSession } from "@/lib/workouts/materialize";
import { getWorkoutEventById, stripCfoPrefix } from "@/lib/workouts/calendar";
import { findSessionByEvent } from "@/lib/workouts/queries";

export type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

/**
 * Parse-on-open core: ensure a (parsed) session exists for a CFO event. Creates
 * the session row, runs the AI parse, materializes the structured workout, and
 * stamps parsed_at — all idempotent against the (user_id, calendar_event_id)
 * unique constraint so concurrent opens don't double up.
 *
 * Safe to call during a Server Component render: it performs no redirect/
 * notFound/revalidatePath, and the supabase server client swallows cookie-write
 * errors during render. It returns early when the session is already parsed.
 */
export async function ensureSessionForEvent(
  supabase: SupabaseServer,
  userId: string,
  eventId: string
): Promise<string> {
  const existing = await findSessionByEvent(supabase, eventId);
  if (existing?.parsedAt) return existing.id;

  const event = await getWorkoutEventById(supabase, eventId);
  if (!event) throw new Error("Workout event not found");

  const tz = await getUserTimezone();
  const sessionDate = localDate(new Date(event.startTime), tz);

  let sessionId = existing?.id ?? null;
  if (!sessionId) {
    const { data, error } = await supabase
      .from("workout_sessions")
      .insert({
        user_id: userId,
        session_date: sessionDate,
        title: stripCfoPrefix(event.rawTitle) || null,
        source: "calendar",
        calendar_event_id: eventId,
        raw_description: event.description,
      })
      .select("id")
      .single();
    if (error) {
      // Lost the insert race — re-read the row the other request created.
      const again = await findSessionByEvent(supabase, eventId);
      if (again?.parsedAt) return again.id;
      if (!again) throw new Error(`create session: ${error.message}`);
      sessionId = again.id;
    } else {
      sessionId = data.id;
    }
  }
  if (!sessionId) throw new Error("Could not resolve session id");

  const vocab = await loadMovementVocabulary(supabase);
  const parsed = await parseWorkoutDescription(event.description ?? "", vocab);
  if (parsed.parsed) {
    const admin = createAdminClient();
    await materializeSession({ user: supabase, admin, userId, sessionId, parsed });
    await supabase
      .from("workout_sessions")
      .update({ parsed_at: new Date().toISOString(), parse_model: WORKOUTS_MODEL })
      .eq("id", sessionId);
  }
  // On parse failure we leave parsed_at NULL so the detail view offers a re-parse
  // and a later open can retry, while still showing the raw description.

  return sessionId;
}
