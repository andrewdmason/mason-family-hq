import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TUTOR_MODEL } from "@/lib/tuttles/prompt";
import { parseSetDraft, type SetDraft } from "@/lib/tuttles/study";
import type { SetRow } from "@/lib/tuttles/study-db";

/**
 * Folds new material into a study set outside a chat: a parent making a set
 * from the parent view, or anyone adding a photo or note on a set's page. The
 * model reads the new photos and note with what the set already has and
 * rewrites its notes, topics, format and coverage, the way the tutor does in a
 * chat with a ```studyset block.
 */

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "format", "topics", "material", "coverage", "coverageNote"],
  properties: {
    title: { type: "string" },
    format: { type: "string" },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "weight"],
        properties: { name: { type: "string" }, weight: { type: "integer" } },
      },
    },
    material: { type: "string" },
    coverage: { type: "string", enum: ["thin", "okay", "good"] },
    coverageNote: { type: "string" },
  },
};

const INSTRUCTIONS = `You keep a student's study set: what's on an upcoming quiz or test, so a tutor can quiz them on it. You get the set as it is and new material (photos of study guides, worksheets or notes, and/or a typed note). Write the set again with the new material folded in.
- title: keep it unless it's a placeholder and the material says what the test is.
- format: what the real test asks (question types, how many, anything known); keep what's known, add what the material says.
- topics: 4 to 12 specific, testable topics ("-ar verbs in the present tense", "solving two-step equations"), not "Chapter 3". Keep existing topic names exactly when they still apply, so their history carries over. weight: 3 a big part of the test, 2 a fair share, 1 a little.
- material: the study notes quizzes are written from. Keep what's there and add the new material faithfully and completely: facts, definitions, vocabulary (word and meaning), formulas, example problems. Transcribe photos; don't summarize a vocab list.
- coverage: "thin" if it's mostly a title, "okay" with a topic list but few details, "good" with a study guide or the actual content. coverageNote: in a few words, what would help most next (e.g. "the vocab list for unit 4"), or "" if nothing.`;

export async function foldInMaterial(
  db: SupabaseClient,
  set: Pick<SetRow, "title" | "format" | "material" | "coverage" | "coverage_note" | "id">,
  topics: { name: string; weight: number }[],
  added: { note?: string | null; images?: string[]; canvas?: string | null },
): Promise<SetDraft> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const bucket = db.storage.from("tuttles");
  const photos = await Promise.all(
    (added.images ?? []).map(async (p) => {
      const { data } = await bucket.download(p);
      return data ? `data:image/jpeg;base64,${Buffer.from(await data.arrayBuffer()).toString("base64")}` : null;
    }),
  );
  const current = {
    title: set.title,
    format: set.format ?? "",
    topics,
    material: set.material,
    coverage: set.coverage,
    coverageNote: set.coverage_note ?? "",
  };
  const text = [
    `## The set now\n${JSON.stringify(current, null, 1)}`,
    added.canvas ? `## From Canvas\n${added.canvas}` : null,
    added.note ? `## New note\n${added.note}` : null,
    photos.some(Boolean) ? "## New photos (attached)" : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const res = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).responses.create({
    model: TUTOR_MODEL,
    instructions: INSTRUCTIONS,
    reasoning: { effort: "low" },
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text },
          ...photos.filter((p): p is string => Boolean(p)).map((p) => ({ type: "input_image" as const, image_url: p, detail: "high" as const })),
        ],
      },
    ],
    text: { format: { type: "json_schema", name: "study_set", schema: SCHEMA, strict: true } },
  });
  const draft = parseSetDraft(res.output_text);
  if (!draft) throw new Error("Couldn't read the material.");
  return { ...draft, coverageNote: draft.coverageNote ?? "" };
}
