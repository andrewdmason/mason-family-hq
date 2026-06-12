"use server";

import { createClient } from "@/lib/supabase/server";
import { playerFromRow, type Bats, type SwingPlayer } from "@/lib/swing/types";

/**
 * Roster mutations for the Swing Coach app. RLS is household-wide ("Family
 * access"), so these don't need ownership filters.
 *
 * Like the todos actions, these deliberately do NOT revalidatePath: the
 * roster shell reconciles client-side with router.refresh() after each
 * mutation, and the swing pages are force-dynamic — revalidation here would
 * only bolt a second full re-render onto every mutation's POST.
 *
 * Players are never hard-deleted: archiving stamps archived_at so the
 * player's sessions, assessments, and focus-area history stay queryable
 * (and restorable) forever.
 */

const BIRTH_YEAR_MIN = 1990;
const BIRTH_YEAR_MAX = 2030;

function validatePlayerInput(input: {
  name: string;
  birthYear: number;
  bats: Bats;
  notes?: string | null;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("Player name is required");
  if (
    !Number.isInteger(input.birthYear) ||
    input.birthYear < BIRTH_YEAR_MIN ||
    input.birthYear > BIRTH_YEAR_MAX
  ) {
    throw new Error(
      `Birth year must be between ${BIRTH_YEAR_MIN} and ${BIRTH_YEAR_MAX}`
    );
  }
  if (input.bats !== "L" && input.bats !== "R") {
    throw new Error("Bats must be L or R");
  }
  return {
    name,
    birth_year: input.birthYear,
    bats: input.bats,
    notes: input.notes?.trim() || null,
  };
}

export async function createPlayer(input: {
  name: string;
  birthYear: number;
  bats: Bats;
  notes?: string | null;
}): Promise<SwingPlayer> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("swing_players")
    .insert(validatePlayerInput(input))
    .select("*")
    .single();
  if (error) throw new Error(`Couldn't add player: ${error.message}`);
  return playerFromRow(data);
}

export async function updatePlayer(
  playerId: string,
  input: {
    name: string;
    birthYear: number;
    bats: Bats;
    notes?: string | null;
  }
): Promise<SwingPlayer> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("swing_players")
    .update(validatePlayerInput(input))
    .eq("id", playerId)
    .select("*")
    .single();
  if (error) throw new Error(`Couldn't save player: ${error.message}`);
  return playerFromRow(data);
}

/** Soft delete: the player leaves the roster but all history is retained. */
export async function archivePlayer(playerId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("swing_players")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", playerId);
  if (error) throw new Error(`Couldn't archive player: ${error.message}`);
}
