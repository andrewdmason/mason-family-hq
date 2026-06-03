import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import {
  buildSystemPrompt,
  loadAgentFiles,
  loadFamilyDoc,
  loadHistory,
  messagesAsAnthropicTurns,
} from "@/lib/journal/context";
import { loadCalendarBlock } from "@/lib/journal/calendar";
import { requireUserId } from "@/lib/members/auth";
import { formatNow, getUserTimezone, localDate } from "@/lib/date-utils";
import type { JournalMessage } from "@/lib/types";

export const runtime = "nodejs";

// Regenerate the latest question: the user didn't connect with the question
// the interviewer just asked and wants a different one in its place.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { entryId?: string };
  const entryId = body.entryId;
  if (!entryId) {
    return new Response("entryId required", { status: 400 });
  }

  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .select("id, status")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) {
    return new Response("entry not found", { status: 404 });
  }
  if (entry.status !== "open") {
    return new Response("entry is closed; reopen first", { status: 409 });
  }

  const { data: existingMsgs, error: msgsErr } = await supabase
    .from("journal_messages")
    .select("id, entry_id, role, content, created_at")
    .eq("entry_id", entryId)
    .order("created_at", { ascending: true });
  if (msgsErr) {
    return new Response(msgsErr.message, { status: 500 });
  }

  const thread = (existingMsgs ?? []) as JournalMessage[];
  const last = thread[thread.length - 1];
  if (!last || last.role !== "assistant") {
    return new Response("nothing to regenerate", { status: 409 });
  }

  // Only follow-up questions can be regenerated. The opening question was
  // already chosen from the three-question picker, so leave it alone.
  const priorTurns = thread.slice(0, -1);
  if (priorTurns.length === 0) {
    return new Response("cannot regenerate the opening question", {
      status: 409,
    });
  }

  // Drop the rejected question; a fresh one is generated in its place.
  const rejected = last.content;
  const { error: delErr } = await supabase
    .from("journal_messages")
    .delete()
    .eq("id", last.id);
  if (delErr) {
    return new Response(delErr.message, { status: 500 });
  }

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const [files, history, calendarBlock, familyDoc] = await Promise.all([
    loadAgentFiles(),
    loadHistory(today, entryId),
    loadCalendarBlock(today, tz),
    loadFamilyDoc(),
  ]);

  const regenerateInstruction = [
    "",
    "=== Regenerate ===",
    "Ask one more follow-up question.",
    "The user didn't connect with the question below and wants a different one. Ask something genuinely different in shape, mood, and angle — not a rephrase of it. Do not echo or repeat it:",
    rejected,
  ].join("\n");

  const system =
    buildSystemPrompt(files, history, today, calendarBlock, formatNow(new Date(), tz), familyDoc) +
    "\n" +
    regenerateInstruction;

  const turns = messagesAsAnthropicTurns(priorTurns);

  const client = anthropic();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let full = "";
      try {
        const claudeStream = client.messages.stream({
          model: JOURNAL_MODEL,
          max_tokens: 1024,
          system,
          messages: turns,
        });

        for await (const event of claudeStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const chunk = event.delta.text;
            full += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
        }

        const trimmed = full.trim();
        if (trimmed.length > 0) {
          await supabase
            .from("journal_messages")
            .insert({ entry_id: entryId, role: "assistant", content: trimmed, user_id: userId });
        } else {
          // Generation produced nothing — restore the original question so
          // the thread isn't left short a turn.
          await supabase
            .from("journal_messages")
            .insert({ entry_id: entryId, role: "assistant", content: rejected, user_id: userId });
        }

        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (full.trim().length === 0) {
          await supabase
            .from("journal_messages")
            .insert({ entry_id: entryId, role: "assistant", content: rejected, user_id: userId });
        }
        controller.enqueue(encoder.encode(`\n\n[error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
