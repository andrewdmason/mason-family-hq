"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/members/auth";
import { WORKOUTS_MODEL } from "@/lib/workouts/anthropic";
import {
  parseWorkoutDescription,
  buildSessionSourceText,
} from "@/lib/workouts/parse";
import { loadMovementVocabulary } from "@/lib/workouts/canonicalize";
import { materializeSession } from "@/lib/workouts/materialize";
import { computeSetE1rm } from "@/lib/workouts/e1rm";
import {
  pushSessionToWhoop,
  markSessionWhoopDirty,
  type PushResult,
} from "@/lib/whoop/push";
import { ensureSessionForEvent } from "@/lib/workouts/session";
import type { WorkoutRxLevel } from "@/lib/workouts/types";

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
    .select("id, title, raw_description")
    .eq("id", sessionId)
    .maybeSingle();
  // The workout may live entirely in the title (calendar events with no
  // description body), so parse from title + description, not description alone.
  const sourceText = buildSessionSourceText(
    session?.title,
    session?.raw_description,
  );
  if (!sourceText) return;

  // Blocks cascade to entries and sets. Reset to a freshly-imported state.
  await supabase.from("workout_blocks").delete().eq("session_id", sessionId);
  await supabase
    .from("workout_sessions")
    .update({ completed_at: null, parsed_at: null })
    .eq("id", sessionId);

  const vocab = await loadMovementVocabulary(supabase);
  const parsed = await parseWorkoutDescription(sourceText, vocab);
  if (parsed.parsed) {
    const admin = createAdminClient();
    await materializeSession({
      user: supabase,
      admin,
      userId,
      sessionId,
      parsed,
    });
    await supabase
      .from("workout_sessions")
      .update({
        parsed_at: new Date().toISOString(),
        parse_model: WORKOUTS_MODEL,
      })
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
  if (error || !data)
    throw new Error(`create manual session: ${error?.message}`);
  const sessionId = data.id;

  if (input.description.trim()) {
    const vocab = await loadMovementVocabulary(supabase);
    const parsed = await parseWorkoutDescription(
      buildSessionSourceText(input.title, input.description),
      vocab,
    );
    if (parsed.parsed) {
      const admin = createAdminClient();
      await materializeSession({
        user: supabase,
        admin,
        userId,
        sessionId,
        parsed,
      });
      await supabase
        .from("workout_sessions")
        .update({
          parsed_at: new Date().toISOString(),
          parse_model: WORKOUTS_MODEL,
        })
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
  revalidatePath("/home");
  // Land on Upcoming rather than Today: a calendar-backed workout is still
  // scheduled, so the Today tab would immediately re-open (and re-parse) it,
  // making the delete look like it did nothing. Upcoming shows it as a
  // not-yet-opened event instead.
  redirect("/workouts?tab=upcoming");
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
  patch: SetActualPatch,
): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);

  const { data: cur } = await supabase
    .from("workout_sets")
    .select(
      `metric_type, actual_load, actual_reps, actual_unit,
       workout_movement_entries!inner ( movements ( is_loaded ) )`,
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
  // Reps/load changed → any prior WHOOP push is now stale.
  await markSessionWhoopDirty(sessionId);
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
  patch: BlockPatch,
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
    supabase
      .from("movements")
      .select("id, canonical_name")
      .order("canonical_name"),
    supabase.from("movement_aliases").select("movement_id, alias"),
  ]);
  const aliasMap = new Map<string, string[]>();
  for (const a of (aliases ?? []) as { movement_id: string; alias: string }[]) {
    const list = aliasMap.get(a.movement_id) ?? [];
    list.push(a.alias);
    aliasMap.set(a.movement_id, list);
  }
  return ((movements ?? []) as { id: string; canonical_name: string }[]).map(
    (m) => ({
      id: m.id,
      name: m.canonical_name,
      aliases: aliasMap.get(m.id) ?? [],
    }),
  );
}

/**
 * Swap a logged movement for another (e.g. your preferred substitute): repoint
 * the entry and recompute its sets' e1RM for the new movement's eligibility.
 */
export async function swapEntryMovement(
  entryId: string,
  sessionId: string,
  newMovementId: string,
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

  // The movement (and thus its WHOOP exercise mapping) changed.
  await markSessionWhoopDirty(sessionId);
  revalidatePath(`/workouts/${sessionId}`);
}

/** Mark a session done (or reopen it). Drives the home widget's focus shift.
 * Sending to WHOOP is a separate, manual step (the "Send to WHOOP" chip) rather
 * than automatic on completion — see resendToWhoop. */
export async function setSessionCompleted(
  sessionId: string,
  completed: boolean,
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

/** Manually (re-)push a session to WHOOP — the panel's "send"/"retry"/"re-send"
 * action. Returns the push result so the panel can show an immediate status
 * readout; the revalidated panel also reflects the persisted outcome. */
export async function resendToWhoop(sessionId: string): Promise<PushResult> {
  const supabase = await createClient();
  await requireUserId(supabase);
  // Confirm the caller owns the session (RLS-scoped read) before pushing.
  const { data } = await supabase
    .from("workout_sessions")
    .select("id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!data) throw new Error("Session not found");
  const result = await pushSessionToWhoop(sessionId);
  revalidatePath(`/workouts/${sessionId}`);
  return result;
}

export async function saveSessionNotes(
  sessionId: string,
  notes: string,
): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);
  await supabase
    .from("workout_sessions")
    .update({ notes: notes.trim() || null })
    .eq("id", sessionId);
  revalidatePath(`/workouts/${sessionId}`);
}

/** Flag the session's effort vs. a normal day ("easier"/"harder"), or clear it.
 * Null is the common case (a normal-effort session, left unselected). */
export async function setSessionEffort(
  sessionId: string,
  effort: "easier" | "harder" | null,
): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);
  await supabase
    .from("workout_sessions")
    .update({ effort })
    .eq("id", sessionId);
  revalidatePath(`/workouts/${sessionId}`);
}

/** Flag how the body felt going in ("low"/"high" energy), or clear it. */
export async function setSessionEnergy(
  sessionId: string,
  energy: "low" | "high" | null,
): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);
  await supabase
    .from("workout_sessions")
    .update({ energy })
    .eq("id", sessionId);
  revalidatePath(`/workouts/${sessionId}`);
}
