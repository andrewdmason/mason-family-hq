"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/members/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canvasClient, CanvasAuthError, type CanvasUser } from "@/lib/canvas/canvas-api";
import { syncCanvasForStudent } from "@/lib/canvas/sync";
import { CANVAS_BASE_URL } from "@/lib/canvas/connections";
import { restoreMemory, rewriteMemory } from "@/lib/tuttles/memory";

export type CanvasActionResult = { ok: boolean; error?: string; assignments?: number };

/** The caller, if they're a parent. Kids never see /tuttles (middleware), but actions are callable directly. */
async function parentId(): Promise<string | null> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const { data } = await supabase.from("family_members").select("role").eq("user_id", userId).maybeSingle();
  return data?.role === "owner" || data?.role === "parent" ? userId : null;
}

async function isKid(studentId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("family_members")
    .select("role")
    .eq("user_id", studentId)
    .maybeSingle();
  return data?.role === "kid";
}

/**
 * Store a student's Canvas key, after checking Canvas accepts it, and pull
 * their coursework straight away. Replacing a key resets the renewal reminder.
 */
export async function connectCanvas(studentId: string, rawToken: string, expiresOn: string): Promise<CanvasActionResult> {
  const me = await parentId();
  if (!me) return { ok: false, error: "Only a parent can connect Canvas." };
  if (!(await isKid(studentId))) return { ok: false, error: "That isn't one of the kids." };
  const token = rawToken.replace(/\s+/g, "");
  if (!/^\d+~[A-Za-z0-9]+$/.test(token)) {
    return { ok: false, error: "That doesn't look like a Canvas key (it's a number, a ~, then letters and digits)." };
  }
  const expires = /^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ? new Date(`${expiresOn}T23:59:00-08:00`) : null;

  let who: CanvasUser | null;
  try {
    who = await canvasClient(CANVAS_BASE_URL, token).get<CanvasUser>("/users/self");
  } catch (err) {
    return { ok: false, error: err instanceof CanvasAuthError ? "Canvas didn't accept that key." : "Couldn't reach Canvas." };
  }
  if (!who) return { ok: false, error: "Canvas didn't accept that key." };

  const db = createAdminClient();
  const { error } = await db.from("canvas_connections").upsert({
    student_id: studentId,
    base_url: CANVAS_BASE_URL,
    token,
    token_expires_at: expires?.toISOString() ?? null,
    canvas_user_id: who.id,
    canvas_name: who.name,
    connected_by: me,
    connected_at: new Date().toISOString(),
    last_error: null,
    reminded_at: null,
  });
  if (error) return { ok: false, error: error.message };

  const result = await syncCanvasForStudent(db, studentId);
  revalidatePath("/tuttles");
  return result.ok ? { ok: true, assignments: result.assignments } : { ok: false, error: result.error };
}

export async function syncCanvasNow(studentId: string): Promise<CanvasActionResult> {
  if (!(await parentId())) return { ok: false, error: "Only a parent can do that." };
  const result = await syncCanvasForStudent(createAdminClient(), studentId);
  revalidatePath("/tuttles");
  return result.ok ? { ok: true, assignments: result.assignments } : { ok: false, error: result.error };
}

// --- Memory (src/lib/tuttles/memory.ts) -----------------------------------------

export type MemoryActionResult = { ok: boolean; error?: string; message?: string };

/** A note the tutor always sees and the nightly rewrite never touches. */
export async function addParentNote(studentId: string, body: string): Promise<MemoryActionResult> {
  const me = await parentId();
  if (!me) return { ok: false, error: "Only a parent can do that." };
  const text = body.trim().slice(0, 1000);
  if (!text) return { ok: false, error: "Write the note first." };
  if (!(await isKid(studentId))) return { ok: false, error: "That isn't one of the kids." };
  const { error } = await createAdminClient()
    .from("tutor_parent_notes")
    .insert({ student_id: studentId, body: text, created_by: me });
  revalidatePath(`/tuttles/memory/${studentId}`);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteParentNote(studentId: string, noteId: string): Promise<MemoryActionResult> {
  if (!(await parentId())) return { ok: false, error: "Only a parent can do that." };
  const { error } = await createAdminClient()
    .from("tutor_parent_notes")
    .delete()
    .eq("id", noteId)
    .eq("student_id", studentId);
  revalidatePath(`/tuttles/memory/${studentId}`);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Undo: an earlier version becomes the newest. */
export async function restoreMemoryVersion(studentId: string, version: number): Promise<MemoryActionResult> {
  const me = await parentId();
  if (!me) return { ok: false, error: "Only a parent can do that." };
  try {
    await restoreMemory(createAdminClient(), studentId, version, me);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't restore." };
  }
  revalidatePath(`/tuttles/memory/${studentId}`);
  return { ok: true };
}

/** The nightly rewrite, now, over the last two weeks of chats. */
export async function rewriteMemoryNow(studentId: string): Promise<MemoryActionResult> {
  if (!(await parentId())) return { ok: false, error: "Only a parent can do that." };
  try {
    const r = await rewriteMemory(createAdminClient(), studentId, { force: true });
    revalidatePath(`/tuttles/memory/${studentId}`);
    return {
      ok: true,
      message:
        r.status === "no-chats"
          ? "No chats in the last two weeks to learn from."
          : r.status === "unchanged"
            ? "Nothing changed."
            : r.changes,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Rewrite failed." };
  }
}
