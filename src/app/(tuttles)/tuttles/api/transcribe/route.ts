import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { TRANSCRIBE_LANGUAGE } from "@/lib/tuttles/voice";

export const runtime = "nodejs";

/** Push to talk: what the student said, written out, to send as their message. */
const TRANSCRIBE_MODEL = "gpt-4o-transcribe";
const MAX_BYTES = 10 * 1024 * 1024;

/**
 *   POST <audio body, audio/mp4 (m4a)>   Authorization: Bearer <supabase access token>
 *   → { text }
 *
 * Primed with the student's class names, so school words come out spelled
 * right ("Tordesillas", "eukaryote", "x squared").
 */
export async function POST(request: Request) {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { db, student } = caller;

  const audio = Buffer.from(await request.arrayBuffer());
  if (audio.length === 0) return NextResponse.json({ error: "no audio" }, { status: 400 });
  if (audio.length > MAX_BYTES) return NextResponse.json({ error: "too long" }, { status: 413 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });

  const { data: courses } = await db.from("canvas_courses").select("name").eq("student_id", student.studentId);
  const prompt = `A middle schooler asking a tutor about homework${
    courses?.length ? ` for ${courses.map((c) => c.name).join(", ")}` : ""
  }, in English with some Spanish words from Spanish class. Math is spoken in words ("two, three", "x squared").`;

  try {
    const result = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).audio.transcriptions.create({
      file: await toFile(audio, "speech.m4a", { type: "audio/mp4" }),
      model: TRANSCRIBE_MODEL,
      language: TRANSCRIBE_LANGUAGE,
      prompt,
    });
    return NextResponse.json({ text: result.text.trim() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't transcribe." }, { status: 502 });
  }
}
