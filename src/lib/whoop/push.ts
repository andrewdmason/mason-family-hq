// Orchestrates the one-way push of a completed session's resistance work into
// WHOOP. Source of truth is Family HQ; WHOOP just receives. Create on first push
// (store the returned id), no-op on an unchanged re-send, and delete-then-recreate
// on a changed one — refusing to recreate if the delete fails, so we never leave
// a duplicate strength workout double-counting muscular load.

import { createAdminClient } from "@/lib/supabase/admin";
import { hasWhoopConnection, getValidWhoopConnection } from "./auth";
import { whoopApi } from "./client";
import { buildLiftBody, type InputExercise, type LiftBody } from "./build-lift-body";
import { toKg } from "./units";

const LIFT_PATH = "/weightlifting-service/v2/weightlifting-workout/activity";
// (Delete is verified working — DELETE /core-details-bff/v1/cardio-details?activityId=
// {id} → 204 — but the interim flow doesn't delete; it only creates. Kept here as a
// note for when we add the attach/replace flow.)

type AdminClient = ReturnType<typeof createAdminClient>;

export interface SessionMeta {
  id: string;
  userId: string;
  sessionDate: string;
  completedAt: string | null;
  title: string | null;
  whoopWorkoutId: string | null;
  whoopSyncStatus: string | null;
  whoopSyncedHash: string | null;
}

export interface PushResult {
  status: "synced" | "failed" | "skipped" | "noop";
  workoutId?: string | null;
  setCount?: number;
  exerciseCount?: number;
  skipped?: string[];
  error?: string;
}

async function loadSessionMeta(admin: AdminClient, sessionId: string): Promise<SessionMeta | null> {
  const { data } = await admin
    .from("workout_sessions")
    .select("id, user_id, session_date, completed_at, title, whoop_workout_id, whoop_sync_status, whoop_synced_hash")
    .eq("id", sessionId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    userId: data.user_id as string,
    sessionDate: data.session_date as string,
    completedAt: (data.completed_at as string) ?? null,
    title: (data.title as string) ?? null,
    whoopWorkoutId: (data.whoop_workout_id as string) ?? null,
    whoopSyncStatus: (data.whoop_sync_status as string) ?? null,
    whoopSyncedHash: (data.whoop_synced_hash as string) ?? null,
  };
}

async function memberEmailFor(admin: AdminClient, userId: string): Promise<string | null> {
  const { data } = await admin
    .from("family_members")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.email as string) ?? null;
}

/** Walk the session's blocks → entries → sets, keeping only eligible, mapped,
 * resistance movements with usable (rep-bearing) sets. */
async function gatherExercises(
  admin: AdminClient,
  sessionId: string,
): Promise<{ exercises: InputExercise[]; skipped: string[] }> {
  const { data: blocks } = await admin
    .from("workout_blocks")
    .select(
      `id, position,
       workout_movement_entries (
         id, position, raw_name,
         movements ( canonical_name, whoop_push_eligible, whoop_exercise_map ( whoop_exercise_id ) ),
         workout_sets ( position, metric_type, actual_reps, actual_load, actual_unit )
       )`,
    )
    .eq("session_id", sessionId)
    .order("position");

  const exercises: InputExercise[] = [];
  const skipped: string[] = [];

  type Row = {
    workout_movement_entries: Array<{
      position: number;
      raw_name: string;
      movements: {
        canonical_name: string;
        whoop_push_eligible: boolean;
        whoop_exercise_map: { whoop_exercise_id: string } | { whoop_exercise_id: string }[] | null;
      } | null;
      workout_sets: Array<{
        position: number;
        metric_type: string;
        actual_reps: number | null;
        actual_load: number | null;
        actual_unit: "lb" | "kg" | null;
      }>;
    }>;
  };

  for (const block of (blocks ?? []) as unknown as Row[]) {
    const entries = [...(block.workout_movement_entries ?? [])].sort((a, b) => a.position - b.position);
    for (const entry of entries) {
      const mv = entry.movements;
      const label = mv?.canonical_name ?? entry.raw_name;
      if (!mv?.whoop_push_eligible) continue; // not resistance — silently skip

      const mapRel = mv.whoop_exercise_map;
      const map = Array.isArray(mapRel) ? mapRel[0] : mapRel;
      if (!map?.whoop_exercise_id) {
        skipped.push(`${label} (no WHOOP exercise mapping)`);
        continue;
      }

      const sets = [...(entry.workout_sets ?? [])]
        .sort((a, b) => a.position - b.position)
        .filter((s) => (s.metric_type === "load_reps" || s.metric_type === "reps") && (s.actual_reps ?? 0) > 0)
        .map((s) => ({
          reps: s.actual_reps as number,
          weightKg: s.metric_type === "load_reps" && s.actual_load ? toKg(s.actual_load, s.actual_unit) : 0,
        }));

      if (sets.length === 0) {
        skipped.push(`${label} (no completed rep-based sets)`);
        continue;
      }
      exercises.push({ exerciseId: map.whoop_exercise_id, label, sets });
    }
  }
  return { exercises, skipped };
}

/** Synthesize the workout's [start,end) window. Anchor to the session's date —
 * the day the training happened — at a mid-day hour, so a historical/backfilled
 * workout lands on its real day. But clamp to never be in the future: a workout
 * scheduled ahead and completed early (or any future date) must file at "now",
 * since WHOOP keys a logged lift to submission time and can't score the future.
 * completed_at refines the time-of-day for a same-day session. Exact minutes
 * don't matter; landing in the right day/cycle does. */
function sessionWindow(meta: SessionMeta): { startMs: number; endMs: number } {
  const now = Date.now();
  const sessionEnd = Date.parse(`${meta.sessionDate}T18:00:00.000Z`);
  const completedEnd = meta.completedAt ? Date.parse(meta.completedAt) : NaN;
  // Prefer the session date; if it's today, the completion time is a nicer anchor.
  let endMs = Number.isFinite(sessionEnd) ? sessionEnd : now;
  if (Number.isFinite(completedEnd) && completedEnd <= now && completedEnd >= endMs) {
    endMs = completedEnd;
  }
  if (endMs > now) endMs = now - 60_000; // never the future
  return { startMs: endMs - 45 * 60 * 1000, endMs };
}

function buildForSession(meta: SessionMeta, exercises: InputExercise[], timezone: string) {
  const { startMs, endMs } = sessionWindow(meta);
  const name = meta.title?.trim() || `Workout ${meta.sessionDate}`;
  return buildLiftBody({ name, startMs, endMs, timezone, exercises });
}

async function writeState(
  admin: AdminClient,
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await admin.from("workout_sessions").update(patch).eq("id", sessionId);
}

/**
 * Build the payload without sending — for safe inspection/verification. Uses a
 * placeholder timezone since no token/connection is needed.
 */
export async function buildSessionDryRun(sessionId: string): Promise<{
  body: LiftBody | null;
  setCount: number;
  exerciseCount: number;
  skipped: string[];
  unknownExercises: string[];
}> {
  const admin = createAdminClient();
  const meta = await loadSessionMeta(admin, sessionId);
  if (!meta) return { body: null, setCount: 0, exerciseCount: 0, skipped: [], unknownExercises: [] };
  const { exercises, skipped } = await gatherExercises(admin, sessionId);
  const built = buildForSession(meta, exercises, "America/Los_Angeles");
  return {
    body: built.body,
    setCount: built.setCount,
    exerciseCount: built.exerciseCount,
    skipped,
    unknownExercises: built.unknownExercises,
  };
}

/**
 * Push (or re-push) a session to WHOOP. Safe to call on any session: returns
 * "skipped" when there's no connection or nothing to push, "noop" when the
 * content is unchanged since the last sync. Persists sync state; never throws.
 */
export async function pushSessionToWhoop(sessionId: string): Promise<PushResult> {
  const admin = createAdminClient();
  const meta = await loadSessionMeta(admin, sessionId);
  if (!meta) return { status: "skipped", error: "Session not found" };

  const memberEmail = await memberEmailFor(admin, meta.userId);
  if (!memberEmail || !(await hasWhoopConnection(memberEmail))) {
    return { status: "skipped" }; // no WHOOP connection — silently do nothing
  }

  try {
    await writeState(admin, sessionId, { whoop_sync_status: "syncing", whoop_sync_error: null });

    const { exercises, skipped } = await gatherExercises(admin, sessionId);
    const conn = await getValidWhoopConnection(memberEmail);
    const built = buildForSession(meta, exercises, conn.identity.timeZone);
    const skipNote = skipped.length ? skipped.join("; ") : null;

    // Nothing WHOOP can use — record a clean synced state without creating a workout.
    if (built.exerciseCount === 0) {
      await writeState(admin, sessionId, {
        whoop_sync_status: "synced",
        whoop_synced_at: new Date().toISOString(),
        whoop_synced_hash: built.hash,
        whoop_sync_error: skipNote,
      });
      return { status: "synced", exerciseCount: 0, setCount: 0, skipped };
    }

    // Interim behavior: every send just CREATES a new standalone Strength Trainer
    // workout. We deliberately don't delete a previously-sent one or try to attach
    // to WHOOP's auto-generated activity (that endpoint isn't reverse-engineered yet,
    // and delete-then-recreate would change the activity's type). Re-sending after
    // edits therefore leaves the old workout in place — accepted for now while we
    // test with live data. The chip only offers a re-send after an edit, so an
    // unchanged workout isn't accidentally duplicated.
    const receipt = await whoopApi<{ id?: string; weightlifting_workout_id?: string }>(
      memberEmail,
      "POST",
      LIFT_PATH,
      built.body,
    );
    const workoutId = receipt.id ?? receipt.weightlifting_workout_id ?? null;

    await writeState(admin, sessionId, {
      whoop_workout_id: workoutId,
      whoop_sync_status: "synced",
      whoop_synced_at: new Date().toISOString(),
      whoop_synced_hash: built.hash,
      whoop_sync_error: skipNote,
    });
    return {
      status: "synced",
      workoutId,
      setCount: built.setCount,
      exerciseCount: built.exerciseCount,
      skipped,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeState(admin, sessionId, { whoop_sync_status: "failed", whoop_sync_error: msg });
    return { status: "failed", error: msg };
  }
}

/** Flip an already-synced session to "dirty" after an edit, so the chip prompts
 * a re-send. No-op if the session was never pushed (the filters match nothing). */
export async function markSessionWhoopDirty(sessionId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("workout_sessions")
    .update({ whoop_sync_status: "dirty" })
    .eq("id", sessionId)
    .not("whoop_workout_id", "is", null)
    .eq("whoop_sync_status", "synced");
}
