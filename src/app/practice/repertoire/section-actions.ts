"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  PieceSection,
  PieceSectionWithChildren,
  SectionStatus,
  SectionStatusSnapshot,
  StatusChange,
} from "@/lib/types";

function revalidate(pieceId?: string) {
  revalidatePath("/practice");
  revalidatePath("/practice/repertoire");
  if (pieceId) {
    revalidatePath(`/practice/repertoire/${pieceId}`);
  }
}

export async function getSections(
  pieceId: string
): Promise<PieceSectionWithChildren[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("piece_sections")
    .select("*")
    .eq("piece_id", pieceId)
    .order("sort_order", { ascending: true });

  const rows = (data ?? []) as PieceSection[];

  // Nest children under parents
  const parents = rows
    .filter((r) => r.parent_id === null)
    .map((p) => ({
      ...p,
      children: rows
        .filter((c) => c.parent_id === p.id)
        .sort((a, b) => a.sort_order - b.sort_order),
    }));

  return parents;
}

export async function createSection(
  pieceId: string,
  label: string,
  parentId: string | null = null
) {
  const supabase = await createClient();

  // Get next sort_order among siblings
  let query = supabase
    .from("piece_sections")
    .select("sort_order")
    .eq("piece_id", pieceId)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (parentId) {
    query = query.eq("parent_id", parentId);
  } else {
    query = query.is("parent_id", null);
  }

  const { data: maxRow } = await query.single();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("piece_sections")
    .insert({
      piece_id: pieceId,
      parent_id: parentId,
      label,
      sort_order: nextOrder,
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidate(pieceId);
  return { success: true, id: data.id };
}

export async function updateSectionStatus(
  sectionId: string,
  status: SectionStatus,
  options?: { pieceId?: string; skipSnapshot?: boolean }
) {
  const supabase = await createClient();

  // Fetch current status and piece_id
  const { data: current } = await supabase
    .from("piece_sections")
    .select("status, piece_id")
    .eq("id", sectionId)
    .single();

  if (!current) return { error: "Section not found" };

  const pieceId = options?.pieceId ?? current.piece_id;
  const oldStatus = current.status as SectionStatus;

  const { error } = await supabase
    .from("piece_sections")
    .update({ status })
    .eq("id", sectionId);

  if (error) {
    return { error: error.message };
  }

  // Log snapshot if status actually changed
  if (oldStatus !== status && !options?.skipSnapshot) {
    await supabase.from("section_status_snapshots").insert({
      piece_id: pieceId,
      section_id: sectionId,
      old_status: oldStatus,
      new_status: status,
    });
  }

  revalidate(pieceId);
  return { success: true };
}

export async function updateSectionTargetTempo(
  sectionId: string,
  targetTempo: number | null
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("piece_sections")
    .update({ target_tempo: targetTempo })
    .eq("id", sectionId)
    .select("piece_id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidate(data.piece_id);
  return { success: true };
}

export async function updateSectionLabel(sectionId: string, label: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("piece_sections")
    .update({ label })
    .eq("id", sectionId)
    .select("piece_id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidate(data.piece_id);
  return { success: true };
}

export async function updateSectionName(
  sectionId: string,
  name: string | null
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("piece_sections")
    .update({ name })
    .eq("id", sectionId)
    .select("piece_id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidate(data.piece_id);
  return { success: true };
}

/** Set, move, or clear a section's measure marker for the Measure view.
 *  Pass null to clear. Snapping to an integer barline happens client-side. */
export async function updateSectionStartMeasure(
  sectionId: string,
  startMeasure: number | null
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("piece_sections")
    .update({ start_measure: startMeasure })
    .eq("id", sectionId)
    .select("piece_id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidate(data.piece_id);
  return { success: true };
}

export async function updateSectionNotes(
  sectionId: string,
  notes: string | null
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("piece_sections")
    .update({ notes })
    .eq("id", sectionId)
    .select("piece_id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidate(data.piece_id);
  return { success: true };
}

export async function deleteSection(sectionId: string) {
  const supabase = await createClient();

  // Get piece_id before deleting
  const { data: section } = await supabase
    .from("piece_sections")
    .select("piece_id")
    .eq("id", sectionId)
    .single();

  const { error } = await supabase
    .from("piece_sections")
    .delete()
    .eq("id", sectionId);

  if (error) {
    return { error: error.message };
  }

  revalidate(section?.piece_id);
  return { success: true };
}

export async function reorderSections(sectionIds: string[]) {
  const supabase = await createClient();

  const updates = sectionIds.map((id, index) =>
    supabase.from("piece_sections").update({ sort_order: index }).eq("id", id)
  );

  const results = await Promise.all(updates);
  const error = results.find((r) => r.error)?.error;

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/practice");
  return { success: true };
}

export async function updatePieceTargetTempo(
  pieceId: string,
  targetTempo: number | null
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("pieces")
    .update({ target_tempo: targetTempo })
    .eq("id", pieceId);

  if (error) {
    return { error: error.message };
  }

  revalidate(pieceId);
  return { success: true };
}

/** Get status changes for specific dates, grouped by date. */
export async function getStatusChangesForDates(
  pieceId: string,
  dates: string[]
): Promise<Record<string, StatusChange[]>> {
  if (dates.length === 0) return {};

  const supabase = await createClient();

  const { data } = await supabase
    .from("section_status_snapshots")
    .select("section_id, old_status, new_status, snapshot_date")
    .eq("piece_id", pieceId)
    .in("snapshot_date", dates)
    .order("created_at", { ascending: true });

  if (!data || data.length === 0) return {};

  // Get section labels for the sections that changed
  const sectionIds = [...new Set(data.map((d) => d.section_id))];
  const { data: sections } = await supabase
    .from("piece_sections")
    .select("id, label")
    .in("id", sectionIds);

  const labelMap = new Map(
    (sections ?? []).map((s) => [s.id, s.label])
  );

  // Group by date, then collapse to net change per section per day
  const result: Record<string, StatusChange[]> = {};

  for (const row of data) {
    const date = row.snapshot_date;
    if (!result[date]) result[date] = [];

    const existing = result[date].find(
      (c) => c.sectionLabel === labelMap.get(row.section_id)
    );
    if (existing) {
      // Update the newStatus to the latest
      existing.newStatus = row.new_status as SectionStatus;
    } else {
      result[date].push({
        sectionLabel: labelMap.get(row.section_id) ?? "?",
        oldStatus: row.old_status as SectionStatus,
        newStatus: row.new_status as SectionStatus,
      });
    }
  }

  // Filter out entries where net change is zero
  for (const date of Object.keys(result)) {
    result[date] = result[date].filter((c) => c.oldStatus !== c.newStatus);
    if (result[date].length === 0) delete result[date];
  }

  return result;
}

/** Get all snapshots for a piece. Used by ProgressGrid. */
export async function getProgressSnapshots(
  pieceId: string
): Promise<SectionStatusSnapshot[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("section_status_snapshots")
    .select("*")
    .eq("piece_id", pieceId)
    .order("snapshot_date", { ascending: true })
    .order("created_at", { ascending: true });

  return (data ?? []) as SectionStatusSnapshot[];
}
