import OpenAI from "openai";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseTitleAndClass, TITLE_INSTRUCTIONS, TITLE_MODEL, titleAndClassInstructions } from "@/lib/tuttles/prompt";

let cachedOpenAI: OpenAI | null = null;
function openai(): OpenAI {
  if (cachedOpenAI) return cachedOpenAI;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  cachedOpenAI = new OpenAI({ apiKey });
  return cachedOpenAI;
}

/**
 * Titles a new thread from its first exchange, after the reply has gone out,
 * and (given the student's id) files it under the class it's about.
 */
export async function nameThread(threadId: string, question: string, reply: string, classifyFor: string | null) {
  try {
    const db = createAdminClient();
    const { data: courses } = classifyFor
      ? await db.from("canvas_courses").select("id, name").eq("student_id", classifyFor)
      : { data: null };
    const res = await openai().responses.create({
      model: TITLE_MODEL,
      instructions: courses?.length ? titleAndClassInstructions(courses.map((c) => c.name)) : TITLE_INSTRUCTIONS,
      input: `Student: ${question || "(sent a photo)"}\n\nTutor: ${reply.slice(0, 1500)}`,
      reasoning: { effort: "none" },
    });
    let title = res.output_text.trim();
    let courseId: number | null = null;
    if (courses?.length) {
      const parsed = parseTitleAndClass(title);
      title = parsed.title;
      courseId = courses.find((c) => c.name === parsed.className)?.id ?? null;
    }
    title = title.replace(/^["']|["'.]$/g, "").slice(0, 80);
    if (!title) return;
    await db
      .from("tutor_threads")
      .update({ title, ...(courseId ? { course_id: courseId } : {}) })
      .eq("id", threadId)
      .is("title", null);
  } catch {
    // An untitled thread shows its first message instead.
  }
}
