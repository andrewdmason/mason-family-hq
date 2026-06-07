"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { WORKOUTS_MODEL } from "@/lib/workouts/anthropic";
import { parseWorkoutDescription } from "@/lib/workouts/parse";
import { loadMovementVocabulary } from "@/lib/workouts/canonicalize";
import { materializeSession } from "@/lib/workouts/materialize";
import { computeSetE1rm } from "@/lib/workouts/e1rm";
import { getWorkoutEventById, stripCfoPrefix } from "@/lib/workouts/calendar";
import { findSessionByEvent } from "@/lib/workouts/queries";
import type { WorkoutRxLevel } from "@/lib/workouts/types";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

/**
 * Parse-on-open core: ensure a (parsed) session exists for a CFO event. Creates
 * the session row, runs the AI parse, materializes the structured workout, and
 * stamps parsed_at — all idempotent against the (user_id, calendar_event_id)
 * unique constraint so concurrent opens don't double up.
 */
async function ensureSessionForEvent(
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

/** Open (and lazily parse) a CFO calendar event, then go to its detail view. */
export async function openWorkoutEvent(eventId: string): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const sessionId = await ensureSessionForEvent(supabase, userId, eventId);
  revalidatePath("/workouts");
  revalidatePath("/home");
  redirect(`/workouts/${sessionId}`);
}

/**
 * Re-import a session from its source text as if for the first time: delete all
 * parsed movements (blocks → entries → sets), clear the completed flag, and
 * re-run the parse fresh. Any edits the user made to actuals are discarded.
 */
export async function reimportSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: session } = await supabase
    .from("workout_sessions")
    .select("id, raw_description")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session?.raw_description) return;

  // Blocks cascade to entries and sets. Reset to a freshly-imported state.
  await supabase.from("workout_blocks").delete().eq("session_id", sessionId);
  await supabase
    .from("workout_sessions")
    .update({ completed_at: null, parsed_at: null })
    .eq("id", sessionId);

  const vocab = await loadMovementVocabulary(supabase);
  const parsed = await parseWorkoutDescription(session.raw_description, vocab);
  if (parsed.parsed) {
    const admin = createAdminClient();
    await materializeSession({ user: supabase, admin, userId, sessionId, parsed });
    await supabase
      .from("workout_sessions")
      .update({ parsed_at: new Date().toISOString(), parse_model: WORKOUTS_MODEL })
      .eq("id", sessionId);
  }
  revalidatePath(`/workouts/${sessionId}`);
  revalidatePath("/workouts");
  revalidatePath("/home");
}

/** Create an ad-hoc session by parsing a pasted/typed description. */
export async function createManualSession(input: {
  date: string;
  title?: string;
  description: string;
}): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data, error } = await supabase
    .from("workout_sessions")
    .insert({
      user_id: userId,
      session_date: input.date,
      title: input.title?.trim() || null,
      source: "manual",
      raw_description: input.description,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`create manual session: ${error?.message}`);
  const sessionId = data.id;

  if (input.description.trim()) {
    const vocab = await loadMovementVocabulary(supabase);
    const parsed = await parseWorkoutDescription(input.description, vocab);
    if (parsed.parsed) {
      const admin = createAdminClient();
      await materializeSession({ user: supabase, admin, userId, sessionId, parsed });
      await supabase
        .from("workout_sessions")
        .update({ parsed_at: new Date().toISOString(), parse_model: WORKOUTS_MODEL })
        .eq("id", sessionId);
    }
  }
  revalidatePath("/workouts");
  redirect(`/workouts/${sessionId}`);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);
  await supabase.from("workout_sessions").delete().eq("id", sessionId);
  revalidatePath("/workouts");
  redirect("/workouts");
}

// ---------- Edits to logged results ----------

export type SetActualPatch = {
  actualReps?: number | null;
  actualLoad?: number | null;
  actualUnit?: "lb" | "kg" | null;
  actualDistance?: number | null;
  actualDuration?: number | null;
  actualCalories?: number | null;
  rxLevel?: WorkoutRxLevel | null;
};

/** Update a set's actual values; recompute e1RM for loaded reps. */
export async function updateSet(
  setId: string,
  sessionId: string,
  patch: SetActualPatch
): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);

  const { data: cur } = await supabase
    .from("workout_sets")
    .select(
      `metric_type, actual_load, actual_reps, actual_unit,
       workout_movement_entries!inner ( movements ( is_loaded ) )`
    )
    .eq("id", setId)
    .maybeSingle();
  if (!cur) return;

  const update: Record<string, unknown> = {};
  if ("actualReps" in patch) update.actual_reps = patch.actualReps;
  if ("actualLoad" in patch) update.actual_load = patch.actualLoad;
  if ("actualUnit" in patch) update.actual_unit = patch.actualUnit;
  if ("actualDistance" in patch) update.actual_distance = patch.actualDistance;
  if ("actualDuration" in patch) update.actual_duration = patch.actualDuration;
  if ("actualCalories" in patch) update.actual_calories = patch.actualCalories;
  if ("rxLevel" in patch) update.rx_level = patch.rxLevel;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = cur as any;
  if (c.metric_type === "load_reps") {
    const load = "actualLoad" in patch ? patch.actualLoad : c.actual_load;
    const reps = "actualReps" in patch ? patch.actualReps : c.actual_reps;
    const unit = "actualUnit" in patch ? patch.actualUnit : c.actual_unit;
    const isLoaded = c.workout_movement_entries?.movements?.is_loaded ?? false;
    const e = computeSetE1rm({ load, reps, unit, isLoadedMovement: isLoaded });
    update.e1rm = e?.e1rm ?? null;
    update.e1rm_is_loose = e?.isLoose ?? false;
  }

  await supabase.from("workout_sets").update(update).eq("id", setId);
  revalidatePath(`/workouts/${sessionId}`);
}

export type BlockPatch = {
  scoreSeconds?: number | null;
  scoreRounds?: number | null;
  scoreReps?: number | null;
  scoreLoad?: number | null;
  scoreDistance?: number | null;
  scoreCalories?: number | null;
  rxLevel?: WorkoutRxLevel | null;
  rpe?: number | null;
  notes?: string | null;
};

export async function updateBlock(
  blockId: string,
  sessionId: string,
  patch: BlockPatch
): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);
  const cols: Record<string, unknown> = {};
  if ("scoreSeconds" in patch) cols.score_seconds = patch.scoreSeconds;
  if ("scoreRounds" in patch) cols.score_rounds = patch.scoreRounds;
  if ("scoreReps" in patch) cols.score_reps = patch.scoreReps;
  if ("scoreLoad" in patch) cols.score_load = patch.scoreLoad;
  if ("scoreDistance" in patch) cols.score_distance = patch.scoreDistance;
  if ("scoreCalories" in patch) cols.score_calories = patch.scoreCalories;
  if ("rxLevel" in patch) cols.rx_level = patch.rxLevel;
  if ("rpe" in patch) cols.rpe = patch.rpe;
  if ("notes" in patch) cols.notes = patch.notes;
  if (Object.keys(cols).length === 0) return;
  await supabase.from("workout_blocks").update(cols).eq("id", blockId);
  revalidatePath(`/workouts/${sessionId}`);
}

/** Lightweight movement list (with aliases) for the entry-edit typeahead. */
export async function getMovementOptions(): Promise<
  { id: string; name: string; aliases: string[] }[]
> {
  const supabase = await createClient();
  await requireUserId(supabase);
  const [{ data: movements }, { data: aliases }] = await Promise.all([
    supabase.from("movements").select("id, canonical_name").order("canonical_name"),
    supabase.from("movement_aliases").select("movement_id, alias"),
  ]);
  const aliasMap = new Map<string, string[]>();
  for (const a of (aliases ?? []) as { movement_id: string; alias: string }[]) {
    const list = aliasMap.get(a.movement_id) ?? [];
    list.push(a.alias);
    aliasMap.set(a.movement_id, list);
  }
  return ((movements ?? []) as { id: string; canonical_name: string }[]).map(
    (m) => ({ id: m.id, name: m.canonical_name, aliases: aliasMap.get(m.id) ?? [] })
  );
}

/**
 * Swap a logged movement for another (e.g. your preferred substitute): repoint
 * the entry and recompute its sets' e1RM for the new movement's eligibility.
 */
export async function swapEntryMovement(
  entryId: string,
  sessionId: string,
  newMovementId: string
): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);

  const { data: mv } = await supabase
    .from("movements")
    .select("is_loaded")
    .eq("id", newMovementId)
    .maybeSingle();
  const isLoaded = mv?.is_loaded ?? false;

  await supabase
    .from("workout_movement_entries")
    .update({ movement_id: newMovementId })
    .eq("id", entryId);

  const { data: sets } = await supabase
    .from("workout_sets")
    .select("id, metric_type, actual_load, actual_reps, actual_unit")
    .eq("entry_id", entryId);
  for (const s of (sets ?? []) as Array<{
    id: string;
    metric_type: string;
    actual_load: number | null;
    actual_reps: number | null;
    actual_unit: "lb" | "kg" | null;
  }>) {
    const e =
      s.metric_type === "load_reps"
        ? computeSetE1rm({
            load: s.actual_load,
            reps: s.actual_reps,
            unit: s.actual_unit,
            isLoadedMovement: isLoaded,
          })
        : null;
    await supabase
      .from("workout_sets")
      .update({ e1rm: e?.e1rm ?? null, e1rm_is_loose: e?.isLoose ?? false })
      .eq("id", s.id);
  }

  revalidatePath(`/workouts/${sessionId}`);
}

export async function updateEntry(
  entryId: string,
  sessionId: string,
  patch: { rpe?: number | null; notes?: string | null }
): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);
  const cols: Record<string, unknown> = {};
  if ("rpe" in patch) cols.rpe = patch.rpe;
  if ("notes" in patch) cols.notes = patch.notes;
  if (Object.keys(cols).length === 0) return;
  await supabase.from("workout_movement_entries").update(cols).eq("id", entryId);
  revalidatePath(`/workouts/${sessionId}`);
}

/** Mark a session done (or reopen it). Drives the home widget's focus shift. */
export async function setSessionCompleted(
  sessionId: string,
  completed: boolean
): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);
  await supabase
    .from("workout_sessions")
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq("id", sessionId);
  revalidatePath(`/workouts/${sessionId}`);
  revalidatePath("/workouts");
  revalidatePath("/home");
}

export async function saveSessionNotes(
  sessionId: string,
  notes: string
): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);
  await supabase
    .from("workout_sessions")
    .update({ notes: notes.trim() || null })
    .eq("id", sessionId);
  revalidatePath(`/workouts/${sessionId}`);
}

/** Set the whole session's perceived effort (RPE 1–10), or clear it. */
export async function setSessionRpe(
  sessionId: string,
  rpe: number | null
): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);
  await supabase.from("workout_sessions").update({ rpe }).eq("id", sessionId);
  revalidatePath(`/workouts/${sessionId}`);
}
