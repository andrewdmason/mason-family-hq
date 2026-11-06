import { after, NextResponse } from "next/server";
import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { createAdminClient } from "@/lib/supabase/admin";
import { TUTOR_MODEL, tutorInstructions } from "@/lib/tuttles/prompt";
import { nameThread } from "@/lib/tuttles/naming";
import { tutoredStudent } from "@/lib/tuttles/tutoring-as";
import { studentSections } from "@/lib/tuttles/context";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * One turn of a Tuttles chat, from the iPhone app.
 *
 *   POST { threadId, text, images, assignmentId? }   Authorization: Bearer <supabase access token>
 *   → the tutor's reply, streamed as plain text
 *
 * `threadId` is made on the phone, so the first message of a new chat creates
 * the thread. `assignmentId`, on that first message, is the Canvas assignment
 * the chat was opened from: the thread files under its class, and the tutor
 * keeps its instructions in view. `images` are paths the phone has already uploaded to the tuttles
 * bucket, under {student_id}/{thread_id}/.
 *
 * The phone has a Supabase session but no website cookies, so it sends its
 * access token and this validates it (excluded from the session gate in
 * middleware for that reason). The model key stays here.
 *
 * A turn is saved only once the reply has finished: the student's message and
 * the tutor's together. A turn that fails mid-reply ends the stream with
 * "\n\n[error: …]" (the reader chat's convention, src/lib/reading/chat-stream.ts)
 * and saves nothing, so the phone can simply send it again.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 8000;
const MAX_IMAGES = 12;

let cachedOpenAI: OpenAI | null = null;
function openai(): OpenAI {
  if (cachedOpenAI) return cachedOpenAI;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  cachedOpenAI = new OpenAI({ apiKey });
  return cachedOpenAI;
}

export async function POST(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const {
    data: { user },
  } = await db.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // A parent is tutored as a kid (src/lib/tuttles/tutoring-as.ts); the thread
  // and its messages are still the parent's own.
  const student = await tutoredStudent(db, user.id);
  if (!student) return NextResponse.json({ error: "not a family member" }, { status: 403 });

  let body: { threadId?: unknown; text?: unknown; images?: unknown; assignmentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const threadId = typeof body.threadId === "string" ? body.threadId.toLowerCase() : "";
  if (!UUID.test(threadId)) return NextResponse.json({ error: "bad threadId" }, { status: 400 });
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  const images = Array.isArray(body.images) ? body.images : [];
  const folder = `${user.id}/${threadId}/`;
  if (
    images.length > MAX_IMAGES ||
    !images.every((p): p is string => typeof p === "string" && p.startsWith(folder) && p.endsWith(".jpg") && !p.includes(".."))
  ) {
    return NextResponse.json({ error: "bad images" }, { status: 400 });
  }
  if (!text && images.length === 0) return NextResponse.json({ error: "empty message" }, { status: 400 });

  const { data: thread } = await db
    .from("tutor_threads")
    .select("id, student_id, title, course_id, assignment_id")
    .eq("id", threadId)
    .maybeSingle();
  if (thread && thread.student_id !== user.id) return NextResponse.json({ error: "not your thread" }, { status: 403 });

  // The assignment this chat was opened from, if it's one of the tutored kid's.
  const requested = typeof body.assignmentId === "number" ? body.assignmentId : null;
  const { data: opened } =
    !thread && requested
      ? await db
          .from("canvas_assignments")
          .select("id, course_id")
          .eq("student_id", student.studentId)
          .eq("id", requested)
          .maybeSingle()
      : { data: null };
  const assignmentId: number | null = thread?.assignment_id ?? opened?.id ?? null;

  const { data: earlier, error: historyErr } = thread
    ? await db
        .from("tutor_messages")
        .select("role, content, images")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (historyErr) return NextResponse.json({ error: historyErr.message }, { status: 500 });
  const history = (earlier ?? []) as { role: "student" | "tutor"; content: string; images: string[] }[];

  // Every photo in the thread goes to the model with every turn, as data
  // rather than a link: nothing outside can fetch it, and it works the same
  // against a local database.
  const allPaths = [...history.flatMap((m) => m.images), ...images];
  const photoData = new Map<string, string>();
  const bucket = db.storage.from("tuttles");
  const downloaded = await Promise.all(allPaths.map(async (p) => [p, (await bucket.download(p)).data] as const));
  for (const [p, blob] of downloaded) {
    if (blob) photoData.set(p, `data:image/jpeg;base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`);
  }
  const missing = images.find((p) => !photoData.has(p));
  if (missing) return NextResponse.json({ error: `photo not uploaded: ${missing}` }, { status: 400 });

  const studentTurn = (content: string, paths: string[]): ResponseInputItem => ({
    role: "user",
    content: [
      ...(content ? [{ type: "input_text" as const, text: content }] : []),
      ...paths
        .filter((p) => photoData.has(p))
        .map((p) => ({ type: "input_image" as const, image_url: photoData.get(p)!, detail: "high" as const })),
    ],
  });
  const input: ResponseInputItem[] = [
    ...history.map((m) =>
      m.role === "student" ? studentTurn(m.content, m.images) : ({ role: "assistant", content: m.content } as const),
    ),
    studentTurn(text, images),
  ];
  // What the tutor knows of them (src/lib/tuttles/memory.ts) and their classes,
  // when a parent has connected Canvas. After the fixed tutoring rules, so
  // those stay a cacheable prefix.
  const instructions = [
    tutorInstructions({ name: student.name, birthdate: student.birthdate }),
    ...(await studentSections(db, student, assignmentId)),
  ].join("\n\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reply = "";
      try {
        const events = await openai().responses.create({
          model: TUTOR_MODEL,
          instructions,
          input,
          reasoning: { effort: "low" },
          stream: true,
        });
        let usage: unknown = null;
        for await (const event of events) {
          if (event.type === "response.output_text.delta") {
            reply += event.delta;
            controller.enqueue(encoder.encode(event.delta));
          } else if (event.type === "response.completed") {
            usage = event.response.usage ?? null;
          } else if (event.type === "response.failed" || event.type === "error") {
            throw new Error("The tutor stopped partway through.");
          }
        }

        const now = new Date();
        if (!thread) {
          const { error } = await db
            .from("tutor_threads")
            .insert({
              id: threadId,
              student_id: user.id,
              course_id: opened?.course_id ?? null,
              assignment_id: opened?.id ?? null,
              created_at: now.toISOString(),
              updated_at: now.toISOString(),
            });
          if (error) throw new Error(error.message);
        } else {
          await db.from("tutor_threads").update({ updated_at: now.toISOString() }).eq("id", threadId);
        }
        // A millisecond apart, so the two sort in the order they happened.
        const { error: saveErr } = await db.from("tutor_messages").insert([
          { thread_id: threadId, role: "student", content: text, images, created_at: now.toISOString() },
          {
            thread_id: threadId,
            role: "tutor",
            content: reply,
            // Rows inserted together share columns, so a missing one is null, not its default.
            images: [],
            model: TUTOR_MODEL,
            usage,
            created_at: new Date(now.getTime() + 1).toISOString(),
          },
        ]);
        if (saveErr) throw new Error(saveErr.message);

        if (!thread?.title) {
          const classify = !thread?.course_id && !opened;
          after(() => nameThread(threadId, text, reply, classify ? student.studentId : null));
        }
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        controller.enqueue(encoder.encode(`\n\n[error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
