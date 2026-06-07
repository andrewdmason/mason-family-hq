// Read model for the movement-library admin view: the global vocabulary grouped
// by family, with each movement's aliases and how many times it's been logged.

import type { SupabaseClient } from "@supabase/supabase-js";
import { MOVEMENT_FAMILIES, type MovementFamily } from "./types";

export const FAMILY_LABELS: Record<MovementFamily, string> = {
  squat: "Squat",
  hinge: "Hinge",
  press: "Press",
  jerk: "Jerk",
  pull: "Pull",
  clean: "Clean",
  snatch: "Snatch",
  lunge: "Lunge",
  carry: "Carry",
  gymnastics: "Gymnastics",
  monostructural: "Cardio",
  core: "Core",
  other: "Other",
};

export type LibraryMovement = {
  id: string;
  name: string;
  slug: string;
  family: MovementFamily;
  isLoaded: boolean;
  aliases: string[];
  usageCount: number;
  lastDate: string | null;
  substitute: { id: string; name: string } | null;
};

export type LibraryFamily = {
  family: MovementFamily;
  label: string;
  movements: LibraryMovement[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function getMovementLibrary(
  supabase: SupabaseClient
): Promise<LibraryFamily[]> {
  const [{ data: movements }, { data: aliases }, { data: entries }, { data: subs }] =
    await Promise.all([
      supabase
        .from("movements")
        .select("id, canonical_name, slug, family, is_loaded")
        .order("canonical_name"),
      supabase.from("movement_aliases").select("movement_id, alias").order("alias"),
      supabase
        .from("workout_movement_entries")
        .select(
          "movement_id, workout_blocks!inner ( workout_sessions!inner ( session_date ) )"
        ),
      supabase
        .from("workout_movement_substitutions")
        .select("movement_id, substitute_movement_id"),
    ]);

  const aliasesByMovement = new Map<string, string[]>();
  for (const a of (aliases ?? []) as any[]) {
    const list = aliasesByMovement.get(a.movement_id) ?? [];
    list.push(a.alias);
    aliasesByMovement.set(a.movement_id, list);
  }

  const usageByMovement = new Map<string, number>();
  const lastByMovement = new Map<string, string>();
  for (const e of (entries ?? []) as any[]) {
    if (!e.movement_id) continue;
    usageByMovement.set(e.movement_id, (usageByMovement.get(e.movement_id) ?? 0) + 1);
    const date = e.workout_blocks?.workout_sessions?.session_date as
      | string
      | undefined;
    if (date) {
      const cur = lastByMovement.get(e.movement_id);
      if (!cur || date > cur) lastByMovement.set(e.movement_id, date);
    }
  }

  const nameById = new Map<string, string>();
  for (const m of (movements ?? []) as any[]) nameById.set(m.id, m.canonical_name);
  const subByMovement = new Map<string, string>();
  for (const s of (subs ?? []) as any[]) {
    subByMovement.set(s.movement_id, s.substitute_movement_id);
  }

  const byFamily = new Map<MovementFamily, LibraryMovement[]>();
  for (const m of (movements ?? []) as any[]) {
    const family = m.family as MovementFamily;
    const list = byFamily.get(family) ?? [];
    const subId = subByMovement.get(m.id);
    list.push({
      id: m.id,
      name: m.canonical_name,
      slug: m.slug,
      family,
      isLoaded: m.is_loaded,
      aliases: aliasesByMovement.get(m.id) ?? [],
      usageCount: usageByMovement.get(m.id) ?? 0,
      lastDate: lastByMovement.get(m.id) ?? null,
      substitute:
        subId && nameById.has(subId)
          ? { id: subId, name: nameById.get(subId)! }
          : null,
    });
    byFamily.set(family, list);
  }

  return MOVEMENT_FAMILIES.filter((f) => (byFamily.get(f)?.length ?? 0) > 0).map(
    (family) => ({
      family,
      label: FAMILY_LABELS[family],
      movements: (byFamily.get(family) ?? []).sort((a, b) =>
        b.usageCount - a.usageCount || a.name.localeCompare(b.name)
      ),
    })
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
