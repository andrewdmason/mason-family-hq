"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  PieceStatus,
  Assignment,
} from "@/lib/types";

function revalidateRepertoire(pieceId?: string) {
  revalidatePath("/practice/repertoire");
  if (pieceId) {
    revalidatePath(`/practice/repertoire/${pieceId}`);
  }
}

// --- Pieces ---

export async function createPiece(formData: FormData) {
  const supabase = await createClient();

  const name = formData.get("name") as string;
  const composer = (formData.get("composer") as string) ?? "";
  const workId = (formData.get("work_id") as string) || null;
  const status = (formData.get("status") as PieceStatus) || "active";
  const notes = (formData.get("notes") as string) || null;

  if (!name) {
    return { error: "Name is required" };
  }

  const { data: newPiece, error } = await supabase.from("pieces").insert({
    name,
    composer,
    work_id: workId,
    status,
    notes,
  }).select("id").single();

  if (error) {
    return { error: error.message };
  }

  revalidateRepertoire();
  return { success: true, pieceId: newPiece.id };
}

export async function updatePiece(id: string, formData: FormData) {
  const supabase = await createClient();

  const name = formData.get("name") as string;
  const composer = (formData.get("composer") as string) ?? "";
  const workId = (formData.get("work_id") as string) || null;
  const status = (formData.get("status") as PieceStatus) || "active";
  const notes = (formData.get("notes") as string) || null;

  if (!name) {
    return { error: "Name is required" };
  }

  const { error } = await supabase
    .from("pieces")
    .update({
      name,
      composer: composer.trim(),
      work_id: workId,
      status,
      notes,
    })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidateRepertoire(id);
  return { success: true };
}

export async function deletePiece(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from("pieces").delete().eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidateRepertoire();
  return { success: true };
}

export async function updatePieceStatus(
  id: string,
  status: PieceStatus,
) {
  const supabase = await createClient();

  const { error } = await supabase.from("pieces").update({ status }).eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidateRepertoire(id);
  return { success: true };
}

/**
 * Put a piece into the keep-it-warm rotation, or take it out. Independent of
 * status — a maintenance piece is still active and still shows up everywhere
 * active pieces do. Also revalidates the log, whose layout carries the flag
 * out to the rotation button.
 */
export async function updatePieceMaintenance(
  id: string,
  maintenance: boolean,
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("pieces")
    .update({ maintenance })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidateRepertoire(id);
  revalidatePath("/practice");
  return { success: true };
}

export async function updatePieceField(
  id: string,
  field: "name" | "composer" | "work_id",
  value: string | null
) {
  if (field === "name" && (!value || !value.trim())) {
    return { error: "Name is required" };
  }

  const supabase = await createClient();

  const dbValue =
    field === "name" ? value!.trim()
    : field === "composer" ? (value?.trim() ?? "")
    : (value?.trim() || null);

  const update: Record<string, string | null> = {
    [field]: dbValue,
  };

  const { error } = await supabase
    .from("pieces")
    .update(update)
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidateRepertoire(id);
  return { success: true };
}

export async function updatePieceNotes(id: string, notes: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("pieces")
    .update({ notes: notes || null })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidateRepertoire(id);
  return { success: true };
}

export async function updatePieceDetails(
  id: string,
  data: { name: string; composer: string | null; notes: string | null }
) {
  const supabase = await createClient();

  if (!data.name.trim()) {
    return { error: "Name is required" };
  }

  const { error } = await supabase
    .from("pieces")
    .update({
      name: data.name.trim(),
      composer: data.composer?.trim() || null,
      notes: data.notes?.trim() || null,
    })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidateRepertoire(id);
  return { success: true };
}

// --- Works ---

export async function createWork(formData: FormData) {
  const supabase = await createClient();

  const name = formData.get("name") as string;
  const composer = (formData.get("composer") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  if (!name) {
    return { error: "Name is required" };
  }

  const { data, error } = await supabase
    .from("works")
    .insert({ name, composer, notes })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidateRepertoire();
  return { success: true, workId: data.id as string };
}

export async function updateWork(id: string, formData: FormData) {
  const supabase = await createClient();

  const name = formData.get("name") as string;
  const composer = (formData.get("composer") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  if (!name) {
    return { error: "Name is required" };
  }

  const { error } = await supabase
    .from("works")
    .update({ name, composer, notes })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidateRepertoire();
  return { success: true };
}

export async function deleteWork(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from("works").delete().eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidateRepertoire();
  return { success: true };
}

// --- Work detail ---

export async function getWorkFocusData(
  workId: string
): Promise<{ assignments: Assignment[] }> {
  const supabase = await createClient();

  const { data: pieces } = await supabase
    .from("pieces")
    .select("id")
    .eq("work_id", workId);

  const pieceIds = (pieces ?? []).map((p) => p.id);
  if (pieceIds.length === 0) {
    return { assignments: [] };
  }

  const { data: assignments } = await supabase
    .from("assignments")
    .select("*")
    .in("piece_id", pieceIds)
    .eq("completed", false)
    .order("created_at", { ascending: false });

  return {
    assignments: (assignments ?? []) as Assignment[],
  };
}
