import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import {
  buildSystemPrompt,
  loadAgentFiles,
  loadTimelineBlock,
  loadFamilyDoc,
  loadHistory,
  messagesAsAnthropicTurns,
} from "@/lib/journal/context";
import { loadCalendarBlock } from "@/lib/journal/calendar";
import { requireUserId } from "@/lib/members/auth";
import { formatNow, getUserTimezone, localDate } from "@/lib/date-utils";
import type { JournalMessage } from "@/lib/types";

export const runtime = "nodejs";

// Keep the conversation going past the five-minute mark. The writer reached
// the end of the timed session, then chose to ask for one more question. We
// generate a fresh follow-up off the thread as it stands — no new user reply
// required — so the interviewer picks the thread back up where it left off.
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
  if (thread.length === 0) {
    return new Response("nothing to continue", { status: 409 });
  }

  // The thread can't end on the interviewer's turn — that's a question the
  // writer chose to leave unanswered when the timer ran out. Asking "one more"
  // there means a fresh question in its place, so drop the dangling one (and
  // restore it if generation comes back empty, like regenerate does).
  const last = thread[thread.length - 1];
  const danglingQuestion =
    last.role === "assistant" && last.content.trim().length > 0 ? last : null;
  if (danglingQuestion) {
    const { error: delErr } = await supabase
      .from("journal_messages")
      .delete()
      .eq("id", danglingQuestion.id);
    if (delErr) {
      return new Response(delErr.message, { status: 500 });
    }
    thread.pop();
  }

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const [files, history, calendarBlock, familyDoc, timelineBlock] = await Promise.all([
    loadAgentFiles(),
    loadHistory(today, entryId),
    loadCalendarBlock(today, tz),
    loadFamilyDoc(),
    loadTimelineBlock(today),
  ]);

  const continueInstruction = [
    "",
    "=== Keep going ===",
    "The five-minute session is complete, but the writer chose to keep going and asked for one more question. Ask a single fresh follow-up that builds naturally on what they've shared so far. Don't acknowledge the timer, the pause, or that they asked for more — simply continue the conversation.",
  ].join("\n");

  const system =
    buildSystemPrompt(
      files,
      history,
      today,
      calendarBlock,
      formatNow(new Date(), tz),
      familyDoc,
      timelineBlock
    ) +
    "\n" +
    continueInstruction;

  const turns = messagesAsAnthropicTurns(thread);

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
        } else if (danglingQuestion) {
          // Generation produced nothing — restore the question we dropped so
          // the thread isn't left short a turn.
          await supabase
            .from("journal_messages")
            .insert({ entry_id: entryId, role: "assistant", content: danglingQuestion.content, user_id: userId });
        }

        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (full.trim().length === 0 && danglingQuestion) {
          await supabase
            .from("journal_messages")
            .insert({ entry_id: entryId, role: "assistant", content: danglingQuestion.content, user_id: userId });
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
