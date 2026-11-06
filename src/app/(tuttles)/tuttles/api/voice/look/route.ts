import { NextResponse } from "next/server";
import OpenAI from "openai";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { PHOTO_READER_INSTRUCTIONS, PHOTO_READER_MODEL } from "@/lib/tuttles/voice";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Reads a photo taken during a voice call, so the voice tutor works from an
 * exact write-up of the page (the printed problems, and the student's own
 * work) and not only its own reading of the picture, which is shakier.
 *
 *   POST { path }   Authorization: Bearer <supabase access token>   → { reading }
 *
 * `path` is the photo, already uploaded to the tuttles bucket under the
 * caller's own folder (it's kept for the saved chat anyway).
 */
export async function POST(request: Request) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, userId } = caller;

  let body: { path?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const path = typeof body.path === "string" ? body.path : "";
  if (!path.startsWith(`${userId}/`) || !path.endsWith(".jpg") || path.includes("..")) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }
  const { data: blob } = await db.storage.from("tuttles").download(path);
  if (!blob) return NextResponse.json({ error: "photo not uploaded" }, { status: 400 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });

  try {
    const res = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).responses.create({
      model: PHOTO_READER_MODEL,
      instructions: PHOTO_READER_INSTRUCTIONS,
      reasoning: { effort: "low" },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`,
              detail: "high",
            },
          ],
        },
      ],
    });
    return NextResponse.json({ reading: res.output_text.trim() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read the photo." }, { status: 502 });
  }
}
