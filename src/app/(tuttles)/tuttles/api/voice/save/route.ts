import { after, NextResponse } from "next/server";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { nameThread } from "@/lib/tuttles/naming";
import { VOICE_MODEL } from "@/lib/tuttles/voice";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Turn = { role: "student" | "tutor"; text: string; images?: string[]; visuals?: string[] };

/**
 * Saves a voice call into its chat, once it ends (src/lib/tuttles/voice.ts).
 *
 *   POST { threadId, assignmentId?, turns: [{role, text, images?, visuals?}] }
 *   Authorization: Bearer <supabase access token>
 *
 * The phone has the transcript (the call ran between it and OpenAI). Each turn
 * becomes a message; the pictures the tutor showed go into its message as
 * ```visual blocks, so the chat reads like any other. A call into a new chat
 * creates it, filed like a typed one.
 */
export async function POST(request: Request) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, userId, student } = caller;

  let body: { threadId?: unknown; assignmentId?: unknown; turns?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const threadId = typeof body.threadId === "string" ? body.threadId.toLowerCase() : "";
  if (!UUID.test(threadId)) return NextResponse.json({ error: "bad threadId" }, { status: 400 });
  const folder = `${userId}/${threadId}/`;
  const raw = Array.isArray(body.turns) ? (body.turns as Turn[]) : [];
  const turns = raw
    .filter((t) => t && (t.role === "student" || t.role === "tutor") && typeof t.text === "string")
    .map((t) => ({
      role: t.role,
      text: t.text.trim().slice(0, 8000),
      images: (t.images ?? []).filter((p) => typeof p === "string" && p.startsWith(folder) && p.endsWith(".jpg")),
      visuals: (t.visuals ?? []).filter((v) => typeof v === "string").slice(0, 10),
    }))
    .filter((t) => t.text || t.images.length || t.visuals.length);
  if (turns.length === 0) return NextResponse.json({ ok: true, saved: 0 });

  // Consecutive turns from the same side read as one message.
  const merged: typeof turns = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) {
      last.text = [last.text, t.text].filter(Boolean).join(" ");
      last.images.push(...t.images);
      last.visuals.push(...t.visuals);
    } else merged.push({ ...t, images: [...t.images], visuals: [...t.visuals] });
  }

  const { data: thread } = await db
    .from("tutor_threads")
    .select("student_id, title, course_id")
    .eq("id", threadId)
    .maybeSingle();
  if (thread && thread.student_id !== userId) return NextResponse.json({ error: "not your thread" }, { status: 403 });

  const now = Date.now();
  if (!thread) {
    const requested = typeof body.assignmentId === "number" ? body.assignmentId : null;
    const { data: opened } = requested
      ? await db
          .from("canvas_assignments")
          .select("id, course_id")
          .eq("student_id", student.studentId)
          .eq("id", requested)
          .maybeSingle()
      : { data: null };
    const { error } = await db.from("tutor_threads").insert({
      id: threadId,
      student_id: userId,
      course_id: opened?.course_id ?? null,
      assignment_id: opened?.id ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = merged.map((t, i) => ({
    thread_id: threadId,
    role: t.role,
    content: [t.text, ...t.visuals.map((v) => "```visual\n" + v + "\n```")].filter(Boolean).join("\n\n"),
    images: t.images,
    model: t.role === "tutor" ? VOICE_MODEL : null,
    usage: null,
    created_at: new Date(now + i).toISOString(),
  }));
  const { error: saveErr } = await db.from("tutor_messages").insert(rows);
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });
  await db.from("tutor_threads").update({ updated_at: new Date(now + rows.length).toISOString() }).eq("id", threadId);

  if (!thread?.title) {
    const firstStudent = merged.find((t) => t.role === "student")?.text ?? "";
    const firstTutor = merged.find((t) => t.role === "tutor")?.text ?? "";
    const classify = !thread?.course_id && !(typeof body.assignmentId === "number");
    after(() => nameThread(threadId, firstStudent, firstTutor, classify ? student.studentId : null));
  }
  return NextResponse.json({ ok: true, saved: rows.length });
}
