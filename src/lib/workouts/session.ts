import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { localDate, resolveTimezone } from "@/lib/date-utils";
import { WORKOUTS_MODEL } from "@/lib/workouts/anthropic";
import { parseWorkoutDescription, buildSessionSourceText } from "@/lib/workouts/parse";
import { loadMovementVocabulary } from "@/lib/workouts/canonicalize";
import { materializeSession } from "@/lib/workouts/materialize";
import { getWorkoutEventById, stripCfoPrefix } from "@/lib/workouts/calendar";
import { findSessionByEvent } from "@/lib/workouts/queries";
import type { ParsedBlock, ParsedWorkout } from "@/lib/workouts/types";

export type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

/**
 * Parse-on-open core: ensure a (parsed) session exists for a CFO event. Creates
 * the session row, runs the AI parse (or picks up the one prepareEvent made
 * ahead), materializes the structured workout, and stamps parsed_at — all idempotent against the (user_id, calendar_event_id)
 * unique constraint so concurrent opens don't double up.
 *
 * Safe to call during a Server Component render: it performs no redirect/
 * notFound/revalidatePath, and the supabase server client swallows cookie-write
 * errors during render. It returns early when the session is already parsed.
 *
 * `supabase` acts as the member: the website's cookie client, or the iPhone
 * app's bearer client (src/app/(workouts)/workouts/api/open/route.ts), which
 * has no tz cookie and so names its `timeZone`.
 */
export async function ensureSessionForEvent(
  supabase: SupabaseServer | SupabaseClient,
  userId: string,
  eventId: string,
  opts: { timeZone?: string | null } = {}
): Promise<string> {
  const existing = await findSessionByEvent(supabase, eventId);
  if (existing?.parsedAt) return existing.id;

  const event = await getWorkoutEventById(supabase, eventId);
  if (!event) throw new Error("Workout event not found");

  const tz = await resolveTimezone(opts.timeZone);
  const sessionDate = localDate(new Date(event.startTime), tz);

  const title = stripCfoPrefix(event.rawTitle) || null;

  let sessionId = existing?.id ?? null;
  if (!sessionId) {
    const { data, error } = await supabase
      .from("workout_sessions")
      .insert({
        user_id: userId,
        session_date: sessionDate,
        title,
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

  const admin = createAdminClient();
  const parsed = await structureWorkout(
    supabase,
    admin,
    buildSessionSourceText(title, event.description)
  );
  if (parsed.parsed) {
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

/**
 * Structure a calendar workout ahead of its first open, without opening it:
 * the Workouts iPhone app asks for this in the background for the workouts
 * coming up (src/app/(workouts)/workouts/api/prepare/route.ts), so the tap
 * that opens one has no parse to wait for. Nothing is created but the kept
 * parse — a workout prepared and then skipped never becomes a session.
 *
 * Returns whether the workout is ready to open quickly.
 */
export async function prepareEvent(
  supabase: SupabaseServer | SupabaseClient,
  eventId: string
): Promise<boolean> {
  // Already opened: nothing to get ahead of.
  if (await findSessionByEvent(supabase, eventId)) return true;

  const event = await getWorkoutEventById(supabase, eventId);
  if (!event) throw new Error("Workout event not found");

  const title = stripCfoPrefix(event.rawTitle) || null;
  const parsed = await structureWorkout(
    supabase,
    createAdminClient(),
    buildSessionSourceText(title, event.description)
  );
  return parsed.parsed;
}

/**
 * The AI parse of a workout's text, kept by the text's hash (workout_parses)
 * so it only ever runs once per workout and model: a parse made ahead by
 * prepareEvent is the one the first open uses. Only parses that worked are
 * kept, so a failed one is tried again. A session's "re-import" doesn't come
 * through here — it asks for a fresh parse on purpose.
 */
async function structureWorkout(
  supabase: SupabaseServer | SupabaseClient,
  admin: SupabaseClient,
  sourceText: string
): Promise<ParsedWorkout> {
  const source = sourceText.trim();
  if (!source) return { parsed: false, blocks: [] };
  const key = {
    source_hash: createHash("sha256").update(source).digest("hex"),
    parse_model: WORKOUTS_MODEL,
  };

  // The kept parse is a shortcut, never a requirement: if it can't be read or
  // written the workout is just parsed as before.
  const { data: kept } = await admin
    .from("workout_parses")
    .select("blocks")
    .match(key)
    .maybeSingle();
  const blocks = kept?.blocks as ParsedBlock[] | undefined;
  if (Array.isArray(blocks) && blocks.length > 0) return { parsed: true, blocks };

  const vocab = await loadMovementVocabulary(supabase);
  const parsed = await parseWorkoutDescription(source, vocab);
  if (parsed.parsed) {
    const { error } = await admin
      .from("workout_parses")
      .upsert({ ...key, blocks: parsed.blocks }, { onConflict: "source_hash,parse_model" });
    if (error) console.error("[workouts/session] keep parse:", error.message);
  }
  return parsed;
}
