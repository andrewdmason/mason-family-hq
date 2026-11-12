import { NextResponse } from "next/server";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { addSources, getSet, saveSet, setSummaries, topicStates } from "@/lib/tuttles/study-db";
import { foldInMaterial } from "@/lib/tuttles/study-material";

export const runtime = "nodejs";
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * More material for a set, from its page: a note and/or photos (already
 * uploaded under {kid id}/study/). Tuttles reads them into the set's notes and
 * topics before this answers, so the page shows the new coverage.
 *
 *   POST { note?, images? }   → { set }
 */
export async function POST(request: Request, { params }: { params: Promise<{ setId: string }> }) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, student, userId } = caller;
  const { setId } = await params;
  if (!UUID.test(setId)) return NextResponse.json({ error: "bad set" }, { status: 400 });
  const set = await getSet(db, setId, student.studentId);
  if (!set) return NextResponse.json({ error: "not found" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 8000) : "";
  const folder = `${student.studentId}/study/`;
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((p): p is string => typeof p === "string" && p.startsWith(folder) && p.endsWith(".jpg") && !p.includes(".."))
    .slice(0, 12);
  if (!note && !images.length) return NextResponse.json({ error: "Nothing to add." }, { status: 400 });

  try {
    const topics = ((await topicStates(db, [setId])).get(setId) ?? []).map((t) => ({ name: t.name, weight: t.weight }));
    const draft = await foldInMaterial(db, set, topics, { note, images });
    await saveSet(db, { student, by: userId, setId, draft: { ...draft, title: set.title } });
    await addSources(db, setId, userId, [
      ...(note ? [{ kind: "note" as const, body: note }] : []),
      ...images.map((p) => ({ kind: "photo" as const, imagePath: p, body: "Photo" })),
    ]);
    const summary = (await setSummaries(db, student.studentId)).find((s) => s.id === setId) ?? null;
    return NextResponse.json({ set: summary });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't add that." }, { status: 500 });
  }
}
