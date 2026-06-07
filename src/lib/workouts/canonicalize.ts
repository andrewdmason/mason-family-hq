// Resolve parsed movement names to canonical movement ids, growing the global
// library when a name is genuinely new. Reads are cheap (one fetch of movements +
// aliases, cached in memory); writes go through the service-role admin client,
// since the library tables are authenticated-read with no user write policy.
//
// Resolution order for each movement:
//   1. alias_norm exact hit  → that movement (fast path; covers learned spellings)
//   2. canonical_name match  → that movement, and learn the raw spelling as an alias
//   3. neither               → create the movement (+ aliases) using the parser's
//                              proposed name and family
//
// So the second time the same wording is parsed, it resolves via the alias path
// with no new row — the self-growing vocabulary the plan calls for.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MOVEMENT_FAMILIES,
  type MovementFamily,
  type MovementVocabularyEntry,
} from "./types";

// Families whose movements default to loaded (e1RM-eligible) when newly created.
const LOADED_FAMILIES = new Set<MovementFamily>([
  "squat", "hinge", "press", "jerk", "clean", "snatch",
]);

export type ResolvedMovement = { movementId: string; isLoaded: boolean };

/** The lookup key: lower-cased, non-alphanumerics stripped. Mirrors the seed. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when a string reads like a prescription phrase, not a movement name. */
function looksLikePhrase(name: string): boolean {
  const t = name.trim();
  return t.length > 28 || t.includes("%") || t.split(/\s+/).length > 4;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "movement";
}

function familyOf(value: string): MovementFamily {
  return (MOVEMENT_FAMILIES as string[]).includes(value)
    ? (value as MovementFamily)
    : "other";
}

/** The canonical movement list handed to the parser as its vocabulary. */
export async function loadMovementVocabulary(
  client: SupabaseClient
): Promise<MovementVocabularyEntry[]> {
  const { data, error } = await client
    .from("movements")
    .select("canonical_name, family")
    .order("canonical_name");
  if (error) throw new Error(`loadMovementVocabulary: ${error.message}`);
  return (data ?? []).map((m) => ({
    canonicalName: m.canonical_name as string,
    family: familyOf(m.family as string),
  }));
}

type MovementRow = {
  id: string;
  slug: string;
  canonical_name: string;
  is_loaded: boolean;
};

/**
 * Build a resolver over the current library. `admin` must be a service-role
 * client so new movements/aliases can be written. Call `resolve` per parsed
 * movement; new rows are created on demand and cached for the rest of the batch.
 */
export async function createMovementResolver(admin: SupabaseClient) {
  const [{ data: movements, error: mErr }, { data: aliases, error: aErr }] =
    await Promise.all([
      admin.from("movements").select("id, slug, canonical_name, is_loaded"),
      admin.from("movement_aliases").select("alias_norm, movement_id"),
    ]);
  if (mErr) throw new Error(`createMovementResolver movements: ${mErr.message}`);
  if (aErr) throw new Error(`createMovementResolver aliases: ${aErr.message}`);

  const byId = new Map<string, MovementRow>();
  const byCanonNorm = new Map<string, string>();
  const bySlug = new Set<string>();
  for (const m of (movements ?? []) as MovementRow[]) {
    byId.set(m.id, m);
    byCanonNorm.set(normalizeName(m.canonical_name), m.id);
    bySlug.add(m.slug);
  }
  const aliasToId = new Map<string, string>();
  for (const a of (aliases ?? []) as { alias_norm: string; movement_id: string }[]) {
    aliasToId.set(a.alias_norm, a.movement_id);
  }

  async function learnAlias(rawName: string, movementId: string): Promise<void> {
    // Only learn things that read like a movement name — not whole prescription
    // phrases ("3x5 back squat at 80%", "Build to a heavy single back squat"),
    // which otherwise pollute the alias list and never match again anyway.
    if (looksLikePhrase(rawName)) return;
    const norm = normalizeName(rawName);
    if (!norm || aliasToId.has(norm)) return;
    // ignoreDuplicates: another concurrent parse may have just learned it.
    const { error } = await admin
      .from("movement_aliases")
      .upsert(
        { movement_id: movementId, alias: rawName, alias_norm: norm },
        { onConflict: "alias_norm", ignoreDuplicates: true }
      );
    if (!error) aliasToId.set(norm, movementId);
  }

  function uniqueSlug(base: string): string {
    let slug = base;
    let n = 2;
    while (bySlug.has(slug)) slug = `${base}-${n++}`;
    return slug;
  }

  async function resolve(
    rawName: string,
    canonicalName: string,
    family: MovementFamily
  ): Promise<ResolvedMovement> {
    // 1. Known alias / spelling.
    const rawNorm = normalizeName(rawName);
    const aliasHit = aliasToId.get(rawNorm) ?? aliasToId.get(normalizeName(canonicalName));
    if (aliasHit) {
      const m = byId.get(aliasHit);
      return { movementId: aliasHit, isLoaded: m?.is_loaded ?? false };
    }

    // 2. Matches an existing canonical movement → learn this spelling.
    const canonHit = byCanonNorm.get(normalizeName(canonicalName));
    if (canonHit) {
      await learnAlias(rawName, canonHit);
      const m = byId.get(canonHit);
      return { movementId: canonHit, isLoaded: m?.is_loaded ?? false };
    }

    // 3. Genuinely new → create it, then learn both spellings.
    const isLoaded = LOADED_FAMILIES.has(family);
    const slug = uniqueSlug(slugify(canonicalName));
    const { data, error } = await admin
      .from("movements")
      .insert({ canonical_name: canonicalName, slug, family, is_loaded: isLoaded })
      .select("id, slug, canonical_name, is_loaded")
      .single();
    if (error || !data) {
      // Lost a race (unique canonical_name): re-read and use the existing row.
      const { data: existing } = await admin
        .from("movements")
        .select("id, slug, canonical_name, is_loaded")
        .eq("canonical_name", canonicalName)
        .maybeSingle();
      if (existing) {
        const row = existing as MovementRow;
        byId.set(row.id, row);
        byCanonNorm.set(normalizeName(row.canonical_name), row.id);
        await learnAlias(rawName, row.id);
        return { movementId: row.id, isLoaded: row.is_loaded };
      }
      throw new Error(
        `createMovementResolver insert "${canonicalName}": ${error?.message ?? "unknown"}`
      );
    }

    const row = data as MovementRow;
    byId.set(row.id, row);
    byCanonNorm.set(normalizeName(row.canonical_name), row.id);
    bySlug.add(row.slug);
    await learnAlias(rawName, row.id);
    await learnAlias(canonicalName, row.id);
    return { movementId: row.id, isLoaded: row.is_loaded };
  }

  return { resolve };
}
