import { NextResponse } from "next/server";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { saveTutorSet } from "@/lib/tuttles/study-chat";
import { setSummaries } from "@/lib/tuttles/study-db";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A study set the voice tutor saved (its save_study_set tool, relayed by the
 * phone), the way a typed chat's ```studyset block is saved.
 *
 *   POST { threadId, set: "<the set's JSON>", assignmentId?, images? }
 *   → { set: SetSummary, block, note }
 *
 * `block` goes into the saved chat when the call ends; `note` is the tool's
 * reply to the tutor. A call in a chat that isn't saved yet passes the set's
 * id to /tuttles/api/voice/save, which files the chat under it.
 */
export async function POST(request: Request) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, student, userId } = caller;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const threadId = typeof body.threadId === "string" ? body.threadId.toLowerCase() : "";
  if (!UUID.test(threadId)) return NextResponse.json({ error: "bad thread" }, { status: 400 });
  const raw = typeof body.set === "string" ? body.set : body.set && typeof body.set === "object" ? JSON.stringify(body.set) : "";
  const folder = `${userId}/${threadId}/`;
  const images = (Array.isArray(body.images) ? body.images : []).filter(
    (p): p is string => typeof p === "string" && p.startsWith(folder) && p.endsWith(".jpg") && !p.includes(".."),
  );

  const { data: thread } = await db.from("tutor_threads").select("student_id, study_set_id, assignment_id").eq("id", threadId).maybeSingle();
  if (thread && thread.student_id !== userId) return NextResponse.json({ error: "not your thread" }, { status: 403 });
  const sets = await setSummaries(db, student.studentId);
  const set = await saveTutorSet(db, {
    student,
    userId,
    threadId,
    linkedId: thread?.study_set_id ?? null,
    knownIds: sets.map((s) => s.id),
    images,
    assignmentId: thread?.assignment_id ?? (typeof body.assignmentId === "number" ? body.assignmentId : null),
    body: raw,
  });
  if (!set) return NextResponse.json({ error: "That set couldn't be read.", note: "Couldn't save that; check the JSON." }, { status: 400 });
  if (thread && !thread.study_set_id) await db.from("tutor_threads").update({ study_set_id: set.id }).eq("id", threadId);
  const summary = (await setSummaries(db, student.studentId)).find((s) => s.id === set.id) ?? null;
  return NextResponse.json({
    set: summary,
    block: "```studyset\n" + JSON.stringify({ id: set.id, title: set.title }) + "\n```\n",
    note: `Saved "${set.title}" (id ${set.id}), ${summary?.topics.length ?? 0} topics, material ${set.coverage}. It's on their screen.`,
  });
}
