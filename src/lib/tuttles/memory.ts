import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tuttles' memory of a student: a small profile of how they learn and where
 * they're strong or shaky in each class.
 *
 * It's rewritten whole, once a night and only after a day with chats, from the
 * current profile, that day's chats and recent Canvas grades. Never appended
 * to: every item has to earn its place again each night, so a one-off doesn't
 * stick and a fixed struggle falls out. The chats themselves stay the record
 * of specifics; the profile only holds patterns. Parents' notes sit beside it
 * (tutor_parent_notes) and this never rewrites them. Every version is kept
 * (tutor_memories), so a parent can see what changed and restore a night.
 *
 * Chats a parent has while trying the app as the kid are theirs, not the
 * kid's, so they never feed this.
 */

export const MEMORY_MODEL = "gpt-5.6-sol";

export type MemoryItem = { text: string; evidence: string[]; lastSeen: string };
export type ClassMemory = { name: string; strengths: MemoryItem[]; shaky: MemoryItem[] };
export type Profile = { learning: MemoryItem[]; classes: ClassMemory[] };

const EMPTY: Profile = { learning: [], classes: [] };
const DAY = 864e5;
/** Grades this recent are evidence for the rewrite. */
const GRADES_BACK = 21 * DAY;

export type MemoryVersion = {
  id: string;
  version: number;
  profile: Profile;
  changes: string | null;
  source: "nightly" | "restore";
  created_at: string;
};

export async function currentMemory(db: SupabaseClient, studentId: string): Promise<MemoryVersion | null> {
  const { data } = await db
    .from("tutor_memories")
    .select("id, version, profile, changes, source, created_at")
    .eq("student_id", studentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as MemoryVersion | null) ?? null;
}

/** What the tutor is told about the student, from the profile and the parents' notes. */
export async function memoryContext(db: SupabaseClient, studentId: string, name: string): Promise<string | null> {
  const [memory, { data: notes }, { data: recent }] = await Promise.all([
    currentMemory(db, studentId),
    db.from("tutor_parent_notes").select("body").eq("student_id", studentId).order("created_at"),
    db
      .from("tutor_threads")
      .select("title, updated_at")
      .eq("student_id", studentId)
      .not("title", "is", null)
      .gte("updated_at", new Date(Date.now() - 14 * DAY).toISOString())
      .order("updated_at", { ascending: false })
      .limit(15),
  ]);
  const p = memory?.profile ?? EMPTY;
  const lines: string[] = [];
  if (p.learning.length) lines.push("How they learn best:", ...p.learning.map((i) => `- ${i.text}`));
  for (const c of p.classes) {
    const parts = [
      ...c.strengths.map((i) => `- Strong: ${i.text}`),
      ...c.shaky.map((i) => `- Still working on: ${i.text}`),
    ];
    if (parts.length) lines.push(`${c.name}:`, ...parts);
  }
  if (notes?.length) lines.push("From their parents:", ...notes.map((n) => `- ${n.body}`));
  // So "like we did last week" lands: what they've worked on lately, by name.
  if (recent?.length) lines.push("Recent chats:", ...recent.map((t) => `- ${day(t.updated_at)}: ${t.title}`));
  if (!lines.length) return null;
  return [
    `## What you know about ${name} as a learner`,
    "Built from past chats and grades. Use it to pitch explanations and hints; bring a shaky spot up when it's relevant to what they're working on. Don't recite it.",
    ...lines,
  ].join("\n");
}

// --- The nightly rewrite ------------------------------------------------------

const ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["text", "evidence", "lastSeen"],
  properties: {
    text: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    lastSeen: { type: "string" },
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["learning", "classes", "changes"],
  properties: {
    learning: { type: "array", items: ITEM },
    classes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "strengths", "shaky"],
        properties: {
          name: { type: "string" },
          strengths: { type: "array", items: ITEM },
          shaky: { type: "array", items: ITEM },
        },
      },
    },
    changes: { type: "string" },
  },
};

const LIMITS = { learning: 5, strengths: 3, shaky: 3 };

function rewriteInstructions(name: string, today: string, classNames: string[]): string {
  return `You keep a homework tutor's memory of ${name}, a student. Today is ${today}. You'll get the current memory, the chats ${name} had since it was last rewritten, and recent grades from school. Write the whole memory again.

The memory holds patterns that help a tutor teach ${name}, nothing else:
- "learning": how ${name} learns best (up to ${LIMITS.learning}). For example: gets it faster from a worked example first; rushes and skips reading the question; asks for answers quickly when frustrated.
- "classes": per class, up to ${LIMITS.strengths} "strengths" and ${LIMITS.shaky} "shaky" spots, as specific skills ("finding the range of a relation from a graph", "explaining why a historical event mattered, not just what happened"). Use these class names exactly: ${classNames.map((c) => `"${c}"`).join(", ") || "(none known)"}. Leave out a class with nothing in it.

Rules:
- An item needs at least two independent signs: two chats on different days, or a chat and a grade, or two grades. One chat isn't a pattern. A new observation with only one sign stays out for now (it'll come back if it repeats).
- "evidence" lists those signs briefly ("chat Nov 6: mixed up domain and range", "Quiz 2-3: 3/6"). Keep the strongest few.
- "lastSeen" (YYYY-MM-DD) is the most recent date the pattern showed. Carry an unchanged item forward as it was.
- Drop an item when a later grade or chat shows it's fixed, or when it hasn't shown for three weeks.
- Grades are evidence, not items: never write "got 6/8 on the homework" as a memory. A grade is evidence about a skill only when its name or the teacher's comment shows what it covered; "Quiz 2-3: 3/6" alone says nothing about which topic.
- Nothing personal beyond what helps tutoring: no friends, family, feelings or private details. No judgments of character. Write plainly and kindly; ${name} can read it.
- Prefer keeping the memory short and right over full. When unsure, leave it out.

"changes": one or two plain sentences for the parents on what changed and why ("Added: rushes word problems, seen in two chats this week. Dropped: graphing points, fixed per Quiz 2-3."), or "No changes." if nothing did.`;
}

type ChatForMemory = { title: string | null; day: string; messages: { role: string; content: string }[] };

/**
 * Rewrites one student's memory if they've chatted since the last version
 * (or always, with `force`). Returns what happened, for the cron log and the
 * parents' "Rewrite now" button.
 */
export async function rewriteMemory(
  db: SupabaseClient,
  studentId: string,
  opts: { force?: boolean; now?: Date } = {},
): Promise<{ status: "rewritten" | "unchanged" | "no-chats"; changes?: string }> {
  const now = opts.now ?? new Date();
  const [{ data: member }, memory, { data: courses }] = await Promise.all([
    db.from("family_members").select("name").eq("user_id", studentId).maybeSingle(),
    currentMemory(db, studentId),
    db.from("canvas_courses").select("id, name").eq("student_id", studentId),
  ]);
  const name = member?.name ?? "the student";
  const since = opts.force ? new Date(now.getTime() - 14 * DAY) : memory ? new Date(memory.created_at) : new Date(0);

  // The student's own chats with activity since the last version.
  const { data: threads } = await db
    .from("tutor_threads")
    .select("id, title, updated_at")
    .eq("student_id", studentId)
    .gt("updated_at", since.toISOString())
    .order("updated_at");
  if (!threads?.length) return { status: "no-chats" };

  const chats: ChatForMemory[] = [];
  for (const t of threads) {
    const { data: msgs } = await db
      .from("tutor_messages")
      .select("role, content, images, created_at")
      .eq("thread_id", t.id)
      .order("created_at");
    chats.push({
      title: t.title,
      day: day(t.updated_at),
      messages: (msgs ?? []).map((m) => ({
        role: m.role,
        content: `${m.images?.length ? `[sent ${m.images.length} photo${m.images.length > 1 ? "s" : ""}] ` : ""}${clip(m.content, 2000)}`,
      })),
    });
  }

  const { data: grades } = await db
    .from("canvas_assignments")
    .select("name, course_id, score, points_possible, graded_at, comments")
    .eq("student_id", studentId)
    .not("graded_at", "is", null)
    .gte("graded_at", new Date(now.getTime() - GRADES_BACK).toISOString())
    .order("graded_at");
  const courseName = (id: number) => courses?.find((c) => c.id === id)?.name ?? "class";
  const gradeLines = (grades ?? [])
    .filter((g) => g.score != null)
    .map(
      (g) =>
        `- ${day(g.graded_at)} · ${courseName(g.course_id)} · ${g.name}: ${g.score}${g.points_possible ? `/${g.points_possible}` : ""}${
          (g.comments as { comment: string }[])?.length
            ? ` (teacher: ${(g.comments as { comment: string }[]).map((c) => clip(c.comment, 200)).join(" / ")})`
            : ""
        }`,
    );

  const input = [
    `## Current memory\n${JSON.stringify(memory?.profile ?? EMPTY, null, 1)}`,
    `## Chats since it was last written\n${chats
      .map(
        (c) =>
          `### ${c.day}: ${c.title ?? "untitled"}\n${c.messages.map((m) => `${m.role === "student" ? name : "Tutor"}: ${m.content}`).join("\n\n")}`,
      )
      .join("\n\n")}`,
    `## Grades in the last three weeks\n${gradeLines.join("\n") || "(none)"}`,
  ].join("\n\n");

  const res = await openai().responses.create({
    model: MEMORY_MODEL,
    instructions: rewriteInstructions(name, day(now.toISOString()), (courses ?? []).map((c) => c.name)),
    input,
    reasoning: { effort: "medium" },
    text: { format: { type: "json_schema", name: "tutor_memory", schema: SCHEMA, strict: true } },
  });
  const out = JSON.parse(res.output_text) as Profile & { changes: string };
  const profile = capped({ learning: out.learning, classes: out.classes });

  // A night with nothing new keeps the version it had, even if the model
  // reworded an item, so the history only shows real changes.
  const said = out.changes.trim();
  if (memory && (JSON.stringify(memory.profile) === JSON.stringify(profile) || /^no changes\.?$/i.test(said))) {
    return { status: "unchanged" };
  }
  await saveVersion(db, studentId, profile, said || null, "nightly", null, memory?.version ?? 0);
  return { status: "rewritten", changes: out.changes };
}

/** Puts an earlier version back, as a new version (history only grows). */
export async function restoreMemory(db: SupabaseClient, studentId: string, version: number, by: string) {
  const [{ data: old }, memory] = await Promise.all([
    db.from("tutor_memories").select("profile").eq("student_id", studentId).eq("version", version).maybeSingle(),
    currentMemory(db, studentId),
  ]);
  if (!old) throw new Error("No such version");
  await saveVersion(db, studentId, old.profile as Profile, `Restored version ${version}.`, "restore", by, memory?.version ?? 0);
}

/** Everyone who chatted since their last version; the cron sweep. */
export async function rewriteAllMemories(db: SupabaseClient) {
  const { data: kids } = await db.from("family_members").select("user_id").eq("role", "kid").not("user_id", "is", null);
  const results: Record<string, string> = {};
  for (const k of kids ?? []) {
    try {
      results[k.user_id] = (await rewriteMemory(db, k.user_id)).status;
    } catch (err) {
      results[k.user_id] = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return results;
}

async function saveVersion(
  db: SupabaseClient,
  studentId: string,
  profile: Profile,
  changes: string | null,
  source: "nightly" | "restore",
  by: string | null,
  previous: number,
) {
  const { error } = await db.from("tutor_memories").insert({
    student_id: studentId,
    version: previous + 1,
    profile,
    changes,
    source,
    created_by: by,
  });
  if (error) throw new Error(error.message);
}

/** The caps, enforced whatever the model wrote. */
function capped(p: Profile): Profile {
  return {
    learning: p.learning.slice(0, LIMITS.learning),
    classes: p.classes
      .map((c) => ({ name: c.name, strengths: c.strengths.slice(0, LIMITS.strengths), shaky: c.shaky.slice(0, LIMITS.shaky) }))
      .filter((c) => c.strengths.length || c.shaky.length),
  };
}

let cached: OpenAI | null = null;
function openai(): OpenAI {
  if (cached) return cached;
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  cached = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cached;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
