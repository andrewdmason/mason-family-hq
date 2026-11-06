import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classesFor } from "@/lib/tuttles/classes";
import { currentMemory } from "@/lib/tuttles/memory";

/**
 * The parents' "This week" in Tuttles: per class, the few concepts a kid is
 * learning right now, each with a parent-friendly summary, how the kid seems
 * to be doing on it, and a few natural ways to bring it up at home. Plus
 * what's coming up (tests and big assignments in the next two weeks).
 *
 * Worked out once a morning (cron) or the first time a parent looks that
 * day, from the synced Canvas (current unit and its overview, this week's
 * assignments with their instructions, announcements), the kid's memory and
 * recent grades. Stored per kid per day (tutor_week_briefs).
 */

export const WEEK_MODEL = "gpt-5.6-sol";
const DAY = 864e5;

export type WeekTopic = {
  id: string;
  title: string;
  summary: string;
  /** How the kid seems to be doing on it, from memory and grades; null when there's no sign either way. */
  doing: string | null;
  /** Ways to bring it up at home. */
  talk: string[];
  assignmentIds: number[];
};

export type WeekClass = {
  courseId: number;
  name: string;
  shortName: string;
  color: string;
  unit: string | null;
  topics: WeekTopic[];
};

export type ComingUp = { id: number; courseId: number; name: string; dueAt: string; points: number | null };

export type WeekBrief = { classes: WeekClass[]; comingUp: ComingUp[]; generatedAt: string };

/** Today's brief for a kid, made now if there isn't one yet. */
export async function weekBrief(db: SupabaseClient, kidId: string, now = new Date()): Promise<WeekBrief | null> {
  const today = localDay(now);
  const { data } = await db
    .from("tutor_week_briefs")
    .select("brief")
    .eq("student_id", kidId)
    .eq("generated_on", today)
    .maybeSingle();
  if (data) return data.brief as WeekBrief;
  return generateWeekBrief(db, kidId, now);
}

const BIG = /\b(test|quiz|exam|project|essay|presentation|lab|final|dbq|pceat|report)\b/i;

export async function generateWeekBrief(db: SupabaseClient, kidId: string, now = new Date()): Promise<WeekBrief | null> {
  const t = now.getTime();
  const [{ data: member }, classes, memory, { data: assignments }, { data: news }] = await Promise.all([
    db.from("family_members").select("name").eq("user_id", kidId).maybeSingle(),
    classesFor(db, kidId, kidId, now),
    currentMemory(db, kidId),
    db
      .from("canvas_assignments")
      .select("id, course_id, name, description, due_at, points_possible, is_quiz, submitted_at, graded_at, score, comments, module_name")
      .eq("student_id", kidId),
    db
      .from("canvas_items")
      .select("course_id, title, body, posted_at")
      .eq("student_id", kidId)
      .eq("kind", "announcement")
      .gte("posted_at", new Date(t - 10 * DAY).toISOString()),
  ]);
  if (!classes.classes.length) return null;
  const name = member?.name ?? "the student";
  const all = assignments ?? [];

  const comingUp: ComingUp[] = all
    .filter(
      (a) =>
        a.due_at &&
        Date.parse(a.due_at) > t &&
        Date.parse(a.due_at) <= t + 14 * DAY &&
        !a.submitted_at &&
        (a.is_quiz || BIG.test(a.name) || (a.points_possible ?? 0) >= 20),
    )
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))
    .map((a) => ({ id: a.id, courseId: a.course_id, name: a.name.trim(), dueAt: a.due_at!, points: a.points_possible }));

  // What each class is doing around now, for the model.
  const sections = classes.classes.map((c) => {
    const near = all
      .filter((a) => a.course_id === c.id && a.due_at && Date.parse(a.due_at) >= t - 7 * DAY && Date.parse(a.due_at) <= t + 10 * DAY)
      .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!));
    const graded = all
      .filter((a) => a.course_id === c.id && a.graded_at && a.score != null && Date.parse(a.graded_at) >= t - 21 * DAY)
      .map((a) => `${a.name}: ${a.score}${a.points_possible ? `/${a.points_possible}` : ""}`);
    const mem = memory?.profile.classes.find((m) => m.name === c.name);
    return [
      `### ${c.name} (course ${c.id})`,
      c.unit ? `Current unit: ${c.unit.name}${c.unit.overview ? `\nUnit overview: ${clip(c.unit.overview, 1500)}` : ""}` : "Current unit: unknown",
      near.length
        ? `Assignments this week (id, due, name, instructions):\n${near
            .map((a) => `- [${a.id}] ${day(a.due_at!)} ${a.name}${a.description ? `: ${clip(a.description, 600)}` : ""}`)
            .join("\n")}`
        : "No assignments due this week.",
      (news ?? []).filter((n) => n.course_id === c.id).map((n) => `Announcement: ${n.title}: ${clip(n.body ?? "", 500)}`).join("\n"),
      graded.length ? `Recent grades: ${graded.join("; ")}` : "",
      mem
        ? `What Tuttles has noticed: strong at ${mem.strengths.map((s) => s.text).join("; ") || "nothing yet"}; still working on ${mem.shaky.map((s) => s.text).join("; ") || "nothing yet"}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  const res = await openai().responses.create({
    model: WEEK_MODEL,
    reasoning: { effort: "medium" },
    instructions: `You help ${name}'s parents follow what ${name} is learning in school this week, from their class information below. For each class, name the concepts ${name} is learning right now (2 to 5; fewer when a class is quiet, none if there's nothing current). Concepts, not assignments: "Domain and range of a relation", "Symbolism in Lord of the Flies", "Why the printing press spread the Reformation". They come from the class material (unit, assignments, announcements); what Tuttles has noticed only informs "doing", never becomes a topic of its own.

For each concept:
- "title": short, plain.
- "summary": one or two sentences for a parent: what it is, and what ${name} is doing with it this week.
- "doing": one short sentence (under 20 words) on how ${name} seems to be doing with it, only from the grades and what Tuttles has noticed; null if there's no sign either way. Kind and specific; never a judgment of character.
- "talk": three or four natural ways a parent could bring it up at dinner or in the car: curious, open questions or small observations that invite ${name} to explain, not quiz questions with right answers. Varied in style.
- "assignmentIds": the ids of this week's assignments it relates to (from the list), possibly none.
Use each class's course id as "courseId". Don't invent work that isn't in the information.`,
    input: sections.join("\n\n"),
    text: { format: { type: "json_schema", name: "week_brief", schema: SCHEMA, strict: true } },
  });
  const out = JSON.parse(res.output_text) as { classes: { courseId: number; topics: Omit<WeekTopic, "id">[] }[] };

  const brief: WeekBrief = {
    generatedAt: now.toISOString(),
    comingUp,
    classes: classes.classes.map((c) => {
      const fromModel = out.classes.find((x) => x.courseId === c.id);
      return {
        courseId: c.id,
        name: c.name,
        shortName: c.shortName,
        color: c.color,
        unit: c.unit?.name.trim() || null,
        topics: (fromModel?.topics ?? []).slice(0, 5).map((tp) => ({
          ...tp,
          id: `${c.id}-${slug(tp.title)}`,
          talk: tp.talk.slice(0, 4),
          assignmentIds: tp.assignmentIds.filter((id) => all.some((a) => a.id === id && a.course_id === c.id)),
        })),
      };
    }),
  };
  await db.from("tutor_week_briefs").upsert({ student_id: kidId, generated_on: localDay(now), brief });
  return brief;
}

/** Every kid with Canvas; the morning sweep. */
export async function generateAllWeekBriefs(db: SupabaseClient) {
  const { data: conns } = await db.from("canvas_connections").select("student_id");
  const results: Record<string, string> = {};
  for (const c of conns ?? []) {
    try {
      const brief = await generateWeekBrief(db, c.student_id);
      results[c.student_id] = brief ? `${brief.classes.reduce((n, k) => n + k.topics.length, 0)} topics` : "no classes";
    } catch (err) {
      results[c.student_id] = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return results;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["classes"],
  properties: {
    classes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["courseId", "topics"],
        properties: {
          courseId: { type: "integer" },
          topics: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "summary", "doing", "talk", "assignmentIds"],
              properties: {
                title: { type: "string" },
                summary: { type: "string" },
                doing: { type: ["string", "null"] },
                talk: { type: "array", items: { type: "string" } },
                assignmentIds: { type: "array", items: { type: "integer" } },
              },
            },
          },
        },
      },
    },
  },
};

let cached: OpenAI | null = null;
function openai(): OpenAI {
  if (cached) return cached;
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  cached = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cached;
}

function localDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric" });
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
