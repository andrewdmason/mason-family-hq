"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdult } from "@/lib/members/auth";
import { generateQuestionBatch } from "@/lib/games/generate";
import { verifyQuestion } from "@/lib/games/verify";
import { loadTriviaPlayers, audienceForLevel } from "@/lib/games/players";
import type { TriviaLevel, TriviaType } from "@/lib/games/types";

const LEVELS: TriviaLevel[] = ["younger_kid", "older_kid", "adult", "all"];
const TYPES: TriviaType[] = ["mc", "list", "closest"];

export type BatchSummary = {
  id: string;
  topic: string;
  level: TriviaLevel | null;
  type: TriviaType | null;
  status: string;
  error: string | null;
  ready: number;
  quarantined: number;
  createdAt: string;
};

async function callerEmail(): Promise<string> {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  return user?.email?.toLowerCase() ?? "owner";
}

/** Recent generation batches with their ready/quarantined question counts. Adult-only. */
export async function loadBatchSummaries(): Promise<BatchSummary[]> {
  await requireAdult();
  const admin = createAdminClient();

  const { data: batches } = await admin
    .from("trivia_batches")
    .select("id, topic, level, type, status, error, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  const rows = (batches ?? []) as {
    id: string;
    topic: string;
    level: TriviaLevel | null;
    type: TriviaType | null;
    status: string;
    error: string | null;
    created_at: string;
  }[];
  if (rows.length === 0) return [];

  const { data: questions } = await admin
    .from("trivia_questions")
    .select("batch_id, status")
    .in(
      "batch_id",
      rows.map((b) => b.id)
    );
  const counts = new Map<string, { ready: number; quarantined: number }>();
  for (const q of (questions ?? []) as { batch_id: string; status: string }[]) {
    const c = counts.get(q.batch_id) ?? { ready: 0, quarantined: 0 };
    if (q.status === "ready") c.ready += 1;
    else if (q.status === "quarantined") c.quarantined += 1;
    counts.set(q.batch_id, c);
  }

  return rows.map((b) => ({
    id: b.id,
    topic: b.topic,
    level: b.level,
    type: b.type,
    status: b.status,
    error: b.error,
    ready: counts.get(b.id)?.ready ?? 0,
    quarantined: counts.get(b.id)?.quarantined ?? 0,
    createdAt: b.created_at,
  }));
}

export type GenerateBatchResult = {
  batchId: string;
  ready: number;
  quarantined: number;
  ok: boolean;
};

/**
 * Generate, verify, and persist a question batch. Adult-only. Generated questions
 * pass through the adversarial verifier; only those that pass land as `ready`,
 * the rest as `quarantined` (and are never served). On a generation failure the
 * batch is marked `failed` so the adult can retry.
 */
export async function generateBatch(input: {
  topic: string;
  level: TriviaLevel;
  type: TriviaType;
  count: number;
}): Promise<GenerateBatchResult> {
  await requireAdult();

  const topic = input.topic.trim();
  if (!topic) throw new Error("Give the batch a topic.");
  const level = LEVELS.includes(input.level) ? input.level : "all";
  const type = TYPES.includes(input.type) ? input.type : "mc";
  const count = Math.min(Math.max(Math.floor(input.count) || 10, 1), 20);

  const admin = createAdminClient();
  const { data: batch, error: batchErr } = await admin
    .from("trivia_batches")
    .insert({
      topic,
      level,
      type,
      requested_count: count,
      status: "generating",
      created_by_email: await callerEmail(),
    })
    .select("id")
    .single();
  if (batchErr || !batch) {
    throw new Error(batchErr?.message ?? "Couldn't start the batch.");
  }
  const batchId = batch.id as string;

  const players = await loadTriviaPlayers();
  const audience = audienceForLevel(level, players);

  const generated = await generateQuestionBatch({ topic, level, type, count, audience });
  if (!generated.ok || generated.questions.length === 0) {
    await admin
      .from("trivia_batches")
      .update({ status: "failed", error: "The generator returned no usable questions." })
      .eq("id", batchId);
    revalidatePath("/games/trivia/generate");
    return { batchId, ready: 0, quarantined: 0, ok: false };
  }

  // Verify each question independently (one failure never fails the batch).
  const verdicts = await Promise.all(
    generated.questions.map((q) => verifyQuestion(q))
  );

  const rows = generated.questions.map((q, i) => ({
    batch_id: batchId,
    topic,
    level,
    type,
    prompt: q.prompt,
    payload: q.payload,
    perishable: q.perishable,
    status: verdicts[i].verdict === "ready" ? "ready" : "quarantined",
    verification: { verdict: verdicts[i].verdict, notes: verdicts[i].notes },
  }));

  const { error: insErr } = await admin.from("trivia_questions").insert(rows);
  if (insErr) {
    await admin
      .from("trivia_batches")
      .update({ status: "failed", error: insErr.message })
      .eq("id", batchId);
    throw new Error(insErr.message);
  }

  const ready = rows.filter((r) => r.status === "ready").length;
  const quarantined = rows.length - ready;
  await admin.from("trivia_batches").update({ status: "ready" }).eq("id", batchId);

  revalidatePath("/games/trivia/generate");
  revalidatePath("/games/trivia");
  return { batchId, ready, quarantined, ok: true };
}

/** Delete a batch and its questions (cascade). Adult-only. */
export async function deleteBatch(batchId: string): Promise<void> {
  await requireAdult();
  const admin = createAdminClient();
  const { error } = await admin.from("trivia_batches").delete().eq("id", batchId);
  if (error) throw new Error(error.message);
  revalidatePath("/games/trivia/generate");
}
