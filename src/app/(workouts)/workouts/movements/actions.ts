"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner, requireUserId } from "@/lib/members/auth";
import {
  normalizeName,
  loadMovementVocabulary,
  createMovementResolver,
} from "@/lib/workouts/canonicalize";
import { recommendSubstitute } from "@/lib/workouts/substitute";
import { MOVEMENT_FAMILIES, type MovementFamily } from "@/lib/workouts/types";

// The movement library is global (authenticated-read, service-role-write) and
// shared, so curating it is owner-only and goes through the admin client.

async function authorize() {
  const supabase = await createClient();
  await requireOwner(supabase);
  return createAdminClient();
}

function revalidateLibrary() {
  revalidatePath("/workouts/movements");
  revalidatePath("/workouts");
  revalidatePath("/workouts/prs");
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Learn `name` as an alias of `movementId` (idempotent). */
async function learnAlias(admin: any, movementId: string, name: string) {
  const norm = normalizeName(name);
  if (!norm) return;
  await admin
    .from("movement_aliases")
    .upsert(
      { movement_id: movementId, alias: name, alias_norm: norm },
      { onConflict: "alias_norm", ignoreDuplicates: true }
    );
}

/** Rename a movement; the old name becomes an alias so old text still resolves. */
export async function renameMovement(
  movementId: string,
  name: string
): Promise<void> {
  const admin = await authorize();
  const trimmed = name.trim();
  if (!trimmed) return;

  const { data: current } = await admin
    .from("movements")
    .select("canonical_name")
    .eq("id", movementId)
    .maybeSingle();
  if (!current || current.canonical_name === trimmed) return;

  await learnAlias(admin, movementId, current.canonical_name);
  const { error } = await admin
    .from("movements")
    .update({ canonical_name: trimmed })
    .eq("id", movementId);
  if (error) {
    throw new Error(
      error.code === "23505"
        ? `A movement named "${trimmed}" already exists.`
        : error.message
    );
  }
  revalidateLibrary();
}

export async function setMovementFamily(
  movementId: string,
  family: MovementFamily
): Promise<void> {
  const admin = await authorize();
  if (!MOVEMENT_FAMILIES.includes(family)) return;
  await admin.from("movements").update({ family }).eq("id", movementId);
  revalidateLibrary();
}

export async function setMovementLoaded(
  movementId: string,
  isLoaded: boolean
): Promise<void> {
  const admin = await authorize();
  await admin.from("movements").update({ is_loaded: isLoaded }).eq("id", movementId);
  revalidateLibrary();
}

// ---------- Per-user preferred substitutes ----------
// These are personal preferences (not shared curation), so they write per-user
// rows via the RLS-scoped client rather than the admin client.

/** Set (or change) the preferred substitute for a movement. */
export async function setSubstitute(
  movementId: string,
  substituteMovementId: string
): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  if (movementId === substituteMovementId) return;
  await supabase.from("workout_movement_substitutions").upsert(
    {
      user_id: userId,
      movement_id: movementId,
      substitute_movement_id: substituteMovementId,
    },
    { onConflict: "user_id,movement_id" }
  );
  revalidateLibrary();
}

export async function clearSubstitute(movementId: string): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  await supabase
    .from("workout_movement_substitutions")
    .delete()
    .eq("user_id", userId)
    .eq("movement_id", movementId);
  revalidateLibrary();
}

export type GenerateSubstituteResult =
  | { ok: true; name: string; rationale: string }
  | { ok: false; error: string };

/**
 * Ask the AI to recommend a substitute, add it to the library if it's new, and
 * set it as the preferred substitute for `movementId`.
 */
export async function generateSubstitute(
  movementId: string,
  reason?: string
): Promise<GenerateSubstituteResult> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: mv } = await supabase
    .from("movements")
    .select("canonical_name, family")
    .eq("id", movementId)
    .maybeSingle();
  if (!mv) return { ok: false, error: "Movement not found." };

  const vocabulary = await loadMovementVocabulary(supabase);
  const rec = await recommendSubstitute({
    movementName: mv.canonical_name as string,
    family: mv.family as MovementFamily,
    reason: reason?.trim() || undefined,
    vocabulary,
  });
  if (!rec) return { ok: false, error: "Couldn't generate a recommendation." };

  // Add to the library if new (and apply the AI's e1RM eligibility for new ones).
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("movements")
    .select("id")
    .eq("canonical_name", rec.canonicalName)
    .maybeSingle();
  const resolver = await createMovementResolver(admin);
  const resolved = await resolver.resolve(
    rec.canonicalName,
    rec.canonicalName,
    rec.family
  );
  if (resolved.movementId === movementId) {
    return { ok: false, error: "The AI suggested the same movement; try a hint." };
  }
  if (!existing) {
    await admin
      .from("movements")
      .update({ is_loaded: rec.isLoaded })
      .eq("id", resolved.movementId);
  }

  await supabase.from("workout_movement_substitutions").upsert(
    {
      user_id: userId,
      movement_id: movementId,
      substitute_movement_id: resolved.movementId,
    },
    { onConflict: "user_id,movement_id" }
  );
  revalidateLibrary();
  return { ok: true, name: rec.canonicalName, rationale: rec.rationale };
}

/** Remove a learned alias (alias_norm is globally unique, so this targets one). */
export async function deleteAlias(alias: string): Promise<void> {
  const admin = await authorize();
  const norm = normalizeName(alias);
  if (!norm) return;
  await admin.from("movement_aliases").delete().eq("alias_norm", norm);
  revalidateLibrary();
}

/**
 * Merge `removeId` into `keepId`: repoint every logged entry and alias to the
 * kept movement, fold the removed name in as an alias, then delete the removed
 * movement. History (e1RM/PRs) recomputes from entries, so it merges too.
 */
export async function mergeMovements(
  keepId: string,
  removeId: string
): Promise<void> {
  const admin = await authorize();
  if (keepId === removeId) return;

  const { data: remove } = await admin
    .from("movements")
    .select("canonical_name, slug")
    .eq("id", removeId)
    .maybeSingle();
  if (!remove) return;

  // Move aliases, dropping any whose normalized form already exists on keep
  // (the unique alias_norm constraint would otherwise reject the repoint).
  const { data: keepAliases } = await admin
    .from("movement_aliases")
    .select("alias_norm")
    .eq("movement_id", keepId);
  const keepNorms = new Set((keepAliases ?? []).map((a: any) => a.alias_norm));
  const { data: removeAliases } = await admin
    .from("movement_aliases")
    .select("id, alias_norm")
    .eq("movement_id", removeId);
  const collide = (removeAliases ?? [])
    .filter((a: any) => keepNorms.has(a.alias_norm))
    .map((a: any) => a.id);
  if (collide.length) {
    await admin.from("movement_aliases").delete().in("id", collide);
  }
  await admin
    .from("movement_aliases")
    .update({ movement_id: keepId })
    .eq("movement_id", removeId);

  // The removed movement's own name should resolve to keep going forward.
  await learnAlias(admin, keepId, remove.canonical_name);

  // Repoint logged entries, drop the removed movement's seed ratios, delete it.
  await admin
    .from("workout_movement_entries")
    .update({ movement_id: keepId })
    .eq("movement_id", removeId);
  // Two deletes rather than .or(): supabase-js .or() on a mutation throws a
  // misleading 42703.
  await admin.from("movement_family_ratios").delete().eq("from_movement", removeId);
  await admin.from("movement_family_ratios").delete().eq("to_movement", removeId);
  await admin.from("movements").delete().eq("id", removeId);

  revalidateLibrary();
}
/* eslint-enable @typescript-eslint/no-explicit-any */
