"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  Assignment,
  PieceKind,
} from "@/lib/types";

export async function getAssignmentsForPiece(pieceId: string): Promise<{
  openAssignments: Assignment[];
  completedAssignments: Assignment[];
}> {
  const supabase = await createClient();

  const [openResult, completedResult] = await Promise.all([
    supabase
      .from("assignments")
      .select("*")
      .eq("piece_id", pieceId)
      .eq("completed", false)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("assignments")
      .select("*")
      .eq("piece_id", pieceId)
      .eq("completed", true)
      .order("completed_at", { ascending: false }),
  ]);

  return {
    openAssignments: (openResult.data ?? []) as Assignment[],
    completedAssignments: (completedResult.data ?? []) as Assignment[],
  };
}

export async function toggleAssignmentCompleted(assignmentId: string, completed: boolean) {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("assignments")
    .update({
      completed,
      completed_at: completed ? now : null,
      updated_at: now,
    })
    .eq("id", assignmentId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/practice");
}

export async function createAssignment(
  pieceId: string,
  text: string,
  metronomeSpeed: number | null = null
): Promise<Assignment> {
  const supabase = await createClient();

  const { data: maxRow } = await supabase
    .from("assignments")
    .select("sort_order")
    .eq("piece_id", pieceId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSort = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("assignments")
    .insert({ piece_id: pieceId, text, sort_order: nextSort, metronome_speed: metronomeSpeed })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/practice");
  return data as Assignment;
}

export async function reorderAssignments(assignmentIds: string[]) {
  const supabase = await createClient();

  const updates = assignmentIds.map((id, index) =>
    supabase.from("assignments").update({ sort_order: index }).eq("id", id)
  );

  await Promise.all(updates);
  revalidatePath("/practice");
}

export async function deleteAssignment(assignmentId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("assignments")
    .delete()
    .eq("id", assignmentId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/practice");
}

export async function updateAssignmentText(assignmentId: string, text: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("assignments")
    .update({ text, updated_at: new Date().toISOString() })
    .eq("id", assignmentId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/practice");
}

export async function updateAssignmentMetronome(
  assignmentId: string,
  metronomeSpeed: number | null
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("assignments")
    .update({ metronome_speed: metronomeSpeed, updated_at: new Date().toISOString() })
    .eq("id", assignmentId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/practice");
}

export async function createTaskFromAssignment(
  pieceId: string,
  text: string,
  metronomeSpeed: number | null,
  date: string
): Promise<string> {
  const supabase = await createClient();

  const { data: maxRow } = await supabase
    .from("practice_tasks")
    .select("sort_order")
    .eq("piece_id", pieceId)
    .eq("date", date)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("practice_tasks")
    .insert({
      piece_id: pieceId,
      text,
      metronome_speed: metronomeSpeed,
      date,
      sort_order: nextOrder,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create task from assignment");
  }

  revalidatePath("/practice");
  return data.id;
}

export type AssignmentWithPiece = Assignment & {
  piece_name: string;
  piece_composer: string | null;
  kind: PieceKind;
};

export async function getAllOpenAssignments(): Promise<AssignmentWithPiece[]> {
  const supabase = await createClient();

  const { data: assignments } = await supabase
    .from("assignments")
    .select("*, pieces(name, composer, kind)")
    .eq("completed", false)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (!assignments) return [];

  return assignments.map((t) => {
    const piece = t.pieces as unknown as { name: string; composer: string | null; kind: PieceKind };
    return {
      id: t.id,
      piece_id: t.piece_id,
      text: t.text,
      completed: t.completed,
      completed_at: t.completed_at,
      sort_order: t.sort_order,
      metronome_speed: t.metronome_speed,
      created_at: t.created_at,
      updated_at: t.updated_at,
      piece_name: piece.name,
      piece_composer: piece.composer,
      kind: piece.kind,
    } as AssignmentWithPiece;
  });
}
